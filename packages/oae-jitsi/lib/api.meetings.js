import _ from 'underscore';

import * as AuthzAPI from 'oae-authz';
import * as AuthzInvitations from 'oae-authz/lib/invitations';
import * as AuthzPermissions from 'oae-authz/lib/permissions';
import * as LibraryAPI from 'oae-library';
import * as MessageBoxAPI from 'oae-messagebox';
import * as OaeUtil from 'oae-util/lib/util';
import * as PrincipalsDAO from 'oae-principals/lib/internal/dao';
import * as PrincipalsUtil from 'oae-principals/lib/util';
import * as ResourceActions from 'oae-resource/lib/actions';
import * as Signature from 'oae-util/lib/signature';
import { setUpConfig } from 'oae-config';
import * as MeetingsAPI from 'oae-jitsi';
import { logger } from 'oae-logger';

import { MessageBoxConstants } from 'oae-messagebox/lib/constants';
import { Validator as validator } from 'oae-authz/lib/validator';
const {
  makeSureThatOnlyIf,
  isDefined,
  otherwise,
  isANumber,
  isValidRoleChange,
  isLoggedInUser,
  isPrincipalId,
  isNotEmpty,
  isBoolean,
  isResourceId,
  isShortString,
  isMediumString,
  isArrayNotEmpty,
  getNestedObject,
  isLongString
} = validator;
import { compose, equals, length, and, pipe, gt as greaterThan, forEachObjIndexed } from 'ramda';
import isIn from 'validator/lib/isIn';
import isInt from 'validator/lib/isInt';
import { AuthzConstants } from 'oae-authz/lib/constants';

import { MeetingsConstants } from './constants';
import * as MeetingsDAO from './internal/dao';

const Config = setUpConfig('oae-jitsi');

const log = logger('meetings-jitsi-api');

const TRUE = 'true';
const FALSE = 'false';
/**
 * PUBLIC FUNCTIONS
 */

/**
 * Create a new meeting.
 *
 * @param {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param {String}     displayName             The display name of the meeting
 * @param {String}     [description]           A longer description for the meeting
 * @param {Boolean}    [chat]                  A boolean declaring whether or not Jitsi chat should be enabled
 * @param {Boolean}    [contactList]           A boolean declaring whether or not Jitsi contact list should be enabled
 * @param {String}     [visibility]            The visibility of the meeting. One of `public`, `loggedin`, `private`
 * @param {Object}     [additionalMembers]     Object where the keys represent principal ids that need to be added to the meeting upon creation and the values represent the role that principal will have. Possible values are "viewer" and "manager"
 * @param {Function}   callback                Standard callback function
 * @param {Object}     callback.err            An error that occurred, if any
 * @param {Meeting}    callback.meeting        The created meeting
 * */
const createMeeting = function(
  ctx,
  displayName,
  description,
  chat,
  contactList,
  visibility,
  additionalMembers,
  callback
) {
  callback = callback || function() {};

  // Setting content to default if no visibility setting is provided
  visibility = visibility || Config.getValue(ctx.tenant().alias, 'visibility', 'meeting');

  const allVisibilities = _.values(AuthzConstants.visibility);

  // Convert chat and contactList value to boolean for validation (if there are present)
  if (chat) chat = _convertToBoolean(String(chat));
  if (contactList) contactList = _convertToBoolean(String(contactList));

  // Verify basic properties
  try {
    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'Anonymous users cannot create a meeting'
      })
    )(ctx);

    pipe(
      isNotEmpty,
      otherwise({
        code: 400,
        msg: 'Must provide a display name for the meeting'
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
        msg: 'An invalid meeting visibility option has been provided. Must be one of: ' + allVisibilities.join(', ')
      })
    )(visibility, allVisibilities);

    const descriptionIsValid = and(isDefined(description), greaterThan(length(description), 0));
    pipe(
      makeSureThatOnlyIf(descriptionIsValid, isMediumString),
      otherwise({
        code: 400,
        msg: 'A description can be at most 10000 characters long'
      })
    )(description);

    // Verify each role is valid
    forEachObjIndexed((role /* , memberId */) => {
      pipe(
        isIn,
        otherwise({
          code: 400,
          msg: 'The role: ' + role + ' is not a valid member role for a meeting'
        })
      )(role, MeetingsConstants.roles.ALL_PRIORITY);
    }, additionalMembers);
  } catch (error) {
    return callback(error);
  }

  // The current user is always a manager
  additionalMembers[ctx.user().id] = AuthzConstants.role.MANAGER;

  const createFn = _.partial(
    MeetingsDAO.createMeeting,
    ctx.user().id,
    displayName,
    description,
    chat,
    contactList,
    visibility
  );
  ResourceActions.create(ctx, additionalMembers, createFn, (err, meeting, memberChangeInfo) => {
    if (err) {
      return callback(err);
    }

    MeetingsAPI.emitter.emit(MeetingsConstants.events.CREATED_MEETING, ctx, meeting, memberChangeInfo, errs => {
      if (errs) {
        return callback(_.first(errs));
      }

      return callback(null, meeting);
    });
  });
};

