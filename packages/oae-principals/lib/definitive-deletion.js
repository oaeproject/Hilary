/*!
 * Copyright 2017 Apereo Foundation (AF) Licensed under the
 * Educational Community License, Version 2.0 (the 'License'); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://opensource.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an 'AS IS'
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

import fs from 'node:fs';
import _ from 'underscore';
import async from 'async';
import shortId from 'shortid';
import { addMonths } from 'date-fns';

import * as UIAPI from 'oae-ui/lib/api.js';
import * as AuthenticationAPI from 'oae-authentication/lib/api.js';
import * as ActivityAPI from 'oae-activity/lib/api.js';
import * as AuthzAPI from 'oae-authz';
import * as AuthzInvitationDAO from 'oae-authz/lib/invitations/dao.js';
import { AuthzConstants } from 'oae-authz/lib/constants.js';
import * as AuthzDelete from 'oae-authz/lib/delete.js';
import * as ContentAPI from 'oae-content';
import * as ContentUtil from 'oae-content/lib/internal/util.js';
import * as DiscussionAPI from 'oae-discussions/lib/api.discussions.js';
import * as EmailAPI from 'oae-email';
import * as FolderAPI from 'oae-folders';
import * as FollowingAPI from 'oae-following/lib/api.js';
import * as MeetingsAPI from 'oae-jitsi';
import * as TenantsUtil from 'oae-tenants/lib/util.js';
import { setUpConfig } from 'oae-config';
import { logger } from 'oae-logger';
import * as GroupAPI from './api.group.js';
import * as PrincipalsAPI from './api.user.js';
import { PrincipalsConstants } from './constants.js';
import * as PrincipalsDAO from './internal/dao.js';
import PrincipalsEmitter from './internal/emitter.js';

const PrincipalsConfig = setUpConfig('oae-principals');
const log = logger('oae-principals');

const FOLDER = 'folder';
const CONTENT = 'content';
const DISCUSSION = 'discussion';
const MEETING = 'meeting';
const GROUP = 'group';

const PUBLIC = 'public';
const DELETE = 'delete';

const RESOURCE_TYPES = [CONTENT, FOLDER, DISCUSSION, MEETING, GROUP];
const FOLDER_PREFIX = 'f';
const CONTENT_PREFIX = 'c';
const DISCUSSION_PREFIX = 'd';
const MEETING_PREFIX = 'm';
const GROUP_PREFIX = 'g';

/**
 * Get or create user archive
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {Object}     user                    User to be archived
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occured, if any
 * @param  {Object}     callback.userArchive    Return user archive
 */
const fetchOrCloneFromUser = (ctx, user, callback) => {
  PrincipalsDAO.getArchivedUser(user.tenant.alias, (error, userClone) => {
    if (error) return callback(error);
    if (userClone) return callback(null, userClone);

    // Persist the user object
    const userOptions = {
      tenant: { alias: user.tenant.alias },
      visibility: PUBLIC,
      emailPreference: 'never',
      locale: ctx.locale(),
      acceptedTC: null,
      isUserArchive: 'true'
    };

    const displayName = user.tenant.alias + ' archive';

    // Create a record in the principals table
    PrincipalsAPI.createUser(ctx, user.tenant.alias, displayName, userOptions, (error, userClone) => {
      if (error) return callback(error);

      // Create a user archive in the table archiveByTenant
      PrincipalsDAO.createArchivedUser(user.tenant.alias, userClone.id, (error_) => {
        if (error_) return callback(error_);

        // Get and return the userArchive
        PrincipalsDAO.getArchivedUser(user.tenant.alias, (error, userClone) => {
          if (error) return callback(error);

          return callback(null, userClone);
        });
      });
    });
  });
};

/**
 * Delete rights on a user + update roles on editors && on user archive
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}     user                    User that will be deleted
 * @param  {String}     cloneUsers              Users Archive
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occured, if any
 * @param  {Object}     callback.listEmail      Array of users to email
 */
