/*!
 * Copyright 2014 Apereo Foundation (AF) Licensed under the
 * Educational Community License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://opensource.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS"
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

/* eslint-disable unicorn/no-array-callback-reference */
import { callbackify, format } from 'node:util';
import _ from 'underscore';
import { logger } from 'oae-logger';
import { setUpConfig } from 'oae-config';
import { isEmpty } from 'ramda';

import { AuthenticationConstants } from 'oae-authentication/lib/constants.js';
import * as AuthzDelete from 'oae-authz/lib/delete.js';
import * as AuthzUtil from 'oae-authz/lib/util.js';
import {
  iterateAll as iterateResults,
  runBatchQuery,
  rowToHash,
  constructUpsertCQL,
  runAutoPagedQuery,
  runQuery
} from 'oae-util/lib/cassandra.js';
import * as OaeUtil from 'oae-util/lib/util.js';
import * as Redis from 'oae-util/lib/redis.js';

import { Group, User } from 'oae-principals/lib/model.js';
import { Validator as validator } from 'oae-authz/lib/validator.js';

import { LoginId } from 'oae-authentication/lib/model.js';
import { PrincipalsConstants } from '../constants.js';

const { unless, toBoolean, isPrincipalId, isArrayEmpty } = validator;

const log = logger('principals-dao');
const PrincipalsConfig = setUpConfig('oae-principals');

const RESTRICTED_FIELDS = ['acceptedTC', 'admin:tenant', 'admin:global', 'deleted'];

/**
 * Create a user record in the database
 *
 * @param  {User}       user            The user to persist
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error object, if any
 */
const createUser = function (user, callback) {
  const queries = [];

  // Persist the user object
  const values = {
    tenantAlias: user.tenant.alias,
    displayName: user.displayName,
    visibility: user.visibility,
    email: user.email,
    emailPreference: user.emailPreference,
    locale: user.locale,
    publicAlias: user.publicAlias,
    smallPictureUri: user.picture.smallUri,
    mediumPictureUri: user.picture.mediumUri,
    largePictureUri: user.picture.largeUri,
    acceptedTC: user.acceptedTC ? user.acceptedTC.toString() : null,
    isUserArchive: user.isUserArchive
  };
  queries.push(constructUpsertCQL('Principals', 'principalId', user.id, values));

  // Only map the email address to the user if it's verified
  if (user.email) {
    queries.push({
      query: 'INSERT INTO "PrincipalsByEmail" ("email", "principalId") VALUES (?, ?)',
      parameters: [user.email, user.id]
    });
  }

  return callbackify(runBatchQuery)(queries, callback);
};

/**
 * Create a group record in the database
 *
 * @param  {String}     groupId             The ID of the new group
 * @param  {String}     displayName         The displayName for this group
 * @param  {String}     description         A description for this group
 * @param  {String}     visibility          The visibility that should be set for this group. Should be one of `AuthzConstants.visibility`'s values
 * @param  {String}     joinable            Whether or not this group can be joined by people. Should be one of `AuthzConstants.joinable`'s values
 * @param  {String}     createdBy           The id of the user that created the group
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Group}      callback.group      The created group
 */
const createGroup = function (
  groupId,
  tenantAlias,
  displayName,
  description,
  visibility,
  joinable,
  createdBy,
  callback
) {
  let lastModified = Date.now();
  let created = new Date(lastModified);

  lastModified = lastModified.toString();
  created = created.toUTCString();

  const query =
    'INSERT INTO "Principals" ("principalId", "tenantAlias", "displayName", "description", "visibility", "joinable", "lastModified", "createdBy", "created") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
  const parameters = [
    groupId,
    tenantAlias,
    displayName,
    description,
    visibility,
    joinable,
    lastModified,
    createdBy,
    created
  ];

  callbackify(runQuery)(query, parameters, (error) => {
    if (error) {
      return callback(error);
    }

    const group = new Group(tenantAlias, groupId, displayName, {
      description,
      visibility,
      joinable,
      lastModified,
      created,
      createdBy
    });

    return callback(null, group);
  });
};

/**
 * Query a principal row from storage and map it to the appropriate principal object (user or group).
 *
 * @param  {String}        principalId         The id of the principal to query
 * @param  {Function}      callback            Standard callback function
 * @param  {Object}        callback.err        An error that occurred, if any
 * @param  {User|Group}    callback.principal  The principal, either a user or a group, depending on the type of entity to which the id mapped. If the principal does not exist, this will be `null`
 */
const getPrincipal = function (principalId, callback) {
  if (isUser(principalId)) {
    // Try and get the user from the cache first. If they aren't cached, we will fetch them from the DB and it will get cached then
    _getUserFromRedis(principalId, (error, user) => {
      if (error && error.code !== 404) {
        log().error({ err: error }, 'Error occurred when trying to get a user from Redis.');
      } else if (user) {
        // We found a user in the cache, immediately return it
        return callback(null, user);
      }

      // The user wasn't cached, fetch from the DB
      return getPrincipalSkipCache(principalId, callback);
    });
  } else {
    // Get groups from the DB
    return getPrincipalSkipCache(principalId, callback);
  }
};