/**
 * Get a full meeting profile.
 *
 * @param  {Context}   ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}    meetingId               The ID of the meeting
 * @param  {Function}  callback                Standard callback function
 * @param  {Object}    callback.err            An error that occurred, if any
 * @param  {Meeting}   callback.meeting        The meeting profile
 */
const getFullMeetingProfile = function(ctx, meetingId, callback) {
  try {
    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'meetingId must be a valid resource id'
      })
    )(meetingId);
  } catch (error) {
    return callback(error);
  }

  _getMeeting(meetingId, (err, meeting) => {
    if (err) {
      return callback(err);
    }

    // Resolve the full meeting access information for the current user
    AuthzPermissions.resolveEffectivePermissions(ctx, meeting, (err, permissions) => {
      if (err) {
        return callback(err);
      }

      if (!permissions.canView) {
        // The user has no effective role, which means they are not allowed to view (this has already taken into
        // consideration implicit privacy rules, such as whether or not the meeting is public).
        return callback({ code: 401, msg: 'You are not authorized to view this meeting' });
      }

      meeting.isManager = permissions.canManage;
      meeting.canShare = permissions.canShare;
      meeting.canPost = permissions.canPost;

      if (ctx.user()) {
        // Attach a signature that can be used to perform quick access checks
        meeting.signature = Signature.createExpiringResourceSignature(ctx, meetingId);
      }

      // Populate the creator of the meeting
      PrincipalsUtil.getPrincipal(ctx, meeting.createdBy, (err, creator) => {
        if (err) {
          log().warn(
            {
              err,
              userId: meeting.createdBy,
              meetingId: meeting.id
            },
            'An error occurred getting the creator of a meeting. Proceeding with empty user for full profile'
          );
        } else {
          meeting.createdBy = creator;
        }

        MeetingsAPI.emitter.emit(MeetingsConstants.events.GET_MEETING_PROFILE, ctx, meeting);
        return callback(null, meeting);
      });
    });
  });
};

/**
 * Get a meeting basic profile.
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         meetingId               The ID of the meeting
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {BasicMeeting}   callback.meeting        The meeting profile
 */
const getMeeting = function(ctx, meetingId, callback) {
  try {
    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'A valid resource id must be specified'
      })
    )(meetingId);
  } catch (error) {
    return callback(error);
  }

  _getMeeting(meetingId, (err, meeting) => {
    if (err) {
      return callback(err);
    }

    AuthzPermissions.canView(ctx, meeting, err => {
      if (err) {
        return callback(err);
      }

      return callback(null, meeting);
    });
  });
};

/**
 * Get the invitations for a meeting.
 *
 * @param  {Context}   ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}    meetingId               The ID of the meeting
 * @param  {Function}  callback                Standard callback function
 */
const getMeetingInvitations = function(ctx, meetingId, callback) {
  try {
    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'A valid resource id must be specified'
      })
    )(meetingId);
  } catch (error) {
    return callback(error);
  }

  _getMeeting(meetingId, (err, meeting) => {
    if (err) {
      return callback(err);
    }

    return AuthzInvitations.getAllInvitations(ctx, meeting, callback);
  });
};

/**
 * Get the meeting members with their roles.
 *
 * @param  {Context}   ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}    meetingId               The ID of the meeting
 * @param  {Function}  callback                Standard callback function
 */
