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

import DiscussionsAPI from 'oae-discussions';

import _ from 'underscore';
import * as AuthzAPI from 'oae-authz';
import * as LibraryAPI from 'oae-library';
import * as OaeUtil from 'oae-util/lib/util.js';
import { logger } from 'oae-logger';

import { DiscussionsConstants } from 'oae-discussions/lib/constants.js';
import * as DiscussionsDAO from 'oae-discussions/lib/internal/dao.js';

const log = logger('oae-discussions');

// When updating discussions as a result of new messages, update it at most every hour
const LIBRARY_UPDATE_THRESHOLD_SECONDS = 3600;

/*!
 * Register a library indexer that can provide resources to reindex the discussions library
 */
LibraryAPI.Index.registerLibraryIndex(DiscussionsConstants.library.DISCUSSIONS_LIBRARY_INDEX_NAME, {
  pageResources(libraryId, start, limit, callback) {
    // Query all the discussion ids ('d') to which the library owner is directly associated in this batch of paged resources
    AuthzAPI.getRolesForPrincipalAndResourceType(libraryId, 'd', start, limit, (err, roles, nextToken) => {
      if (err) {
        return callback(err);
      }

      // We just need the ids, not the roles
      const ids = _.pluck(roles, 'id');

      DiscussionsDAO.getDiscussionsById(
        ids,
        ['id', 'tenantAlias', 'visibility', 'lastModified'],
        (err, discussions) => {
          if (err) {
            return callback(err);
          }

          // Convert all the discussions into the light-weight library items that describe how its placed in a library index
          const resources = _.chain(discussions)
            .compact()
            .map((discussion) => {
              return { rank: discussion.lastModified, resource: discussion };
            })
            .value();

          return callback(null, resources, nextToken);
        }
      );
    });
  }
});

/*!
 * Configure the discussion library search endpoint
 */
LibraryAPI.Search.registerLibrarySearch('discussion-library', ['discussion']);

/*!
 * When a discussion is created, add the discussion to the member discussion libraries
 */
DiscussionsAPI.when(DiscussionsConstants.events.CREATED_DISCUSSION, (ctx, discussion, memberChangeInfo, callback) => {
  const addedMemberIds = _.pluck(memberChangeInfo.members.added, 'id');
  _insertLibrary(addedMemberIds, discussion, (err) => {
    if (err) {
      log().warn(
        {
          err,
          discussionId: discussion.id,
          memberIds: addedMemberIds
        },
        'An error occurred inserting discussion into discussion libraries after create'
      );
    }

    return callback();
  });
});

/*!
 * When a discussion is updated, update all discussion libraries with its updated last modified
 * date
 */
DiscussionsAPI.on(DiscussionsConstants.events.UPDATED_DISCUSSION, (ctx, updatedDiscussion, oldDiscussion) => {
  // Get all the member ids, we will update their discussion libraries
  _getAllMemberIds(updatedDiscussion.id, (err, memberIds) => {
    if (err) {
      log().warn(
        {
          err,
          discussionId: updatedDiscussion.id,
          memberIds
        },
        'An error occurred while updating a discussion in all discussion libraries'
      );
    }

    // Perform all the library updates
    return _updateLibrary(memberIds, updatedDiscussion, oldDiscussion.lastModified);
  });
});

/**
 * When a discussion is deleted, remove it from all discussion libraries
 */
DiscussionsAPI.when(DiscussionsConstants.events.DELETED_DISCUSSION, (ctx, discussion, removedMemberIds, callback) => {
  // Remove the discussion from all libraries
  _removeLibrary(removedMemberIds, discussion, (err) => {
    if (err) {
      log().warn(
        {
          err,
          discussionId: discussion.id
        },
        'An error occurred while removing a deleted discussion from all discussion libraries'
      );
    }

    return callback();
  });
});

/**
 * When a discussions members are updated, pass the required updates to its members library as well
 * as all the discussions libraries that contain the discussion
 */