/**
 * Query a set of principal rows from the database, ensuring each one exists. Note that this just
 * ensures that the principal has a record in Cassandra. If the user or group is marked as deleted
 * with a `deleted` flag, those users and groups will still be successfully returned from this
 * function
 *
 * @param  {String[]}   principalIds                        The ids of the principals to query
 * @param  {String[]}   [fields]                            The fields to select for the principals. By default, all fields will be fetched
 * @param  {Function}   callback                            Standard callback function
 * @param  {Object}     callback.err                        An error that occurred, if any
 * @param  {Object}     callback.principals                 A hash of principals, keyed by the principal id, and whose value is the principal (either user or group) to which the id mapped
 */
const getExistingPrincipals = function (principalIds, fields, callback) {
  if (_.isEmpty(principalIds)) {
    return callback(null, {});
  }

  getPrincipals(principalIds, fields, (error, principalsById) => {
    if (error) {
      return callback(error);
    }

    if (_.keys(principalsById).length !== principalIds.length) {
      return callback({ code: 400, msg: 'One or more provided principals did not exist' });
    }

    return callback(null, principalsById);
  });
};

/**
 * Query a set of principal rows from storage and map it to the appropriate principal object (user or group).
 *
 * @param  {String[]}   principalIds                        The ids of the principals to query
 * @param  {String[]}   [fields]                            The fields to select for the principals. By default, all fields will be fetched
 * @param  {Function}   callback                            Standard callback function
 * @param  {Object}     callback.err                        An error that occurred, if any
 * @param  {Object}     callback.principals                 A hash of principals, keyed by the principal id, and whose value is the principal (either user or group) to which the id mapped.
 */
const getPrincipals = function (principalIds, fields, callback) {
  if (_.isEmpty(principalIds)) {
    return callback(null, {});
  }

  // If we're only requesting 1 principal we can hand it off to the getPrincipal method.
  // This will try looking in the cache first, which might be faster
  if (principalIds.length === 1) {
    getPrincipal(principalIds[0], (error, user) => {
      if (error && error.code === 404) {
        // This method never returns an error if any principals in the listing are missing,
        // even if it is just a listing of 1 principal (e.g., a library of 1 item)
        return callback(null, {});
      }

      if (error) {
        return callback(error);
      }

      const users = {};
      users[principalIds[0]] = user;
      return callback(null, users);
    });
    return;
  }

  // Build the query and parameters to select just the specified fields
  let query = null;
  let parameters = [];

  // If `fields` was specified, we select only the fields specified. Otherwise we select all (i.e., *)
  if (fields) {
    const columns = [];
    _.map(fields, (field) => {
      columns.push(format('"%s"', field));
    });
    query = 'SELECT ' + columns.join(',') + ' FROM "Principals" WHERE "principalId" IN ?';
  } else {
    query = 'SELECT * FROM "Principals" WHERE "principalId" IN ?';
  }

  parameters = [principalIds];

  callbackify(runQuery)(query, parameters, (error, rows) => {
    if (error) {
      return callback(error);
    }

    const principals = _.chain(rows).map(_getPrincipalFromRow).compact().indexBy('id').value();

    return callback(null, principals);
  });
};

/**
 * Update the profile fields of a principal.
 *
 * @param  {String}     principalId     The id of the principal to update
 * @param  {Object}     profileFields   An object containing the profile field updates to apply
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const updatePrincipal = function (principalId, profileFields, callback) {
  // Ensure the caller is not trying to set an invalid field
  const invalidKeys = _.intersection(RESTRICTED_FIELDS, _.keys(profileFields));

  try {
    unless(isArrayEmpty, {
      code: 400,
      msg: 'Attempted to update an invalid property'
    })(invalidKeys);
  } catch (error) {
    return callback(error);
  }

  // Perform the update
  return _updatePrincipal(principalId, profileFields, callback);
};

/**
 * Marks a principal as being deleted. Currently only groups are supported
 *
 * @param  {String}     principalId     The id of the principal to mark as deleted
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const deletePrincipal = function (principalId, callback) {
  const deleted = Date.now();

  // Determine if the principal was already deleted in the authz index before we set them and flip
  // the principals deleted flag
  AuthzDelete.isDeleted([principalId], (error, wasDeleted) => {
    if (error) {
      return callback(error);
    }

    // Set (or re-Set) the principal as deleted in the authz index
    AuthzDelete.setDeleted(principalId, (error_) => {
      if (error_) {
        return callback(error_);
      }

      _updatePrincipal(principalId, { deleted }, (error_) => {
        if (error_) {
          // If updating the principal field fails, we want to make sure we try and unset
          // the principal as being deleted if it wasn't set before
          if (!wasDeleted[principalId]) {
            AuthzDelete.unsetDeleted(principalId);
          }

          return callback(error_);
        }

        return callback();
      });
    });
  });
};

/**
 * Restores a principal from its deleted state. Currently only groups are supported
 *
 * @param  {String}     principalId     The id of the principal to restore from being deleted
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const restorePrincipal = function (principalId, callback) {
  // Determine if the principal was already deleted in the authz index before we unset them and
  // flip the principals deleted flag
  AuthzDelete.isDeleted([principalId], (error, wasDeleted) => {
    if (error) {
      return callback(error);
    }

    // Unset (or re-Unset) the principal as deleted in the authz index
    AuthzDelete.unsetDeleted(principalId, (error_) => {
      if (error_) {
        return callback(error_);
      }

      _deletePrincipalFields(principalId, ['deleted'], (error_) => {
        if (error_) {
          // If updating the principal field fails, we want to make sure we try and re-set
          // the principal as being deleted if was set before
          if (wasDeleted[principalId]) {
            AuthzDelete.setDeleted(principalId);
          }

          return callback(error_);
        }

        return callback();
      });
    });
  });
};

/**
 * Accepts the Terms and Conditions for a user
 *
 * @param  {String}     userId          The id of the user that accepts the Terms and Conditions
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const acceptTermsAndConditions = function (userId, callback) {
  callbackify(runQuery)(
    'UPDATE "Principals" SET "acceptedTC" = ? WHERE "principalId" = ?',
    [Date.now().toString(), userId],
    (error) => {
      if (error) {
        return callback(error);
      }

      return invalidateCachedUsers([userId], callback);
    }
  );
};

/**
 * Makes a user either a global admin or tenant admin.
 *
 * @param  {String}         adminType       One of `admin:global` or `admin:tenant` to make the user either a global admin or tenant admin, respectively.
 * @param  {Boolean}        isAdmin         Flag that indicates whether this user should be an admin or not.
 * @param  {String}         userId          The id of the user that needs to be made an admin.
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 */
const setAdmin = function (adminType, isAdmin, userId, callback) {
  // Ensure we're using a real principal id. If we weren't, we would be dangerously upserting an invalid row
  try {
    unless(isPrincipalId, {
      code: 400,
      msg: 'Attempted to update a principal with a non-principal id'
    })(userId);
  } catch (error) {
    return callback(error);
  }

  const query = format('UPDATE "Principals" SET "%s" = ? WHERE "principalId" = ?', adminType);
  callbackify(runQuery)(query, [String(isAdmin), userId], (error) => {
    if (error) {
      return callback(error);
    }

    return invalidateCachedUsers([userId], callback);
  });
};

