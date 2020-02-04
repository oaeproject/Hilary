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

import fs from 'fs';
import util from 'util';
import _ from 'underscore';
import async from 'async';
import clone from 'clone';
import csv from 'csv';
import dateFormat from 'dateformat';
import jszip from 'jszip';
import ShortId from 'shortid';

import { getJSON } from 'oae-content/lib/internal/ethercalc';
import { getTenantSkinVariables } from 'oae-ui';
import * as AuthzUtil from 'oae-authz/lib/util';
import {
  getContentLibraryItems,
  getComments as getCommentsForContent,
  getRevision as getContentRevision
} from 'oae-content';
import * as ContentUtil from 'oae-content/lib/internal/util';
import * as DiscussionsAPI from 'oae-discussions';
import * as EmailAPI from 'oae-email';
import { logger } from 'oae-logger';
import * as MeetingsAPI from 'oae-jitsi';
import * as OaeUtil from 'oae-util/lib/util';
import * as TenantsAPI from 'oae-tenants';
import * as TenantsUtil from 'oae-tenants/lib/util';
import * as Signature from 'oae-util/lib/signature';
import { setUpConfig } from 'oae-config';
import { Context } from 'oae-context';
import { Validator as validator } from 'oae-util/lib/validator';
const {
  makeSureThat,
  otherwise,
  isShortString,
  isUserId,
  isNotNull,
  isArrayEmpty,
  isNotEmpty,
  isLoggedInUser,
  isEmail,
  isArrayNotEmpty
} = validator;
import pipe from 'ramda/src/pipe';
import isIn from 'validator/lib/isIn';
import isInt from 'validator/lib/isInt';
import { AuthenticationConstants } from 'oae-authentication/lib/constants';
import { AuthzConstants } from 'oae-authz/lib/constants';
import * as UserDeletionUtil from 'oae-principals/lib/definitive-deletion';
import * as PrincipalsDAO from './internal/dao';
import PrincipalsEmitter from './internal/emitter';
import * as PrincipalsTermsAndConditionsAPI from './api.termsAndConditions';
import * as PrincipalsUtil from './util';
import { PrincipalsConstants } from './constants';
import { User } from './model';

const log = logger('oae-principals');
const PrincipalsConfig = setUpConfig('oae-principals');

const fullUserProfileDecorators = {};

const HTTP_PROTOCOL = 'http';
const HTTPS_PROTOCOL = 'https';

/**
 * Register a decorator for the full user profile. A decorator will, at read time, provide additional data about the user
 * that will be returned to the client
 *
 * @param  {String}     namespace                   The unique namespace for this decorator. This will be used as the actual property name on the full user profile object. If this namespace collides with an existing user profile property, it will be silently ignored
 * @param  {Function}   decorator                   The function that will provide additional data for the user profile
 * @param  {Context}    decorator.ctx               The context of the current request
 * @param  {User}       decorator.user              The user being decorated
 * @param  {Function}   decorator.callback          This function should be invoked with the decoration object when complete
 * @param  {Object}     decorator.callback.err      An error that occurred during decoration, if any
 * @param  {Object}     decorator.callback.data     The decoration data to bind to the full user profile
 */
const registerFullUserProfileDecorator = function(namespace, decorator) {
  if (fullUserProfileDecorators[namespace]) {
    throw new Error(
      util.format('Attempted to register duplicate full user profile decorator with namespace "%s"', namespace)
    );
  } else if (!_.isFunction(decorator)) {
    throw new TypeError(
      util.format(
        'Attempted to register full user profile decorator for namespace "%s" without a decorator function',
        namespace
      )
    );
  }

  fullUserProfileDecorators[namespace] = decorator;
};

/**
 * Create a new user record on a tenant. If the optional `tenantAlias` is not specified, the user
 * will be created on the current tenant. Note that you will still need to associate an
 * authentication strategy with this user record as the user would otherwise have no means
 * of logging onto the system.
 *
 * @param  {Context}   ctx                      Standard context object containing the current user and the current tenant
 * @param  {String}    displayName              The display name for the user
 * @param  {Object}    [opts]                   Optional parameters for the user
 * @param  {String}    [opts.visibility]        The visibility of the user. One of AuthzConstants.visibility
 * @param  {String}    [opts.locale]            The locale for the user
 * @param  {String}    [opts.publicAlias]       The name to show when the user is inaccessible to a user
 * @param  {Boolean}   [opts.acceptedTC]        Whether or not the user has accepted the Terms & Conditions
 * @param  {String}    [opts.email]             The email address for the user
 * @param  {String}    [opts.emailPreference]   The email preference for the user. One of PrincipalsConstants.emailPreference
 * @param  {Boolean}   [opts.emailVerified]     Whether the user's email address is considered verified
 * @param  {String}    [opts.smallPictureUri]   The URI for the small picture
 * @param  {String}    [opts.mediumPictureUri]  The URI for the medium picture
 * @param  {String}    [opts.largePictureUri]   The URI for the large picture
 * @param  {Function}  callback                 Standard callback function
 * @param  {Object}    callback.err             An error that occurred, if any
 * @param  {User}      callback.createdUser     The created user
 */
const createUser = function(ctx, tenantAlias, displayName, opts, callback) {
  tenantAlias = tenantAlias || ctx.tenant().alias;
  opts = opts || {};
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error(
          {
            err,
            displayName
          },
          'Error creating user'
        );
      }
    };

  // Resolve the initial locale for the new user
  if (!opts.locale) {
    // If a user is creating an account for themself (i.e., they are currently anonymous) then
    // we try and use the locale suggested by the request context (e.g., browser locale)
    if (!ctx.user()) {
      opts.locale = ctx.locale();
    }

    // If a user is creating a user on behalf of someone else or there was no suggested
    // locale, we fall back to the configured tenant default
    if (!opts.locale) {
      opts.locale = PrincipalsConfig.getValue(tenantAlias, 'user', 'defaultLanguage');
    }
  }

  // Const isAdmin = ctx.user() && ctx.user().isAdmin(tenantAlias);
  opts.visibility = opts.visibility || PrincipalsConfig.getValue(tenantAlias, 'user', 'visibility');
  opts.publicAlias = opts.publicAlias || displayName;
  opts.acceptedTC = opts.acceptedTC || false;
  opts.emailPreference = opts.emailPreference || PrincipalsConfig.getValue(tenantAlias, 'user', 'emailPreference');
  opts.isUserArchive = opts.isUserArchive || null;

  try {
    pipe(
      isNotEmpty,
      otherwise({
        code: 400,
        msg: 'A display name must be provided'
      })
    )(displayName);

    pipe(
      isShortString,
      otherwise({
        code: 400,
        msg: 'A display name can be at most 1000 characters long'
      })
    )(displayName);

    pipe(
      isIn,
      otherwise({
        code: 400,
        msg: 'The specified visibility setting is unknown'
      })
    )(opts.visibility, _.values(AuthzConstants.visibility));

    pipe(
      isIn,
      otherwise({
        code: 400,
        msg: 'The specified email preference is invalid'
      })
    )(opts.emailPreference, _.values(PrincipalsConstants.emailPreferences));
  } catch (error) {
    return callback(error);
  }

  // If an administrator is creating an account, we consider the email address to be verified
  opts.emailVerified = opts.emailVerified || (ctx.user() && ctx.user().isAdmin(tenantAlias)) || false;

  // Because some SSO strategies do not release an email address, we allow user accounts to be
  // created without providing the email
  if (_.isString(opts.email)) {
    // E-mail addresses are always lower-cased as it makes them easier to deal with
    opts.email = opts.email.toLowerCase();

    try {
      pipe(
        isEmail,
        otherwise({
          code: 400,
          msg: 'The specified email address is invalid'
        })
      )(opts.email);
    } catch (error) {
      return callback(error);
    }
  } else {
    // Avoid setting a falsey email address
    delete opts.email;
  }

  const id = AuthzUtil.toId('u', tenantAlias, ShortId.generate());
  const user = new User(tenantAlias, id, displayName, null, {
    visibility: opts.visibility,
    locale: opts.locale,
    publicAlias: opts.publicAlias,
    emailPreference: opts.emailPreference,
    smallPictureUri: opts.smallPictureUri,
    mediumPictureUri: opts.mediumPictureUri,
    largePictureUri: opts.largePictureUri,
    acceptedTC: 0,
    isUserArchive: opts.isUserArchive
  });

  // Only add the email address if it's been verified
  if (opts.email && opts.emailVerified) {
    user.email = opts.email;
  }

  // We store the timestamp at which the user accepted the Terms and Conditions
  // This allows users to re-accept the Terms and Conditions after they have been updated
  user.needsToAcceptTC = PrincipalsConfig.getValue(tenantAlias, 'termsAndConditions', 'enabled');
  if (user.needsToAcceptTC && opts.acceptedTC) {
    user.acceptedTC = Date.now();
    user.needsToAcceptTC = false;
  }

  return _createUser(ctx, user, opts.email, callback);
};