const getMeetingMembers = function(ctx, meetingId, start, limit, callback) {
  limit = OaeUtil.getNumberParam(limit, 10, 1);

  try {
    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'A valid resource id must be specified'
      })
    )(meetingId);
  } catch (error) {
    return callback(error);
  }

  // eslint-disable-next-line no-unused-vars
  getMeeting(ctx, meetingId, (err, meeting) => {
    if (err) {
      return callback(err);
    }

    // Get the meeting members
    AuthzAPI.getAuthzMembers(meetingId, start, limit, (err, memberRoles, nextToken) => {
      if (err) {
        return callback(err);
      }

      // Get the basic profiles for all of these principals
      const memberIds = _.pluck(memberRoles, 'id');
      PrincipalsUtil.getPrincipals(ctx, memberIds, (err, memberProfiles) => {
        if (err) {
          return callback(err);
        }

        // Merge the member profiles and roles into a single object
        const memberList = _.map(memberRoles, memberRole => {
          return {
            profile: memberProfiles[memberRole.id],
            role: memberRole.role
          };
        });

        return callback(null, memberList, nextToken);
      });
    });
  });
};

/**
 * Update a meeting's metadata
 *
 * @param  {Context}   ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}    meetingId           The ID of the meeting
 * @param  {Object}    profileFields       An object whose keys are profile field names, and the value is the value to which you wish the field to change. Keys must be one of: displayName, visibility, discription
 * @param  {Function}  callback            Standard callback function
 */
const updateMeeting = function(ctx, meetingId, profileFields, callback) {
  const allVisibilities = _.values(AuthzConstants.visibility);

  // Convert chat and contactList value to boolean for validation (if there are present)
  const getAttribute = getNestedObject(profileFields);
  const isDefined = attr => compose(Boolean, getAttribute, x => [x])(attr);

  const CHAT = 'chat';
  const CONTACT_LIST = 'contactList';
  if (isDefined(CHAT)) profileFields.chat = _convertToBoolean(getAttribute([CHAT]));
  if (isDefined(CONTACT_LIST)) profileFields.contactList = _convertToBoolean(getAttribute([CONTACT_LIST]));

  try {
    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'A valid resource id must be specified'
      })
    )(meetingId);

    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'You must be authenticated to update a meeting'
      })
    )(ctx);

    pipe(
      isArrayNotEmpty,
      otherwise({
        code: 400,
        msg: 'You should at least provide one profile field to update'
      })
    )(_.keys(profileFields));

    forEachObjIndexed((value, field) => {
      pipe(
        isIn,
        otherwise({
          code: 400,
          msg:
            "The field '" +
            field +
            "' is not a valid field. Must be one of: " +
            MeetingsConstants.updateFields.join(', ')
        })
      )(field, MeetingsConstants.updateFields);

      const VISIBILITY = 'visibility';
      const DISPLAY_NAME = 'displayName';
      const DESCRIPTION = 'description';
      const CHAT = 'chat';
      const CONTACT_LIST = 'contactList';
      const ifFieldIs = attr => equals(field, attr);

      pipe(
        makeSureThatOnlyIf(ifFieldIs(VISIBILITY), isIn),
        otherwise({
          code: 400,
          msg: 'An invalid visibility was specified. Must be one of: ' + allVisibilities.join(', ')
        })
      )(value, allVisibilities);

      pipe(
        makeSureThatOnlyIf(ifFieldIs(DISPLAY_NAME), isNotEmpty),
        otherwise({
          code: 400,
          msg: 'A display name cannot be empty'
        })
      )(value);

      pipe(
        makeSureThatOnlyIf(ifFieldIs(DISPLAY_NAME), isShortString),
        otherwise({
          code: 400,
          msg: 'A display name can be at most 1000 characters long'
        })
      )(value);

      pipe(
        makeSureThatOnlyIf(and(ifFieldIs(DESCRIPTION), greaterThan(length(value), 0)), isMediumString),
        otherwise({
          code: 400,
          msg: 'A description can be at most 10000 characters long'
        })
      )(value);

      pipe(
        makeSureThatOnlyIf(ifFieldIs(CHAT), isBoolean),
        otherwise({
          code: 400,
          msg: 'An invalid chat value was specified, must be boolean'
        })
      )(value);

      pipe(
        makeSureThatOnlyIf(ifFieldIs(CONTACT_LIST), isBoolean),
        otherwise({
          code: 400,
          msg: 'An invalid contactList value was specified, must be boolean'
        })
      )(value);
    }, profileFields);
  } catch (error) {
    return callback(error);
  }

  _getMeeting(meetingId, (err, meeting) => {
    if (err) {
      return callback(err);
    }

    AuthzPermissions.canManage(ctx, meeting, err => {
      if (err) {
        return callback(err);
      }

      MeetingsDAO.updateMeeting(meeting, profileFields, (err, updatedMeeting) => {
        if (err) {
          return callback(err);
        }

        // Fill in the full profile, the user is inevitably a manager
        updatedMeeting.isManager = true;
        updatedMeeting.canPost = true;
        updatedMeeting.canShare = true;

        MeetingsAPI.emitter.emit(MeetingsConstants.events.UPDATED_MEETING, ctx, updatedMeeting, meeting, errs => {
          if (errs) {
            return callback(_.first(errs));
          }

          return callback(null, updatedMeeting);
        });
      });
    });
  });
};