const transferPermissionsToCloneUser = (ctx, user, cloneUsers, callback) => {
  callback = callback || function () {};

  const listEmail = [];
  const listOfIdElementToBeTransferred = [];

  async.eachSeries(
    RESOURCE_TYPES,
    (resourceType, done) => {
      _transferResourcePermissions(
        ctx,
        user,
        cloneUsers,
        listEmail,
        listOfIdElementToBeTransferred,
        resourceType,
        (error /* ListEmail, listOfIdElementToBeTransferred */) => {
          if (error) return done(error);

          return done();
        }
      );
    },
    () => {
      _addToArchive(cloneUsers.archiveId, user, listOfIdElementToBeTransferred, (error) => {
        if (error) return callback(error);

        _sendEmail(ctx, listEmail, cloneUsers, user, (error, listEmail) => {
          if (error) return callback(error);

          return callback(null, listEmail);
        });
      });
    }
  );
};

/**
 * Create a member list with corresponding resources
 *
 * values of deleted :
 *          contentWillBeDeleted : list of resources - corresponding to a user - which will be delete into X months
 *          userJustLeaving : list of resources - corresponding to a user - where the user deleted is leaving these resources
 *
 * @param  {Array}      list            List of resources corresponding to a user
 * @param  {Object}     resource        The resource to add to the list
 * @param  {Array}      memberList      The list of memeber to add to the list
 * @param  {Array}      action          The action can be 'true' if the content will be deleted into X month or 'false' if
 *                                          the deleted user is just leaving the resource.
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const _addMemberToList = (list, resource, memberList, action, callback) => {
  if (_.isEmpty(memberList)) {
    return callback();
  }

  list = list || [];

  async.eachSeries(
    memberList,
    (member, done) => {
      _parseMember(list, resource, member, action, (error, newList) => {
        if (error) return done(error);

        list = newList;
        return done();
      });
    },
    () => callback(null, list)
  );
};

const _parseMember = (list, resource, user, action, callback) => {
  if (_.isEmpty(list)) {
    list.push({ contentWillBeDeleted: [], userJustLeaving: [], profile: user.profile });
  }

  async.eachSeries(
    list,
    (member, done) => {
      if (user.profile.id === member.profile.id) {
        if (action === true) {
          member.contentWillBeDeleted.push(resource);
        } else {
          member.userJustLeaving.push(resource);
        }

        return done(true);
      }

      return done();
    },
    (isUserFound) => {
      if (!isUserFound) {
        if (action === true) {
          list.push({ contentWillBeDeleted: [resource], userJustLeaving: [], profile: user.profile });
        } else {
          list.push({ contentWillBeDeleted: [], userJustLeaving: [resource], profile: user.profile });
        }
      }

      return callback(null, list);
    }
  );
};

/**
 * Send an email token to a user that have a resource shared with the deleted user
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {Object}     data            User to send mail + resource
 * @param  {Object}     cloneUser       The archive user
 * @param  {Object}     userDeleted     The user deleted
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const _sendEmail = (ctx, data, cloneUser, userDeleted, callback) => {
  callback =
    callback ||
    function (error) {
      if (error) {
        log().error({ err: error, user: userDeleted.id }, 'Unable to send a user a verification email');
      }
    };

  if (_.isEmpty(data)) {
    return callback();
  }

  PrincipalsDAO.getPrincipalSkipCache(cloneUser.archiveId, (error, cloneUser) => {
    if (error) return callback(error);

    // Grab the configuration field. This will return the number of months
    const month = PrincipalsConfig.getValue(ctx.tenant().alias, 'user', DELETE);

    if (_.isEmpty(data)) {
      return callback();
    }

    const listEmail = [];

    async.eachSeries(
      data,
      (user, done) => {
        if (_.isEmpty(user.contentWillBeDeleted) && _.isEmpty(user.userJustLeaving)) {
          return done();
        }

        const token = shortId.generate();

        PrincipalsDAO.storeEmailToken(user.profile.id, user.profile.email, token, (error_) => {
          if (error_) return callback(error_);

          const resource = _.omit(user, 'profile');
          user = _.omit(user, ['contentWillBeDeleted', 'userJustLeaving']);

          // The EmailAPI expects a user to have a verified email address. As this is not the case
          // when sending an email token, we send in a patched user object
          const userToEmail = _.extend({}, user, { email: user.profile.email });

          // Send an email to the specified e-mail address
          const dataEmail = {
            tenant: ctx.tenant(),
            userDeletedName: userDeleted.displayName,
            resource,
            user,
            month,
            baseUrl: TenantsUtil.getBaseUrl(ctx.tenant()),
            skinVariables: UIAPI.getTenantSkinVariables(ctx.tenant().alias),
            token,
            archiveEmail: cloneUser.email
          };

          // We pass the current date in as the 'hashCode' for this email. We need to be able to send
          // a copy of the same email for the 'resend email token' functionality. As we don't expect
          // that this logic will get stuck in a loop this is probably OK
          EmailAPI.sendEmail('oae-principals', 'notify', userToEmail.profile, dataEmail, { hash: Date.now() });
          listEmail.push(user.profile.email);

          return done();
        });
      },
      () => callback(null, listEmail)
    );
  });
};

/**
 * Delete rights on element + update roles on editors && on user archive
 *
 * @param  {Context}    ctx                                          Standard context object containing the current user and the current tenant
 * @param  {String}     user                                         The user to delete
 * @param  {String}     archiveUser                                  User Archive
 * @param  {String}     listEmail                                    Array of users to email
 * @param  {String}     listOfIdElementToBeTransferred               List of element to remove from deleted user
 * @param  {String}     resourceType                                 Type can be : 'content', 'folder', 'discussion', 'meeting' or 'group'
 * @param  {Function}   callback                                     Standard callback function
 * @param  {Object}     callback.err                                 An error that occured, if any
 * @param  {Array}      callback.listEmail                           Array of users to email
 * @param  {Array}      callback.listOfIdElementToBeTransferred      List of element to remove from deleted user
 * @api private
 */