/**
 * Create a new user record. This assumes all validation has happened
 * at an earlier point in time
 *
 * @param  {Context}    ctx                         Standard context object containing the current user and the current tenant
 * @param  {User}       user                        The user to create
 * @param  {String}     [email]                     The email address of the user. If an email address was specified but not persisted on the `user` object, a verification email will be sent to the given email address
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {User}       callback.createdUser        The created user
 */
const _createUser = function(ctx, user, email, callback) {
  PrincipalsDAO.createUser(user, err => {
    if (err) return callback(err);

    // Emit an event indicating a user account has been created
    PrincipalsEmitter.emit(PrincipalsConstants.events.CREATED_USER, ctx, user);

    // If the email address hasn't been verified we ask the user to verify it
    const hasUnverifiedEmail = email && !user.email;

    OaeUtil.invokeIfNecessary(hasUnverifiedEmail, _sendEmailToken, ctx, user, email, null, err => {
      if (err) return callback(err);

      return callback(null, user);
    });
  });
};

/**
 * Import users using a CSV file. The CSV file should be formatted in the following way:
 *
 *  `externalId, lastName, firstName, email`
 *
 * When importing a set of users using the local authentication strategy, the CSV format should be the following:
 *
 *  `externalId, password, lastName, firstName, email`
 *
 * When an external id for the provided authentication strategy cannot be found, a new user will be created. When that
 * user can be found, no new user will be created. When that user's display name is the same as their external id and
 * a real display name is available in the CSV file, the user's display name will be updated to be the one in the CSV
 * file. When that user doesn't have an email address set and an email address is available in the CSV file, the user's
 * email address will be updated to be the one in the CSV file. This accounts for the scenario where an external authentication
 * provider that doesn't release the required basic profile attributes was configured and users signed into it before the
 * full user list with appropriate basic profile attributes was imported.
 *
 * When the `forceProfileUpdate` parameter is provided, the user's display name and email address will always be set to the values provided in the CSV file.
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         [tenantAlias]           The alias of the tenant for which the users should imported
 * @param  {Object}         userCSV                 File object representing the uploaded CSV file as returned by express
 * @param  {String}         authenticationStrategy  The authentication strategy with which the provided external ids should be associated (One of AuthenticationConstants.providers)
 * @param  {Boolean}        [forceProfileUpdate]    Whether or not the user's display name, public alias and email should be updated with the value specified in the CSV file, even when the display name/public alais is different than the external id or an email address has been set. By default, this will be set to `false`
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 */
const importUsers = function(ctx, tenantAlias, userCSV, authenticationStrategy, forceProfileUpdate, callback) {
  tenantAlias = tenantAlias || ctx.user().tenant.alias;
  forceProfileUpdate = forceProfileUpdate || false;
  callback = callback || function() {};

  const tenant = TenantsAPI.getTenant(tenantAlias);

  // Only global or tenant administrators should be able to import users
  if (!ctx.user() || !ctx.user().isAdmin(tenantAlias)) {
    return _cleanUpCSVFile(userCSV, () => {
      callback({ code: 401, msg: 'Only authorized admins can import users' });
    });
  }

  try {
    // Parameter validation
    pipe(
      isNotNull,
      otherwise({
        code: 400,
        msg: 'An existing tenant alias must be provided'
      })
    )(tenant);

    pipe(
      isNotNull,
      otherwise({
        code: 400,
        msg: 'A CSV file must be provided'
      })
    )(userCSV);

    if (userCSV) {
      pipe(
        isNotEmpty,
        otherwise({
          code: 400,
          msg: 'Missing size on the CSV file'
        })
      )(String(userCSV.size));

      pipe(
        isInt,
        otherwise({
          code: 400,
          msg: 'Invalid size on the CSV file'
        })
      )(String(userCSV.size));

      pipe(
        size => {
          return size > 0;
        },
        otherwise({
          code: 400,
          msg: 'Invalid size on the CSV file'
        })
      )(String(userCSV.size));

      pipe(
        isNotEmpty,
        otherwise({
          code: 400,
          msg: 'Missing name on the CSV file'
        })
      )(userCSV.name);
    }

    pipe(
      isNotEmpty,
      otherwise({
        code: 400,
        msg: 'An authentication strategy must be provided'
      })
    )(authenticationStrategy);

    pipe(
      isIn,
      otherwise({
        code: 400,
        msg: 'The specified authentication strategy is unknown'
      })
    )(authenticationStrategy, _.values(AuthenticationConstants.providers));
  } catch (error) {
    return _cleanUpCSVFile(userCSV, () => {
      callback(error);
    });
  }

  // Create a new context object on the request tenant
  const adminCtx = new Context(tenant, ctx.user());

  // Will contain an entry for each user in the CSV file
  const data = [];

  // The CSV module works with streams, so get a readable stream to the uploaded CSV file
  const input = fs.createReadStream(userCSV.path);

  // Pipe the stream to a CSV parser and keep track of the user records
  const parser = csv.parse({ trim: true });
  input.pipe(parser);
  parser.on('readable', () => {
    let user = parser.read();
    while (user) {
      data.push(user);
      user = parser.read();
    }
  });

  parser
    .on('finish', () => {
      // If the CSV parse was successful, we call the callback to prevent the request from timing out
      // whilst the users are being loaded
      PrincipalsEmitter.emit('preCSVUserImport');
      callback();

      // Remove the uploaded file
      _cleanUpCSVFile(userCSV, () => {
        log(ctx).info(
          {
            tenantAlias,
            authenticationStrategy
          },
          'Starting user import from CSV'
        );

        /*!
         * Process an invidual user from the CSV file and create a new user if no user exists for the provided
         * external id - authentication strategy combination.
         *
         * @param  {Array.<Array.<String>>}     data        Parsed CSV file
         */
        const processUser = function(data) {
          // Get the next user from the stack
          const user = data.pop();

          // Extract the password in case local authentication is used
          let providerProperties = null;
          if (authenticationStrategy === AuthenticationConstants.providers.LOCAL) {
            providerProperties = { password: user.splice(1, 1) };
          }

          // Extract the basic profile data
          const externalId = user[0];

          // Construct the first name and last name into a display name
          const displayName = util.format('%s %s', user[2], user[1]).trim();

          // Email addresses provided through a CSV import are always considered to be verified
          const opts = {
            email: user[3],
            emailVerified: true
          };

          /*!
           * Gets called when the user has been created or updated
           *
           * @param  {Object}     err     An error object that can be returned by the updateUser call
           */
          const finishImportUser = function(err) {
            if (err) log().error({ err, externalId }, 'Failed to import user');

            if (_.isEmpty(data)) {
              log(ctx).info(
                {
                  authenticationStrategy,
                  tenantAlias
                },
                'Finished user import from CSV'
              );

              // Send out an event indicating that the import has finished
              return PrincipalsEmitter.emit('postCSVUserImport');
              // Add a progress log statement every 25 imported users
            }

            if (data.length % 25 === 0) {
              log(ctx).info(
                {
                  authenticationStrategy,
                  tenantAlias
                },
                'Importing users from CSV. ' + data.length + ' users left to import'
              );
            }

            // Process the next user
            processUser(data);
          };

          // Check if the user already exists and create a new user if it doesn't.
          // If the user already exists but has a different displayName from the one
          // in the CSV file, we update it
          // TODO: Fix cross-dependency between the Authentication API and the Principals API
          require('oae-authentication').getOrCreateUser(
            adminCtx,
            authenticationStrategy,
            externalId,
            providerProperties,
            displayName,
            opts,
            (err, user, loginId, created) => {
              if (err) return finishImportUser(err);

              // If the user already existed it's possible that we need to update it

              if (created) {
                finishImportUser();
                // If the user was created, we can move on to the next one
              } else {
                const update = {};

                if (forceProfileUpdate) {
                  // Only perform the update if there's a difference
                  if (user.displayName !== displayName) {
                    update.displayName = displayName;
                  }

                  if (user.publicAlias !== displayName) {
                    update.publicAlias = displayName;
                  }

                  if (user.email !== opts.email) {
                    update.email = opts.email;
                  }
                } else {
                  // Only update the user's displayname or email when their is value in doing it
                  if (user.displayName === externalId) {
                    update.displayName = displayName;
                  }

                  if (!user.publicAlias || user.publicAlias === externalId) {
                    update.publicAlias = displayName;
                  }
                }

                if (_.isEmpty(update)) {
                  finishImportUser();
                } else {
                  log(ctx).info(
                    {
                      externalId,
                      user,
                      update
                    },
                    'Updating display name, public alias and/or email during import from CSV'
                  );
                  _updateUser(adminCtx, user, update, finishImportUser);
                }
              }
            }
          );
        };

        // Process the first user
        processUser(data);
      });

      // Parsing error
    })
    .on('error', err => {
      // Remove the uploaded file
      _cleanUpCSVFile(userCSV, () => {
        callback({ code: 500, msg: err.message });
      });
    });
};

