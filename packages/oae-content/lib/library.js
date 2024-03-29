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
import * as LibraryAPI from 'oae-library';
import * as PrincipalsDAO from 'oae-principals/lib/internal/dao.js';
import * as ContentAPI from 'oae-content';
import * as ContentDAO from 'oae-content/lib/internal/dao.js';
import * as ContentMembersLibrary from 'oae-content/lib/internal/membersLibrary.js';

import { ContentConstants } from 'oae-content/lib/constants.js';
import { logger } from 'oae-logger';

const log = logger('oae-content-library');

/*!
 * Register a library indexer that can provide resources to reindex the content library
 */
LibraryAPI.Index.registerLibraryIndex(ContentConstants.library.CONTENT_LIBRARY_INDEX_NAME, {
  pageResources(libraryId, start, limit, callback) {
    // Query all the content ids ('c') to which the library owner is directly associated in this batch of paged resources
    AuthzAPI.getRolesForPrincipalAndResourceType(libraryId, 'c', start, limit, (error, roles, nextToken) => {
      if (error) {
        return callback(error);
      }

      // We just need the ids, not the roles
      const ids = _.pluck(roles, 'id');

      // Get the properties of the content items in the library that are relevant to building the library
      ContentDAO.Content.getMultipleContentItems(
        ids,
        ['contentId', 'tenantAlias', 'visibility', 'lastModified'],
        (error, contentItems) => {
          if (error) {
            return callback(error);
          }

          // Map the content items to light-weight resources with just the properties needed to populate the library index
          const resources = _.chain(contentItems)
            .compact()
            .map((content) => ({ rank: content.lastModified, resource: content }))
            .value();

          return callback(null, resources, nextToken);
        }
      );
    });
  }
});

/*!
 * Register a library indexer that can provide resources to reindex the content members library
 */
LibraryAPI.Index.registerLibraryIndex(ContentConstants.library.MEMBERS_LIBRARY_INDEX_NAME, {
  pageResources(libraryId, start, limit, callback) {
    AuthzAPI.getAuthzMembers(libraryId, start, limit, (error, memberInfos, nextToken) => {
      if (error) {
        return callback(error);
      }

      const ids = _.pluck(memberInfos, 'id');
      PrincipalsDAO.getPrincipals(ids, ['principalId', 'tenantAlias', 'visibility'], (error, memberProfiles) => {
        if (error) {
          return callback(error);
        }

        const resources = _.map(memberProfiles, (memberProfile) => ({ resource: memberProfile }));

        return callback(null, resources, nextToken);
      });
    });
  }
});

/*!
 * Configure the content library search endpoint
 */
LibraryAPI.Search.registerLibrarySearch('content-library', ['content']);

/*!
 * Update content members libraries when a content item is created
 */
ContentAPI.emitter.when(
  ContentConstants.events.CREATED_CONTENT,
  (ctx, content, revision, memberChangeInfo, folders, callback) => {
    // Add this content item to all member content libraries
    ContentDAO.Content.updateContentLibraries(content, [], (error) => {
      if (error) {
        // If there was an error updating libraries here, the permissions were still changed, so
        // we should not return an error. Just log it
        log().warn(
          {
            err: error,
            contentId: content.id,
            memberIds: _.keys(memberChangeInfo.changes)
          },
          'Failed to update user content libraries after creating a content item'
        );
      }

      return callback();
    });
  }
);

/*!
 * Update libraries when roles are updated on content
 */
ContentAPI.emitter.when(
  ContentConstants.events.UPDATED_CONTENT_MEMBERS,
  (ctx, content, memberChangeInfo, options, callback) => {
    const removedMemberIds = _.pluck(memberChangeInfo.members.removed, 'id');

    // Update the content rank in the libraries of those who now have the content item in them,
    // while removing it from those who are having it removed
    ContentDAO.Content.updateContentLibraries(content, removedMemberIds, (error, newContent) => {
      if (error) {
        // If there was an error updating libraries here, the permissions were still changed, so
        // we should not return an error. Just log it
        log().warn(
          {
            err: error,
            contentId: content.id,
            removedMemberIds
          },
          'Failed to update user content libraries after updating content roles'
        );
      }

      // Update the content members library of the content item who just had members added/removed
      return _updateContentMembersLibrary(newContent || content, memberChangeInfo, callback);
    });
  }
);

/**
 * Update the members library of the specified content item according to the member change info
 * object received from resource action.
 *
 * @param  {Content}    content             The content item whose members library to update
 * @param  {Object}     memberChangeInfo    The member change object for the members update that occurred
 * @param  {Function}   callback            Invoked when the libraries are updated. Errors are logged and swallowed at this point since library updates are secondary updates to the roles that have already been successfully updated
 * @api private
 */
const _updateContentMembersLibrary = function (content, memberChangeInfo, callback) {
  const removedMemberIds = _.pluck(memberChangeInfo.members.removed, 'id');

  // If setting the content permissions results in any new members, we should insert them into
  // the content members library
  ContentMembersLibrary.insert(content, memberChangeInfo.members.added, (error) => {
    if (error) {
      log().warn(
        {
          err: error,
          contentId: content.id,
          principalIds: _.pluck(memberChangeInfo.members.added, 'id')
        },
        'An error occurred while inserting principals into content members library while setting content roles'
      );
    }

    // If setting the content permissions results in removing members from the content item,
    // we should remove them from the content members library
    ContentMembersLibrary.remove(content, removedMemberIds, (error) => {
      if (error) {
        log().warn(
          {
            err: error,
            contentId: content.id,
            principalIds: removedMemberIds
          },
          'An error occurred while removing principals from content members library while setting content roles'
        );
      }

      return callback();
    });
  });
};