const _transferResourcePermissions = (
  ctx,
  user,
  archiveUser,
  listElementByMember,
  listOfIdElementToBeTransferred,
  resourceType,
  callback
) => {
  _getLibrary(ctx, user.id, resourceType, (error, libraryContents) => {
    if (error) return callback(error);

    if (_.isEmpty(libraryContents)) {
      return callback(null, listElementByMember, listOfIdElementToBeTransferred);
    }

    async.mapSeries(
      libraryContents,
      (eachLibraryItem, done) => {
        // Search if other user have right on this document
        _getMembers(ctx, eachLibraryItem.id, resourceType, (error, memberList) => {
          if (error) return callback(error);

          // If he's not a manager, do nothing
          _isManagerOfContent(user.id, eachLibraryItem, resourceType, (error, isManager) => {
            if (error) return callback(error);

            // Remove the deleted user from the member list
            _removeUserFromMemberList(memberList, user.id, (error, newMemberList) => {
              if (error) return callback(error);

              if (isManager) {
                // If member list is empty
                if (_.isEmpty(newMemberList)) {
                  listOfIdElementToBeTransferred.push(eachLibraryItem.id);

                  // Make user archive a manager of the resource
                  _updateRoles(ctx, eachLibraryItem, archiveUser, resourceType, (error_) => {
                    if (error_) return callback(error_);

                    _removeFromLibrary(ctx, user.id, eachLibraryItem, resourceType, (error_) => {
                      if (error_) return callback(error_);

                      done();
                    });
                  });
                } else {
                  const hasAnotherManager = _.find(
                    newMemberList,
                    (member) => member.role === AuthzConstants.role.MANAGER
                  );

                  // If there is another manager on the resource, send a notification email
                  if (hasAnotherManager) {
                    // We will just notify the members that the user will remove his account
                    _addMemberToList(
                      listElementByMember,
                      eachLibraryItem,
                      newMemberList,
                      false,
                      (
                        error
                        /* ListElementByMember */
                      ) => {
                        if (error) return callback(error);

                        _removeFromLibrary(ctx, user.id, eachLibraryItem, resourceType, (error_) => {
                          if (error_) return callback(error_);

                          done();
                        });
                      }
                    );

                    // Has no manager
                  } else {
                    listOfIdElementToBeTransferred.push(eachLibraryItem.id);

                    // Make user archive a manager of the resource
                    _updateRoles(ctx, eachLibraryItem, archiveUser, resourceType, (error_) => {
                      if (error_) return callback(error_);

                      // We will notify the members that the user will remove his account and make the user archive manager of the resource
                      _addMemberToList(
                        listElementByMember,
                        eachLibraryItem,
                        newMemberList,
                        true,
                        (
                          error
                          /* ListElementByMember */
                        ) => {
                          if (error) return callback(error);

                          _removeFromLibrary(ctx, user.id, eachLibraryItem, resourceType, (error_) => {
                            if (error_) return callback(error_);

                            done();
                          });
                        }
                      );
                    });
                  }
                }
              } else {
                // We will just notify the members that the user will remove his account
                _addMemberToList(
                  listElementByMember,
                  eachLibraryItem,
                  newMemberList,
                  false,
                  (error /* ListElementByMember */) => {
                    if (error) return callback(error);

                    _removeFromLibrary(ctx, user.id, eachLibraryItem, resourceType, (error_) => {
                      if (error_) return callback(error_);

                      done();
                    });
                  }
                );
              }
            });
          });
        });
      },
      () => callback(null, listElementByMember, listOfIdElementToBeTransferred)
    );
  });
};