/**
 * Remove an uploaded user CSV file
 * TODO: Move this out into a utility as this functionality is needed in a number of places
 *
 * @param  {Object}         userCSV                 File object representing the uploaded CSV file as returned by express
 * @param  {Function}       callback                Standard callback function
 * @api private
 */
const _cleanUpCSVFile = function(userCSV, callback) {
  if (userCSV && userCSV.path) {
    fs.stat(userCSV.path, (err, exists) => {
      if (exists) {
        fs.unlink(userCSV.path, err => {
          if (err) log().warn({ err, file: userCSV }, 'Could not remove the user import CSV file');

          callback();
        });
      } else {
        callback();
      }
    });
  } else {
    callback();
  }
};

/**
 * Update a user
 *
 * @param  {Context}        ctx             Standard context object containing the current user and the current tenant
 * @param  {String}         userId          The id of the user to update
 * @param  {Object}         profileFields   Object that represent the profile fields that should be updated. Possible keys are `visibility`, `displayName`, `publicAlias`, `locale`, `email` and `emailPreference`
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 * @param  {User}           callback.user   The updated user
 */
const updateUser = function(ctx, userId, profileFields, callback) {
  callback = callback || function() {};
  profileFields = profileFields || {};

  const profileFieldKeys = _.keys(profileFields);

  // Parameter validation
  try {
    pipe(
      isNotEmpty,
      otherwise({
        code: 400,
        msg: 'A valid user id must be provided'
      }),
      makeSureThat(true, userId, isUserId),
      otherwise({
        code: 400,
        msg: 'A valid user id must be provided'
      })
    )(userId);

    // Check that there is at least one updated profile field
    pipe(
      isArrayNotEmpty,
      otherwise({
        code: 400,
        msg: 'At least one basic profile field should be specified'
      })
    )(profileFieldKeys);

    // Verify that restricted properties aren't set here
    const validKeys = ['displayName', 'visibility', 'email', 'emailPreference', 'publicAlias', 'locale'];
    const invalidKeys = _.difference(profileFieldKeys, validKeys);
    pipe(isArrayEmpty, otherwise({ code: 400, msg: 'Restricted property was attempted to be set.' }))(invalidKeys);

    // Apply special restrictions on some profile fields
    if (!_.isUndefined(profileFields.displayName)) {
      pipe(
        isNotEmpty,
        otherwise({
          code: 400,
          msg: 'A display name cannot be empty'
        }),
        makeSureThat(true, profileFields.displayName, isShortString),
        otherwise({
          code: 400,
          msg: 'A display name can be at most 1000 characters long'
        })
      )(profileFields.displayName);
    }

    if (!_.isUndefined(profileFields.visibility)) {
      pipe(
        isIn,
        otherwise({
          code: 400,
          msg: 'An invalid visibility option has been specified'
        })
      )(profileFields.visibility, _.values(AuthzConstants.visibility));
    }

    if (!_.isUndefined(profileFields.emailPreference)) {
      pipe(
        isIn,
        otherwise({
          code: 400,
          msg: 'The specified emailPreference is invalid'
        })
      )(profileFields.emailPreference, _.values(PrincipalsConstants.emailPreferences));
    }

    if (_.isString(profileFields.email)) {
      // E-mail addresses are always lower-cased as it makes them easier to deal with
      profileFields.email = profileFields.email.toLowerCase();
      pipe(
        isEmail,
        otherwise({
          code: 400,
          msg: 'The specified email address is invalid'
        })
      )(profileFields.email);
    } else {
      // Ensure we never set a false-y email
      delete profileFields.email;
    }

    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'You have to be logged in to be able to update a user'
      })
    )(ctx);
  } catch (error) {
    return callback(error);
  }

  // Regular users cannot update other users
  const principalResource = AuthzUtil.getResourceFromId(userId);
  if (ctx.user().id !== userId && !ctx.user().isAdmin(principalResource.tenantAlias)) {
    return callback({ code: 401, msg: "You are not authorized to update this user's profile." });
  }

  // Only update existing users
  PrincipalsDAO.getPrincipal(userId, (err, oldUser) => {
    if (err) return callback(err);

    if (oldUser.deleted) {
      return callback({ code: 404, msg: util.format("Couldn't find principal: ", oldUser.id) });
    }

    // Overlay the correct lastModified date
    profileFields = _.extend({}, profileFields, { lastModified: Date.now().toString() });

    // If the user wants to change their own email address, we don't change it immediately.
    // We will make that change once they have verified they own it. We will persist the
    // desired email address in a separate column family
    let newEmailAddress = null;
    const isEmailChange = !_.isUndefined(profileFields.email) && profileFields.email !== oldUser.email;
    if (isEmailChange) {
      newEmailAddress = profileFields.email;
      delete profileFields.email;
    }

    _updateUser(ctx, oldUser, profileFields, (err, newUser) => {
      if (err) return callback(err);

      // If the email address changed but isn't verified, we have to send a verification email
      OaeUtil.invokeIfNecessary(isEmailChange, _sendEmailToken, ctx, newUser, newEmailAddress, null, err => {
        if (err) return callback(err);

        return getUser(ctx, userId, callback);
      });
    });
  });
};

/**
 * Update a user record in the database. This is an internal method that performs no validation.
 * It will also not send out any email verification tokens if an email address were to change
 *
 * @param  {Context}        ctx             Standard context object containing the current user and the current tenant
 * @param  {String}         userId          The user to update
 * @param  {Object}         profileFields   Object that represent the profile fields that should be updated. Possible keys are `visibility`, `displayName`, `publicAlias`, `locale`, `email` and `emailPreference`
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 * @param  {User}           callback.user   The updated user
 * @api private
 */
const _updateUser = function(ctx, oldUser, profileFields, callback) {
  PrincipalsDAO.updatePrincipal(oldUser.id, profileFields, err => {
    if (err) return callback(err);

    // Emit an event indicating the user has been updated
    const newUser = PrincipalsUtil.createUpdatedUser(oldUser, profileFields);
    PrincipalsEmitter.emit(PrincipalsConstants.events.UPDATED_USER, ctx, newUser, oldUser);

    return callback(null, newUser);
  });
};

/**
 * Determine if the user in context can delete the specified user
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     userId              The id of the user being deleted
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Boolean}    callback.canDelete  Indicates whether or not the current user can delete the specified user
 * @param  {User}       callback.user       The user that was fetched to perform the checks. Will not be specified if the authorization fails
 */
const canDeleteUser = function(ctx, userId, callback) {
  if (!ctx.user()) {
    return callback(null, false);
  }

  PrincipalsDAO.getPrincipal(userId, (err, user) => {
    if (err) return callback(err);

    if (ctx.user().id !== userId && !ctx.user().isAdmin(user.tenant.alias)) {
      // Only an admin or the user themself can delete a user
      return callback(null, false);
    }

    return callback(null, true, user);
  });
};

/**
 * Delete a user
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     userId          The id of the user to delete
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occured, if any
 */
