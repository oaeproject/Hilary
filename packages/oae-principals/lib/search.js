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

/* eslint-disable camelcase */
import _ from 'underscore';
import {
  pluck,
  filter,
  without,
  partition,
  compose,
  prop,
  has,
  not,
  objOf,
  identity,
  pipe,
  pick,
  map,
  assoc,
  head,
  defaultTo,
  mapObjIndexed,
  mergeDeepLeft,
  mergeLeft
} from 'ramda';
import { logger } from 'oae-logger';

import * as AuthzSearch from 'oae-authz/lib/search.js';
import * as AuthzUtil from 'oae-authz/lib/util.js';
import * as ContentUtil from 'oae-content/lib/internal/util.js';
import * as OaeUtil from 'oae-util/lib/util.js';
import * as SearchAPI from 'oae-search';
import * as TenantsAPI from 'oae-tenants';

import { emitter } from 'oae-principals';
import * as PrincipalsDAO from 'oae-principals/lib/internal/dao.js';
import * as PrincipalsDelete from 'oae-principals/lib/delete.js';
import * as PrincipalsUtil from 'oae-principals/lib/util.js';

import { PrincipalsConstants } from 'oae-principals/lib/constants.js';
import { User } from 'oae-principals/lib/model.js';

const { getTenant } = TenantsAPI;
const getTenantAlias = prop('tenantAlias');
const log = logger('principals-search');
const { getResourceFromId } = AuthzUtil;
const getResourceId = prop('resourceId');

