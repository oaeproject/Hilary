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

import _ from 'underscore';

import * as AuthzAPI from 'oae-authz';
import { AuthzConstants } from 'oae-authz/lib/constants';
import * as AuthzUtil from 'oae-authz/lib/util';
import * as SearchAPI from 'oae-search';
import * as SearchUtil from 'oae-search/lib/util';
import * as resourceMembersSchema from './search/schema/resourceMembersSchema.js';
import * as resourceMembershipsSchema from './search/schema/resourceMembershipsSchema.js';

/**
 * Initializes the child search documents for the Authz module
 *
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const init = function (callback) {
  const membersChildSearchDocumentOptions = {
    resourceTypes: ['content', 'discussion', 'group'],
    schema: resourceMembersSchema,
    producer(resources, callback) {
      return _produceResourceMembersDocuments(resources.slice(), callback);
    }
  };

  const membershipsChildSearchDocumentOptions = {
    resourceTypes: ['group', 'user'],
    schema: resourceMembershipsSchema,
    producer(resources, callback) {
      return _produceResourceMembershipsDocuments(resources.slice(), callback);
    }
  };

  // Create the members and memberships child search document mappings in elasticsearch
  SearchAPI.registerChildSearchDocument(
    AuthzConstants.search.MAPPING_RESOURCE_MEMBERS,
    membersChildSearchDocumentOptions,
    (error) => {
      if (error) {
        return callback(error);
      }

      return SearchAPI.registerChildSearchDocument(
        AuthzConstants.search.MAPPING_RESOURCE_MEMBERSHIPS,
        membershipsChildSearchDocumentOptions,
        callback
      );
    }
  );
};

/**
 * Given a list of ids of principals whose membership has changed, fire the index tasks required to
 * update the appropriate membership documents
 *
 * @param  {String[]}   memberIds   The list of principals whose membership in a group changed
 */
const fireMembershipUpdateTasks = function (memberIds) {
  if (_.isEmpty(memberIds)) {
    return;
  }

  const groupResources = [];
  const userResources = [];

  _.each(memberIds, (memberId) => {
    if (AuthzUtil.isGroupId(memberId)) {
      groupResources.push({ id: memberId });
    } else if (AuthzUtil.isUserId(memberId)) {
      userResources.push({ id: memberId });
    }
  });

  // Send the update tasks for the aggregated group and user membership updates
  if (!_.isEmpty(groupResources)) {
    // eslint-disable-next-line camelcase
    SearchAPI.postIndexTask('group', groupResources, { children: { resource_memberships: true } });
  }

  if (!_.isEmpty(userResources)) {
    // eslint-disable-next-line camelcase
    SearchAPI.postIndexTask('user', userResources, { children: { resource_memberships: true } });
  }
};

/**
 * Produce all the resource members documents that represent the given resources
 *
 * @param  {Object[]}   resources       An array of search resource documents
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _produceResourceMembersDocuments = function (resources, callback, _documents) {
  _documents = _documents || [];
  if (_.isEmpty(resources)) {
    return callback(null, _documents);
  }

  // Take the next resource
  const resource = resources.pop();
  _getMemberIds(resource, (error, memberIds) => {
    if (error) {
      return callback(error);
    }

    _documents.push(
      SearchUtil.createChildSearchDocument(
        AuthzConstants.search.MAPPING_RESOURCE_MEMBERS,
        resource.id,
        // eslint-disable-next-line camelcase
        { direct_members: memberIds }
      )
    );
    return _produceResourceMembersDocuments(resources, callback, _documents);
  });
};

/**
 * Produce all the resource memberships documents that represent the given resources
 *
 * @param  {Object[]}   resources       An array of search resource documents
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _produceResourceMembershipsDocuments = function (resources, callback, _documents) {
  _documents = _documents || [];
  if (_.isEmpty(resources)) {
    return callback(null, _documents);
  }

  // Take the next resource
  const resource = resources.pop();
  _getMembershipIds(resource, (error, membershipIds) => {
    if (error) {
      return callback(error);
    }

    _documents.push(
      SearchUtil.createChildSearchDocument(
        AuthzConstants.search.MAPPING_RESOURCE_MEMBERSHIPS,
        resource.id,
        // eslint-disable-next-line camelcase
        { direct_memberships: membershipIds }
      )
    );
    return _produceResourceMembershipsDocuments(resources, callback, _documents);
  });
};

/**
 * Get the members of the provided resource.
 *
 * @param  {Object}     resource            The resource whose members to get
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {String[]}   callback.memberIds  The ids of the members of the provided resource
 * @api private
 */
const _getMemberIds = function (resource, callback) {
  if (resource.memberIds) {
    return callback(null, resource.memberIds);
  }

  AuthzAPI.getAuthzMembers(resource.id, null, 10000, (error, memberIdRoles) => {
    if (error) {
      return callback(error);
    }

    return callback(null, _.pluck(memberIdRoles, 'id'));
  });
};

/**
 * Get the memberships of the current resource.
 *
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {String[]}   callback.membershipIds  The ids of the group memberships of the provided resource
 * @api private
 */
const _getMembershipIds = function (resource, callback) {
  if (resource.membershipIds) {
    return callback(null, resource.membershipIds);
  }

  AuthzAPI.getRolesForPrincipalsAndResourceType(
    [resource.id],
    AuthzConstants.resourceTypes.GROUP,
    (error, principalGroupRole) => {
      if (error) {
        return callback(error);
      }

      // Just extract a set of the groupIds in which the resource is a member
      const memberships = {};
      // eslint-disable-next-line no-unused-vars
      _.each(principalGroupRole, (groupRole, principalId) => {
        _.each(groupRole, (role, groupId) => {
          memberships[groupId] = true;
        });
      });

      return callback(null, _.keys(memberships));
    }
  );
};

export { init, fireMembershipUpdateTasks };