const deleteUser = function(ctx, userId, callback) {
  try {
    pipe(
      isUserId,
      otherwise({
        code: 400,
        msg: 'A valid user id must be provided'
      })
    )(userId);
  } catch (error) {
    return callback(error);
  }

  // Check if the user has permission to delete the user
  canDeleteUser(ctx, userId, (err, canDelete) => {
    if (err) return callback(err);

    if (!canDelete) {
      return callback({ code: 401, msg: 'You are not authorized to delete this user' });
    }

    PrincipalsDAO.getPrincipalSkipCache(userId, function(err, user) {
      if (err) return callback(err);

      // Get and/or create archiveUser
      UserDeletionUtil.fetchOrCloneFromUser(ctx, user, function(err, archiveUser) {
        if (err) return callback(err);

        if (user.isUserArchive === 'true' || archiveUser.archiveId === user.id) {
          return callback({ code: 401, msg: "This user can't be deleted" });
        }

        UserDeletionUtil.transferUsersDataToCloneUser(ctx, user, archiveUser, function(err) {
          if (err) return callback(err);

          PrincipalsDAO.deletePrincipal(userId, err => {
            if (err) return callback(err);

            // Notify consumers that a user has been deleted
            return PrincipalsEmitter.emit(PrincipalsConstants.events.DELETED_USER, ctx, user, callback);
          });
        });
      });
    });
  });
};

/**
 *
 * Delete or restore users within a tenancy
 *
 * @function deleteOrRestoreUsersByTenancy
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     tenantAlias      The tenant alias we want to delete or restore users from
 * @param  {Boolean}    disableUsers     Sets the behaviour to delete if true and restore if false
 * @param  {Function}   callback         Standard callback function
 * @param  {Object}     callback.err     An error that occured, if any
 * @param  {Object[]}   callback.users   An array of objects representing affected users
 */
const deleteOrRestoreUsersByTenancy = function(ctx, tenantAlias, disableUsers, callback) {
  getAllUsersForTenant(ctx, tenantAlias, (err, users) => {
    if (err) callback(err);

    if (disableUsers) {
      _deletePrincipals(users, (err, users) => {
        if (err) callback(err);

        callback(null, users);
      });
    } else {
      _restorePrincipals(users, (err, users) => {
        if (err) callback(err);

        callback(null, users);
      });
    }
  });
};

/**
 * Get all users for a given tenant
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}     tenantAlias             The tenant alias to filter by
 * @param  {Function}   callback                Invoked when users have been collected
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object[]}   callback.users          An array of users
 * @api private
 */
const getAllUsersForTenant = function(ctx, tenantAlias, callback) {
  tenantAlias = tenantAlias || ctx.user().tenant.alias;
  const tenant = TenantsAPI.getTenant(tenantAlias);

  if (!ctx.user() || !ctx.user().isAdmin(tenantAlias)) {
    log().warn('A non-admin user tried to fetch all users for tenant %s', tenantAlias);
    return callback({ code: 401, msg: 'Only authorized admins can fetch all users for a tenant' });
  }

  if (!tenant) {
    log().warn('Could not find tenant with alias %s', tenantAlias);
    return callback({ code: 404, msg: 'No tenant was found for this alias' });
  }

  PrincipalsDAO.getAllUsersForTenant(tenantAlias, (err, users) => {
    if (err) return callback(err);

    if (_.isEmpty(users)) {
      log().info('No users found for tenant %s', tenantAlias);
    } else {
      users = _.chain(users)
        .compact()
        .uniq()
        .value();
    }

    return callback(null, users);
  });
};

/**
 * Deletes users from the database, one by one
 *
 * @function _deletePrincipals
 * @param  {Object[]} usersToDelete     Array of users which will be deleted
 * @param  {Function} afterDeleted      Invoked when all users have been deleted
 * @api private
 */
const _deletePrincipals = function(usersToDelete, afterDeleted) {
  async.mapSeries(
    usersToDelete,
    (eachUser, transformed) => {
      // eslint-disable-next-line no-unused-vars
      PrincipalsDAO.deletePrincipal(eachUser.id, err => {
        transformed(null, eachUser);
      });
    },
    (err, results) => {
      afterDeleted(null, results);
    }
  );
};

/**
 *
 * Restore a set of users in an async manner
 *
 * @function _restorePrincipals
 * @param  {Object[]} usersToRestore    Array of users to restore
 * @param  {Function} afterRestored     Invoked when all users have been restored
 * @api private
 */
const _restorePrincipals = function(usersToRestore, afterRestored) {
  async.map(
    usersToRestore,
    (eachUser, transformed) => {
      // eslint-disable-next-line no-unused-vars
      PrincipalsDAO.restorePrincipal(eachUser.id, err => {
        transformed(null, eachUser);
      });
    },
    (err, results) => {
      afterRestored(null, results);
    }
  );
};

/**
 * Restore a user
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     userId          The id of the user to restore
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occured, if any
 */
const restoreUser = function(ctx, userId, callback) {
  try {
    pipe(
      isUserId,
      otherwise({
        code: 400,
        msg: 'A valid user id must be provided'
      })
    )(userId);
  } catch (error) {
    return callback(error);
  }

  canRestoreUser(ctx, userId, (err, canRestore, user) => {
    if (err) return callback(err);

    if (!canRestore) {
      return callback({ code: 401, msg: 'You are not authorized to restore this user' });
    }

    // Unmark the user as deleted
    PrincipalsDAO.restorePrincipal(userId, err => {
      if (err) return callback(err);

      // Notify consumers that a user has been restored
      return PrincipalsEmitter.emit(PrincipalsConstants.events.RESTORED_USER, ctx, user, callback);
    });
  });
};

/**
 * Determine if the user in context can restore the specified user
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     userId              The id of the user being restored
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Boolean}    callback.canDelete  Indicates whether or not the current user can restore the specified user
 * @param  {User}       callback.user       The user that was fetched to perform the checks. Will not be specified if the authorization fails
 */
const canRestoreUser = function(ctx, userId, callback) {
  if (!ctx.user()) {
    return callback(null, false);
  }

  PrincipalsDAO.getPrincipal(userId, (err, user) => {
    if (err) return callback(err);

    if (!ctx.user().isAdmin(user.tenant.alias)) {
      // Only an admin can restore a user
      return callback(null, false);
    }

    return callback(null, true, user);
  });
};

/**
 * Get a user from the DB
 *
 * @param  {Context}   ctx             Standard context object containing the current user and the current tenant
 * @param  {String}    userId          The userId for the user you wish to retrieve
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 * @param  {User}      callback.user   The user object
 */
const getUser = function(ctx, userId, callback) {
  try {
    pipe(
      isUserId,
      otherwise({
        code: 400,
        msg: 'An invalid user id was provided'
      })
    )(userId);
  } catch (error) {
    return callback(error);
  }

  PrincipalsUtil.getPrincipal(ctx, userId, callback);
};

/**
 * Get the full user profile of a user. In addition to the basic profile, this also fetches the
 * decorated properties.
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     userId          The id of the user whose full profile to fetch
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {Object}     callback.user   The decorated user object
 */
const getFullUserProfile = function(ctx, userId, callback) {
  try {
    pipe(
      isUserId,
      otherwise({
        code: 400,
        msg: 'An invalid user id was provided'
      })
    )(userId);
  } catch (error) {
    return callback(error);
  }

  // Get and validate the basic user profile to decorate
  getUser(ctx, userId, (err, user) => {
    if (err) return callback(err);

    if (user.deleted) {
      return callback({ code: 404, msg: util.format("Couldn't find principal: ", userId) });
    }

    // Only add the `isGlobalAdmin` and `isTenantAdmin` if the user's profile is requested by a global admin or the tenant admin
    if (ctx.user() && ctx.user().isAdmin(user.tenant.alias)) {
      user.isGlobalAdmin = user.isGlobalAdmin();
      user.isTenantAdmin = user.isTenantAdmin(user.tenant.alias);
    }

    // Keep track of how many decorators still need to return
    let numDecorators = _.keys(fullUserProfileDecorators).length;
    if (numDecorators === 0) {
      return callback(null, user);
    }

    // Hold all decorations for the user profile until we've collected them all
    const decorations = {};

    /*!
     * Complete one iteration of the decorators loop. Will invoke the method callback when all decorations have completed
     */
    const _finishDecorator = function() {
      numDecorators--;
      if (numDecorators === 0) {
        // Apply all the decorations to the user object
        user = _.extend(user, decorations);
        PrincipalsEmitter.emit(PrincipalsConstants.events.GET_USER_PROFILE, ctx, user);
        return callback(null, user);
      }
    };

    // Concurrently apply all decorators to the user object
    _.each(fullUserProfileDecorators, (decorator, namespace) => {
      if (user[namespace] !== undefined) {
        log().warn(
          'Skipping full user profile decorator "%s" which overwrites an existing user profile value',
          namespace
        );
        return _finishDecorator();
      }

      decorator(ctx, clone(user), (err, decoration) => {
        if (err) {
          log().warn({ err }, 'Skipping decorator because of an error in the decoration method');
          return _finishDecorator();
        }

        if (decoration === undefined) {
          // If the decoration wasn't specified, do not apply it to the decorations. However null is a valid
          // value
          return _finishDecorator();
        }

        decorations[namespace] = decoration;
        return _finishDecorator();
      });
    });
  });
};