/**
 * Clear the list by removing the deleted user
 *
 * @param  {Array}      memberList                  Array of user
 * @param  {String}     userId                      User to delete from the array
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occured, if any
 * @param  {Object}     callback.newMemberList      Array of user without the deleted user
 * @api private
 */
const _removeUserFromMemberList = (memberList, userId, callback) =>
  callback(
    null,
    _.reject(memberList, (element) => element.profile.id === userId)
  );

/**
 * Add elements to archive
 *
 * @param  {String}     cloneUserId              The user archive of the tenant
 * @param  {String}     principalToEliminate       The user to delete
 * @param  {String}     elementId                  The id element to delete
 * @param  {Function}   callback                   Standard callback function
 * @param  {Object}     callback.err               An error that occured, if any
 * @api private
 */
const _addToArchive = (cloneUserId, principalToEliminate, elementId, callback) => {
  if (!cloneUserId || !principalToEliminate.id) {
    return callback({ code: 400, msg: 'A user archive and a user to delete are required' });
  }

  if (!elementId) {
    return callback();
  }

  // Return list of ids after removing duplicate elements
  const duplicationRemoved = elementId.filter((element, index, self) => index === self.indexOf(element));

  const monthsUntilDeletion = PrincipalsConfig.getValue(principalToEliminate.tenant.alias, 'user', DELETE);
  const deletionDate = addMonths(new Date(), Number.parseInt(monthsUntilDeletion, 10));

  // Add the element to data archive
  PrincipalsDAO.addDataToArchive(
    cloneUserId,
    principalToEliminate.id,
    duplicationRemoved,
    deletionDate.toString(),
    (error) => {
      if (error) return callback(error);

      return callback();
    }
  );
};

/**
 * Check if the current user is manager a content
 *
 * @param  {String}     userId              The user id
 * @param  {Object}     resource            The resource
 * @param  {String}     resourceType        Type can be : 'content', 'folder', 'discussion', 'meeting' or 'group'
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occured, if any
 * @param  {Boolean}    callback.hasRole    True if the user are manager of the content
 * @api private
 */
const _isManagerOfContent = (userId, resource, resourceType, callback) => {
  const elementId = resourceType === FOLDER ? resource.groupId : resource.id;

  AuthzAPI.hasRole(userId, elementId, AuthzConstants.role.MANAGER, (error, hasRole) => {
    if (error) return callback(error);

    return callback(null, hasRole);
  });
};

/**
 * Remove elements from library
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     userId              The user id
 * @param  {String}     element             Element to remove from library
 * @param  {String}     type                Type can be : 'content', 'folder', 'discussion', 'meeting' or 'group'
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occured, if any
 * @api private
 */
const _removeFromLibrary = (ctx, userId, element, type, callback) => {
  if (!element) return callback();

  const changes = {};
  changes[userId] = false;

  switch (type) {
    case CONTENT:
      ContentAPI.removeContentFromLibrary(ctx, userId, element.id, (error) => {
        if (error) return callback(error);

        return callback();
      });
      break;

    case FOLDER:
      FolderAPI.removeFolderFromLibrary(ctx, userId, element.id, (error) => {
        if (error) return callback(error);

        return callback();
      });
      break;

    case DISCUSSION:
      DiscussionAPI.removeDiscussionFromLibrary(ctx, userId, element.id, (error) => {
        if (error) return callback(error);

        return callback();
      });
      break;

    case MEETING:
      MeetingsAPI.Meetings.removeMeetingFromLibrary(ctx, userId, element.id, (error) => {
        if (error) return callback(error);

        return callback();
      });
      break;

    case GROUP:
      AuthzAPI.updateRoles(element.id, changes, (error) => {
        if (error) return callback(error);

        return callback();
      });
      break;

    default:
      break;
  }
};

