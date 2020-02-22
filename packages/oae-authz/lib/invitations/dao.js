/*!
 * Copyright 2015 Apereo Foundation (AF) Licensed under the
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

import util from 'util';
import _ from 'underscore';
import Chance from 'chance';

import * as Cassandra from 'oae-util/lib/cassandra';

import { Validator as validator } from 'oae-authz/lib/validator';
const {
  unless,
  validateInCase: bothCheck,
  isResourceId,
  isEmail,
  isValidRole,
  isString,
  isUserId,
  isValidRoleChange
} = validator;
import { not, equals, forEachObjIndexed } from 'ramda';

const chance = new Chance();

const TOKEN_POOL = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';

/**
 * Get the current invitation tokens for the specified emails. For any email that is not associated
 * to a token, one will be randomly generated for it
 *
 * @param  {String[]}   emails                  The emails for which to get or create tokens
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.emailTokens    An object keyed by email, whose value is the invitation token associated to it
 */
const getOrCreateTokensByEmails = function(emails, callback) {
  getTokensByEmails(emails, (err, emailTokens) => {
    if (err) {
      return callback(err);
    }

    const queries = [];

    // For each email that did not have an invitation associated to it, persist one and add it
    // to the email tokens hash
    _.each(emails, email => {
      if (!emailTokens[email]) {
        const token = chance.string({ length: 12, pool: TOKEN_POOL });
        queries.push(
          Cassandra.constructUpsertCQL('AuthzInvitationsTokenByEmail', 'email', email, {
            token
          }),
          Cassandra.constructUpsertCQL('AuthzInvitationsEmailByToken', 'token', token, {
            email
          })
        );
        emailTokens[email] = token;
      }
    });

    // If all the emails had tokens, we can just return without doing any queries
    if (_.isEmpty(queries)) {
      return callback(null, emailTokens);
    }

    // Add the missing email tokens to the invitations token tables
    Cassandra.runBatchQuery(queries, err => {
      if (err) {
        return callback(err);
      }

      return callback(null, emailTokens);
    });
  });
};

/**
 * Get the email tokens associated to the specified emails
 *
 * @param  {String[]}   emails                  The emails for which to get the tokens
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.emailTokens    An object keyed by email, whose value is the invitation token associated to it
 */
const getTokensByEmails = function(emails, callback) {
  // Get all existing tokens for emails
  Cassandra.runQuery('SELECT * FROM "AuthzInvitationsTokenByEmail" WHERE "email" IN ?', [emails], (err, rows) => {
    if (err) {
      return callback(err);
    }

    const emailTokens = _.chain(rows)
      .map(Cassandra.rowToHash)
      .indexBy('email')
      .mapObject(hash => {
        return hash.token;
      })
      .value();
    return callback(null, emailTokens);
  });
};

/**
 * Get the email associated to the specified token
 *
 * @param  {String}     token           The token for which to get the associated email
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {String}     callback.email  The email that was associated to the token
 */
const getEmailByToken = function(token, callback) {
  Cassandra.runQuery('SELECT * FROM "AuthzInvitationsEmailByToken" WHERE "token" = ?', [token], (err, rows) => {
    if (err) {
      return callback(err);
    }

    if (_.isEmpty(rows)) {
      return callback({
        code: 404,
        msg: util.format('There is no email associated to the email token "%s"', token)
      });
    }

    const email = _.chain(rows)
      .map(Cassandra.rowToHash)
      .pluck('email')
      .first()
      .value();

    return callback(null, email);
  });
};

/**
 * Given an email, get all the invitations associated to it
 *
 * @param  {String}         email                   The email for which to get the invitations
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Invitation[]}   callback.invitations    All invitations that were sent for the specified email
 */
const getAllInvitationsByEmail = function(email, callback) {
  _getAllInvitationResourceIdsByEmail(email, (err, invitationResourceIds) => {
    if (err) {
      return callback(err);
    }

    return _getInvitations(invitationResourceIds, email, callback);
  });
};

/**
 * Get all invitations that were sent for a specified resource
 *
 * @param  {String}         resourceId              The id of the resource for which to get invitations
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Invitation[]}   callback.invitations    All invitations that were sent for the specified resource
 */
const getAllInvitationsByResourceId = function(resourceId, callback, _invitations, _nextToken) {
  _invitations = _invitations || [];
  _nextToken = _nextToken || '';
  Cassandra.runQuery(
    'SELECT * FROM "AuthzInvitations" WHERE "resourceId" = ? AND "email" > ? ORDER BY "email" ASC LIMIT 150',
    [resourceId, _nextToken],
    (err, rows) => {
      if (err) {
        return callback(err);
      }

      if (_.isEmpty(rows)) {
        return callback(null, _invitations);
      }

      const invitations = _.map(rows, Cassandra.rowToHash);
      return getAllInvitationsByResourceId(
        resourceId,
        callback,
        _.union(_invitations, invitations),
        _.last(invitations).email
      );
    }
  );
};