/**
 * Get the me feed for the current user, if anonymous returns 'anon': true
 * If logged in returns structured me feed object in the callback
 *
 *     {
 *         "profilePath": "/person/u:global:bert",
 *         "id": "u:global:bert",
 *         "displayName": "Bert Pareyn",
 *         "publicAlias": "Bert the Merciful"
 *         "visibility": "private",
 *         "isTenantAdmin": true,
 *         "isGlobalAdmin": false,
 *         "resourceType": "user"
 *         "locale": "en_GB"
 *     }
 *
 * If error returns error object
 *
 * @param  {Context}   ctx            Standard context object containing the current user and the current tenant
 * @param  {Function}  callback       Standard callback function
 * @param  {Object}    callback.err   An error that occurred, if any
 * @param  {Object}    callback.data  The me feed for the current user
 */
const getMe = function(ctx, callback) {
  // Get the compact tenant object for the current tenant
  const tenant = ctx.tenant().compact();

  // Indicate whether the tenant is private or not
  tenant.isPrivate = TenantsUtil.isPrivate(tenant.alias);

  // Handle the anonymous user
  if (!ctx.user()) {
    const anonMe = {
      anon: true,
      tenant
    };

    const locale = ctx.locale();
    if (locale) {
      anonMe.locale = locale;
    }

    return callback(null, anonMe);
  }

  // If the user is authenticated we get their profile
  getUser(ctx, ctx.user().id, (err, data) => {
    if (err) return callback(err);

    // Overwrite the `tenant` value with our object that contains whether the tenant is private
    data.tenant = tenant;

    // If this user is being impostered, we add the information of the user that is doing the impostering
    if (ctx.imposter()) {
      data.imposter = ctx.imposter();
    }

    data.isGlobalAdmin = ctx.user().isGlobalAdmin();
    data.isTenantAdmin = ctx.user().isTenantAdmin(ctx.user().tenant.alias);
    data.locale = ctx.user().locale;

    // Determine if the current user needs to accept terms and conditions
    data.needsToAcceptTC = PrincipalsTermsAndConditionsAPI.needsToAcceptTermsAndConditions(ctx);

    // Generate a signature that can be used to authenticate to one's self for push notifications
    data.signature = Signature.createExpiringResourceSignature(ctx, ctx.user().id);

    // Return the name of the strategy that the user used to log into the system
    data.authenticationStrategy = ctx.authenticationStrategy();

    return callback(null, data);
  });
};

/**
 * Set a flag that indicates whether a user is a tenant admin.
 * The ctx user must be a tenant or global admin to be able to do this.
 *
 * @param  {Context}   ctx             Standard context object containing the current user and the current tenant
 * @param  {String}    userId          The id of the user to update the tenant administrator setting for
 * @param  {Boolean}   isAdmin         Whether or not the user should become a tenant administrator
 * @param  {Function}  callback        Standard callback function
 * @param  {Object}    callback.err    An error that occurred, if any
 */
const setTenantAdmin = function(ctx, userId, isAdmin, callback) {
  const user = AuthzUtil.getResourceFromId(userId);
  if (ctx.user() && ctx.user().isAdmin(user.tenantAlias)) {
    _setAdmin(ctx, 'admin:tenant', isAdmin, userId, callback);
  } else {
    return callback({
      code: 401,
      msg: 'You do not have sufficient rights to make someone an admin'
    });
  }
};

/**
 * Set a flag that indicates whether a user is a global admin. The user in context must be a global
 * admin to be able to do this
 *
 * @param  {Context}   ctx              Standard context object containing the current user and the current tenant
 * @param  {String}    userId           The id of the user to update the global administrator setting for
 * @param  {Boolean}   isAdmin          Whether or not the user should become a global administrator
 * @param  {Function}  callback         Standard callback function
 * @param  {Object}    callback.err     An error that occurred, if any
 */
const setGlobalAdmin = function(ctx, userId, isAdmin, callback) {
  if (ctx.user() && _.isFunction(ctx.user().isGlobalAdmin) && ctx.user().isGlobalAdmin()) {
    return _setAdmin(ctx, 'admin:global', isAdmin, userId, callback);
  }

  return callback({ code: 401, msg: 'You do not have sufficient rights to make someone an admin' });
};

/**
 * Internal method that either promotes or demotes a user to or from being an admin. This method
 * will do all the necessary validation of the user in context and passed in parameters
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     adminType       One of `admin:global` or `admin:tenant`
 * @param  {Boolean}    isAdmin         Flag that indicates whether this user should be an admin or not
 * @param  {String}     userId          The id of the user whose admin status to set or unset
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _setAdmin = function(ctx, adminType, isAdmin, principalId, callback) {
  if (!PrincipalsUtil.isUser(principalId)) {
    return callback({ code: 400, msg: 'The provided principalId is not a user' });
  }

  // Double-check that this user exists
  getUser(ctx, principalId, (err, user) => {
    if (err) return callback(err);

    if (user.deleted) {
      return callback({ code: 404, msg: util.format("Couldn't find principal: ", principalId) });
    }

    return PrincipalsDAO.setAdmin(adminType, isAdmin, principalId, callback);
  });
};

/**
 * Send an email token to a user that can be used to verify the user owns the email address
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {User}       user            The user to send the email token to
 * @param  {String}     email           The email address where to send the token to
 * @param  {String}     [token]         The token to send. If left null, a new one will be generated
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _sendEmailToken = function(ctx, user, email, token, callback) {
  callback =
    callback ||
    function(err) {
      if (err) log().error({ err, userId: user.id }, 'Unable to send a user a verification email');
    };

  // Generate a token if none was specified
  token = token || ShortId.generate();

  // Store the token
  PrincipalsDAO.storeEmailToken(user.id, email, token, err => {
    if (err) return callback(err);

    // The EmailAPI expects a user to have a verified email address. As this is not the case
    // when sending an email token, we send in a patched user object
    const userToEmail = _.extend({}, user, { email });

    const tenant = TenantsAPI.getTenant(user.tenant.alias);
    const verificationUrl = TenantsUtil.getBaseUrl(tenant) + '/?verifyEmail=' + encodeURIComponent(token);

    // Send an email to the specified e-mail address
    const data = {
      actor: ctx.user(),
      tenant: ctx.tenant(),
      user: userToEmail,
      baseUrl: TenantsUtil.getBaseUrl(ctx.tenant()),
      skinVariables: getTenantSkinVariables(ctx.tenant().alias),
      token,
      verificationUrl
    };

    // We pass the current date in as the "hashCode" for this email. We need to be able to send
    // a copy of the same email for the "resend email token" functionality. As we don't expect
    // that this logic will get stuck in a loop this is probably OK
    EmailAPI.sendEmail('oae-principals', 'verify', userToEmail, data, { hash: Date.now() });

    return callback();
  });
};

/**
 * Resend an email token
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     userId          The id of the user for who to resend the email token
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const resendEmailToken = function(ctx, userId, callback) {
  try {
    pipe(
      isUserId,
      otherwise({
        code: 400,
        msg: 'A valid user id must be provided'
      })
    )(userId);

    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'You have to be logged in to be able to resend an email token'
      })
    )(ctx);
  } catch (error) {
    return callback(error);
  }

  // Ensure that you need to either be the user for which a token is being sent or a tenant admin
  const principalResource = AuthzUtil.getResourceFromId(userId);
  if (ctx.user().id !== userId && !ctx.user().isAdmin(principalResource.tenantAlias)) {
    return callback({ code: 401, msg: 'You are not authorized to resend an email token' });
  }

  // Get the email token for the user
  PrincipalsDAO.getEmailToken(userId, (err, email, persistedToken) => {
    if (err) return callback(err);

    // Get the user object
    PrincipalsDAO.getPrincipal(userId, (err, user) => {
      if (err) return callback(err);

      // Send the email token
      return _sendEmailToken(ctx, user, email, persistedToken, callback);
    });
  });
};

/**
 * Verify an email token
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     userId          The id of the user to verify the email address for
 * @param  {String}     token           The token with which to verify the email address
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {User}       callback.user   The updated user
 */