/**
 * Get the email token for a user
 *
 * @param  {String}     userId              The id of the user for who to get the email token
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error object, if any
 * @param  {String}     callback.email      The email that is associated with the token
 * @param  {String}     callback.token      The token that can be used to verify the email with
 */
const getEmailToken = function (userId, callback) {
  callbackify(runQuery)('SELECT * FROM "PrincipalsEmailToken" WHERE "principalId" = ?', [userId], (error, rows) => {
    if (error) {
      return callback(error);
    }

    if (_.isEmpty(rows)) {
      return callback({ code: 404, msg: 'No email token found for the given user id' });
    }

    const token = _.first(rows).get('token');
    const email = _.first(rows).get('email');
    return callback(null, email, token);
  });
};

/**
 * Delete a pending email token for a user
 *
 * @param  {String}     userId              The id of the user to for whom to delete the pending email token
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const deleteEmailToken = function (userId, callback) {
  callbackify(runQuery)('DELETE FROM "PrincipalsEmailToken" WHERE "principalId" = ?', [userId], callback);
};

/**
 * Get a set of users by their email address
 *
 * @param  {String[]}   emails                      The email addresses with which to look up associated user ids
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error object, if any
 * @param  {Object}     callback.userIdsByEmail     An object keyed by email, whose value are the user ids associated to that email
 */
const getUserIdsByEmails = function (emails, callback) {
  callbackify(runQuery)('SELECT * FROM "PrincipalsByEmail" WHERE "email" IN ?', [emails], (error, rows) => {
    if (error) {
      return callback(error);
    }

    const userIdsByEmail = _.chain(rows)
      .map(rowToHash)
      .groupBy('email')
      .mapObject((principalIdEmailHashes) => _.pluck(principalIdEmailHashes, 'principalId'))
      .value();
    return callback(null, userIdsByEmail);
  });
};

/**
 * Store an email token
 *
 * @param  {String}     userId          The id of the user for whom the token is associated
 * @param  {String}     email           The email address to store the token for
 * @param  {String}     token           The token to store
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error object, if any
 */
const storeEmailToken = function (userId, email, token, callback) {
  const q = constructUpsertCQL('PrincipalsEmailToken', 'principalId', userId, {
    email,
    token
  });
  callbackify(runQuery)(q.query, q.parameters, callback);
};

/**
 * Set the email address for a user. This will also map the user to the email address
 *
 * @param  {User}       user            The user to update
 * @param  {String}     email           The new email address of the user
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error object, if any
 * @param  {User}       callback.user   The updated user
 */
const setEmailAddress = function (user, email, callback) {
  const queries = [];

  // The token is correct, change the email address
  const principalsUpdate = { email };
  queries.push(
    constructUpsertCQL('Principals', 'principalId', user.id, principalsUpdate),
    {
      query: 'DELETE FROM "PrincipalsEmailToken" WHERE "principalId" = ?',
      parameters: [user.id]
    },
    {
      query: 'INSERT INTO "PrincipalsByEmail" ("email", "principalId") VALUES (?, ?)',
      parameters: [email, user.id]
    }
  );

  // Remove the old mapping, if any
  if (user.email && user.email !== email) {
    queries.push({
      query: 'DELETE FROM "PrincipalsByEmail" WHERE "email" = ? AND "principalId" = ?',
      parameters: [user.email, user.id]
    });
  }

  callbackify(runBatchQuery)(queries, (error) => {
    if (error) {
      return callback(error);
    }

    // Invalidate the cached user object as it has changed
    _updateCachedUser(user.id, principalsUpdate, (error) => {
      if (error) {
        return callback(error);
      }

      // Return the new user
      return getPrincipal(user.id, callback);
    });
  });
};