DiscussionsAPI.when(
  DiscussionsConstants.events.UPDATED_DISCUSSION_MEMBERS,
  (ctx, discussion, memberChangeInfo, opts, callback) => {
    const addedMemberIds = _.pluck(memberChangeInfo.members.added, 'id');
    const updatedMemberIds = _.pluck(memberChangeInfo.members.updated, 'id');
    const removedMemberIds = _.pluck(memberChangeInfo.members.removed, 'id');

    const oldLastModified = discussion.lastModified;

    // Asynchronously remove from the library of removed members before we touch the discussion to update the lastModified
    _removeLibrary(removedMemberIds, discussion, (err) => {
      if (err) {
        log().warn(
          {
            err,
            principalIds: removedMemberIds,
            discussionId: discussion.id
          },
          'Error removing discussion from principal libraries. Ignoring.'
        );
      } else if (_.isEmpty(updatedMemberIds) && _.isEmpty(addedMemberIds)) {
        // If all we did was remove members, don't update the discussion timestamp and user
        // discussion libraries
        return callback();
      }

      // Only touch the discussion and update its profile if it is within the update duration threshold
      const touchDiscussion = _testDiscussionUpdateThreshold(discussion);
      OaeUtil.invokeIfNecessary(touchDiscussion, _touch, discussion, (err, touchedDiscussion) => {
        if (err) {
          log().warn(
            {
              err,
              discussionId: discussion.id
            },
            'Error touching the discussion while adding members. Ignoring.'
          );
        }

        discussion = touchedDiscussion || discussion;

        // Always insert the discussion into the added user libraries
        _insertLibrary(addedMemberIds, discussion, (err) => {
          if (err) {
            log().warn(
              {
                err,
                principalIds: addedMemberIds,
                discussionIds: discussion.id
              },
              'Error inserting the discussion into new member libraries while adding members. Ignoring.'
            );
          }

          // For all existing members of the discussion, we update the discussion in their
          // library but only if the discussion last modified time was actually updated. Here
          // we use the `touchedDiscussion` object because even if `touchDiscussion` was true,
          // we could have failed to touch the discussion, in which case we would not want to
          // update the discussion in libraries
          const libraryUpdateIds = _.chain(memberChangeInfo.roles.before).keys().difference(removedMemberIds).value();
          OaeUtil.invokeIfNecessary(
            touchedDiscussion,
            _updateLibrary,
            libraryUpdateIds,
            discussion,
            oldLastModified,
            (err) => {
              if (err) {
                log().warn(
                  {
                    err,
                    principalIds: libraryUpdateIds,
                    discussionId: discussion.id
                  },
                  'Error updating the library index for these users. Ignoring the error, but some repair may be necessary for these users.'
                );
              }

              return callback();
            }
          );
        });
      });
    });
  }
);

/*!
 * When a new message is created for the discussion, update its last modified date and update its
 * rank in all discussion libraries
 */
DiscussionsAPI.on(DiscussionsConstants.events.CREATED_DISCUSSION_MESSAGE, (ctx, message, discussion) => {
  // Check to see if we are in a threshold to perform a discussion lastModified update. If not, we
  // don't promote the discussion the library ranks
  if (!_testDiscussionUpdateThreshold(discussion)) {
    return;
  }

  // Try and get the principals whose libraries will be updated
  _getAllMemberIds(discussion.id, (err, memberIds) => {
    if (err) {
      // If we can't get the members, don't so that we don't risk
      return log().warn(
        {
          err,
          discussionId: discussion.id,
          memberIds
        },
        'Error fetching discussion members list to update library. Skipping updating libraries'
      );
    }

    // Update the lastModified of the discussion
    _touch(discussion, (err, updatedDiscussion) => {
      if (err) {
        // If we get an error touching the discussion, we simply won't update the libraries. Better luck next time.
        return log().warn(
          {
            err,
            discussionId: discussion.id,
            memberIds
          },
          'Error touching discussion to update lastModified time. Skipping updating libraries'
        );
      }

      return _updateLibrary(memberIds, updatedDiscussion, discussion.lastModified);
    });
  });
});

/**
 * Perform a "touch" on a discussion, which updates only the lastModified date of the discussion
 *
 * @param  {Discussion} discussion              The discussion object to update
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Discussion} [callback.discussion]   The discussion object with the new lastModified date. If not specified, then the discussion was not updated due to rate-limiting.
 * @api private
 */