const verifyEmail = function(ctx, userId, token, callback) {
  try {
    pipe(
      isUserId,
      otherwise({
        code: 400,
        msg: 'A valid user id must be provided'
      })
    )(userId);

    pipe(
      isNotEmpty,
      otherwise({
        code: 400,
        msg: 'A token must be provided'
      })
    )(token);

    pipe(
      (value, regex) => {
        return value.match(regex);
      },
      otherwise({
        code: 400,
        msg: 'An invalid token was provided'
      })
    )(token, /^[a-zA-Z0-9-_]{7,14}$/);

    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'You have to be logged in to be able to verify an email address'
      })
    )(ctx);
  } catch (error) {
    return callback(error);
  }

  const principalResource = AuthzUtil.getResourceFromId(userId);
  if (ctx.user().id !== userId && !ctx.user().isAdmin(principalResource.tenantAlias)) {
    return callback({
      code: 401,
      msg: 'You are not authorized to verify the email address of this user'
    });
  }

  // Get the user object as we need to know the old email address so we can take it out of the mapping
  PrincipalsDAO.getPrincipal(userId, (err, user) => {
    if (err) return callback(err);

    // Ensure the token is correct
    PrincipalsDAO.getEmailToken(userId, (err, email, persistedToken) => {
      if (err) return callback(err);

      if (persistedToken !== token) {
        return callback({ code: 401, msg: 'Wrong token' });
      }

      // Set the email address
      PrincipalsUtil.verifyEmailAddress(ctx, user, email, (err, updatedUser) => {
        if (err) return callback(err);

        return callback(null, updatedUser);
      });
    });
  });
};

/**
 * Check whether a user has a pending email token
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     userId              The id of the user for which to check whether they have a pending email token
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {String}     callback.email      The email address for which there is a token
 */
const getEmailToken = function(ctx, userId, callback) {
  try {
    pipe(
      isUserId,
      otherwise({
        code: 400,
        msg: 'A valid user id must be provided'
      })
    )(userId);

    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'You have to be logged in to be able to check for the existence of a pending email token'
      })
    )(ctx);
  } catch (error) {
    return callback(error);
  }

  const principalResource = AuthzUtil.getResourceFromId(userId);
  if (ctx.user().id !== userId && !ctx.user().isAdmin(principalResource.tenantAlias)) {
    return callback({
      code: 401,
      msg: 'You are not authorized to check for the existence of a pending email token'
    });
  }

  // Check if there's a token and return the email address if there is one
  // eslint-disable-next-line no-unused-vars
  PrincipalsDAO.getEmailToken(userId, (err, email, persistedToken) => {
    if (err) return callback(err);

    return callback(null, email);
  });
};

/**
 * Delete a pending email token for a user
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     userId              The id of the user for which to delete the pending email token
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {String}     callback.email      The email address for which there is a token
 */
const deleteEmailToken = function(ctx, userId, callback) {
  try {
    pipe(
      isUserId,
      otherwise({
        code: 400,
        msg: 'A valid user id must be provided'
      })
    )(userId);

    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'You have to be logged in to be able to delete a pending email token'
      })
    )(ctx);
  } catch (error) {
    return callback(error);
  }

  const principalResource = AuthzUtil.getResourceFromId(userId);
  if (ctx.user().id !== userId && !ctx.user().isAdmin(principalResource.tenantAlias)) {
    return callback({ code: 401, msg: 'You are not authorized to delete a pending email token' });
  }

  // Check if there is a token
  getEmailToken(ctx, userId, err => {
    if (err) return callback(err);

    // Delete the email token
    PrincipalsDAO.deleteEmailToken(userId, err => {
      if (err) return callback(err);

      // Emit an event that an email token has been deleted
      PrincipalsEmitter.emit(PrincipalsConstants.events.DELETED_EMAIL_TOKEN, ctx, userId, errs => {
        if (errs) {
          return callback(_.first(errs));
        }

        return callback();
      });
    });
  });
};

/**
 * Get data of a principal
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}     userId                  The id of the user for which to get his personal data
 * @param  {String}     exportType              Export type can be 'personal-data', 'content' or 'shared'
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Objetc}     callback.zipFile        Zip file containing all the data
 */
const exportData = function(ctx, userId, exportType, callback) {
  try {
    pipe(
      isUserId,
      otherwise({
        code: 400,
        msg: 'A valid user id must be provided'
      })
    )(userId);

    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'You have to be logged in to be able to delete a pending email token'
      })
    )(ctx);

    pipe(
      isIn,
      otherwise({
        code: 402,
        msg: 'An invalid exportType has been specified'
      })
    )(exportType, _.values(PrincipalsConstants.exportType));
  } catch (error) {
    return callback(error);
  }

  PrincipalsDAO.getPrincipal(userId, (err, principal) => {
    if (err) return callback(err);

    const personalDetails =
      'Personal id : ' +
      principal.id +
      '\nPersonal name : ' +
      principal.displayName +
      '\nPersonal e-mail : ' +
      principal.email;

    // Get profile picture if exist
    _extractProfilePicture(ctx, principal, (err, profilePicture) => {
      if (err) return callback(err);

      // Get personal data
      collectDataToExport(ctx, userId, exportType, (err, data) => {
        if (err) return callback(err);

        // Create an object by assembling all personal data
        _assemblePersonalData(personalDetails, profilePicture, data, (err, personalData) => {
          if (err) return callback(err);

          // Convert an object to a zip file
          _zipData(personalData, (err, zipFile) => {
            if (err) {
              log().error({ err, displayName: principal.displayName }, 'An error occurred while creating the zip file');
              return callback(err);
            }

            return callback(null, zipFile);
          });
        });
      });
    });
  });
};

/**
 * Get profile picture
 *
 * @param  {Context}    ctx                         Standard context object containing the current user and the current tenant
 * @param  {Array}      principal                   The user for which to get his personal data
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {Objetc}     callback.profilePicture     Object containing the profile picture's data
 */
const _extractProfilePicture = function(ctx, principal, callback) {
  if (_.isEmpty(principal.picture)) {
    return callback();
  }

  const path = ContentUtil.getStorageBackend(ctx, principal.picture.largeUri).getRootDirectory();

  const pathLargePicture = principal.picture.largeUri.split(':');
  const pathSplited = principal.picture.largeUri.split('/');
  const imageName = pathSplited[pathSplited.length - 1];

  const profilePicture = { path: path + '/' + pathLargePicture[1], imageName };

  return callback(null, profilePicture);
};

/**
 * Create an object containing the personal data of a user
 *
 * @param  {Object}     personalDetails             Personal details about a user
 * @param  {Object}     profilePicture              The profile picture of a user
 * @param  {Object}     data                        An object containing data about link, collabdoc, uploaded file, meeting and discussion
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {Objetc}     callback.personalData       Object contain all the data
 */
const _assemblePersonalData = function(personalDetails, profilePicture, data, callback) {
  const personalData = { personalDetails, profilePicture };

  if (data) {
    const dataTypes = ['uploads', 'links', 'collabdocs', 'collabsheets', 'meetings', 'discussions'];

    dataTypes.forEach(dataType => {
      if (data[dataType]) {
        personalData[dataType] = data[dataType];
      }
    });
  }

  return callback(null, personalData);
};

/**
 * Get content informations
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}     userId                  The id of the user for which to get his personal data
 * @param  {String}     exportType              Export type can be 'personal-data', 'content' or 'shared'
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Objetc}     callback.data           Object contain all the data
 */