/**
 * Iterate through all the principals. This will return just the raw principal properties that are specified in the `properties`
 * parameter, and only `batchSize` principals at a time. On each iteration of `batchSize` principals, the `onEach` callback
 * will be invoked, and the next batch will not be fetched until you have invoked the `onEach.done` function parameter. When
 * complete (e.g., there are 0 principals left to iterate through or an error has occurred), the `callback` parameter will be
 * invoked.
 *
 * @param  {String[]}   [properties]            The names of the principal properties to return in the principal objects. If not specified (or is empty array), it returns just the `principalId`s
 * @param  {Number}     [batchSize]             The number of principals to fetch at a time. Defaults to 100
 * @param  {Function}   onEach                  Invoked with each batch of principals that are fetched from storage
 * @param  {Object[]}   onEach.principalRows    An array of objects holding the raw principal rows that were fetched from storage
 * @param  {Function}   onEach.done             The function to invoke when processing of the current batch is complete
 * @param  {Object}     onEach.done.err         An error that occurred, if any, while processing the current batch. If you specify this error, iteration will finish and the completion callback will be invoked
 * @param  {Function}   [callback]              Invoked when all rows have been iterated, or an error has occurred
 * @param  {Object}     [callback.err]          An error that occurred, while iterating rows, if any
 * @see Cassandra#iterateAll
 */
const iterateAll = function (properties, batchSize, onEach, callback) {
  // eslint-disable-next-line unicorn/explicit-length-check
  if (!properties || !properties.length) {
    properties = ['principalId'];
  }

  /*!
   * Handles each batch from the cassandra iterateAll method.
   *
   * @see Cassandra#iterateAll
   */
  const _iterateAllOnEach = function (rows, done) {
    // Convert the rows to a hash and delegate action to the caller onEach method
    return onEach(_.map(rows, rowToHash), done);
  };

  return callbackify(iterateResults)(
    properties,
    'Principals',
    'principalId',
    { batchSize },
    _iterateAllOnEach,
    callback
  );
};

/**
 * Determine whether or not the given string represents a group id.
 *
 * @param  {String}  groupId    A string that may or may not be a group id
 * @return {Boolean}            Whether or not the provided identifier is a group identifier.
 */
const isGroup = function (groupId) {
  return AuthzUtil.isGroupId(groupId);
};

/**
 * Determine whether or not the given string represents a user id.
 *
 * @param  {String}  userId     A string that may or may not be a user id
 * @return {Boolean}            Whether or not the provided identifier is a user identifier
 */
const isUser = function (userId) {
  return AuthzUtil.isUserId(userId);
};

/**
 * Perform a raw update with the given profile fields without any checking if restricted fields are
 * being set, and ensuring the cache remains in a valid state
 *
 * @param  {String}     principalId     The id of the principal to update
 * @param  {Object}     profileFields   An object containing the profile field updates to apply
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _updatePrincipal = function (principalId, profileFields, callback) {
  // Take out the `principalId` to avoid setting a partial cache entry. Also ensure we have a
  // `lastModified` set for the update
  profileFields = _.chain({})
    .defaults(profileFields, { lastModified: Date.now().toString() })
    .omit('principalId')
    .value();

  // Ensure we aren't updating a non-principal to avoid upserting invalid rows
  try {
    unless(isPrincipalId, {
      code: 400,
      msg: 'Attempted to update a principal with a non-principal id'
    })(principalId);
  } catch (error) {
    return callback(error);
  }

  // If a change is being made to the email address, we need to update the mapping
  _isEmailAddressUpdate(principalId, profileFields, (error, isEmailAddressUpdate, oldEmail) => {
    if (error) {
      return callback(error);
    }

    const queries = [];

    // Update the principal record
    queries.push(constructUpsertCQL('Principals', 'principalId', principalId, profileFields));

    // If the user's email address needs to be updated, we remove the old one from the mapping
    if (isEmailAddressUpdate) {
      queries.push(
        {
          query: 'DELETE FROM "PrincipalsByEmail" WHERE "email" = ? AND "principalId" = ?',
          parameters: [oldEmail, principalId]
        },
        {
          query: 'INSERT INTO "PrincipalsByEmail" ("email", "principalId") VALUES (?, ?)',
          parameters: [profileFields.email, principalId]
        }
      );
    }

    // Execute the queries
    callbackify(runBatchQuery)(queries, (error_) => {
      if (error_) {
        return callback(error_);
      }

      // Update the cache, if necessary
      return OaeUtil.invokeIfNecessary(isUser(principalId), _updateCachedUser, principalId, profileFields, callback);
    });
  });
};

/**
 * Remove the specified fields from the principal
 *
 * @param  {String}     principalId     The id of the principal whose fields to delete
 * @param  {String[]}   profileFields   The names of the fields to delete
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const _deletePrincipalFields = function (principalId, profileFields, callback) {
  // Remove the specified fields
  const query = format('DELETE "%s" FROM "Principals" where "principalId" = ?', profileFields.join('", "'));
  callbackify(runQuery)(query, [principalId], (error) => {
    if (error) return callback(error);

    // If the principal is a user, invalidate their cache entry. They are being invalidated
    // rather than simply updated in the cache because we have removed fields
    OaeUtil.invokeIfNecessary(isUser(principalId), invalidateCachedUsers, [principalId], (error) => {
      if (error) {
        return callback(error);
      }

      // This is an update, so we also need to touch the principal
      _updatePrincipal(principalId, {}, (error) => {
        if (error) {
          // We bypass indicating an error to the consumer in this case as we have
          // successfully removed the fields in both Cassandra and the cache
          log().warn(
            {
              err: error,
              principalId
            },
            'An unexpected error occurred while trying to touch a principal timestamp'
          );
        }

        return callback();
      });
    });
  });
};

/**
 * Check whether the email address for a user would be updated when updating a set of `profileFields`
 *
 * @param  {String}     principalId                         The id of the principal to update
 * @param  {Object}     profileFields                       An object containing the profile field updates to apply
 * @param  {Function}   callback                            Standard callback function
 * @param  {Object}     callback.err                        An error that occurred, if any
 * @param  {Boolean}    calllback.isEmailAddressUpdate      Whether the email address will be updated
 * @param  {String}     callback.oldEmail                   The user's old email address
 * @api private
 */
