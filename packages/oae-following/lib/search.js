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

const _ = require('underscore');
const SearchAPI = require('oae-search');
const SearchUtil = require('oae-search/lib/util');

const FollowingAPI = require('oae-following');
const { FollowingConstants } = require('oae-following/lib/constants');
const FollowingDAO = require('oae-following/lib/internal/dao');

/**
 * Initializes the child search documents for the Following module
 *
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const init = function(callback) {
  const followersChildSearchDocumentOptions = {
    resourceTypes: ['user'],
    schema: require('./search/schema/resourceFollowersSchema'),
    producer(resources, callback) {
      return _produceResourceFollowersDocuments(resources.slice(), callback);
    }
  };

  const followingChildSearchDocumentOptions = {
    resourceTypes: ['user'],
    schema: require('./search/schema/resourceFollowingSchema'),
    producer(resources, callback) {
      return _produceResourceFollowingDocuments(resources.slice(), callback);
    }
  };

  // Create the followers and following child search document mappings in elasticsearch
  SearchAPI.registerChildSearchDocument(
    FollowingConstants.search.MAPPING_RESOURCE_FOLLOWERS,
    followersChildSearchDocumentOptions,
    err => {
      if (err) {
        return callback(err);
      }

      return SearchAPI.registerChildSearchDocument(
        FollowingConstants.search.MAPPING_RESOURCE_FOLLOWING,
        followingChildSearchDocumentOptions,
        callback
      );
    }
  );
};

/**
 * Produce all the resource followers documents that represent the given resources
 *
 * @see SearchAPI.registerChildSearchDocument
 * @api private
 */
const _produceResourceFollowersDocuments = function(resources, callback, _documents, _errs) {
  _documents = _documents || [];
  if (_.isEmpty(resources)) {
    return callback(_errs, _documents);
  }

  // Get all of the followers ids for the next resource in the list
  const resource = resources.pop();
  _getAllIds(FollowingDAO.getFollowers, resource.id, null, 100, (err, followerUserIds) => {
    if (err) {
      _errs = _.union(_errs, [err]);
      return _produceResourceFollowersDocuments(resources, callback, _documents, _errs);
    }

    _documents.push(
      SearchUtil.createChildSearchDocument(
        FollowingConstants.search.MAPPING_RESOURCE_FOLLOWERS,
        resource.id,
        { followers: followerUserIds }
      )
    );
    return _produceResourceFollowersDocuments(resources, callback, _documents, _errs);
  });
};

/**
 * Produce all the resource following documents that represent the given resources
 *
 * @see SearchAPI.registerChildSearchDocument
 * @api private
 */
const _produceResourceFollowingDocuments = function(resources, callback, _documents, _errs) {
  _documents = _documents || [];
  if (_.isEmpty(resources)) {
    return callback(_errs, _documents);
  }

  // Get all of the followers ids for the next resource in the list
  const resource = resources.pop();
  _getAllIds(FollowingDAO.getFollowing, resource.id, null, 100, (err, followingUserIds) => {
    if (err) {
      _errs = _.union(_errs, [err]);
      return _produceResourceFollowingDocuments(resources, callback, _documents);
    }

    _documents.push(
      SearchUtil.createChildSearchDocument(
        FollowingConstants.search.MAPPING_RESOURCE_FOLLOWING,
        resource.id,
        { following: followingUserIds }
      )
    );
    return _produceResourceFollowingDocuments(resources, callback, _documents, _errs);
  });
};

/**
 * Iterate and fetch all ids from the given paging method, which is expected to be either the
 * `FollowingDAO.getFollowers` or the `FollowingDAO.getFollwing` methods.
 *
 * @param  {Function}   method          Either the `FollowingDAO.getFollowers` or the `FollowingDAO.getFollwing` methods
 * @param  {String}     id              The id for the provided method
 * @param  {String}     start           The starting point to start returning ids from the provided method
 * @param  {Number}     limit           The maximum number of items to fetch from the provided method
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {String[]}   callback.ids    All ids that were fetched while paging the provided method
 * @api private
 */
const _getAllIds = function(method, id, start, limit, callback, _ids) {
  _ids = _ids || [];
  method(id, start, limit, (err, ids, nextToken) => {
    if (err) {
      return callback(err);
    }

    // Gather all fetched ids into the internal _ids param
    _ids = _.union(_ids, ids);

    if (!nextToken) {
      // There are no more ids to fetch, recursively get the next set
      return callback(null, _ids);
    }
    // There are still more, recursively get the next set
    return _getAllIds(method, id, nextToken, limit, callback, _ids);
  });
};

/// ///////////////////
// SEARCH ENDPOINTS //
/// ///////////////////

SearchAPI.registerSearch('followers', require('./search/searches/followers'));
SearchAPI.registerSearch('following', require('./search/searches/following'));

/// /////////////////
// INDEXING TASKS //
/// /////////////////

/*!
 * Update the following search index and the followers search index based on the change in the following user and the followed user
 */
FollowingAPI.emitter.on(FollowingConstants.events.FOLLOW, (ctx, followingUser, followedUser) => {
  return _handleIndexChange(ctx, followingUser.id, followedUser.id);
});

/*!
 * Update the following search index and the followers search index based on the change in the following user and the unfollowed user
 */
FollowingAPI.emitter.on(
  FollowingConstants.events.UNFOLLOW,
  (ctx, followingUser, unfollowedUserId) => {
    return _handleIndexChange(ctx, followingUser.id, unfollowedUserId);
  }
);

/*!
 * Handle the change in follower/following index. The `followingUserId` will have their following index updated
 * while the `followedUserId` will have their followers index updated
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     followingUserId     The id of the user whose following index to update
 * @param  {String}     followedUserId      The id of the user whose followers index to update
 */
const _handleIndexChange = function(ctx, followingUserId, followedUserId) {
  SearchAPI.postIndexTask('user', [{ id: followingUserId }], {
    children: {
      // eslint-disable-next-line camelcase
      resource_following: true
    }
  });

  SearchAPI.postIndexTask('user', [{ id: followedUserId }], {
    children: {
      // eslint-disable-next-line camelcase
      resource_followers: true
    }
  });
};

module.exports = {
  init
};