const collectDataToExport = function(ctx, userId, exportType, callback) {
  if (exportType === PrincipalsConstants.exportType.PERSONAL_DATA) {
    return callback();
  }

  // Get contents library
  getContentLibraryItems(ctx, userId, null, null, (err, contents) => {
    if (err) return callback(err);

    // Remove all content that was not created by the user
    if (exportType === PrincipalsConstants.exportType.CONTENT_DATA) {
      contents = _.reject(contents, content => {
        return content.createdBy !== userId;
      });
    }

    // Group all content by type
    const contentsSplited = _.groupBy(contents, content => {
      return content.resourceSubType;
    });

    // Get uploaded files
    _getUploadedFiles(ctx, contentsSplited.file, (err, uploadData) => {
      if (err) return callback(err);

      // Convert links into txt file
      _linkToTxt(ctx, contentsSplited.link, (err, linkData) => {
        if (err) return callback(err);

        // Convert collabdocs into txt file
        _collabdocToTxt(ctx, contentsSplited.collabdoc, (err, collabdocData) => {
          if (err) return callback(err);

          _collabsheetToCSV(ctx, contentsSplited.collabsheet, (err, collabsheetData) => {
            if (err) return callback(err);

            // Get meetings library
            MeetingsAPI.Meetings.getMeetingsLibrary(ctx, userId, null, null, (err, meetings) => {
              if (err) return callback(err);

              if (exportType === PrincipalsConstants.exportType.CONTENT_DATA) {
                meetings = _.reject(meetings, meeting => {
                  return meeting.createdBy !== userId;
                });
              }

              // Convert meetings into txt file
              _meetingToTxt(ctx, meetings, (err, meetingData) => {
                if (err) return callback(err);

                // Get discussions library
                DiscussionsAPI.Discussions.getDiscussionsLibrary(ctx, userId, null, null, (err, discussions) => {
                  if (err) return callback(err);

                  if (exportType === PrincipalsConstants.exportType.CONTENT_DATA) {
                    discussions = _.reject(discussions, discussion => {
                      return discussion.createdBy !== userId;
                    });
                  }

                  // Convert meetings into txt file
                  _discussionToTxt(ctx, discussions, (err, discussionData) => {
                    if (err) return callback(err);

                    return callback(null, {
                      uploads: uploadData,
                      links: linkData,
                      collabdocs: collabdocData,
                      collabsheets: collabsheetData,
                      meetings: meetingData,
                      discussions: discussionData
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
};

/**
 * Get information about uploaded files
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {Array}      uploadedFiles           Array of uploaded files
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Objetc}     callback.uploadData     Object contain all the uploaded files' data
 */
const _getUploadedFiles = function(ctx, uploadedFiles, callback) {
  if (_.isEmpty(uploadedFiles)) {
    return callback();
  }

  // Get files path
  const filePath = ContentUtil.getStorageBackend(ctx, null).getRootDirectory();
  const uploadData = [];

  _.each(uploadedFiles, uploadedFile => {
    const uploadedFileId = uploadedFile.id.split(':');
    const path =
      uploadedFileId[0] +
      '/' +
      uploadedFileId[1] +
      '/' +
      uploadedFileId[2].slice(0, 2) +
      '/' +
      uploadedFileId[2].slice(2, 6) +
      '/' +
      uploadedFileId[2].slice(4, 10) +
      '/' +
      uploadedFileId[2].slice(6, 14) +
      '/' +
      uploadedFileId[2] +
      '/' +
      uploadedFile.latestRevisionId.split(':').join('-');
    const nameWithoutSpace = uploadedFile.filename.split(/ /g).join('-');

    uploadData.push({
      path: filePath + '/' + path + '/' + nameWithoutSpace,
      title: nameWithoutSpace
    });
  });

  return callback(null, uploadData);
};

const _collabsheetToCSV = function(ctx, collabsheets, callback) {
  if (_.isEmpty(collabsheets)) return callback();

  let txtCollabsheet = '';
  const collabsheetData = [];

  async.eachSeries(
    collabsheets,
    (eachSheet, callback) => {
      getCommentsForContent(ctx, eachSheet.id, null, null, (err, comments) => {
        if (err) return callback(err);

        getContentRevision(ctx, eachSheet.id, eachSheet.latestRevisionId, (err /* latestRevision */) => {
          if (err) return callback(err);

          getJSON(eachSheet.ethercalcRoomId, (err, jsonExport) => {
            if (err) return callback(err);

            txtCollabsheet = `Collabsheet name: ${eachSheet.displayName}
            Collabsheet path: ${eachSheet.profilePath}
            Collabsheet visibility: ${eachSheet.visibility}
            Tenant name: ${eachSheet.tenant.displayName}
            Content of the document: ${jsonExport[0].join(' ')}\n`;

            _attachCommentsToTxt(txtCollabsheet, comments, (err, exportedContentWithComments) => {
              if (err) return callback(err);

              _escapeFilename(eachSheet.displayName, (err, fileName) => {
                if (err) return callback(err);

                collabsheetData.push({ text: exportedContentWithComments, title: fileName + '.txt' });
                callback();
              });
            });
          });
        });
      });
    },
    err => {
      if (err) return callback(err);

      return callback(null, collabsheetData);
    }
  );
};

/**
 * Get information about collabdocs
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {Array}      collabdocs              Array of collabdocs
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Objetc}     callback.collabdocData  Object contain all the collabdocs' data
 */
const _collabdocToTxt = function(ctx, collabdocs, callback) {
  if (_.isEmpty(collabdocs)) {
    return callback();
  }

  let txtCollabdoc = '';
  const collabdocData = [];

  async.eachSeries(
    collabdocs,
    (collabdoc, callback) => {
      getCommentsForContent(ctx, collabdoc.id, null, null, (err, messages) => {
        if (err) return callback(err);

        getContentRevision(ctx, collabdoc.id, collabdoc.latestRevisionId, (err, revision) => {
          if (err) return callback(err);

          txtCollabdoc =
            'Collabdoc name: ' +
            collabdoc.displayName +
            '\nCollabdoc path: ' +
            collabdoc.profilePath +
            '\nCollabdoc visibility: ' +
            collabdoc.visibility +
            '\nTenant name : ' +
            collabdoc.tenant.displayName +
            '\nContent of the document : ' +
            revision.etherpadHtml +
            '\n\n';

          _attachCommentsToTxt(txtCollabdoc, messages, (err, txtCollabdocWithMessages) => {
            if (err) return callback(err);

            _escapeFilename(collabdoc.displayName, (err, fileName) => {
              if (err) return callback(err);

              collabdocData.push({ text: txtCollabdocWithMessages, title: fileName + '.txt' });
              callback();
            });
          });
        });
      });
    },
    err => {
      if (err) return callback(err);

      return callback(null, collabdocData);
    }
  );
};

/**
 * Get information about links
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {Array}      links                   Array of links
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Obejct}     callback.linkData       Object contain all the links' data
 */
const _linkToTxt = function(ctx, links, callback) {
  if (_.isEmpty(links)) {
    return callback();
  }

  let txtLink = '';
  const linkData = [];

  async.eachSeries(
    links,
    (link, callback) => {
      getCommentsForContent(ctx, link.id, null, null, (err, messages) => {
        if (err) return callback(err);

        txtLink =
          'Link name : ' +
          link.displayName +
          '\nLink path : ' +
          link.profilePath +
          '\nLink : ' +
          link.link +
          '\nLink visibility: ' +
          link.visibility +
          '\nTenant name : ' +
          link.tenant.displayName +
          '\n\n';

        _attachCommentsToTxt(txtLink, messages, (err, txtLinkWithMessages) => {
          if (err) return callback(err);

          _escapeFilename(link.displayName, (err, fileName) => {
            if (err) return callback(err);

            linkData.push({ text: txtLinkWithMessages, title: fileName + '.txt' });
            callback();
          });
        });
      });
    },
    err => {
      if (err) return callback(err);

      return callback(null, linkData);
    }
  );
};

/**
 * Get information about meetings
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {Array}      meetings                Array of meetings
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.meetingData    Object contain all meetings' data
 */
const _meetingToTxt = function(ctx, meetings, callback) {
  if (_.isEmpty(meetings)) {
    return callback();
  }

  let txtMeeting = '';
  const meetingData = [];

  async.eachSeries(
    meetings,
    (meeting, callback) => {
      MeetingsAPI.Meetings.getMessages(ctx, meeting.id, null, null, (err, messages) => {
        if (err) return callback(err);

        txtMeeting =
          'Meeting name : ' +
          meeting.displayName +
          '\nMeeting description : ' +
          meeting.description +
          '\nMeeting path : ' +
          meeting.tenant.host +
          meeting.profilePath +
          '\nMeeting visibility: ' +
          meeting.visibility +
          '\nTenant name : ' +
          meeting.tenant.displayName +
          '\n\n';

        _attachCommentsToTxt(txtMeeting, messages, (err, txtMeetingWithMessages) => {
          if (err) return callback(err);

          _escapeFilename(meeting.displayName, (err, fileName) => {
            if (err) return callback(err);

            meetingData.push({ text: txtMeetingWithMessages, title: fileName + '.txt' });
            callback();
          });
        });
      });
    },
    err => {
      if (err) return callback(err);

      return callback(null, meetingData);
    }
  );
};

/**
 * Get information about discussions
 *
 * @param  {Context}    ctx                         Standard context object containing the current user and the current tenant
 * @param  {Array}      discussions                 Array of discussions
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {Object}     callback.discussionData     Object contain all the discussions' data
 */
const _discussionToTxt = function(ctx, discussions, callback) {
  if (_.isEmpty(discussions)) {
    return callback();
  }

  let txtDiscussion = '';
  const discussionData = [];

  async.eachSeries(
    discussions,
    (discussion, callback) => {
      DiscussionsAPI.Discussions.getMessages(ctx, discussion.id, null, null, (err, messages) => {
        if (err) return callback(err);

        txtDiscussion =
          'Discussion name : ' +
          discussion.displayName +
          '\nDiscussion description: ' +
          discussion.description +
          '\nDiscussion path : ' +
          discussion.tenant.host +
          discussion.profilePath +
          '\nDiscussion visibility : ' +
          discussion.visibility +
          '\nTenant name : ' +
          discussion.tenant.displayName +
          '\n';

        _attachCommentsToTxt(txtDiscussion, messages, (err, txtDiscussionWithMessages) => {
          if (err) return callback(err);

          _escapeFilename(discussion.displayName, (err, fileName) => {
            if (err) return callback(err);

            discussionData.push({ text: txtDiscussionWithMessages, title: fileName + '.txt' });
            callback();
          });
        });
      });
    },
    err => {
      if (err) return callback(err);

      return callback(null, discussionData);
    }
  );
};

/**
 * Return comments as String
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {Array}      messages            Array of messages
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {String}     callback.txt        Comments as String
 */
const _attachCommentsToTxt = function(txt, messages, callback) {
  if (_.isEmpty(messages)) {
    return callback(null, txt);
  }

  txt += 'Comments : ';

  _.each(messages, message => {
    const messageCreated = dateFormat(
      new Date(parseInt(message.created)), // eslint-disable-line radix
      'dd-mm-yyyy, h:MM:ss TT'
    );
    txt +=
      '\n\t' +
      messageCreated +
      ' : level ' +
      message.level +
      ' : ' +
      message.createdBy.displayName +
      ' says : ' +
      message.body;
  });

  txt += '\n\n';

  return callback(null, txt);
};

/**
 * Clear the resource's name. The goal is to remove characters that can disrupt the creation of the zip
 *
 * @param  {String}     nameResource        The name of the resource to rewrite
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {String}     callback.fileName   New file name
 */
const _escapeFilename = function(nameResource, callback) {
  if (_.isEmpty(nameResource)) {
    return callback(null, 'no_name');
  }

  let fileName = nameResource.replace(HTTP_PROTOCOL + '://', '');
  fileName = fileName.split(HTTPS_PROTOCOL + '://').join('');
  fileName = fileName.split(HTTP_PROTOCOL + '://').join('');
  fileName = fileName.split('/').join('-');
  fileName = fileName.split(' ').join('_');
  return callback(null, fileName);
};

/**
 * Build a jszip object
 *
 * @param  {object}     personalData        An object containing all the data
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {String}     callback.jszip      Zip object contain all personal data
 */
const _zipData = function(personalData, callback) {
  const zipFile = new jszip(); // eslint-disable-line new-cap

  const compressPersonalData = callback => {
    if (personalData.personalDetails) {
      zipFile.file('personal_data.txt', personalData.personalDetails);
    }

    return callback();
  };

  const compressProfilePicture = callback => {
    if (personalData.profilePicture) {
      fs.readFile(personalData.profilePicture.path, (err, data) => {
        if (err) return callback(err);

        zipFile.file(personalData.profilePicture.imageName, data, { base64: false, binary: true });
        return callback();
      });
    } else {
      return callback();
    }
  };

  const compressUploadedData = callback => {
    if (personalData.uploads) {
      const uploadFolder = zipFile.folder('upload_data');

      async.eachSeries(
        personalData.uploads,
        (uploadedFile, callback) => {
          fs.readFile(uploadedFile.path, (err, data) => {
            if (err) return callback(err);

            const fileExt = uploadedFile.title.split('.').pop();
            const text = uploadedFile.title.split('.');
            const fileName = text.slice(0, text.length - 1).join('.');
            const newName = _getNewFileName(fileExt, fileName, uploadFolder);

            uploadFolder.file(newName, data, { base64: false, binary: true });
            callback();
          });
        },
        err => {
          if (err) return callback(err);
          return callback();
        }
      );
    }

    return callback();
  };

  const compressCollabDocs = callback => {
    if (personalData.collabdocs) {
      const collabdocFolder = zipFile.folder('collabdoc_data');

      _.each(personalData.collabdocs, collabdoc => {
        const fileExt = collabdoc.title.split('.').pop();
        const text = collabdoc.title.split('.');
        const fileName = text.slice(0, text.length - 1).join('.');
        const newName = _getNewFileName(fileExt, fileName, collabdocFolder);

        collabdocFolder.file(newName, collabdoc.text);
      });
    }

    return callback();
  };

  const compressCollabSheets = callback => {
    if (personalData.collabsheets) {
      const collabsheetFolder = zipFile.folder('collabsheet_data');

      _.each(personalData.collabsheets, collabsheet => {
        const fileExt = collabsheet.title.split('.').pop();
        const text = collabsheet.title.split('.');
        const fileName = text.slice(0, text.length - 1).join('.');
        const newName = _getNewFileName(fileExt, fileName, collabsheetFolder);

        collabsheetFolder.file(newName, collabsheet.text);
      });
    }

    return callback();
  };

  const compressLinks = callback => {
    if (personalData.links) {
      const linkFolder = zipFile.folder('link_data');

      _.each(personalData.links, link => {
        const fileExt = link.title.split('.').pop();
        const text = link.title.split('.');
        const fileName = text.slice(0, text.length - 1).join('.');
        const newName = _getNewFileName(fileExt, fileName, linkFolder);

        linkFolder.file(newName, link.text);
      });
    }

    return callback();
  };

  const compressMeetings = callback => {
    if (personalData.meetings) {
      const meetingFolder = zipFile.folder('meeting_data');

      _.each(personalData.meetings, meeting => {
        const fileExt = meeting.title.split('.').pop();
        const text = meeting.title.split('.');
        const fileName = text.slice(0, text.length - 1).join('.');
        const newName = _getNewFileName(fileExt, fileName, meetingFolder);

        meetingFolder.file(newName, meeting.text);
      });
    }

    return callback();
  };

  const compressDiscussions = callback => {
    if (personalData.discussions) {
      const discussionFolder = zipFile.folder('discussion_data');

      _.each(personalData.discussions, discussion => {
        const fileExt = discussion.title.split('.').pop();
        const text = discussion.title.split('.');
        const fileName = text.slice(0, text.length - 1).join('.');
        const newName = _getNewFileName(fileExt, fileName, discussionFolder);

        discussionFolder.file(newName, discussion.text);
      });
    }

    return callback();
  };

  async.series(
    [
      compressPersonalData,
      compressProfilePicture,
      compressUploadedData,
      compressCollabDocs,
      compressCollabSheets,
      compressLinks,
      compressMeetings,
      compressDiscussions
    ],
    err => {
      if (err) return callback(err);

      return callback(null, zipFile);
    }
  );
};

/**
 * Check if the name is already used. If it's already in use, give it a new name.
 *
 * @param  {String}     fileExt             The extension file
 * @param  {String}     fileName            The file name
 * @param  {Object}     folder              The folder
 * @param  {String}     return.fileName     The new file name
 */
const _getNewFileName = function(fileExt, fileName, folder) {
  let index = 0;
  let file = '';
  let searchAName = true;

  while (searchAName) {
    if (index === 0) {
      file = fileName + '.' + fileExt;
    } else {
      file = fileName + '(' + index + ').' + fileExt;
    }

    if (folder.files[folder.root + file]) {
      index += 1;
    } else {
      searchAName = false;
      if (index !== 0) {
        return fileName + '(' + index + ').' + fileExt;
      }

      return fileName + '.' + fileExt;
    }
  }
};

export {
  registerFullUserProfileDecorator,
  createUser,
  importUsers,
  updateUser,
  canDeleteUser,
  deleteUser,
  deleteOrRestoreUsersByTenancy,
  getAllUsersForTenant,
  restoreUser,
  canRestoreUser,
  getUser,
  getFullUserProfile,
  getMe,
  setTenantAdmin,
  setGlobalAdmin,
  resendEmailToken,
  verifyEmail,
  getEmailToken,
  deleteEmailToken,
  exportData,
  collectDataToExport
};