const _isEmailAddressUpdate = function (principalId, profileFields, callback) {
  if (!isUser(principalId) || !profileFields.email) {
    return callback(null, false);
  }

  getPrincipal(principalId, (error, user) => {
    if (error) {
      return callback(error);
    }

    if (user.email !== profileFields.email) {
      return callback(null, true, user.email);
    }

    return callback(null, false);
  });
};

/**
 * Get a principal from Cassandra.
 *
 * @param  {String}         principalId         The ID of the principal that should be retrieved.
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Group|User}     callback.principal  The requested principal
 * @api private
 */
const getPrincipalSkipCache = function (principalId, callback) {
  callbackify(runQuery)('SELECT * FROM "Principals" WHERE "principalId" = ?', [principalId], (error, rows) => {
    if (error) {
      return callback(error);
    }

    if (_.isEmpty(rows)) {
      return callback({ code: 404, msg: "Couldn't find principal: " + principalId });
    }

    if (isUser(principalId)) {
      // Update the cache with the raw cassandra row asynchronously to the response. It is not
      // necessary for this to complete or be successful before we return to the caller. Note
      // that it is storing a full cache entry, not updating an existing one which is why this
      // is safe
      _updateCachedUser(principalId, rowToHash(rows[0]));
    }

    return callback(null, _getPrincipalFromRow(rows[0]));
  });
};

/**
 * Update a user record in the cache. If the user did not exist prior, this will result in an upsert (i.e., a potentially
 * partial record containing only the fields that were updated). In order to detect an incomplete record, the `principalId`
 * is checked for existence. Therefore, if you are upserting a potentially partial match here, ensure that the `principalId`
 * is *not* part of the `fields` object. If you are upserting a FULL copy (e.g., just fetched * from Cassandra), then
 * persist the principalId with the `fields`.
 *
 * @param  {String}     userId          The ID of the user to update in the cache
 * @param  {Object}     fields          The profile fields of the user to update in the cache
 * @param  {Function}   [callback]      Standard callback function
 * @param  {Object}     [callback.err]  An error that occurred, if any
 */
const _updateCachedUser = function (userId, fields, callback) {
  callback =
    callback ||
    function (error) {
      if (error) {
        log().warn({ err: error }, 'Error updating cached user in Redis');
      }
    };

  _transformUserFieldTypes(fields);

  // Clean out null and undefined values
  _.each(fields, (value, key) => {
    if (OaeUtil.isUnspecified(value)) {
      delete fields[key];
    } else {
      // Ensure we have all strings
      fields[key] = String(value);
    }
  });

  if (_.isEmpty(fields)) {
    return callback();
  }

  return Redis.getClient().hmset(userId, fields, callback);
};

/**
 * Get a user from Redis. If the user can't be found an error object with code 404 will be returned.
 *
 * @param  {String}     userId              The ID of the user that should be retrieved
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {User}       callback.principal  The requested user
 * @api private
 */
const _getUserFromRedis = function (userId, callback) {
  Redis.getClient().hgetall(userId, (error, hash) => {
    if (error) {
      return callback({ code: 500, msg: error });
      // Since we also push updates into redis, use the user id as a slug to ensure that the user doesn't exist in
      // cache by virtue of an upsert
    }

    if (!hash || !hash.principalId || _.isEmpty(hash)) {
      return callback({ code: 404, msg: 'Principal not found in redis' });
    }

    return callback(null, _hashToUser(hash));
  });
};

/**
 * Creates a User or Group from a cassandra row.
 *
 * @param  {Row}        row     Cassandra Row
 * @return {User|Group}         A user or group object
 * @api private
 */
const _getPrincipalFromRow = function (row) {
  if (row.count <= 1 || !row.tenantAlias) {
    return null;
  }

  return isGroup(row.get('principalId')) ? _getGroupFromRow(row) : _getUserFromRow(row);
};