/**
 * Delete the specified meeting
 *
 * @param {Context}     ctx                 Standard context object containing the current user and the current tenant
 * @param {String}      meetingId           The id of the meeting to delete
 * @param {Function}    callback            Standard callback function
 * @param {Object}      callback.err        An error that occured, if any
 */
const deleteMeeting = function(ctx, meetingId, callback) {
  try {
    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'A valid resource id must be specified'
      })
    )(meetingId);

    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'You must be authenticated to delete a meeting'
      })
    )(ctx);
  } catch (error) {
    return callback(error);
  }

  _getMeeting(meetingId, (err, meeting) => {
    if (err) {
      return callback(err);
    }

    AuthzPermissions.canManage(ctx, meeting, err => {
      if (err) {
        return callback(err);
      }

      AuthzAPI.getAllAuthzMembers(meeting.id, (err, members) => {
        if (err) {
          return callback(err);
        }

        const roleChanges = {};
        const memberIds = _.pluck(members, 'id');
        _.each(memberIds, memberId => {
          roleChanges[memberId] = false;
        });

        // Remove the meeting members
        AuthzAPI.updateRoles(meeting.id, roleChanges, err => {
          if (err) {
            return callback(err);
          }

          // Delete the meeting itself
          MeetingsDAO.deleteMeeting(meeting.id, err => {
            if (err) {
              return callback(err);
            }

            MeetingsAPI.emitter.emit(MeetingsConstants.events.DELETED_MEETING, ctx, meeting, memberIds, errs => {
              if (errs) {
                return callback(_.first(errs));
              }

              return callback();
            });
          });
        });
      });
    });
  });
};

/**
 * Update the members of a meeting
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}     meetingId               The id of the meeting to share
 * @param  {Object}     changes                 An object that describes the permission changes to apply to the meeting. The key is the id of the principal to which to apply the change, and the value is the role to apply to the principal. If the value is `false`, the principal will be revoked access.
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 */
const setMeetingMembers = function(ctx, meetingId, changes, callback) {
  try {
    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'A valid resource id must be specified'
      })
    )(meetingId);

    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'You must be authenticated to update meeting members'
      })
    )(ctx);

    forEachObjIndexed((role /* , principalId */) => {
      pipe(
        isValidRoleChange,
        otherwise({
          code: 400,
          msg: 'The role change : ' + role + ' is not a valid value. Must either be a string, or false'
        })
      )(role);

      const thereIsRole = Boolean(role);
      pipe(
        makeSureThatOnlyIf(thereIsRole, isIn),
        otherwise({
          code: 400,
          msg:
            'The role "' +
            role +
            '" is not a valid value. Must be one of : ' +
            MeetingsConstants.roles.ALL_PRIORITY.join(', ') +
            ', or false'
        })
      )(role, MeetingsConstants.roles.ALL_PRIORITY);
    }, changes);
  } catch (error) {
    return callback(error);
  }

  _getMeeting(meetingId, (err, meeting) => {
    if (err) {
      return callback(err);
    }

    ResourceActions.setRoles(ctx, meeting, changes, (err, memberChangeInfo) => {
      if (err) {
        return callback(err);
      }

      MeetingsAPI.emitter.emit(
        MeetingsConstants.events.UPDATED_MEETING_MEMBERS,
        ctx,
        meeting,
        memberChangeInfo,
        {},
        errs => {
          if (errs) {
            return callback(_.first(errs));
          }

          return callback();
        }
      );
    });
  });
};