/**
 * Get members of a resource
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}     elementId               The element id
 * @param  {String}     type                    Type can be : 'content', 'folder', 'discussion', 'meeting' or 'group'
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occured, if any
 * @param  {Object}     callback.memberList     List of members
 * @api private
 */
const _getMembers = (ctx, elementId, type, callback) => {
  switch (type) {
    case CONTENT:
      ContentAPI.getContentMembersLibrary(ctx, elementId, null, null, (error, memberList) => {
        if (error) return callback(error);

        return callback(null, memberList);
      });
      break;

    case FOLDER:
      FolderAPI.getFolderMembers(ctx, elementId, null, null, (error, memberList) => {
        if (error) return callback(error);

        return callback(null, memberList);
      });
      break;

    case DISCUSSION:
      DiscussionAPI.getDiscussionMembers(ctx, elementId, null, null, (error, memberList) => {
        if (error) return callback(error);

        return callback(null, memberList);
      });
      break;

    case MEETING:
      MeetingsAPI.Meetings.getMeetingMembers(ctx, elementId, null, null, (error, memberList) => {
        if (error) return callback(error);

        return callback(null, memberList);
      });
      break;

    case GROUP:
      GroupAPI.getMembersLibrary(ctx, elementId, null, null, (error, memberList) => {
        if (error) return callback(error);

        return callback(null, memberList);
      });
      break;

    default:
      break;
  }
};

/**
 * Get members of a resource
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}     userId                  The user id
 * @param  {String}     type                    Type can be : 'content', 'folder', 'discussion', 'meeting' or 'group'
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occured, if any
 * @param  {Object}     callback.resourceList   List of resources
 * @api private
 */
const _getLibrary = (ctx, userId, type, callback) => {
  switch (type) {
    case CONTENT:
      ContentAPI.getContentLibraryItems(ctx, userId, null, null, (error, contents) => {
        if (error) return callback(error);

        return callback(null, contents);
      });
      break;

    case FOLDER:
      FolderAPI.getFoldersLibrary(ctx, userId, null, null, (error, folders) => {
        if (error) return callback(error);

        return callback(null, folders);
      });
      break;

    case DISCUSSION:
      DiscussionAPI.getDiscussionsLibrary(ctx, userId, null, null, (error, discussions) => {
        if (error) return callback(error);

        return callback(null, discussions);
      });
      break;

    case MEETING:
      MeetingsAPI.Meetings.getMeetingsLibrary(ctx, userId, null, null, (error, meetings) => {
        if (error) return callback(error);

        return callback(null, meetings);
      });
      break;

    case GROUP:
      GroupAPI.getMembershipsLibrary(ctx, userId, null, null, (error, groups) => {
        if (error) return callback(error);

        return callback(null, groups);
      });
      break;

    default:
      break;
  }
};

/**
 * Update roles and make the archive user manager of the resource
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {Object}     element             The resource
 * @param  {String}     archiveUser         User Archive
 * @param  {String}     type                Type can be : 'content', 'folder', 'discussion', 'meeting' or 'group'
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occured, if any
 * @api private
 */
const _updateRoles = (ctx, element, archiveUser, type, callback) => {
  const update = {};
  update[archiveUser.archiveId] = AuthzConstants.role.MANAGER;

  if (type === FOLDER) {
    AuthzAPI.updateRoles(element.groupId, update, (error /* update */) => {
      if (error) return callback(error);

      return callback();
    });
  } else if (type === CONTENT) {
    ContentAPI.setContentPermissions(ctx, element.id, update, (error /* update */) => {
      if (error) return callback(error);

      return callback();
    });
  } else {
    AuthzAPI.updateRoles(element.id, update, (error /* update */) => {
      if (error) return callback(error);

      return callback();
    });
  }
};

/** =============================================================== **/
/** ===================== Definitive deletion ===================== **/
/** =============================================================== **/

/**
 * Definitive delete of user
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     user            User that will be deleted
 * @param  {String}     alias           Tenant alias
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occured, if any
 */
