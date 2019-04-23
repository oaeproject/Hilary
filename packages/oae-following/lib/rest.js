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

import * as OAE from 'oae-util/lib/oae';
import * as OaeUtil from 'oae-util/lib/util';
import * as FollowingAPI from 'oae-following';

/**
 * @REST getFollowingUserIdFollowers
 *
 * Get the users who are following a user
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /following/{userId}/followers
 * @PathParam   {string}                userId              The id of the user whose followers to get
 * @QueryParam  {number}                [limit]             The maximum number of results to return. Default: 10
 * @QueryParam  {string}                [start]             The following paging token from which to start fetching followers
 * @Return      {FollowResults}                             The followers of the specified user
 * @HttpResponse                        200                 Followers available
 * @HttpResponse                        400                 You must specify a valid user id
 * @HttpResponse                        401                 You are not authorized to see this user's list of followers
 */
OAE.tenantRouter.on('get', '/api/following/:userId/followers', (req, res) => {
  const limit = OaeUtil.getNumberParam(req.query.limit, 10, 1, 25);
  FollowingAPI.getFollowers(req.ctx, req.params.userId, req.query.start, limit, (err, followers, nextToken) => {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    return res.status(200).send({ results: followers, nextToken });
  });
});

/**
 * @REST getFollowingUserIdFollowing
 *
 * Get the users who are followed by a specific user
 *
 * @Server      tenant
 * @Method      GET
 * @Path        /following/{userId}/following
 * @PathParam   {string}                userId              The id of the user for who to get the followed users
 * @QueryParam  {number}                [limit]             The maximum number of results to return. Default: 10
 * @QueryParam  {string}                [start]             The following paging token from which to start fetching followed users
 * @Return      {FollowResults}                             The users followed by the specified user
 * @HttpResponse                        200                 Users available
 * @HttpResponse                        400                 You must specify a valid user id
 * @HttpResponse                        401                 You are not authorized to view this user's list of followed users
 */
OAE.tenantRouter.on('get', '/api/following/:userId/following', (req, res) => {
  const limit = OaeUtil.getNumberParam(req.query.limit, 10, 1, 25);
  FollowingAPI.getFollowing(req.ctx, req.params.userId, req.query.start, limit, (err, following, nextToken) => {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    return res.status(200).send({ results: following, nextToken });
  });
});

/**
 * @REST postFollowingUserIdFollow
 *
 * Follow a user
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /following/{userId}/follow
 * @PathParam   {string}                userId              The id of the user to follow
 * @Return      {void}
 * @HttpResponse                        200                 Now following user
 * @HttpResponse                        400                 You must specify a valid user id of a user to follow
 * @HttpResponse                        401                 You are not authorized to follow this user
 * @HttpResponse                        401                 You must be authenticated to follow a user
 */
OAE.tenantRouter.on('post', '/api/following/:userId/follow', (req, res) => {
  // eslint-disable-next-line no-unused-vars
  FollowingAPI.follow(req.ctx, req.params.userId, (err, followers) => {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    return res.status(200).end();
  });
});

/**
 * @REST postFollowingUserIdUnfollow
 *
 * Unfollow a user
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /following/{userId}/unfollow
 * @PathParam   {string}                userId              The id of the user to unfollow
 * @Return      {void}
 * @HttpResponse                        200                 No longer following user
 * @HttpResponse                        400                 You must specify a valid user id of a user to unfollow
 * @HttpResponse                        401                 You must be authenticated to unfollow a user
 */
OAE.tenantRouter.on('post', '/api/following/:userId/unfollow', (req, res) => {
  FollowingAPI.unfollow(req.ctx, req.params.userId, err => {
    if (err) {
      return res.status(err.code).send(err.msg);
    }

    return res.status(200).end();
  });
});