/**
 * Get the messages in a meeting
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         meetingId               The id of the meeting for which to get the messages
 * @param  {String}         [start]                 The `threadKey` of the message from which to start retrieving messages (exclusively). By default, will start fetching from the most recent message
 * @param  {Number}         [limit]                 The maximum number of results to return. Default: 10
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Message[]}      callback.messages       The messages in the meeting. Of the type `MessageBoxModel#Message`
 * @param  {String}         callback.nextToken      The value to provide in the `start` parameter to get the next set of results
 */
const getMessages = function(ctx, meetingId, start, limit, callback) {
  limit = OaeUtil.getNumberParam(limit, 10, 1);

  try {
    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'Must provide a valid meeting id'
      })
    )(meetingId);

    pipe(
      isANumber,
      otherwise({
        code: 400,
        msg: 'Must provide a valid limit'
      })
    )(limit);
  } catch (error) {
    return callback(error);
  }

  // eslint-disable-next-line no-unused-vars
  getMeeting(ctx, meetingId, (err, meeting) => {
    if (err) {
      return callback(err);
    }

    // Fetch the messages from the message box
    MessageBoxAPI.getMessagesFromMessageBox(meetingId, start, limit, null, (err, messages, nextToken) => {
      if (err) {
        return callback(err);
      }

      let userIds = _.map(messages, message => {
        return message.createdBy;
      });

      // Remove falsey and duplicate userIds
      userIds = _.uniq(_.compact(userIds));

      // Get the basic principal profiles of the messagers to add to the messages as `createdBy`.
      PrincipalsUtil.getPrincipals(ctx, userIds, (err, users) => {
        if (err) {
          return callback(err);
        }

        // Attach the user profiles to the message objects
        _.each(messages, message => {
          if (users[message.createdBy]) {
            message.createdBy = users[message.createdBy];
          }
        });

        return callback(err, messages, nextToken);
      });
    });
  });
};

/**
 * Create a new message in a meeting. If `replyToCreatedTimestamp` is specified, the message will be
 * a reply to the message in the meeting identified by that timestamp.
 *
 * @param  {Context}        ctx                         Standard context object containing the current user and the current tenant
 * @param  {String}         meetingId                   The id of the meeting to which to post the message
 * @param  {String}         body                        The body of the message
 * @param  {String|Number}  [replyToCreatedTimestamp]   The timestamp of the message to which this message is a reply. Not specifying this will create a top level comment
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Message}        callback.message            The created message
 */
const createMessage = function(ctx, meetingId, body, replyToCreatedTimestamp, callback) {
  try {
    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'Only authenticated users can post on meetings'
      })
    )(ctx);

    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'Invalid meeting id provided'
      })
    )(meetingId);

    pipe(
      isNotEmpty,
      otherwise({
        code: 400,
        msg: 'A message body must be provided'
      })
    )(body);

    pipe(
      isLongString,
      otherwise({
        code: 400,
        msg: 'A message body can only be 100000 characters long'
      })
    )(body);

    const timestampIsDefined = Boolean(replyToCreatedTimestamp);
    pipe(
      makeSureThatOnlyIf(timestampIsDefined, isInt),
      otherwise({
        code: 400,
        msg: 'Invalid reply-to timestamp provided'
      })
    )(replyToCreatedTimestamp);
  } catch (error) {
    return callback(error);
  }

  // Get the meeting, throwing an error if it doesn't exist, avoiding permission checks for now
  _getMeeting(meetingId, (err, meeting) => {
    if (err) {
      return callback(err);
    }

    // Determine if the current user can post meeting messages to this meeting
    AuthzPermissions.canInteract(ctx, meeting, err => {
      if (err) {
        return callback(err);
      }

      // Create the message
      MessageBoxAPI.createMessage(
        meetingId,
        ctx.user().id,
        body,
        { replyToCreated: replyToCreatedTimestamp },
        (err, message) => {
          if (err) {
            return callback(err);
          }

          // Get a UI-appropriate representation of the current user
          PrincipalsUtil.getPrincipal(ctx, ctx.user().id, (err, createdBy) => {
            if (err) {
              return callback(err);
            }

            message.createdBy = createdBy;

            // The message has been created in the database so we can emit the `created-message` event
            MeetingsAPI.emitter.emit(MeetingsConstants.events.CREATED_MEETING_MESSAGE, ctx, message, meeting, errs => {
              if (errs) {
                return callback(_.first(errs));
              }

              return callback(null, message);
            });
          });
        }
      );
    });
  });
};

