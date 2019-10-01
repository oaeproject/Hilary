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

import fs from 'fs';
import _ from 'underscore';
import async from 'async';
import shortId from 'shortid';
import { addMonths } from 'date-fns';

import * as ActivityAPI from 'oae-activity';
import * as AuthzAPI from 'oae-authz';
import * as AuthzInvitationDAO from 'oae-authz/lib/invitations/dao';
import { AuthzConstants } from 'oae-authz/lib/constants';
import * as AuthzDelete from 'oae-authz/lib/delete';
import * as ContentAPI from 'oae-content';
import * as ContentUtil from 'oae-content/lib/internal/util';
import * as DiscussionAPI from 'oae-discussions/lib/api.discussions';
import * as EmailAPI from 'oae-email';
import * as FolderAPI from 'oae-folders';
import * as FollowingAPI from 'oae-following';
import * as MeetingsAPI from 'oae-jitsi';
import * as TenantsUtil from 'oae-tenants/lib/util';
import { setUpConfig } from 'oae-config';
import { logger } from 'oae-logger';
import * as GroupAPI from './api.group';
import * as PrincipalsAPI from './api.user';
import { PrincipalsConstants } from './constants';
import * as PrincipalsDAO from './internal/dao';
import PrincipalsEmitter from './internal/emitter';

const PrincipalsConfig = setUpConfig('oae-principals');
const log = logger('oae-principals');

const FOLDER = 'folder';
const CONTENT = 'content';
const DISCUSSION = 'discussion';
const MEETING = 'meeting';
const GROUP = 'group';

const PUBLIC_VISIBILITY = 'public';
const DELETE = 'delete';

const RESOURCE_TYPES = [CONTENT, FOLDER, DISCUSSION, MEETING, GROUP];
const FOLDER_PREFIX = 'f';
const CONTENT_PREFIX = 'c';
const DISCUSSION_PREFIX = 'd';
const MEETING_PREFIX = 'm';
const GROUP_PREFIX = 'g';