const eliminateUser = (ctx, user, alias, callback) => {
  callback = callback || function () {};

  // Get userArchive
  PrincipalsDAO.getArchivedUser(alias, (error, userArchive) => {
    if (error) return callback(error);

    // Get all data from user archive where data belonged to the user removed
    PrincipalsDAO.getDataFromArchive(userArchive.archiveId, user.id, (error, data) => {
      if (error) {
        log().info({ userId: user.id, name: 'oae-principals' }, 'Unable to get data to eliminate, aborting.');
        return callback(error);
      }

      async.series(
        {
          deleteResources(done) {
            _deleteResourcePermissions(ctx, user, userArchive.archiveId, data, (error_) => {
              if (error_) {
                log().info(
                  { userId: user.id, name: 'oae-principals', archiveId: userArchive.archiveId },
                  'Unable to delete resource permissions, skipping this step.'
                );
              }

              done();
            });
          },
          removeProfile(done) {
            removeProfilePicture(ctx, user, (error_) => {
              if (error_) {
                log().info(
                  { userId: user.id, name: 'oae-principals' },
                  'Unable to delete profile picture, skipping this step.'
                );
              }

              done();
            });
          },
          deleteFollowers(done) {
            FollowingAPI.deleteFollowers(ctx, user, (error_) => {
              if (error_) {
                log().info(
                  { userId: user.id, name: 'oae-principals' },
                  'Unable to delete user followers, skipping this step.'
                );
              }

              done();
            });
          },
          deleteFollowing(done) {
            FollowingAPI.deleteFollowing(ctx, user, (error_) => {
              if (error_) {
                log().info(
                  { userId: user.id, name: 'oae-principals' },
                  'Unable to delete user following, skipping this step.'
                );
              }

              done();
            });
          },
          deleteInvitations(done) {
            AuthzInvitationDAO.deleteInvitationsByEmail(user.email, (error_) => {
              if (error_) {
                log().info(
                  { userId: user.id, name: 'oae-principals' },
                  'Unable to delete invitations, skipping this step.'
                );
              }

              done();
            });
          },
          deleteActivity(done) {
            ActivityAPI.removeActivityStream(ctx, user.id, (error_) => {
              if (error_) {
                log().info(
                  { userId: user.id, name: 'oae-principals' },
                  'Unable to delete user activity streams, skipping this step.'
                );
              }

              done();
            });
          },
          removeFromCronTable(done) {
            PrincipalsDAO.removePrincipalFromDataArchive(userArchive.archiveId, user.id, (error_) => {
              if (error_) {
                log().info(
                  { userId: user.id, name: 'oae-principals', archiveId: userArchive.archiveId },
                  'Unable to remove principal from data archive, skipping this step.'
                );
                return callback(error_);
              }

              done();
            });
          },
          isDeleted(done) {
            // Determine if the principal was already deleted in the authz index before we set them and flip the principals deleted flag
            AuthzDelete.isDeleted([user.id], (error /* wasDeleted */) => {
              if (error) {
                log().info(
                  { userId: user.id, name: 'oae-principals' },
                  'Unable to remove principal from authz index, skipping this step.'
                );
              }

              done();
            });
          }
        },
        (error_) => {
          if (error_) {
            log().info(
              { userId: user.id, name: 'oae-principals' },
              'Found some errors while deleting data associated to user, moving on...'
            );
          }

          // Get the login to delete the user form the table AuthenticationLoginId
          AuthenticationAPI.getUserLoginIds(ctx, user.id, (error, login) => {
            if (error) return callback(error);

            // Set (or re-Set) the principal as deleted in the authz index
            AuthzDelete.setDeleted(user.id, (error_) => {
              if (error_) {
                log().info('Unable to delete user from Authz index.');
                return callback(error_);
              }

              // Delete a user from the database
              PrincipalsDAO.fullyDeletePrincipal(user, login, (error_) => {
                if (error_) return callback(error_);

                // Notify that a user has been deleted
                PrincipalsEmitter.emit(PrincipalsConstants.events.DELETED_USER, ctx, user, (error_) => {
                  if (error_) return callback(error_);

                  // Notify consumers that a user has been deleted
                  log().info(
                    { userId: user.id, name: 'oae-principals' },
                    'Definitive deletion user with a mapped login id'
                  );

                  return callback(null, true);
                });
              });
            });
          });
        }
      );
    });
  });
};