/**
 * Delete a message in a meeting. Managers of the meeting can delete all messages while people that have access
 * to the meeting can only delete their own messages. Therefore, anonymous users will never be able to delete messages.
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}     meetingId               The id of the meeting from which to delete the message
 * @param  {Number}     messageCreatedDate      The timestamp of the message that should be deleted
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Comment}    [callback.softDeleted]  When the message has been soft deleted (because it has replies), a stripped down message object representing the deleted message will be returned, with the `deleted` parameter set to `false`. If the message has been deleted from the index, no message object will be returned
 */
const deleteMessage = function(ctx, meetingId, messageCreatedDate, callback) {
  try {
    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'Only authenticated users can delete messages'
      })
    )(ctx);

    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'A meeting id must be provided'
      })
    )(meetingId);

    pipe(
      isInt,
      otherwise({
        code: 400,
        msg: 'A valid integer message created timestamp must be specified'
      })
    )(messageCreatedDate);
  } catch (error) {
    return callback(error);
  }

  // Get the meeting without permissions check
  _getMeeting(meetingId, (err, meeting) => {
    if (err) {
      return callback(err);
    }

    // Ensure that the message exists. We also need it so we can make sure we have access to delete it
    MessageBoxAPI.getMessages(meetingId, [messageCreatedDate], { scrubDeleted: false }, (err, messages) => {
      if (err) {
        return callback(err);
      }

      if (!messages[0]) {
        return callback({ code: 404, msg: 'The specified message does not exist' });
      }

      const message = messages[0];

      // Determine if we have access to delete the meeting message
      AuthzPermissions.canManageMessage(ctx, meeting, message, err => {
        if (err) {
          return callback(err);
        }

        // Delete the message using the "leaf" method, which will SOFT delete if the message has replies, or HARD delete if it does not
        MessageBoxAPI.deleteMessage(
          meetingId,
          messageCreatedDate,
          { deleteType: MessageBoxConstants.deleteTypes.LEAF },
          (err, deleteType, deletedMessage) => {
            if (err) {
              return callback(err);
            }

            MeetingsAPI.emitter.emit(
              MeetingsConstants.events.DELETED_MEETING_MESSAGE,
              ctx,
              message,
              meeting,
              deleteType
            );

            // If a soft-delete occurred, we want to inform the consumer of the soft-delete message model
            if (deleteType === MessageBoxConstants.deleteTypes.SOFT) {
              return callback(null, deletedMessage);
            }

            return callback();
          }
        );
      });
    });
  });
};

/**
 * Get the meetings library items for a user or group. Depending on the access of the principal in context,
 * either a library of public, loggedin, or all items will be returned.
 *
 * @param  {Context}        ctx                     Standard context object containing the current user and the current tenant
 * @param  {String}         principalId             The id of the principal whose meeting library to fetch
 * @param  {String}         [start]                 The meeting ordering token from which to start fetching meetings (see `nextToken` in callback params)
 * @param  {Number}         [limit]                 The maximum number of results to return. Default: 10
 * @param  {Function}       callback                Standard callback function
 * @param  {Object}         callback.err            An error that occurred, if any
 * @param  {Meeting[]}      callback.meetings       The array of meetings fetched
 * @param  {String}         [callback.nextToken]    The token that can be used as the `start` parameter to fetch the next set of tokens (exclusively). If not specified, indicates that the query fetched all remaining results.
 */