/**
 * Creates a Group from a Cassandra row.
 *
 * @param  {Row}    row     Cassandra Row
 * @return {Group}          A group object
 * @api private
 */
const _getGroupFromRow = function (row) {
  const hash = rowToHash(row);

  // Helenus returns the timestamp data-type as a string. Lets convert them to millis since the
  // epoch
  _timestampToMillis(hash, 'created');
  _timestampToMillis(hash, 'deleted');

  return new Group(hash.tenantAlias, hash.principalId, hash.displayName, hash);
};

/**
 * Creates a User from a Cassandra row.
 *
 * @param  {Row}    row     Cassandra Row
 * @return {User}           A User object
 * @api private
 */
const _getUserFromRow = function (row) {
  const hash = rowToHash(row);

  _transformUserFieldTypes(hash);

  return _hashToUser(hash);
};

/**
 * Given a potentially partial storage hash of a user, fix up the types. This particularly means
 * turn the string timestamp identifiers into a millis-since-the-epoch numeric value
 *
 * @param  {Object}     hash    A partial user storage object
 * @return {Object}             The hash with appropriate field types transformed
 */
const _transformUserFieldTypes = function (hash) {
  _timestampToMillis(hash, 'deleted');
};

/**
 * Creates a User from a hash.
 *
 * @param  {Object}     hash    Hash that has the required keys and values
 * @return {User}               User object representing the created user
 * @api private
 */
const _hashToUser = function (hash) {
  const user = new User(hash.tenantAlias, hash.principalId, hash.displayName, hash.email, {
    visibility: hash.visibility,
    deleted: hash.deleted,
    locale: hash.locale,
    publicAlias: hash.publicAlias,
    isGlobalAdmin: toBoolean(String(hash['admin:global']), true),
    isTenantAdmin: toBoolean(String(hash['admin:tenant']), true),
    smallPictureUri: hash.smallPictureUri,
    mediumPictureUri: hash.mediumPictureUri,
    largePictureUri: hash.largePictureUri,
    notificationsUnread: OaeUtil.getNumberParam(hash.notificationsUnread),
    notificationsLastRead: OaeUtil.getNumberParam(hash.notificationsLastRead),
    emailPreference: hash.emailPreference || PrincipalsConfig.getValue(hash.tenantAlias, 'user', 'emailPreference'),
    acceptedTC: OaeUtil.getNumberParam(hash.acceptedTC, 0),
    lastModified: OaeUtil.getNumberParam(hash.lastModified),
    isUserArchive: hash.isUserArchive
  });
  return user;
};

/**
 * Convenience function to convert a value that is a Cassandra timestamp into millis since the
 * epoch. This updates the specified `key` of the given `obj` object
 *
 * @param  {Object}     obj     Arbitrary object on which to convert the key
 * @param  {String}     key     The name of the property to convert
 * @api private
 */
const _timestampToMillis = function (object, key) {
  if (object[key]) {
    object[key] = new Date(object[key]).getTime();
  }
};

/**
 * Fields that are not allowed to be set by a call to `updatePrincipal`.
 *
 * @return {String[]}   An array of fields that are not allowed to be set by a call to `updatePrincipal`
 */
const getRestrictedFields = function () {
  return [...RESTRICTED_FIELDS];
};

/**
 * Invalidates a set of users in the cache.
 *
 * @param  {String[]}    userIds         The IDs of the users you wish to invalidate
 * @param  {Function}    callback        Standard callback function
 * @param  {Object}      callback.err    An error that occurred, if any
 */
const invalidateCachedUsers = function (userIds, callback) {
  Redis.getClient().del(userIds, callback);
};

/**
 * Create or update a record of a user visiting a group in the database
 *
 * @param  {User}       user            The user that visited
 * @param  {Group}      group           The group that was visited
 * @param  {Date}       visit           The time of the last visit
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error object, if any
 */
const setLatestVisit = function (user, group, visit, callback) {
  const q = constructUpsertCQL('UsersGroupVisits', ['userId', 'groupId'], [user.id, group.id], {
    latestVisit: visit.getTime().toString()
  });

  return callbackify(runQuery)(q.query, q.parameters, callback);
};

/**
 * Query IDs of all groups for a user and when they were visited.
 *
 * @param  {String}        userId              The id of the user to query
 * @param  {Function}      callback            Standard callback function
 * @param  {Object}        callback.err        An error that occurred, if any
 * @param  [Group]         callback.groups     Groups the user has visited. If the user has visited no groups, an empty list will be returned
 */
const getVisitedGroups = function (userId, callback) {
  if (isUser(userId)) {
    return _getVisitedGroupsFromCassandra(userId, callback);
  }

  return callback({ code: 404, msg: "Couldn't find user: " + userId });
};

/**
 * Get IDs of all groups for a user and when they were visited.
 *
 * @param  {String}         userId              The ID of the user whose groups should be retrieved.
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Group|User}     callback.groups     The groups user has visited
 * @api private
 */
const _getVisitedGroupsFromCassandra = function (userId, callback) {
  callbackify(runQuery)('SELECT * FROM "UsersGroupVisits" WHERE "userId" = ?', [userId], (error, rows) => {
    if (error) {
      return callback(error);
    }

    if (_.isEmpty(rows)) {
      return callback(null, []);
    }

    const groups = _.map(rows, (row) => {
      const hash = rowToHash(row);
      hash.latestVisit = OaeUtil.getNumberParam(hash.latestVisit);
      return hash;
    });

    return callback(null, groups);
  });
};