/**
 * Remove profile picture from file system
 *
 * @param  {String}     user            The user to delete
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occured, if any
 */
const removeProfilePicture = (ctx, user, callback) => {
  PrincipalsDAO.getPrincipal(user.id, (error, principal) => {
    if (error) return callback(error);
    if (_.isEmpty(principal.picture)) return callback();

    const pathSmallPicture = principal.picture.smallUri.split(':');
    const pathMediumPicture = principal.picture.mediumUri.split(':');
    const pathLargePicture = principal.picture.largeUri.split(':');

    const pathStorageBackend = ContentUtil.getStorageBackend(ctx, principal.picture.largeUri).getRootDirectory();

    fs.unlink(pathStorageBackend + '/' + pathSmallPicture[1], (error_) => {
      if (error_) return callback(error_);

      fs.unlink(pathStorageBackend + '/' + pathMediumPicture[1], (error_) => {
        if (error_) return callback(error_);

        fs.unlink(pathStorageBackend + '/' + pathLargePicture[1], (error_) => {
          if (error_) return callback(error_);

          return callback();
        });
      });
    });
  });
};

/**
 * Remove all his rights on resources
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     user            The user to delete
 * @param  {String}     archiveId       The user archive of the tenant
 * @param  {Object}     data            Data of the user from the table DataArchive
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occured, if any
 * @api private
 */
const _deleteResourcePermissions = (ctx, user, archiveId, data, callback) => {
  // If there is no ids, return callback
  if (!data.resourceId) {
    return callback();
  }

  const ids = data.resourceId.split(',');

  async.eachSeries(
    ids,
    (id, done) => {
      // If the data belonged to the removed user, delete the resource
      if (data.principalId === user.id) {
        // Get type of resource
        let idResource = id;
        const splitId = idResource.split(':');
        const resourceType = splitId[0];

        // If it's a folder get the idGroup
        _ifFolderGetIdGroup(ctx, idResource, splitId[0], (error, idFolder) => {
          if (error) return callback(error);
          if (idFolder) idResource = idFolder;

          // Get role
          AuthzAPI.getAllAuthzMembers(idResource, (error, memberIdRoles) => {
            if (error) return callback(error);

            const doesResourceHaveManagers =
              _.chain(memberIdRoles)
                .reject((each) => each.id === archiveId)
                .pluck('role')
                .filter((role) => role === AuthzConstants.role.MANAGER)
                .value().length > 0;

            // Lets erase only if there are no new managers in the meantime
            const shouldProceed = !doesResourceHaveManagers;

            // Remove the resource with the appropriate method
            switch (resourceType) {
              case CONTENT_PREFIX:
                _deletePermissionsOnContent(ctx, shouldProceed, archiveId, idResource, (error_) => {
                  if (error_) return callback(error_);
                });
                break;
              case DISCUSSION_PREFIX:
                _deletePermissionsOnDiscussion(ctx, shouldProceed, archiveId, idResource, (error_) => {
                  if (error_) return callback(error_);
                });
                break;
              case FOLDER_PREFIX:
                _deletePermissionsOnFolder(ctx, shouldProceed, archiveId, id, (error_) => {
                  if (error_) return callback(error_);
                });
                break;
              case GROUP_PREFIX:
                _deletePermissionsOnGroup(ctx, shouldProceed, archiveId, idResource, (error_) => {
                  if (error_) return callback(error_);
                });
                break;
              case MEETING_PREFIX:
                _deletePermissionsOnMeeting(ctx, shouldProceed, archiveId, idResource, (error_) => {
                  if (error_) return callback(error_);
                });
                break;
              default:
                break;
            }

            return done();
          });
        });
      }
    },
    () => callback()
  );
};

/**
 * Return the group a folder belongs to
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     idResource      The id of the resource to delete
 * @param  {String}     splitId        The first part of a resource id (e.g. f:test:ryfQL_D4b, it will be 'f') who define the type of resource
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occured, if any
 * @api private
 */
const _ifFolderGetIdGroup = (ctx, idResource, splitId, callback) => {
  if (splitId === FOLDER_PREFIX) {
    FolderAPI.getFolder(ctx, idResource, (error, folder) => {
      if (error) return callback(error);

      return callback(null, folder.groupId);
    });
  } else {
    return callback();
  }
};