const getMeetingsLibrary = function(ctx, principalId, start, limit, callback) {
  limit = OaeUtil.getNumberParam(limit, 10, 1);

  try {
    pipe(
      isPrincipalId,
      otherwise({
        code: 400,
        msg: 'A user or group id must be provided'
      })
    )(principalId);
  } catch (error) {
    return callback(error);
  }

  // Get the principal
  PrincipalsUtil.getPrincipal(ctx, principalId, (err, principal) => {
    if (err) {
      return callback(err);
    }

    // Determine which library visibility the current user should receive
    LibraryAPI.Authz.resolveTargetLibraryAccess(ctx, principal.id, principal, (err, hasAccess, visibility) => {
      if (err) {
        return callback(err);
      }

      if (!hasAccess) {
        return callback({ code: 401, msg: 'You do not have have access to this library' });
      }

      // Get the meeting ids from the library index
      LibraryAPI.Index.list(
        MeetingsConstants.library.MEETINGS_LIBRARY_INDEX_NAME,
        principalId,
        visibility,
        { start, limit },
        (err, entries, nextToken) => {
          if (err) {
            return callback(err);
          }

          // Get the meeting objects from the meeting ids
          const meetingIds = _.pluck(entries, 'resourceId');
          MeetingsDAO.getMeetingsById(meetingIds, (err, meetings) => {
            if (err) {
              return callback(err);
            }

            // Emit an event indicating that the meeting library has been retrieved
            MeetingsAPI.emitter.emit(
              MeetingsConstants.events.GET_MEETING_LIBRARY,
              ctx,
              principalId,
              visibility,
              start,
              limit,
              meetings
            );

            return callback(null, meetings, nextToken);
          });
        }
      );
    });
  });
};

/**
 * Remove a meeting from a meeting library. This is its own API method due to special permission handling required, as the user
 * is effectively updating a meetings permissions (removing themselves, or removing it from a group they manage), and they might not
 * necessarily have access to update the permissions of the private meeting (e.g., they are only a member). Also, tenant privacy
 * rules do not come into play in this case.
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     libraryOwnerId  The owner of the library, should be a principal id (either user or group id)
 * @param  {String}     meetingId       The id of the meeting to remove from the library
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const removeMeetingFromLibrary = function(ctx, libraryOwnerId, meetingId, callback) {
  try {
    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'You must be authenticated to remove a meeting from a library'
      })
    )(ctx);

    pipe(
      isPrincipalId,
      otherwise({
        code: 400,
        msg: 'An user or group id must be provided'
      })
    )(libraryOwnerId);

    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'An invalid meeting id "' + meetingId + '" was provided'
      })
    )(meetingId);
  } catch (error) {
    return callback(error);
  }

  // Make sure the meeting exists
  _getMeeting(meetingId, (err, meeting) => {
    if (err) {
      return callback(err);
    }

    // Ensure the library owner exists
    PrincipalsDAO.getPrincipal(libraryOwnerId, (err, principal) => {
      if (err) {
        return callback(err);
      }

      // Ensure the user can remove the content item from the library owner's resource
      AuthzPermissions.canRemoveRole(ctx, principal, meeting, (err, memberChangeInfo) => {
        if (err) {
          return callback(err);
        }

        // All validation checks have passed, finally persist the role change and update the user library
        AuthzAPI.updateRoles(meetingId, memberChangeInfo.changes, err => {
          if (err) {
            return callback(err);
          }

          MeetingsAPI.emitter.emit(
            MeetingsConstants.events.UPDATED_MEETING_MEMBERS,
            ctx,
            meeting,
            memberChangeInfo,
            {},
            errs => {
              if (errs) {
                return callback(_.first(errs));
              }

              return callback();
            }
          );
        });
      });
    });
  });
};

/**
 * PRIVATE FUNCTIONS
 */

/**
 * Get the meeting with the specified id.
 *
 * @param {any} meetingId
 * @param {any} callback
 */
const _getMeeting = function(meetingId, callback) {
  MeetingsDAO.getMeeting(meetingId, (err, meeting) => {
    if (err) {
      return callback(err);
    }

    if (!meeting) {
      return callback({ code: 404, msg: 'Could not find meeting : ' + meetingId });
    }

    return callback(null, meeting);
  });
};

const _convertToBoolean = attr => {
  if (equals(attr, TRUE)) return true;
  if (equals(attr, FALSE)) return false;
};

export {
  createMeeting,
  getFullMeetingProfile,
  getMeetingInvitations,
  getMeetingMembers,
  updateMeeting,
  deleteMeeting,
  setMeetingMembers,
  getMessages,
  createMessage,
  deleteMessage,
  getMeetingsLibrary,
  removeMeetingFromLibrary,
  getMeeting
};