/**
 * Get all the users for a given tenancy. Uses an index on the Principals table.
 *
 * @param  {String}         tenantAlias         The tenant for which users should be retrieved.
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  [User]           callback.users      The list of users for the given tenancy
 * @api private
 */
const getAllUsersForTenant = function (tenantAlias, callback) {
  const query = 'SELECT * FROM "Principals" WHERE "tenantAlias" = ?';
  runAutoPagedQuery(query, [tenantAlias], (error, rows) => {
    if (error) {
      return callback(error);
    }

    if (isEmpty(rows)) return callback(null, []);

    const users = _.map(rows, (row) => {
      if (isUser(row.get('principalId'))) {
        return _getUserFromRow(row);
      }
    });
    log().info('Found %s users for tenant %s', users.length, tenantAlias);
    return callback(null, users);
  });
};

/**
 * Create a request
 *
 * @param  {String}         principalId                 The princiapl who wants to join the group
 * @param  {String}         groupId                     The group id
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 */
const createRequestJoinGroup = function (principalId, groupId, callback) {
  const lastModified = Date.now().toString();

  callbackify(runQuery)(
    'INSERT INTO "GroupJoinRequestsByGroup" ("groupId", "principalId", "created_at", "updated_at", "status") VALUES (?, ?, ?, ?, ?)',
    [groupId, principalId, lastModified, lastModified, PrincipalsConstants.requestStatus.PENDING],
    (error) => {
      if (error) {
        return callback(error);
      }

      return callback();
    }
  );
};

/**
 * Update a request
 *
 * @param  {String}         principalId                 The princiapl who wants to join the group
 * @param  {String}         groupId                     The group id
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 */
const updateJoinGroupByRequest = function (principalId, groupId, status, callback) {
  const queries = [];
  const lastModified = Date.now().toString();

  queries.push({
    query:
      'UPDATE "GroupJoinRequestsByGroup" SET "status" = ?, "updated_at" = ? WHERE "groupId" = ? AND "principalId" = ?',
    parameters: [status, lastModified, groupId, principalId]
  });

  // Execute the queries
  callbackify(runBatchQuery)(queries, (error) => {
    if (error) {
      return callback(error);
    }

    return callback();
  });
};

/**
 * Get all requests related to a group
 *
 * @param  {String}         groupId                     The group id
 * @param  {String}         principalId                 The princiapl who wants to join the group
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 */
const getJoinGroupRequest = function (groupId, principalId, callback) {
  callbackify(runQuery)(
    'SELECT * FROM "GroupJoinRequestsByGroup" WHERE "groupId" = ? AND "principalId" = ?',
    [groupId, principalId],
    (error, row) => {
      if (error) {
        return callback(error);
      }

      if (_.isEmpty(row)) {
        return callback();
      }

      const hash = rowToHash(row[0]);
      return callback(null, hash);
    }
  );
};

/**
 * Get all requests related to a group
 *
 * @param  {String}         groupId                     The group id
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 */
const getJoinGroupRequests = function (groupId, callback) {
  callbackify(runQuery)('SELECT * FROM "GroupJoinRequestsByGroup" WHERE "groupId" = ?', [groupId], (error, rows) => {
    if (error) {
      return callback(error);
    }

    if (_.isEmpty(rows)) {
      return callback();
    }

    const users = _.map(rows, (row) => rowToHash(row));

    return callback(null, users);
  });
};

/**
 * Permanently delete a user fromm every where in the database
 *
 * @param  {Object}     user            The principal to permanently delete
 * @param  {String}     login           The login of the principal to permanently delete
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const fullyDeletePrincipal = function (user, login, callback) {
  const queries = [];
  const deleted = Date.now();
  const loginId = new LoginId(user.tenant.alias, AuthenticationConstants.providers.LOCAL, login.local);

  // Delete user from table Principals
  queries.push(
    { query: 'DELETE FROM "Principals" where "principalId" = ?', parameters: [user.id] },
    { query: 'DELETE FROM "PrincipalsEmailToken" WHERE "principalId" = ?', parameters: [user.id] },
    {
      query: 'DELETE FROM "PrincipalsByEmail" where "email" = ? AND "principalId" = ?',
      parameters: [user.email, user.id]
    },
    { query: 'DELETE FROM "AuthenticationUserLoginId" WHERE "userId" = ?', parameters: [user.id] }
  );

  // Delete user from table AuthenticationLoginId
  if (loginId && loginId.tenantAlias && loginId.provider && loginId.externalId) {
    queries.push({
      query: 'DELETE FROM "AuthenticationLoginId" WHERE "loginId" = ?',
      parameters: [loginId.tenantAlias + ':' + loginId.provider + ':' + loginId.externalId]
    });
  }

  callbackify(runBatchQuery)(queries, (error) => {
    if (error) return callback(error);

    // Update the cache
    return OaeUtil.invokeIfNecessary(isUser(user.id), _updateCachedUser, user.id, { deleted }, callback);
  });
};

/**
 * Create user Archive
 *
 * @param  {String}         alias               The tenant alias
 * @param  {String}         createdUserId       The user archive id
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  [User]           callback.user       The user archive creates for this tenant
 */