/**
 * Get a unique invitation for the given resource id and email
 *
 * @param  {String}     resourceId                  The id of the resource for which to get the invitation
 * @param  {String}     email                       The email address that was invited to the resource
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {Object}     callback.invitationHash     The invitation storage hash associated to the given resource id and email
 */
const getInvitation = function(resourceId, email, callback) {
  Cassandra.runQuery(
    'SELECT * FROM "AuthzInvitations" WHERE "resourceId" = ? AND "email" = ?',
    [resourceId, email],
    (err, rows) => {
      if (err) {
        return callback(err);
      }

      if (_.isEmpty(rows)) {
        return callback({
          code: 404,
          msg: 'An invitation could not be found for the given resource and email'
        });
      }

      return callback(null, Cassandra.rowToHash(_.first(rows)));
    }
  );
};

/**
 * Create an invitation for each specified email+role for the specified resource
 *
 * @param  {String}     resourceId                  The id of the resource for which to create the invitations
 * @param  {Object}     emailRoles                  An object keyed by email whose value is the role for each invitation to create
 * @param  {String}     inviterUserId               The id of the user who is inviting the specified emails
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {Object}     callback.emailTokens        An object keyed by email whose value is the associated invitation token
 * @param  {Object[]}   callback.invitationHashes   All invitations that were created for the email+roles
 */
const createInvitations = function(resourceId, emailRoles, inviterUserId, callback) {
  try {
    unless(isResourceId, {
      code: 400,
      msg: 'Specified resource must have a valid resource id'
    })(resourceId);

    const validateEachRole = (role, email) => {
      unless(isEmail, {
        code: 400,
        msg: 'A valid email must be supplied to invite'
      })(email);

      unless(isValidRole, {
        code: 400,
        msg: 'A valid role must be supplied to give the invited user'
      })(role);
    };

    forEachObjIndexed(validateEachRole, emailRoles);

    unless(isUserId, {
      code: 400,
      msg: util.format('Specified inviter id "%s" must be a valid user id')
    })(inviterUserId);
  } catch (error) {
    return callback(error);
  }

  // Ensure all emails have invitation tokens that can be used to accept invitations
  getOrCreateTokensByEmails(_.keys(emailRoles), (err, emailTokens) => {
    if (err) {
      return callback(err);
    }

    // Create the invitation storage hashes that will be persisted
    const invitationHashes = _.map(emailRoles, (role, email) => {
      return {
        resourceId,
        email,
        inviterUserId,
        role
      };
    });

    // Create and run the batch set of queries that will create all the invitations
    const queries = _.chain(invitationHashes)
      .map(hash => {
        return [
          {
            query:
              'UPDATE "AuthzInvitations" SET "inviterUserId" = ?, "role" = ? WHERE "resourceId" = ? AND "email" = ?',
            parameters: [hash.inviterUserId, hash.role, hash.resourceId, hash.email]
          },
          {
            query: 'INSERT INTO "AuthzInvitationsResourceIdByEmail" ("resourceId", "email") VALUES (?, ?)',
            parameters: [hash.resourceId, hash.email]
          }
        ];
      })
      .flatten()
      .value();
    Cassandra.runBatchQuery(queries, err => {
      if (err) {
        return callback(err);
      }

      return callback(null, emailTokens, invitationHashes);
    });
  });
};