/**
 * Remove right on content or remove it if there is no manager
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {Boolean}    del             Boolean who determine if the element should be remove or just removed from the library
 * @param  {String}     archiveId       The id user archive of the tenant
 * @param  {String}     idResource      The id of the resource to delete
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occured, if any
 * @api private
 */
const _deletePermissionsOnContent = (ctx, del, archiveId, idResource, callback) => {
  if (del) {
    ContentAPI.deleteContent(ctx, idResource, (error) => {
      if (error) return callback(error);

      return callback();
    });
  } else {
    // If there is another manager on the content, remove it from the library
    ContentAPI.removeContentFromLibrary(ctx, archiveId, idResource, (error) => {
      if (error) return callback(error);

      return callback();
    });
  }
};

/**
 * Remove right on discussion or remove it if there is no manager
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {Boolean}    del             Boolean who determine if the element should be remove or just removed from the library
 * @param  {String}     archiveId       The id user archive of the tenant
 * @param  {String}     idResource      The id of the resource to delete
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occured, if any
 * @api private
 */
const _deletePermissionsOnDiscussion = (ctx, del, archiveId, idResource, callback) => {
  if (del) {
    // Remove the actual discussion profile
    DiscussionAPI.deleteDiscussion(ctx, idResource, (error) => {
      if (error) return callback(error);

      return callback();
    });
  } else {
    // If there is another manager on the discussion, remove it from the library
    DiscussionAPI.removeDiscussionFromLibrary(ctx, archiveId, idResource, (error) => {
      if (error) return callback(error);

      return callback();
    });
  }
};

/**
 * Remove right on folder or remove it if there is no manager
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {Boolean}    del             Boolean who determine if the element should be remove or just removed from the library
 * @param  {String}     archiveId       The id user archive of the tenant
 * @param  {String}     idResource      The id of the resource to delete
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occured, if any
 * @api private
 */
const _deletePermissionsOnFolder = (ctx, del, archiveId, idResource, callback) => {
  if (del) {
    FolderAPI.deleteFolder(ctx, idResource, false, (error /* content */) => {
      if (error) return callback(error);

      return callback();
    });
  } else {
    // If there is another manager on the folder, remove it from the library
    FolderAPI.removeFolderFromLibrary(ctx, archiveId, idResource, (error) => {
      if (error) return callback(error);

      return callback();
    });
  }
};

/**
 * Remove right on group or remove it if there is no manager
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {Boolean}    del             Boolean who determine if the element should be remove or just removed from the library
 * @param  {String}     archiveId       The id user archive of the tenant
 * @param  {String}     idResource      The id of the resource to delete
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occured, if any
 * @api private
 */
const _deletePermissionsOnGroup = (ctx, del, archiveId, idResource, callback) => {
  if (del) {
    // Remove group
    GroupAPI.deleteGroup(ctx, idResource, (error) => {
      if (error) return callback(error);

      // Remove roles
      const update = {};
      update[archiveId] = false;
      AuthzAPI.updateRoles(idResource, update, (error /* usersToInvalidate */) => {
        if (error) return callback(error);

        return callback();
      });
    });
  } else {
    // If there is another manager on the group, remove it from the library
    GroupAPI.leaveGroup(ctx, idResource, (error) => {
      if (error) return callback(error);

      return callback();
    });
  }
};

/**
 * Remove right on meeting or remove it if there is no manager
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {Boolean}    del             Boolean who determine if the element should be remove or just removed from the library
 * @param  {String}     archiveId       The id user archive of the tenant
 * @param  {String}     idResource      The id of the resource to delete
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occured, if any
 * @api private
 */
const _deletePermissionsOnMeeting = (ctx, del, archiveId, idResource, callback) => {
  if (del) {
    // Remove meeting
    MeetingsAPI.Meetings.deleteMeeting(ctx, idResource, (error) => {
      if (error) return callback(error);

      return callback();
    });
  } else {
    // If there is another manager on the meeting, remove it from the library
    MeetingsAPI.Meetings.removeMeetingFromLibrary(ctx, archiveId, idResource, (error) => {
      if (error) return callback(error);

      return callback();
    });
  }
};

export {
  transferPermissionsToCloneUser as transferUsersDataToCloneUser,
  removeProfilePicture,
  eliminateUser,
  fetchOrCloneFromUser
};