const createArchivedUser = function (alias, createdUserId, callback) {
  // Prepare query
  const query = 'INSERT INTO "ArchiveByTenant" ("tenantAlias", "archiveId") VALUES (?, ?)';
  const parameters = [alias, createdUserId];

  // Run query
  callbackify(runQuery)(query, parameters, (error) => {
    if (error) {
      return callback(error);
    }

    const userArchive = { tenantAlias: alias, archiveId: createdUserId };
    return callback(null, userArchive);
  });
};

/**
 * Get datas from user archive
 *
 * @param  {String}         archiveId           The archive id ot the principal tenant
 * @param  {String}         principalId         The principal id of the removed user
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  [Id]             callback.datas      The list of id resources that belonged to the user deleted
 */
const getDataFromArchive = function (archiveId, principalId, callback) {
  // Verify if an archive user exist
  callbackify(runQuery)(
    'SELECT * FROM "DataArchive" WHERE "archiveId" = ? AND "principalId" = ?',
    [archiveId, principalId],
    (error, rows) => {
      if (error) {
        return callback(error);
      }

      if (_.isEmpty(rows)) {
        return callback({ code: 404, msg: 'Principal not found in DataArchive' });
      }

      const userArchive = _.map(rows, rowToHash);
      return callback(null, userArchive[0]);
    }
  );
};

/**
 * Add datas in user archive
 *
 * @param  {String}         archiveId           The archive id ot the principal tenant
 * @param  {String}         principalId         The principal id of the removed user
 * @param  {String}         resourceId          The resource id of the removed user
 * @param  {String}         date                The date after which an archived user is deleted
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  [User]           callback.users      The list of users for the given tenancy
 */
const addDataToArchive = function (archiveId, principalId, resourceId, date, callback) {
  const stringResource = resourceId.join(',');

  callbackify(runQuery)(
    'INSERT INTO "DataArchive" ("archiveId", "principalId", "resourceId", "deletionDate") VALUES (?, ?, ?, ?)',
    [archiveId, principalId, stringResource, date],
    (error) => {
      if (error) return callback(error);

      return callback();
    }
  );
};

/**
 * Remove the principal from the DataArchive
 *
 * @param  {String}         archiveId           The archive id ot the principal tenant
 * @param  {String}         principalId         The principal id of the removed user
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 *  */
const removePrincipalFromDataArchive = function (archiveId, principalId, callback) {
  callbackify(runQuery)(
    'DELETE FROM "DataArchive" WHERE "archiveId" = ? AND "principalId" = ?',
    [archiveId, principalId],
    (error) => {
      if (error) return callback(error);

      return callback();
    }
  );
};

/**
 * Get a user archive from a tenant
 *
 * @param  {String}         alias                   The tenant alias
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Object}         callback.userArchive    The archive of the tenant
 */
const getArchivedUser = function (alias, callback) {
  callbackify(runQuery)('SELECT * FROM "ArchiveByTenant" WHERE "tenantAlias" = ?', [alias], (error, rows) => {
    if (error) return callback(error);

    const userArchive = _.map(rows, rowToHash);
    return callback(null, userArchive[0]);
  });
};

/**
 * Get all expired users
 *
 * @param  {Date}           actualDate              The actual date
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  [Object]         callback.users          A list of users
 */
const getExpiredUser = function (actualDate, callback) {
  callbackify(runQuery)('SELECT * FROM "DataArchive"', [], (error, rows) => {
    if (error) return callback(error);
    if (_.isEmpty(rows)) return callback(null, []);

    const users = _.chain(rows)
      .map(rowToHash)
      .filter((user) => new Date(user.deletionDate) < actualDate)
      .value();
    return callback(null, users);
  });
};

/**
 * Update the archive user flag. This user will be now considered as a user archive.
 *
 * @param  {String}         principalId         The principal id of the removed user
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 */
const updateUserArchiveFlag = function (principalId, callback) {
  callbackify(runQuery)(
    'UPDATE "Principals" SET "isUserArchive" = ? WHERE "principalId" = ?',
    ['true', principalId],
    (error) => {
      if (error) return callback(error);

      return callback();
    }
  );
};

export {
  fullyDeletePrincipal,
  createUser,
  createGroup,
  getPrincipal,
  getPrincipalSkipCache,
  getExistingPrincipals,
  getPrincipals,
  updatePrincipal,
  deletePrincipal,
  restorePrincipal,
  acceptTermsAndConditions,
  setAdmin,
  getEmailToken,
  deleteEmailToken,
  getUserIdsByEmails,
  storeEmailToken,
  setEmailAddress,
  iterateAll,
  isGroup,
  isUser,
  getRestrictedFields,
  invalidateCachedUsers,
  setLatestVisit,
  getVisitedGroups,
  getAllUsersForTenant,
  createRequestJoinGroup,
  updateJoinGroupByRequest,
  getJoinGroupRequest,
  getJoinGroupRequests,
  createArchivedUser,
  getDataFromArchive,
  addDataToArchive,
  removePrincipalFromDataArchive,
  getArchivedUser,
  getExpiredUser,
  updateUserArchiveFlag
};