const _touch = function (discussion, callback) {
  DiscussionsDAO.updateDiscussion(discussion, { lastModified: Date.now() }, callback);
};

/**
 * Determine if the discussion is beyond the threshold such that a `_touch` operation will be effective.
 *
 * @param  {Discussion}    discussion  The discussion to test
 * @return {Boolean}                   `true` if the discussion was last updated beyond the threshold and `_touch` will be effective. `false` otherwise.
 * @api private
 */
const _testDiscussionUpdateThreshold = function (discussion) {
  return !discussion.lastModified || Date.now() - discussion.lastModified > LIBRARY_UPDATE_THRESHOLD_SECONDS * 1000;
};

/**
 * Get all the ids of the principals that are members for the specified discussion.
 *
 * @param  {String}     discussionId        The id of the discussion whose member ids to fetch
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {String[]}   callback.memberIds  The member ids associated to the discussion
 * @api private
 */
const _getAllMemberIds = function (discussionId, callback) {
  AuthzAPI.getAllAuthzMembers(discussionId, (err, memberIdRoles) => {
    if (err) {
      return callback(err);
    }

    // Flatten the members hash into just an array of ids
    return callback(null, _.pluck(memberIdRoles, 'id'));
  });
};

/**
 * Insert a discussion into the discussion libraries of the specified principals
 *
 * @param  {String[]}   principalIds    The ids of the principals whose libraries to update
 * @param  {Discussion} discussion      The discussion to insert
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _insertLibrary = function (principalIds, discussion, callback) {
  callback =
    callback ||
    function (err) {
      if (err) {
        log().error(
          {
            err,
            principalIds,
            discussionId: discussion.id
          },
          'Error inserting discussion into principal libraries'
        );
      }
    };

  if (_.isEmpty(principalIds) || !discussion) {
    return callback();
  }

  const entries = _.map(principalIds, (principalId) => {
    return {
      id: principalId,
      rank: discussion.lastModified,
      resource: discussion
    };
  });

  LibraryAPI.Index.insert(DiscussionsConstants.library.DISCUSSIONS_LIBRARY_INDEX_NAME, entries, callback);
};

/**
 * Update a discussion in the discussion libraries of the specified principals
 *
 * @param  {String[]}   principalIds    The ids of the principals whose libraries to update
 * @param  {Discussion} discussion      The discussion to insert
 * @param  {String}     oldLastModified The discussion record associated to this last-modified timestamp will be removed in favour of the updated one
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _updateLibrary = function (principalIds, discussion, oldLastModified, callback) {
  callback =
    callback ||
    function (err) {
      if (err) {
        log().error(
          {
            err,
            principalIds,
            discussionId: discussion.id
          },
          'Error updating discussion for principal libraries'
        );
      }
    };

  // These are cases where an update would have no impact. Do not perform the library update
  if (_.isEmpty(principalIds) || !discussion) {
    return callback();
  }

  const entries = _.map(principalIds, (principalId) => {
    return {
      id: principalId,
      oldRank: oldLastModified,
      newRank: discussion.lastModified,
      resource: discussion
    };
  });

  LibraryAPI.Index.update(DiscussionsConstants.library.DISCUSSIONS_LIBRARY_INDEX_NAME, entries, callback);
};

/**
 * Delete a discussion in the discussion libraries of the specified principals
 *
 * @param  {String[]}   principalIds    The ids of the principals whose libraries to update
 * @param  {Discussion} discussion      The discussion to remove
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _removeLibrary = function (principalIds, discussion, callback) {
  callback =
    callback ||
    function (err) {
      if (err) {
        log().error(
          {
            err,
            principalIds,
            discussionId: discussion.id
          },
          'Error removing discussion from principal libraries'
        );
      }
    };

  if (_.isEmpty(principalIds) || !discussion) {
    return callback();
  }

  const entries = _.map(principalIds, (principalId) => {
    return {
      id: principalId,
      rank: discussion.lastModified,
      resource: discussion
    };
  });

  LibraryAPI.Index.remove(DiscussionsConstants.library.DISCUSSIONS_LIBRARY_INDEX_NAME, entries, callback);
};