const init = (callback) => {
  /**
   * Indexing tasks
   */

  /*!
   * When a user is created, we must index the user resource document
   */
  emitter.on(PrincipalsConstants.events.CREATED_USER, (ctx, user) => {
    SearchAPI.postIndexTask('user', [{ id: user.id }], {
      resource: true
    });
  });

  /*!
   * When a user is updated, we must reindex the user resource document
   */
  emitter.on(PrincipalsConstants.events.UPDATED_USER, (ctx, user) => {
    SearchAPI.postIndexTask('user', [{ id: user.id }], {
      resource: true
    });
  });

  /*!
   * When a user is deleted, we must reindex the user resource document
   */
  emitter.on(PrincipalsConstants.events.DELETED_USER, (ctx, user) => {
    SearchAPI.postIndexTask('user', [{ id: user.id }], {
      resource: true
    });
  });

  /*!
   * When a user is restored, we must reindex the user resource document
   */
  emitter.on(PrincipalsConstants.events.RESTORED_USER, (ctx, user) => {
    SearchAPI.postIndexTask('user', [{ id: user.id }], {
      resource: true
    });
  });

  /*!
   * When a user's email is verified, we must reindex the user resource document
   */
  emitter.on(PrincipalsConstants.events.VERIFIED_EMAIL, (ctx, user) => {
    SearchAPI.postIndexTask('user', [{ id: user.id }], {
      resource: true
    });
  });

  /*!
   * When a group is created, we must index the group resource document and its members child document
   */
  emitter.on(PrincipalsConstants.events.CREATED_GROUP, (ctx, group, memberChangeInfo) => {
    SearchAPI.postIndexTask('group', [{ id: group.id }], {
      resource: true,
      children: {
        resource_members: true
      }
    });

    // Fire additional tasks to update the memberships of the members
    AuthzSearch.fireMembershipUpdateTasks(_.keys(memberChangeInfo.changes));
  });

  /*!
   * When a group is updated, we must reindex the user resource document
   */
  emitter.on(PrincipalsConstants.events.UPDATED_GROUP, (ctx, group) => {
    SearchAPI.postIndexTask('group', [{ id: group.id }], {
      resource: true
    });
  });

  /*!
   * When group members have been updated, we must both the group's members child document and all the
   * principals' child memberships documents
   */
  emitter.on(
    PrincipalsConstants.events.UPDATED_GROUP_MEMBERS,
    // eslint-disable-next-line no-unused-vars
    (ctx, group, oldGroup, memberChangeInfo, options) => {
      _handleUpdateGroupMembers(ctx, group, _.keys(memberChangeInfo.changes));
    }
  );

  /*!
   * When someone joins a group, we must both the group's members child document and the user's child
   * memberships documents
   */
  emitter.on(PrincipalsConstants.events.JOINED_GROUP, (ctx, group, oldGroup, memberChangeInfo) => {
    _handleUpdateGroupMembers(ctx, group, _.keys(memberChangeInfo.changes));
  });

  /*!
   * When someone leaves a group, we must both the group's members child document and the user's child
   * memberships documents
   */
  emitter.on(PrincipalsConstants.events.LEFT_GROUP, (ctx, group, memberChangeInfo) => {
    _handleUpdateGroupMembers(ctx, group, _.keys(memberChangeInfo.changes));
  });

  /**
   * Submits the indexing operation required when a group's members have changed.
   *
   * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
   * @param  {Group}      group           The group object whose membership changed
   * @param  {String[]}   principalIds    The ids of all the members whose status in the group changed
   * @api private
   */
  const _handleUpdateGroupMembers = function (ctx, group, principalIds) {
    SearchAPI.postIndexTask('group', [{ id: group.id }], {
      children: {
        resource_members: true
      }
    });

    // Fire additional tasks to update the memberships of the members
    AuthzSearch.fireMembershipUpdateTasks(principalIds);
  };

  /**
   * Document producers
   */

  /**
   * Produces search documents for 'user' resources.
   *
   * @see SearchAPI#registerSearchDocumentProducer
   * @api private
   */
  const _produceUserSearchDocuments = function (resources, callback, _documents, _errs) {
    _documents = _documents || [];
    if (_.isEmpty(resources)) {
      return callback(_errs, _documents);
    }

    const resource = resources.pop();

    // No need to retrieve the user object if it was provided
    if (resource.user) {
      _documents.push(_produceUserSearchDocument(resource.user));
      return _produceUserSearchDocuments(resources, callback, _documents, _errs);
    }

    // We'll need to retrieve the user if the full object wasn't provided
    PrincipalsDAO.getPrincipal(resource.id, (error, user) => {
      if (error) {
        _errs = _.union(_errs, [error]);
        return _produceUserSearchDocuments(resources, callback, _documents, _errs);
      }

      _documents.push(_produceUserSearchDocument(user));
      return _produceUserSearchDocuments(resources, callback, _documents, _errs);
    });
  };

  /**
   * Given a user, create a search document based on its information.
   *
   * @param  {User}  user    The user document
   * @return {Object}        The search document that represents the user
   * @api private
   */
  const _produceUserSearchDocument = function (user) {
    const searchDoc = {
      resourceType: user.resourceType,
      id: user.id,
      tenantAlias: user.tenant.alias,
      email: user.email,
      deleted: user.deleted,
      displayName: user.displayName,
      visibility: user.visibility,
      q_high: user.displayName,
      sort: user.displayName,
      lastModified: user.lastModified,
      _extra: {
        publicAlias: user.publicAlias,
        userExtra: user.extra
      }
    };

    if (user.picture.mediumUri) {
      searchDoc.thumbnailUrl = user.picture.mediumUri;
    }

    return searchDoc;
  };

  /**
   * Produces search documents for 'group' resources.
   *
   * @see SearchAPI#registerSearchDocumentProducer
   * @api private
   */
  const _produceGroupSearchDocuments = function (resources, callback, _documents, _errs) {
    _documents = _documents || [];
    if (_.isEmpty(resources)) return callback(_errs, _documents);

    const resource = resources.pop();
    if (resource.group) {
      _documents.push(_produceGroupSearchDocument(resource.group));
      return _produceGroupSearchDocuments(resources, callback, _documents, _errs);
    }

    PrincipalsDAO.getPrincipal(resource.id, (error, group) => {
      if (error) {
        _errs = _.union(_errs, [error]);
        return _produceGroupSearchDocuments(resources, callback, _documents, _errs);
      }

      _documents.push(_produceGroupSearchDocument(group));
      return _produceGroupSearchDocuments(resources, callback, _documents, _errs);
    });
  };

  /**
   * Given a group, create a search document based on its information.
   *
   * @param  {Group}  group  The group document
   * @return {Object}        The search document that represents the group
   * @api private
   */
  const _produceGroupSearchDocument = function (group) {
    // Full text searching is done on the name, alias and description. Though, the displayName is scored higher through `q_high`.
    const fullText = _.compact([group.displayName, group.alias, group.description]).join(' ');

    const searchDoc = {
      resourceType: group.resourceType,
      id: group.id,
      tenantAlias: group.tenant.alias,
      deleted: group.deleted,
      displayName: group.displayName,
      visibility: group.visibility,
      joinable: group.joinable,
      q_high: group.displayName,
      q_low: fullText,
      sort: group.displayName,
      dateCreated: group.created,
      lastModified: group.lastModified,
      createdBy: group.createdBy,
      _extra: {
        alias: group.alias
      }
    };

    if (group.picture.mediumUri) {
      searchDoc.thumbnailUrl = group.picture.mediumUri;
    }

    return searchDoc;
  };

  // Bind the document producers
  SearchAPI.registerSearchDocumentProducer('user', _produceUserSearchDocuments);
  SearchAPI.registerSearchDocumentProducer('group', _produceGroupSearchDocuments);

  /**
   * Document transformers
   */

  /**
   * A function that returns a function that either associates an `thumbnailUrl` field
   * to the user object or alternatively just returns the identity function
   *
   * @function _assignThumbnailIfNeeded
   * @param  {Object} ctx  The http context requesting
   * @param  {Object} user the user object
   */
  const _assignThumbnailIfNeeded = (ctx, user) => {
    if (user.picture.mediumUri) {
      return assoc('thumbnailUrl', ContentUtil.getSignedDownloadUrl(ctx, user.picture.mediumUri));
    }

    return identity;
  };

  /**
   * A function that returns a function that either associates an `extra` field
   * to the user object or alternatively just returns the identity function
   *
   * @function _assignExtraIfNeeded
   * @param {Object} user The user object
   */
  const _assignExtraIfNeeded = (user) => {
    if (user.extra) {
      return assoc('extra', user.extra);
    }

    return identity;
  };

  /**
   * Given an array of user search documents, transform them into search documents
   * suitable to be displayed to the user in context.
   *
   * @param  {Context}   ctx             Standard context object containing the current user and the current tenant
   * @param  {Object}    docs            A hash, keyed by the document id, while the value is the document to transform
   * @param  {Function}  callback        Standard callback function
   * @param  {Object}    callback.err    An error that occurred, if any
   * @param  {Object}    callback.docs   The transformed docs, in the same form as the `docs` parameter.
   * @api private
   */
  const _transformUserDocuments = function (ctx, docs, callback) {
    const transformedDocs = mapObjIndexed((doc, docId) => {
      const scalarExtraField = head(doc.fields._extra);
      const extra = defaultTo({}, scalarExtraField);
      const scalarFields = map(head, doc.fields);
      const { thumbnailUrl, email, displayName, tenantAlias, visibility } = scalarFields;

      const user = assoc(
        'extra',
        extra.userExtra,
        new User(tenantAlias, docId, displayName, email, {
          visibility,
          publicAlias: extra.publicAlias,
          mediumPictureUri: thumbnailUrl
        })
      );

      /**
       * First we need to convert the data in this document back into the source user object
       * so that we may use PrincipalsUtil.hideUserData to hide its information.
       * We will then after convert the user *back* to a search document once the user information
       * has been scrubbed
       */
      // Hide information that is sensitive to the current session
      PrincipalsUtil.hideUserData(ctx, user);

      /**
       * Convert the user object back to a search document using the producer.
       * We use this simply to re-use the logic of turning a user object into a search document
       */
      const tenantAndProfileInfo = {
        profilePath: user.profilePath,
        tenant: user.tenant
      };

      const result = pipe(
        _produceUserSearchDocument,
        mergeDeepLeft(tenantAndProfileInfo),
        // The UI search model expects the 'extra' parameter if it was not scrubbed
        _assignExtraIfNeeded(user),
        // If the mediumPictureUri wasn't scrubbed from the user object that means the current user can see it
        _assignThumbnailIfNeeded(ctx, user)
      )(user);

      /**
       * We need to delete these fields which are added by the producer but aren't
       * supposed to be included in the UI
       */
      delete result.q_high;
      delete result.sort;

      return result;
    }, docs);

    return callback(null, transformedDocs);
  };

  // Bind the transformer to the search API
  SearchAPI.registerSearchDocumentTransformer('user', _transformUserDocuments);

  /**
   * A function that either returns a function that conditionally assigns the `thumbnailUrl`
   * to an object or alternatively just returns the identity function
   *
   * @function _signThumbnail
   * @param  {Object} ctx          The http context of the request
   * @param  {String} thumbnailUrl The thumbnailUrl to assign conditionally
   * @param  {Object} result       Search result object
   */
  const _signThumbnailIfNeeded = (ctx, thumbnailUrl, result) => {
    if (has('thumbnailUrl', result)) {
      return assoc('thumbnailUrl', ContentUtil.getSignedDownloadUrl(ctx, thumbnailUrl));
    }

    return identity;
  };

  /**
   * A function that either returns a function that conditionally assigns the `profilePath`
   * to an object or alternatively just returns the identity function
   * @function _assignProfilePathIfNeeded
   * @param  {Object} tenantAlias The tenant alias the profile belongs to
   * @param  {String} resourceId  The resourceId representing the group
   * @param  {Object} result      Search result object
   */
  const _assignProfilePathIfNeeded = (tenantAlias, resourceId, result) => {
    if (not(result.deleted)) {
      return assoc('profilePath', `/group/${tenantAlias}/${resourceId}`);
    }

    return identity;
  };

  /**
   * Given an array of group search documents, transform them into search documents suitable to be displayed to the user in context.
   *
   * @param  {Context}   ctx             Standard context object containing the current user and the current tenant
   * @param  {Object}    docs            A hash, keyed by the document id, while the value is the document to transform
   * @param  {Function}  callback        Standard callback function
   * @param  {Object}    callback.err    An error that occurred, if any
   * @param  {Object}    callback.docs   The transformed docs, in the same form as the `docs` parameter.
   * @api private
   */
  const _transformGroupDocuments = function (ctx, docs, callback) {
    const transformedDocs = mapObjIndexed((doc, docId) => {
      const scalarExtraField = head(doc.fields._extra);
      const extraFields = defaultTo({}, scalarExtraField);
      const alias = pick(['alias'], extraFields);
      const scalarFields = map(head, doc.fields);
      const tenantAlias = getTenantAlias(scalarFields);
      const tenant = getTenant(tenantAlias).compact();
      const resourceId = compose(getResourceId, getResourceFromId)(docId);

      return pipe(
        mergeLeft({ id: docId }),
        mergeLeft(scalarFields),
        // Sign the thumbnail URL so it may be downloaded by the client
        _signThumbnailIfNeeded(ctx, scalarFields.thumbnailUrl, scalarFields),
        // Add the profile path, only if the group is not deleted
        _assignProfilePathIfNeeded(tenantAlias, resourceId, scalarFields),
        mergeDeepLeft({ alias }),
        mergeDeepLeft({ tenant })
      )(extraFields);
    }, docs);

    return callback(null, transformedDocs);
  };

  // Bind the transformer to the search API
  SearchAPI.registerSearchDocumentTransformer('group', _transformGroupDocuments);

  /**
   * Reindex all handlers
   */

  /*!
   * Binds a reindexAll handler that reindexes all rows from the Principals CF (users and groups)
   */
  SearchAPI.registerReindexAllHandler('principal', (callback) => {
    /*!
     * Handles each iteration of the PrincipalsDAO iterate all method, firing tasks for all principals to
     * be reindexed.
     *
     * @see PrincipalsDAO#iterateAll
     */
    const _onEach = function (principalRows, done) {
      // Aggregate group and user reindexing task resources
      const groupResources = [];
      const userResources = [];
      _.each(principalRows, (principal) => {
        const { principalId } = principal;
        if (principalId) {
          if (AuthzUtil.isGroupId(principalId)) {
            groupResources.push({ id: principalId });
          } else if (AuthzUtil.isUserId(principalId)) {
            userResources.push({ id: principalId });
          }
        }
      });

      log().info('Firing re-indexing task for %s users and %s groups', userResources.length, groupResources.length);

      if (!_.isEmpty(userResources)) {
        SearchAPI.postIndexTask('user', userResources, { resource: true, children: true });
      }

      if (!_.isEmpty(groupResources)) {
        SearchAPI.postIndexTask('group', groupResources, { resource: true, children: true });
      }

      return done();
    };

    return PrincipalsDAO.iterateAll(null, 100, _onEach, callback);
  });

  /**
   * Delete handlers
   */

  /**
   * Handler to invoke the search tasks required to invalidate search documents necessary
   *
   * @param  {Group}          group               The group that needs to be invalidated
   * @param  {AuthzGraph}     membershipsGraph    The graph of group memberships of the group
   * @param  {AuthzGraph}     membersGraph        The graph of group members of the group
   * @param  {Function}       callback            Standard callback function
   * @param  {Object[]}       callback.errs       All errs that occurred while trying to fire the search update tasks, if any
   * @api private
   */
  const _handleInvalidateSearch = function (group, membershipsGraph, membersGraph, callback) {
    /**
     * All members (direct and indirect, users and groups) of the group that was deleted need to
     * have their memberships child search documents invalidated
     */
    const groupAndUserIds = pipe(
      pluck('id'),
      filter(AuthzUtil.isPrincipalId),
      without(group.id),
      partition(AuthzUtil.isGroupId)
    )(membersGraph.getNodes());
    const memberGroupIds = groupAndUserIds[0];
    const memberUserIds = groupAndUserIds[1];

    // Create the index task that will tell search to update the deleted group's resource document
    const resourceGroupIndexTask = [{ id: group.id }];

    // Create the index tasks that will tell search which resource's memberships document to update
    const memberGroupIndexTasks = map(objOf('id'), memberGroupIds);

    const memberUserIndexTasks = map(objOf('id'), memberUserIds);

    // The index operation that tells search to update only the resource document of the target
    // resources. This is needed for the group being deleted only
    const resourceIndexOp = { resource: true };

    // The index operation that tells search to only update the memberships child document of the
    // target resources
    const membershipsIndexOp = {
      children: {
        resource_memberships: true
      }
    };

    let allErrs = null;

    // Update the resource document of the group that was deleted so its `deleted` flag may be
    // set/unset for the updated delete date
    SearchAPI.postIndexTask('group', resourceGroupIndexTask, resourceIndexOp, (error) => {
      if (error) {
        allErrs = _.union(allErrs, [error]);
      }

      // If there are group index tasks to invoke, do it
      OaeUtil.invokeIfNecessary(
        !_.isEmpty(memberGroupIndexTasks),
        SearchAPI.postIndexTask,
        'group',
        memberGroupIndexTasks,
        membershipsIndexOp,
        (error) => {
          if (error) {
            allErrs = _.union(allErrs, [error]);
          }

          // If there are user index tasks to invoke, do it
          OaeUtil.invokeIfNecessary(
            !_.isEmpty(memberUserIndexTasks),
            SearchAPI.postIndexTask,
            'user',
            memberUserIndexTasks,
            membershipsIndexOp,
            (error) => {
              if (error) {
                allErrs = _.union(allErrs, [error]);
              }

              return callback(allErrs);
            }
          );
        }
      );
    });
  };

  /*!
   * When a group is deleted or restored, invalidate the memberships search documents of all members
   * affected by the change
   */
  PrincipalsDelete.registerGroupDeleteHandler('search', _handleInvalidateSearch);
  PrincipalsDelete.registerGroupRestoreHandler('search', _handleInvalidateSearch);

  return callback();
};

export { init };