const DEFAULT_MONTH = 2;

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
  PrincipalsDAO.getArchivedUser(user.tenant.alias, (err, userClone) => {
    if (err) return callback(err);
    if (userClone) return callback(null, userClone);

    // Persist the user object
    const userOpts = {
      tenant: { alias: user.tenant.alias },
      visibility: PUBLIC_VISIBILITY,
      emailPreference: 'never',
      locale: ctx.locale(),
      acceptedTC: null,
      isUserArchive: 'true'
    };

    const displayName = user.tenant.alias + ' archive';

    // Create a record in the principals table
    PrincipalsAPI.createUser(ctx, user.tenant.alias, displayName, userOpts, (err, userClone) => {
      if (err) return callback(err);

      // Create a user archive in the table archiveByTenant
      PrincipalsDAO.createArchivedUser(user.tenant.alias, userClone.id, err => {
        if (err) return callback(err);

        // Get and return the userArchive
        PrincipalsDAO.getArchivedUser(user.tenant.alias, (err, userClone) => {
          if (err) return callback(err);

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
  callback = callback || function() {};

  const listEmail = [];
  const listOfIdElementToBeTransferred = [];

  async.eachSeries(
    RESOURCE_TYPES,
    (resourceType, done) => {
      _transferResourcePermissions(ctx, user, cloneUsers, listEmail, listOfIdElementToBeTransferred, resourceType, (
        err /* ListEmail, listOfIdElementToBeTransferred */
      ) => {
        if (err) return done(err);

        return done();
      });
    },
    () => {
      _addToArchive(cloneUsers.archiveId, user, listOfIdElementToBeTransferred, err => {
        if (err) return callback(err);

        _sendEmail(ctx, listEmail, cloneUsers, user, (err, listEmail) => {
          if (err) return callback(err);

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
      _parseMember(list, resource, member, action, (err, newList) => {
        if (err) return done(err);

        list = newList;
        return done();
      });
    },
    () => {
      return callback(null, list);
    }
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
    isUserFound => {
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
    function(err) {
      if (err) {
        log().error({ err, user: userDeleted.id }, 'Unable to send a user a verification email');
      }
    };

  if (_.isEmpty(data)) {
    return callback();
  }

  PrincipalsDAO.getPrincipalSkipCache(cloneUser.archiveId, (err, cloneUser) => {
    if (err) return callback(err);

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

        PrincipalsDAO.storeEmailToken(user.profile.id, user.profile.email, token, err => {
          if (err) return callback(err);

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
            skinVariables: require('oae-ui').getTenantSkinVariables(ctx.tenant().alias),
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
      () => {
        return callback(null, listEmail);
      }
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
  _getLibrary(ctx, user.id, resourceType, (err, libraryContents) => {
    if (err) return callback(err);

    if (_.isEmpty(libraryContents)) {
      return callback(null, listElementByMember, listOfIdElementToBeTransferred);
    }

    async.mapSeries(
      libraryContents,
      (eachLibraryItem, done) => {
        // Search if other user have right on this document
        _getMembers(ctx, eachLibraryItem.id, resourceType, (err, memberList) => {
          if (err) return callback(err);

          // If he's not a manager, do nothing
          _isManagerOfContent(user.id, eachLibraryItem, resourceType, (err, isManager) => {
            if (err) return callback(err);

            // Remove the deleted user from the member list
            _removeUserFromMemberList(memberList, user.id, (err, newMemberList) => {
              if (err) return callback(err);

              if (isManager) {
                // If member list is empty
                if (_.isEmpty(newMemberList)) {
                  listOfIdElementToBeTransferred.push(eachLibraryItem.id);

                  // Make user archive a manager of the resource
                  _updateRoles(ctx, eachLibraryItem, archiveUser, resourceType, err => {
                    if (err) return callback(err);

                    _removeFromLibrary(ctx, user.id, eachLibraryItem, resourceType, err => {
                      if (err) return callback(err);

                      done();
                    });
                  });
                } else {
                  const hasAnotherManager = _.find(newMemberList, member => {
                    return member.role === AuthzConstants.role.MANAGER;
                  });

                  // If there is another manager on the resource, send a notification email
                  if (hasAnotherManager) {
                    // We will just notify the members that the user will remove his account
                    _addMemberToList(listElementByMember, eachLibraryItem, newMemberList, false, (
                      err
                      /* ListElementByMember */
                    ) => {
                      if (err) return callback(err);

                      _removeFromLibrary(ctx, user.id, eachLibraryItem, resourceType, err => {
                        if (err) return callback(err);

                        done();
                      });
                    });

                    // Has no manager
                  } else {
                    listOfIdElementToBeTransferred.push(eachLibraryItem.id);

                    // Make user archive a manager of the resource
                    _updateRoles(ctx, eachLibraryItem, archiveUser, resourceType, err => {
                      if (err) return callback(err);

                      // We will notify the members that the user will remove his account and make the user archive manager of the resource
                      _addMemberToList(listElementByMember, eachLibraryItem, newMemberList, true, (
                        err
                        /* ListElementByMember */
                      ) => {
                        if (err) return callback(err);

                        _removeFromLibrary(ctx, user.id, eachLibraryItem, resourceType, err => {
                          if (err) return callback(err);

                          done();
                        });
                      });
                    });
                  }
                }
              } else {
                // We will just notify the members that the user will remove his account
                _addMemberToList(listElementByMember, eachLibraryItem, newMemberList, false, (
                  err /* ListElementByMember */
                ) => {
                  if (err) return callback(err);

                  _removeFromLibrary(ctx, user.id, eachLibraryItem, resourceType, err => {
                    if (err) return callback(err);

                    done();
                  });
                });
              }
            });
          });
        });
      },
      () => {
        return callback(null, listElementByMember, listOfIdElementToBeTransferred);
      }
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
const _removeUserFromMemberList = (memberList, userId, callback) => {
  return callback(
    null,
    _.reject(memberList, element => {
      return element.profile.id === userId;
    })
  );
};

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
  const duplicationRemoved = elementId.filter((elem, index, self) => {
    return index === self.indexOf(elem);
  });

  const monthsUntilDeletion = PrincipalsConfig.getValue(principalToEliminate.tenant.alias, 'user', DELETE);
  const deletionDate = addMonths(new Date(), parseInt(monthsUntilDeletion, 10));

  // Add the element to data archive
  PrincipalsDAO.addDataToArchive(
    cloneUserId,
    principalToEliminate.id,
    duplicationRemoved,
    deletionDate.toString(),
    err => {
      if (err) return callback(err);

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

  AuthzAPI.hasRole(userId, elementId, AuthzConstants.role.MANAGER, (err, hasRole) => {
    if (err) return callback(err);

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
      ContentAPI.removeContentFromLibrary(ctx, userId, element.id, err => {
        if (err) return callback(err);

        return callback();
      });
      break;

    case FOLDER:
      FolderAPI.removeFolderFromLibrary(ctx, userId, element.id, err => {
        if (err) return callback(err);

        return callback();
      });
      break;

    case DISCUSSION:
      DiscussionAPI.removeDiscussionFromLibrary(ctx, userId, element.id, err => {
        if (err) return callback(err);

        return callback();
      });
      break;

    case MEETING:
      MeetingsAPI.Meetings.removeMeetingFromLibrary(ctx, userId, element.id, err => {
        if (err) return callback(err);

        return callback();
      });
      break;

    case GROUP:
      AuthzAPI.updateRoles(element.id, changes, err => {
        if (err) return callback(err);

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
      ContentAPI.getContentMembersLibrary(ctx, elementId, null, null, (err, memberList) => {
        if (err) return callback(err);

        return callback(null, memberList);
      });
      break;

    case FOLDER:
      FolderAPI.getFolderMembers(ctx, elementId, null, null, (err, memberList) => {
        if (err) return callback(err);

        return callback(null, memberList);
      });
      break;

    case DISCUSSION:
      DiscussionAPI.getDiscussionMembers(ctx, elementId, null, null, (err, memberList) => {
        if (err) return callback(err);

        return callback(null, memberList);
      });
      break;

    case MEETING:
      MeetingsAPI.Meetings.getMeetingMembers(ctx, elementId, null, null, (err, memberList) => {
        if (err) return callback(err);

        return callback(null, memberList);
      });
      break;

    case GROUP:
      GroupAPI.getMembersLibrary(ctx, elementId, null, null, (err, memberList) => {
        if (err) return callback(err);

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
      ContentAPI.getContentLibraryItems(ctx, userId, null, null, (err, contents) => {
        if (err) return callback(err);

        return callback(null, contents);
      });
      break;

    case FOLDER:
      FolderAPI.getFoldersLibrary(ctx, userId, null, null, (err, folders) => {
        if (err) return callback(err);

        return callback(null, folders);
      });
      break;

    case DISCUSSION:
      DiscussionAPI.getDiscussionsLibrary(ctx, userId, null, null, (err, discussions) => {
        if (err) return callback(err);

        return callback(null, discussions);
      });
      break;

    case MEETING:
      MeetingsAPI.Meetings.getMeetingsLibrary(ctx, userId, null, null, (err, meetings) => {
        if (err) return callback(err);

        return callback(null, meetings);
      });
      break;

    case GROUP:
      GroupAPI.getMembershipsLibrary(ctx, userId, null, null, (err, groups) => {
        if (err) return callback(err);

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
    AuthzAPI.updateRoles(element.groupId, update, (err /* update */) => {
      if (err) return callback(err);

      return callback();
    });
  } else if (type === CONTENT) {
    ContentAPI.setContentPermissions(ctx, element.id, update, (err /* update */) => {
      if (err) return callback(err);

      return callback();
    });
  } else {
    AuthzAPI.updateRoles(element.id, update, (err /* update */) => {
      if (err) return callback(err);

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
  callback = callback || function() {};

  // Get userArchive
  PrincipalsDAO.getArchivedUser(alias, (err, userArchive) => {
    if (err) return callback(err);

    // Get all data from user archive where data belonged to the user removed
    PrincipalsDAO.getDataFromArchive(userArchive.archiveId, user.id, (err, data) => {
      if (err) {
        log().info({ userId: user.id, name: 'oae-principals' }, 'Unable to get data to eliminate, aborting.');
        return callback(err);
      }

      async.series(
        {
          deleteResources(done) {
            _deleteResourcePermissions(ctx, user, userArchive.archiveId, data, err => {
              if (err) {
                log().info(
                  { userId: user.id, name: 'oae-principals', archiveId: userArchive.archiveId },
                  'Unable to delete resource permissions, skipping this step.'
                );
              }

              done();
            });
          },
          removeProfile(done) {
            removeProfilePicture(ctx, user, err => {
              if (err) {
                log().info(
                  { userId: user.id, name: 'oae-principals' },
                  'Unable to delete profile picture, skipping this step.'
                );
              }

              done();
            });
          },
          deleteFollowers(done) {
            FollowingAPI.deleteFollowers(ctx, user, err => {
              if (err) {
                log().info(
                  { userId: user.id, name: 'oae-principals' },
                  'Unable to delete user followers, skipping this step.'
                );
              }

              done();
            });
          },
          deleteFollowing(done) {
            FollowingAPI.deleteFollowing(ctx, user, err => {
              if (err) {
                log().info(
                  { userId: user.id, name: 'oae-principals' },
                  'Unable to delete user following, skipping this step.'
                );
              }

              done();
            });
          },
          deleteInvitations(done) {
            AuthzInvitationDAO.deleteInvitationsByEmail(user.email, err => {
              if (err) {
                log().info(
                  { userId: user.id, name: 'oae-principals' },
                  'Unable to delete invitations, skipping this step.'
                );
              }

              done();
            });
          },
          deleteActivity(done) {
            ActivityAPI.removeActivityStream(ctx, user.id, err => {
              if (err) {
                log().info(
                  { userId: user.id, name: 'oae-principals' },
                  'Unable to delete user activity streams, skipping this step.'
                );
              }

              done();
            });
          },
          removeFromCronTable(done) {
            PrincipalsDAO.removePrincipalFromDataArchive(userArchive.archiveId, user.id, err => {
              if (err) {
                log().info(
                  { userId: user.id, name: 'oae-principals', archiveId: userArchive.archiveId },
                  'Unable to remove principal from data archive, skipping this step.'
                );
                return callback(err);
              }

              done();
            });
          },
          isDeleted(done) {
            // Determine if the principal was already deleted in the authz index before we set them and flip the principals deleted flag
            AuthzDelete.isDeleted([user.id], (err /* wasDeleted */) => {
              if (err) {
                log().info(
                  { userId: user.id, name: 'oae-principals' },
                  'Unable to remove principal from authz index, skipping this step.'
                );
              }

              done();
            });
          }
        },
        err => {
          if (err) {
            log().info(
              { userId: user.id, name: 'oae-principals' },
              'Found some errors while deleting data associated to user, moving on...'
            );
          }

          // Get the login to delete the user form the table AuthenticationLoginId
          require('oae-authentication').getUserLoginIds(ctx, user.id, (err, login) => {
            if (err) return callback(err);

            // Set (or re-Set) the principal as deleted in the authz index
            AuthzDelete.setDeleted(user.id, err => {
              if (err) {
                log().info('Unable to delete user from Authz index.');
                return callback(err);
              }

              // Delete a user from the database
              PrincipalsDAO.fullyDeletePrincipal(user, login, err => {
                if (err) return callback(err);

                // Notify that a user has been deleted
                PrincipalsEmitter.emit(PrincipalsConstants.events.DELETED_USER, ctx, user, err => {
                  if (err) return callback(err);

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
  PrincipalsDAO.getPrincipal(user.id, (err, principal) => {
    if (err) return callback(err);
    if (_.isEmpty(principal.picture)) return callback();

    const pathSmallPicture = principal.picture.smallUri.split(':');
    const pathMediumPicture = principal.picture.mediumUri.split(':');
    const pathLargePicture = principal.picture.largeUri.split(':');

    const pathStorageBackend = ContentUtil.getStorageBackend(ctx, principal.picture.largeUri).getRootDirectory();

    fs.unlink(pathStorageBackend + '/' + pathSmallPicture[1], err => {
      if (err) return callback(err);

      fs.unlink(pathStorageBackend + '/' + pathMediumPicture[1], err => {
        if (err) return callback(err);

        fs.unlink(pathStorageBackend + '/' + pathLargePicture[1], err => {
          if (err) return callback(err);

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
        _ifFolderGetIdGroup(ctx, idResource, splitId[0], (err, idFolder) => {
          if (err) return callback(err);
          if (idFolder) idResource = idFolder;

          // Get role
          AuthzAPI.getAllAuthzMembers(idResource, (err, memberIdRoles) => {
            if (err) return callback(err);

            const doesResourceHaveManagers =
              _.chain(memberIdRoles)
                .reject(each => {
                  return each.id === archiveId;
                })
                .pluck('role')
                .filter(role => {
                  return role === AuthzConstants.role.MANAGER;
                })
                .value().length > 0;

            // Lets erase only if there are no new managers in the meantime
            const shouldProceed = !doesResourceHaveManagers;

            // Remove the resource with the appropriate method
            switch (resourceType) {
              case CONTENT_PREFIX:
                _deletePermissionsOnContent(ctx, shouldProceed, archiveId, idResource, err => {
                  if (err) return callback(err);
                });
                break;
              case DISCUSSION_PREFIX:
                _deletePermissionsOnDiscussion(ctx, shouldProceed, archiveId, idResource, err => {
                  if (err) return callback(err);
                });
                break;
              case FOLDER_PREFIX:
                _deletePermissionsOnFolder(ctx, shouldProceed, archiveId, id, err => {
                  if (err) return callback(err);
                });
                break;
              case GROUP_PREFIX:
                _deletePermissionsOnGroup(ctx, shouldProceed, archiveId, idResource, err => {
                  if (err) return callback(err);
                });
                break;
              case MEETING_PREFIX:
                _deletePermissionsOnMeeting(ctx, shouldProceed, archiveId, idResource, err => {
                  if (err) return callback(err);
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
    () => {
      return callback();
    }
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
    FolderAPI.getFolder(ctx, idResource, (err, folder) => {
      if (err) return callback(err);

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
    ContentAPI.deleteContent(ctx, idResource, err => {
      if (err) return callback(err);

      return callback();
    });
  } else {
    // If there is another manager on the content, remove it from the library
    ContentAPI.removeContentFromLibrary(ctx, archiveId, idResource, err => {
      if (err) return callback(err);

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
    DiscussionAPI.deleteDiscussion(ctx, idResource, err => {
      if (err) return callback(err);

      return callback();
    });
  } else {
    // If there is another manager on the discussion, remove it from the library
    DiscussionAPI.removeDiscussionFromLibrary(ctx, archiveId, idResource, err => {
      if (err) return callback(err);

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
    FolderAPI.deleteFolder(ctx, idResource, false, (err /* content */) => {
      if (err) return callback(err);

      return callback();
    });
  } else {
    // If there is another manager on the folder, remove it from the library
    FolderAPI.removeFolderFromLibrary(ctx, archiveId, idResource, err => {
      if (err) return callback(err);

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
    GroupAPI.deleteGroup(ctx, idResource, err => {
      if (err) return callback(err);

      // Remove roles
      const update = {};
      update[archiveId] = false;
      AuthzAPI.updateRoles(idResource, update, (err /* usersToInvalidate */) => {
        if (err) return callback(err);

        return callback();
      });
    });
  } else {
    // If there is another manager on the group, remove it from the library
    GroupAPI.leaveGroup(ctx, idResource, err => {
      if (err) return callback(err);

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
    MeetingsAPI.Meetings.deleteMeeting(ctx, idResource, err => {
      if (err) return callback(err);

      return callback();
    });
  } else {
    // If there is another manager on the meeting, remove it from the library
    MeetingsAPI.Meetings.removeMeetingFromLibrary(ctx, archiveId, idResource, err => {
      if (err) return callback(err);

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