/**
 * Update the roles associated to the specified invitations for the given resource
 *
 * @param  {String}     resourceId      The id of the resource for which to update the invitation roles
 * @param  {Object}     emailRoles      An object keyed by email whose value is the role for each invitation to update
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const updateInvitationRoles = function(resourceId, emailRoles, callback) {
  try {
    unless(isResourceId, {
      code: 400,
      msg: 'Specified resource must have a valid resource id'
    })(resourceId);

    const validateEachRole = (role, email) => {
      unless(isEmail, {
        code: 400,
        msg: util.format('Invalid email "%s" specified', email)
      })(email);

      unless(isValidRoleChange, {
        code: 400,
        msg: util.format('Invalid role change "%s" specified', role)
      })(role);

      const roleAintFalse = not(equals(role, false));
      unless(bothCheck(roleAintFalse, isString), {
        code: 400,
        msg: util.format('Invalid role "%s" specified', role)
      })(role);
    };

    forEachObjIndexed(validateEachRole, emailRoles);
  } catch (error) {
    return callback(error);
  }

  const queries = [];
  _.each(emailRoles, (role, email) => {
    if (_.isString(role)) {
      queries.push({
        query: 'UPDATE "AuthzInvitations" SET "role" = ? WHERE "resourceId" = ? AND "email" = ?',
        parameters: [role, resourceId, email]
      });
    } else if (role === false) {
      queries.push(
        {
          query: 'DELETE FROM "AuthzInvitations" WHERE "resourceId" = ? AND "email" = ?',
          parameters: [resourceId, email]
        },
        {
          query: 'DELETE FROM "AuthzInvitationsResourceIdByEmail" WHERE "email" = ? AND "resourceId" = ?',
          parameters: [email, resourceId]
        }
      );
    }
  });

  Cassandra.runBatchQuery(queries, callback);
};

/**
 * Delete all invitations that are associated to the given resource id
 *
 * @param  {String}     resourceId      The id of the resource whose invitations to delete
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const deleteInvitationsByResourceId = function(resourceId, callback) {
  getAllInvitationsByResourceId(resourceId, (err, invitations) => {
    if (err) {
      return callback(err);
    }

    const changes = _.chain(invitations)
      .pluck('email')
      .map(email => {
        return [email, false];
      })
      .object()
      .value();
    return updateInvitationRoles(resourceId, changes, callback);
  });
};

/**
 * Delete all invitations associated to the given email
 *
 * @param  {String}     email           The email whose invitations to delete
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const deleteInvitationsByEmail = function(email, callback) {
  try {
    unless(isEmail, {
      code: 400,
      msg: 'Specified email is not valid'
    })(email);
  } catch (error) {
    return callback(error);
  }

  // Get the active token for the given email
  getOrCreateTokensByEmails([email], (err, tokenByEmail) => {
    if (err) {
      return callback(err);
    }

    const token = tokenByEmail[email];

    _getAllInvitationResourceIdsByEmail(email, (err, resourceIds) => {
      if (err) {
        return callback(err);
      }

      const queries = [
        // Delete the email token so a new one can be generated
        {
          query: 'DELETE FROM "AuthzInvitationsEmailByToken" WHERE "token" = ?',
          parameters: [token]
        },
        {
          query: 'DELETE FROM "AuthzInvitationsTokenByEmail" WHERE "email" = ?',
          parameters: [email]
        },

        // Delete the invitations index associated to this email
        {
          query: 'DELETE FROM "AuthzInvitationsResourceIdByEmail" WHERE "email" = ?',
          parameters: [email]
        }
      ];

      // Delete all the invitations entries for each resource that invited this email
      _.each(resourceIds, resourceId => {
        queries.push({
          query: 'DELETE FROM "AuthzInvitations" WHERE "resourceId" = ? AND "email" = ?',
          parameters: [resourceId, email]
        });
      });

      return Cassandra.runBatchQuery(queries, callback);
    });
  });
};

/**
 * Get all invitation resource ids for the specified email
 *
 * @param  {String}     email                   The email for which to get all invitation resource ids
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {String[]}   callback.resourceIds    All resource ids that the specified email was invited into
 * @api private
 */
const _getAllInvitationResourceIdsByEmail = function(email, callback, _resourceIds, _nextToken) {
  _resourceIds = _resourceIds || [];
  _nextToken = _nextToken || '';

  let cql = 'SELECT "resourceId" FROM "AuthzInvitationsResourceIdByEmail" WHERE "email" = ?';
  const params = [email];
  if (_nextToken) {
    cql += ' AND "resourceId" > ?';
    params.push(_nextToken);
  }

  cql += ' ORDER BY "resourceId" ASC LIMIT 100';
  Cassandra.runQuery(cql, params, (err, rows) => {
    if (err) {
      return callback(err);
    }

    if (_.isEmpty(rows)) {
      return callback(null, _resourceIds);
    }

    // Join the resource ids we just fetched with our existing list
    const resourceIds = _.chain(rows)
      .map(Cassandra.rowToHash)
      .pluck('resourceId')
      .value();
    _resourceIds = _.union(_resourceIds, resourceIds);

    return _getAllInvitationResourceIdsByEmail(email, callback, _resourceIds, _.last(resourceIds));
  });
};

/**
 * Get invitations associated to the specified resources ids and email
 *
 * @param  {String[]}   resourceIds                 The ids of the resources for which to get the invitations
 * @param  {String}     email                       The email for which to get the invitations
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {Object[]}   callback.invitationHashes   The invitation storage objects for the given resource ids and email
 * @api private
 */
const _getInvitations = function(resourceIds, email, callback) {
  if (_.isEmpty(resourceIds)) {
    return callback(null, []);
  }

  Cassandra.runQuery(
    'SELECT * FROM "AuthzInvitations" WHERE "resourceId" IN ? AND email = ?',
    [resourceIds, email],
    (err, rows) => {
      if (err) {
        return callback(err);
      }

      return callback(null, _.map(rows, Cassandra.rowToHash));
    }
  );
};

export {
  getOrCreateTokensByEmails,
  getTokensByEmails,
  getEmailByToken,
  getAllInvitationsByEmail,
  getAllInvitationsByResourceId,
  getInvitation,
  createInvitations,
  updateInvitationRoles,
  deleteInvitationsByResourceId,
  deleteInvitationsByEmail
};
