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

import assert from 'assert';
import { format } from 'util';
import _ from 'underscore';
import ShortId from 'shortid';
import async from 'async';

import { map, path } from 'ramda';

import { setSheetContents, getJSON } from 'oae-content/lib/internal/ethercalc.js';
import * as AuthzTestUtil from 'oae-authz/lib/test/util.js';
import * as MqTestUtil from 'oae-util/lib/test/mq-util.js';
import * as LibraryTestUtil from 'oae-library/lib/test/util.js';
import * as PrincipalsTestUtil from 'oae-principals/lib/test/util.js';
import * as RestAPI from 'oae-rest';
import * as MQ from 'oae-util/lib/mq.js';
import * as TestsUtil from 'oae-tests/lib/util.js';

import { ContentConstants } from 'oae-content/lib/constants.js';

const PUBLIC = 'public';

/**
 * Set up 2 public tenants and 2 private tenants, each with a public, loggedin, private set of users, groups and
 * content. The resulting model looks like this:
 *
 * ```
 *  {
 *      "publicTenant": {
 *          "tenant": <Tenant>,
 *          "anonymousRestContext": <RestContext>,
 *          "adminRestContext": <RestContext>,
 *          "publicGroup": <Group>,
 *          "loggedinGroup": <Group>,
 *          "privateGroup": <Group>,
 *          "publicContent": <Content>,
 *          "loggedinContent": <Content>,
 *          "privateContent": <Content>,
 *          "publicUser": {
 *              "user": <User>,
 *              "restContext": <RestContext>
 *          },
 *          "loggedinUser": { ... }
 *          "privateUser": { ... }
 *      },
 *      "publicTenant1": { ... },
 *      "privateTenant": { ... },
 *      "privateTenant1": { ... }
 *  }
 * ```
 *
 * @param  {Function}   Invoked when all the entities are set up
 * @throws {Error}      An assertion error is thrown if something does not get created properly
 */
const setupMultiTenantPrivacyEntities = function (callback) {
  // Create the tenants and users
  TestsUtil.setupMultiTenantPrivacyEntities((publicTenant, publicTenant1, privateTenant, privateTenant1) => {
    // Create the content
    _setupTenant(publicTenant, () => {
      _setupTenant(publicTenant1, () => {
        _setupTenant(privateTenant, () => {
          _setupTenant(privateTenant1, () => {
            return callback(publicTenant, publicTenant1, privateTenant, privateTenant1);
          });
        });
      });
    });
  });
};

/**
 * Create a link content item, ensuring that the operation succeeds
 *
 * @param  {RestContext}    restContext         The context of the current request
 * @param  {String}         displayName         The display name of the link
 * @param  {String}         [description]       The description of the link
 * @param  {String}         visibility          The visibility of the link
 * @param  {String}         link                The link location
 * @param  {String[]}       [managerIds]        The share target ids that specify the managers
 * @param  {String[]}       [viewerIds]         The share target ids that specify the viewers
 * @param  {String[]}       [folderIds]         The folders to which the link should belong
 * @param  {Function}       callback            Invoked when the link is created
 * @param  {Content}        callback.content    The created link
 * @throws {AssertionError}                     Thrown if any assertions fail
 */
const assertCreateLinkSucceeds = function (
  restContext,
  displayName,
  description,
  visibility,
  link,
  managerIds,
  viewerIds,
  folderIds,
  callback
) {
  PrincipalsTestUtil.assertGetMeSucceeds(restContext, (me) => {
    RestAPI.Content.createLink(
      restContext,
      { displayName, description, visibility, link, managers: managerIds, viewers: viewerIds, folders: folderIds },
      (error, content) => {
        assert.ok(!error);
        assert.strictEqual(content.displayName, displayName);
        assert.strictEqual(content.description, description);
        assert.strictEqual(content.visibility, visibility);

        // Assemble our expected roles after creation
        const roleChanges = {};
        roleChanges[me.id] = 'manager';

        _.each(managerIds, (id) => {
          roleChanges[id] = 'manager';
        });

        _.each(viewerIds, (id) => {
          roleChanges[id] = 'viewer';
        });

        // Ensure the members have the expected roles
        getAllContentMembers(restContext, content.id, null, (result) => {
          AuthzTestUtil.assertMemberRolesEquals({}, roleChanges, AuthzTestUtil.getMemberRolesFromResults(result));

          AuthzTestUtil.assertGetInvitationsSucceeds(restContext, 'content', content.id, (result) => {
            AuthzTestUtil.assertEmailRolesEquals(
              {},
              roleChanges,
              AuthzTestUtil.getEmailRolesFromResults(result.results)
            );
            return callback(content);
          });
        });
      }
    );
  });
};

/**
 * Attempt to create a link content item, ensuring that the operation fails in the expected manner
 *
 * @param  {RestContext}    restContext         The context of the current request
 * @param  {String}         displayName         The display name of the link
 * @param  {String}         [description]       The description of the link
 * @param  {String}         visibility          The visibility of the link
 * @param  {String}         link                The link location
 * @param  {String[]}       [managerIds]        The share target ids that specify the managers
 * @param  {String[]}       [viewerIds]         The share target ids that specify the viewers
 * @param  {String[]}       [folderIds]         The folders to which the link should belong
 * @param  {Number}         [httpCode]          The expected HTTP code of the failed request
 * @param  {Function}       callback            Invoked when the create link request fails in the expected manner
 * @throws {AssertionError}                     Thrown if any assertions fail
 */
const assertCreateLinkFails = function (
  restContext,
  displayName,
  description,
  visibility,
  link,
  managerIds,
  viewerIds,
  folderIds,
  httpCode,
  callback
) {
  RestAPI.Content.createLink(
    restContext,
    { displayName, description, visibility, link, managers: managerIds, viewers: viewerIds, folders: folderIds },
    (error, content) => {
      assert.ok(error);
      assert.strictEqual(error.code, httpCode);
      assert.ok(!content);
      return callback();
    }
  );
};

/**
 * Attempt to get a content item, ensuring the request fails in the specified manner
 *
 * @param  {RestContext}    restContext     The context of the current request
 * @param  {String}         contentId       The id of the content item to get
 * @param  {Number}         httpCode        The expected HTTP code of the failed request
 * @param  {Function}       callback        Invoked when the request fails as expected
 * @throws {AssertionError}                 Thrown if any assertions fail
 */
const assertGetContentFails = function (restContext, contentId, httpCode, callback) {
  RestAPI.Content.getContent(restContext, contentId, (error, content) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);
    assert.ok(!content);
    return callback();
  });
};

/**
 * Delete a content item, ensuring the operation succeeds
 *
 * @param  {RestContext}    restContext         The context of the current request
 * @param  {String}         contentId           The id of the content item to delete
 * @param  {Function}       callback            Invoked when the request fails as expected
 * @throws {AssertionError}                     Thrown if any assertions fail
 */
const assertDeleteContentSucceeds = function (restContext, contentId, callback) {
  RestAPI.Content.deleteContent(restContext, contentId, (error) => {
    assert.ok(!error);

    // Ensure the content now gets a 404
    return assertGetContentFails(restContext, contentId, 404, callback);
  });
};

/**
 * Ensure that the provided etherpad content matches the expected content that was persisted. This
 * assertion abstracts things such as the `<html></html>` pre-amble of an etherpad document so
 * the consumer only needs to focus on the content it persisted
 *
 * @param  {String}         actualContent       The actual content that was read from the Etherpad API
 * @param  {String}         expectedContent     The expected contents of the etherpad document
 * @throws {AssertionError}                     Thrown if the actual content did not match the expected content
 */
const assertEtherpadContentEquals = function (actualContent, expectedContent) {
  // Wrap the expected content into the etherpad document structure. Also add a line break at the
  // end of the provided content. This is not extremely robust and will likely only be valid for
  // asserting simple single-line content, so it's possible if we have more complex test cases
  // we'll need to revisit this logic
  expectedContent = '<!DOCTYPE HTML><html><body>' + expectedContent + '<br></body></html>';

  assert.strictEqual(actualContent, expectedContent);
};

/**
 * Try and get the members library of a content item, ensuring the request fails in a particular way
 *
 * @param  {RestContext}    restContext     The context to use to issue the request
 * @param  {String}         [contentId]     The id of the content item whose members library to get
 * @param  {String}         [start]         From where in the list to start listing results
 * @param  {Number}         [limit]         The maximum number of member results to return
 * @param  {Number}         httpCode        The expected failure HTTP code of the get content members library request
 * @param  {Function}       callback        Standard callback function
 * @throws {AssertionError}                 Thrown if the the request did not fail in the expected manner
 */
const assertGetContentMembersFails = function (restContext, contentId, start, limit, httpCode, callback) {
  // eslint-disable-next-line no-unused-vars
  RestAPI.Content.getMembers(restContext, contentId, start, limit, (error, result) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);
    return callback();
  });
};

/**
 * Get the members library of a content item, ensuring the request is successful
 *
 * @param  {RestContext}    restContext                         The context to use to issue the request
 * @param  {String}         contentId                           The id of the content item whose members library to get
 * @param  {String}         [start]                             From where in the list to start listing results
 * @param  {Number}         [limit]                             The maximum number of member results to return. Default: 25
 * @param  {Function}       callback                            Standard callback function
 * @param  {Object}         callback.result                     The member results
 * @param  {Object[]}       callback.result.results             An array of members library results
 * @param  {User|Group}     callback.result.results[i].profile  The profile of the user or group member
 * @param  {String}         callback.result.results[i].role     The role the user or group has on the content item
 * @param  {String}         callback.result.nextToken           The token to use for the next members library request to get the next page of members
 * @throws {AssertionError}                                     Thrown if there is an error getting the content members library
 */
const assertGetContentMembersSucceeds = function (restContext, contentId, start, limit, callback) {
  RestAPI.Content.getMembers(restContext, contentId, start, limit, (error, result) => {
    assert.ok(!error);
    assert.ok(result);
    assert.ok(_.isArray(result.results));
    assert.ok(_.isString(result.nextToken) || _.isNull(result.nextToken));

    // If a valid limit was specified (valid meaning above 0 and below the maximum amount of
    // 25), ensure the `nextToken` is shown if there were less than the expected amount of
    // results
    if (_.isNumber(limit) && limit > 0 && result.results.length < limit && limit <= 25) {
      assert.strictEqual(result.nextToken, null);
    }

    // Ensure each result has an id and a valid role
    _.each(result.results, (result) => {
      assert.ok(result);
      assert.ok(result.profile);
      assert.ok(result.profile.id);
      assert.ok(_.contains(['manager', 'editor', 'viewer'], result.role));
    });

    return callback(result);
  });
};

/**
 * Try and update the members of a content item, ensuring that the request fails in a specified manner
 *
 * @param  {RestContext}    managerRestContext  The rest context of a manager of the content item. This is needed to ensure that the membership is not impacted by the failure
 * @param  {RestContext}    actorRestContext    The rest context of the user who should perform the update members action
 * @param  {String}         [contentId]         The id of the content item whose members to try and update
 * @param  {Object}         [roleChanges]       A hash keyed by user id, whose values are the role to set for each member
 * @param  {Number}         httpCode            The expected failure HTTP code of the update members request
 * @param  {Function}       callback            Standard callback function
 * @throws {AssertionError}                     Thrown if there is an error ensuring that the request fails in the specified manner
 */
const assertUpdateContentMembersFails = function (
  managerRestContext,
  actorRestContext,
  contentId,
  roleChanges,
  httpCode,
  callback
) {
  // Get the members library so we can ensure it does not change after the failure
  getAllContentMembers(managerRestContext, contentId, null, (result) => {
    const memberRolesBefore = AuthzTestUtil.getMemberRolesFromResults(result);

    AuthzTestUtil.assertGetInvitationsSucceeds(managerRestContext, 'content', contentId, (result) => {
      const emailRolesBefore = AuthzTestUtil.getEmailRolesFromResults(result.results);

      // Perform the update and ensure it fails as expected
      RestAPI.Content.updateMembers(actorRestContext, contentId, roleChanges, (error) => {
        assert.ok(error);
        assert.strictEqual(error.code, httpCode);

        // Ensure the members and invitations did not change
        AuthzTestUtil.assertGetInvitationsSucceeds(managerRestContext, 'content', contentId, (result) => {
          AuthzTestUtil.assertEmailRolesEquals(
            emailRolesBefore,
            null,
            AuthzTestUtil.getEmailRolesFromResults(result.results)
          );

          getAllContentMembers(managerRestContext, contentId, null, (result) => {
            AuthzTestUtil.assertMemberRolesEquals(
              memberRolesBefore,
              null,
              AuthzTestUtil.getMemberRolesFromResults(result)
            );

            // Test once more that the library did not change by purging and rebuilding it
            _purgeMembersLibrary(contentId, () => {
              // Ensure the library members still did not change
              getAllContentMembers(managerRestContext, contentId, null, (result) => {
                AuthzTestUtil.assertMemberRolesEquals(
                  memberRolesBefore,
                  null,
                  AuthzTestUtil.getMemberRolesFromResults(result)
                );
                return callback();
              });
            });
          });
        });
      });
    });
  });
};

/**
 * Update the members of a content item, ensuring that the request fails in a specified manner
 *
 * @param  {RestContext}    managerRestContext  The rest context of a manager of the content item. This is needed to ensure that the membership is impacted by the role changes in the expected manner
 * @param  {RestContext}    actorRestContext    The rest context of the user who should perform the update members action
 * @param  {String}         contentId           The id of the content item whose members to update
 * @param  {Object}         roleChanges         A hash keyed by user id, whose values are the role to set for each member
 * @param  {Function}       callback            Standard callback function
 * @throws {AssertionError}                     Thrown if there is an error ensuring that the update members operation was successful
 */
const assertUpdateContentMembersSucceeds = function (
  managerRestContext,
  actorRestContext,
  contentId,
  roleChanges,
  callback
) {
  // Ensure the members library is currently built
  getAllContentMembers(managerRestContext, contentId, null, (result) => {
    const memberRolesBefore = AuthzTestUtil.getMemberRolesFromResults(result);

    AuthzTestUtil.assertGetInvitationsSucceeds(managerRestContext, 'content', contentId, (result) => {
      const emailRolesBefore = AuthzTestUtil.getEmailRolesFromResults(result.results);

      // Perform the update, causing the library to update on-the-fly
      RestAPI.Content.updateMembers(actorRestContext, contentId, roleChanges, (error) => {
        assert.ok(!error);

        // Ensure the invitations and members have the updated status
        AuthzTestUtil.assertGetInvitationsSucceeds(managerRestContext, 'content', contentId, (result) => {
          AuthzTestUtil.assertEmailRolesEquals(
            emailRolesBefore,
            roleChanges,
            AuthzTestUtil.getEmailRolesFromResults(result.results)
          );

          getAllContentMembers(managerRestContext, contentId, null, (result) => {
            AuthzTestUtil.assertMemberRolesEquals(
              memberRolesBefore,
              roleChanges,
              AuthzTestUtil.getMemberRolesFromResults(result)
            );

            // Test the library once more by purging and building the library from scratch
            _purgeMembersLibrary(contentId, () => {
              // Now that we're running with a fresh library, ensure that the members we receive are still what we expect
              getAllContentMembers(managerRestContext, contentId, null, (result) => {
                AuthzTestUtil.assertMemberRolesEquals(
                  memberRolesBefore,
                  roleChanges,
                  AuthzTestUtil.getMemberRolesFromResults(result)
                );

                return callback();
              });
            });
          });
        });
      });
    });
  });
};

/**
 * Try and share a content item, ensuring that the request fails in a specified manner
 *
 * @param  {RestContext}    managerRestContext  The rest context of a manager of the content item. This is needed to ensure that the membership is not impacted by the failure
 * @param  {RestContext}    actorRestContext    The rest context of the user who should perform the share action
 * @param  {String}         [contentId]         The id of the content item to try and share
 * @param  {String[]}       [memberIds]         The ids of the members with which to share the content item
 * @param  {Number}         httpCode            The expected failure HTTP code of the share content request
 * @param  {Function}       callback            Standard callback function
 * @throws {AssertionError}                     Thrown if there is an error ensuring that the request fails in the specified manner
 */
const assertShareContentFails = function (
  managerRestContext,
  actorRestContext,
  contentId,
  memberIds,
  httpCode,
  callback
) {
  // Get the members library so we can ensure it does not change after the failure
  getAllContentMembers(managerRestContext, contentId, null, (result) => {
    const memberRolesBefore = AuthzTestUtil.getMemberRolesFromResults(result);

    AuthzTestUtil.assertGetInvitationsSucceeds(managerRestContext, 'content', contentId, (result) => {
      const emailRolesBefore = AuthzTestUtil.getEmailRolesFromResults(result.results);

      // Perform the update and ensure it fails as expected
      RestAPI.Content.shareContent(actorRestContext, contentId, memberIds, (error) => {
        assert.ok(error);
        assert.strictEqual(error.code, httpCode);

        // Ensure the invitations and members did not change
        AuthzTestUtil.assertGetInvitationsSucceeds(managerRestContext, 'content', contentId, (result) => {
          AuthzTestUtil.assertEmailRolesEquals(
            emailRolesBefore,
            null,
            AuthzTestUtil.getEmailRolesFromResults(result.results)
          );

          getAllContentMembers(managerRestContext, contentId, null, (result) => {
            AuthzTestUtil.assertMemberRolesEquals(
              memberRolesBefore,
              null,
              AuthzTestUtil.getMemberRolesFromResults(result)
            );

            // Test once more that the library did not change by purging and rebuilding it
            _purgeMembersLibrary(contentId, () => {
              // Ensure the library members still did not change
              getAllContentMembers(managerRestContext, contentId, null, (result) => {
                AuthzTestUtil.assertMemberRolesEquals(
                  memberRolesBefore,
                  null,
                  AuthzTestUtil.getMemberRolesFromResults(result)
                );
                return callback();
              });
            });
          });
        });
      });
    });
  });
};

/**
 * Share the content item with the given list of users, ensuring it succeeds and the content item is
 * added to the content item members library
 *
 * @param  {RestContext}    managerRestContext  The rest context of a manager of the content item. This is needed to ensure that the membership is impacted by the sharing in the expected manner
 * @param  {RestContext}    actorRestContext    The rest context of the user who should perform the share action
 * @param  {String}         contentId           The id of the content item to share
 * @param  {String[]}       memberIds           The ids of the members with which to share the content item
 * @param  {Function}       callback            Standard callback function
 * @throws {AssertionError}                     Thrown if there is an error verifying that the content item is successfully shared
 */
const assertShareContentSucceeds = function (managerRestContext, actorRestContext, contentId, memberIds, callback) {
  // Ensure the members library is currently built
  getAllContentMembers(managerRestContext, contentId, null, (result) => {
    const memberRolesBefore = AuthzTestUtil.getMemberRolesFromResults(result);

    AuthzTestUtil.assertGetInvitationsSucceeds(managerRestContext, 'content', contentId, (result) => {
      const emailRolesBefore = AuthzTestUtil.getEmailRolesFromResults(result.results);

      // Build a role update object that represents the change that should occur in the share
      // operation
      const roleChange = {};
      _.each(memberIds, (memberId) => {
        if (!memberRolesBefore[memberId] && !emailRolesBefore[memberId]) {
          roleChange[memberId] = 'viewer';
        }
      });

      // Perform the share action, causing the library to update on-the-fly
      RestAPI.Content.shareContent(actorRestContext, contentId, memberIds, (error) => {
        assert.ok(!error);

        // Ensure the members and invitations had the expected updates
        AuthzTestUtil.assertGetInvitationsSucceeds(managerRestContext, 'content', contentId, (result) => {
          AuthzTestUtil.assertEmailRolesEquals(
            emailRolesBefore,
            roleChange,
            AuthzTestUtil.getEmailRolesFromResults(result.results)
          );

          getAllContentMembers(managerRestContext, contentId, null, (membersAfterUpdate) => {
            AuthzTestUtil.assertMemberRolesEquals(
              memberRolesBefore,
              roleChange,
              AuthzTestUtil.getMemberRolesFromResults(membersAfterUpdate)
            );

            // Test the library once more by purging and building the library from scratch
            _purgeMembersLibrary(contentId, () => {
              // Now that we're running with a fresh library, ensure that the members we receive are what we expect
              getAllContentMembers(managerRestContext, contentId, null, (membersAfterUpdate) => {
                AuthzTestUtil.assertMemberRolesEquals(
                  memberRolesBefore,
                  roleChange,
                  AuthzTestUtil.getMemberRolesFromResults(membersAfterUpdate)
                );

                return callback();
              });
            });
          });
        });
      });
    });
  });
};

/**
 * Get the full content members library of a content item
 *
 * @param  {RestContext}    restContext         The rest context to use to get the content members library
 * @param  {String}         contentId           The id of the content item whose members to get
 * @param  {Object}         [opts]              Optional arguments for getting the content members library
 * @param  {Number}         [opts.batchSize]    The size of the pages to use when paging through the content members library
 * @param  {Function}       callback            Standard callback function
 * @param  {Object[]}       callback.members    An array of users and groups that were fetched from the library
 * @param  {Object[][]}     callback.responses  The raw response objects for each page request that was made to get the content members library
 * @throws {AssertionError}                     Thrown if an error occurrs while paging through the content members library
 */
const getAllContentMembers = function (restContext, contentId, options, callback, _members, _responses, _nextToken) {
  _members = _members || [];
  _responses = _responses || [];
  if (_nextToken === null) {
    return callback(_members, _responses);
  }

  options = options || {};
  options.batchSize = options.batchSize || 25;
  assertGetContentMembersSucceeds(restContext, contentId, _nextToken, options.batchSize, (result) => {
    _responses.push(result);
    return getAllContentMembers(
      restContext,
      contentId,
      options,
      callback,
      _.union(_members, result.results),
      _responses,
      result.nextToken
    );
  });
};

/**
 * Get the full content library of the specified principal, ensuring that the requests succeed
 *
 * @param  {RestContext}    restContext             The rest context to use to get the content library
 * @param  {String}         principalId             The id of the principal whose content library to get
 * @param  {Object}         [opts]                  Optional arguments
 * @param  {Number}         [opts.batchSize]        The batch size to use to page through the content library
 * @param  {Function}       callback                Standard callback function
 * @param  {Object[]}       callback.contentItems   The array of content items in the library
 * @param  {Object[][]}     callback.responses      The raw response objects for each page request that was made to get the content library
 */
const assertGetAllContentLibrarySucceeds = function (
  restContext,
  principalId,
  options,
  callback,
  _contentItems,
  _responses,
  _nextToken
) {
  _contentItems = _contentItems || [];
  _responses = _responses || [];
  if (_nextToken === null) {
    return callback(_contentItems, _responses);
  }

  options = options || {};
  options.batchSize = options.batchSize || 25;
  assertGetContentLibrarySucceeds(
    restContext,
    principalId,
    { start: _nextToken, limit: options.batchSize },
    (result) => {
      _responses.push(result);
      return assertGetAllContentLibrarySucceeds(
        restContext,
        principalId,
        options,
        callback,
        _.union(_contentItems, result.results),
        _responses,
        result.nextToken
      );
    }
  );
};

/**
 * Get a page of the content library of the specified principal, ensuring the request succeeds
 *
 * @param  {RestContext}    restContext         The rest context to use to get the content library
 * @param  {String}         principalId         The id of the principal whose content library to get
 * @param  {Object}         [opts]              Optional arguments
 * @param  {String}         [opts.start]        The start point at which to start returning items. By default, starts from the beginning of the list
 * @param  {Number}         [opts.limit]        The maximum number of items to fetch
 * @param  {Function}       callback            Standard callback function
 * @param  {ContentLibrary} callback.result     The content library result
 */
const assertGetContentLibrarySucceeds = function (restContext, principalId, options, callback) {
  options = options || {};
  RestAPI.Content.getLibrary(restContext, principalId, options.start, options.limit, (error, result) => {
    assert.ok(!error);
    assert.ok(result);
    return callback(result);
  });
};

/**
 * Generate a number of test links
 *
 * @param  {restContext}    restContext         The rest context to use to generate the links with
 * @param  {[type]}         total               The total number of links that should be generated
 * @param  {Function}       callback            Standard callback function
 * @param  {Content}        callback.link1      The first link
 * @param  {Content}        [callback.link2]    The second link, if any
 * @param  {Content}        [callback...]       Each link is passed as a new callback argument
 */
const generateTestLinks = function (restContext, total, callback) {
  const contentItems = [];

  // Ensure the restContext's cookieJar is properly set up before
  // we start doing parallel requests
  RestAPI.User.getMe(restContext, (error) => {
    assert.ok(!error);

    const done = _.after(total, () => {
      return callback.apply(callback, contentItems);
    });

    // eslint-disable-next-line no-unused-vars
    _.each(_.range(total), (i) => {
      RestAPI.Content.createLink(
        restContext,
        {
          displayName: 'test displayname',
          description: 'test descr',
          visibility: PUBLIC,
          link: 'google.com',
          managers: [],
          viewers: [],
          folders: []
        },
        (error, contentItem) => {
          assert.ok(!error);
          contentItems.push(contentItem);
          done();
        }
      );
    });
  });
};

/**
 * Create the content within a tenant
 *
 * @param  {Tenant}     tenant          The tenant to setup
 * @param  {Function}   callback        Standard callback function
 * @throws {Error}                      An assertion error is thrown if something does not get created properly
 * @api private
 */
const _setupTenant = function (tenant, callback) {
  _createMultiPrivacyContent(tenant.adminRestContext, (publicContent, loggedinContent, privateContent) => {
    tenant.publicContent = publicContent;
    tenant.loggedinContent = loggedinContent;
    tenant.privateContent = privateContent;
    return callback();
  });
};

/**
 * Set up content of all privacies using the given rest context
 *
 * @param  {RestContext}    restCtx         The rest context to use
 * @param  {Function}       callback        Standard callback function
 * @throws {Error}                          An assertion error is thrown if something does not get created properly
 * @api private
 */
const _createMultiPrivacyContent = function (restCtx, callback) {
  _createContentWithVisibility(restCtx, 'public', (publicContent) => {
    _createContentWithVisibility(restCtx, 'loggedin', (loggedinContent) => {
      _createContentWithVisibility(restCtx, 'private', (privateContent) => {
        return callback(publicContent, loggedinContent, privateContent);
      });
    });
  });
};

/**
 * Create a piece of content with the specified visibility
 *
 * @param  {RestContext}    restCtx             The rest context to use
 * @param  {String}         visibility          The visibility of the user
 * @param  {Function}       callback            Standard callback function
 * @param  {Content}        callback.content    The piece of content that was created
 * @throws {Error}                              An assertion error is thrown if something does not get created properly
 * @api private
 */
const _createContentWithVisibility = function (restCtx, visibility, callback) {
  const randomId = format('%s-%s', visibility, ShortId.generate());
  RestAPI.Content.createLink(
    restCtx,
    {
      displayName: 'displayName-' + randomId,
      description: 'description-' + randomId,
      visibility,
      link: 'http://www.oaeproject.org',
      managers: null,
      viewers: null,
      folders: []
    },
    (error, content) => {
      assert.ok(!error);
      return callback(content);
    }
  );
};

/**
 * Create a set of test users and a collaborative document.
 * The `nrOfJoinedUsers` specifies how many users should join the document
 *
 * @param  {RestContext}    adminRestContext            An administrator rest context that can be used to create the users
 * @param  {Number}         nrOfUsers                   The number of users that should be created
 * @param  {Number}         nrOfJoinedUsers             The number of users that should be joined in the document. These will be the first `nrOfJoinedUsers` of the users hash
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Object}         callback.array              An array to include the following data below
 * @param  {Content}        callback.array.contentObj   The created collaborative document
 * @param  {Object}         callback.array.users        The created users
 * @param  {Object}         callback.array.user1        An object containing the user profile and a rest context for the first user of the set of users that was created
 * @param  {Object}         callback.data.user..        An object containing the user profile and a rest context for the next user of the set of users that was created
 */
const createCollabDoc = function (adminRestContext, nrOfUsers, nrOfJoinedUsers, callback) {
  TestsUtil.generateTestUsers(adminRestContext, nrOfUsers, (error, users) => {
    assert.ok(!error);

    const userIds = map(path(['user', 'id']), users);
    const userValues = users;

    // Create a collaborative document where all the users are managers
    const name = TestsUtil.generateTestUserId('collabdoc');

    RestAPI.Content.createCollabDoc(
      userValues[0].restContext,
      name,
      'description',
      'public',
      userIds,
      [],
      [],
      [],
      (error, contentObject) => {
        assert.ok(!error);

        // Create a function that will get executed once each user has joined the document
        const done = _.after(nrOfJoinedUsers, () => {
          return callback(null, _.union([contentObject, users], userValues));
        });

        // If no user should join the document we can return immediately
        if (nrOfJoinedUsers === 0) {
          return done();
        }

        // Join the collab doc for `nrOfJoinedUsers` users
        const joinCollabDoc = function (i) {
          const restCtx = userValues[i].restContext;
          // eslint-disable-next-line no-unused-vars
          RestAPI.Content.joinCollabDoc(restCtx, contentObject.id, (error, data) => {
            assert.ok(!error);
            done();
          });
        };

        for (let i = 0; i < nrOfJoinedUsers; i++) {
          joinCollabDoc(i);
        }
      }
    );
  });
};

/**
 * Publish a collaborative document. This function will mimick Etherpad's
 * publishing behaviour by sending the appropriate message to Redis
 *
 * @param  {String}     contentId   The ID of the content item
 * @param  {String}     userId      The ID of the user who will be publishing the collaborative document
 * @param  {Function}   callback    Standard callback function
 * @throws {Error}                  An assertion error is thrown when something unexpected occurs
 */
const publishCollabDoc = function (contentId, userId, callback) {
  const data = {
    contentId,
    userId
  };
  MQ.submit(ContentConstants.queue.ETHERPAD_PUBLISH, JSON.stringify(data), (error) => {
    assert.ok(!error);
  });

  MqTestUtil.whenTasksEmpty(ContentConstants.queue.ETHERPAD_PUBLISH, () => {
    MqTestUtil.whenTasksEmpty(ContentConstants.queue.ETHERPAD_PUBLISH_PROCESSING, callback);
  });
};

/**
 * Create a set of test users and a collaborative spreadsheet.
 * The `nrOfJoinedUsers` specifies how many users should join the spreadsheet
 *
 * @param  {RestContext}    adminRestContext        An administrator rest context that can be used to create the users
 * @param  {Number}         nrOfUsers               The number of users that should be created
 * @param  {Number}         nrOfJoinedUsers         The number of users that should be joined in the spreadsheet. These will be the first `nrOfJoinedUsers` of the users hash
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Object}         callback.array               An object to include the following data below
 * @param  {Content}        callback.array.contentObj    The created collaborative spreadsheet
 * @param  {Object}         callback.array.users         The created users
 * @param  {Object}         callback.array.user1         An object containing the user profile and a rest context for the first user of the set of users that was created
 * @param  {Object}         callback.user..             An object containing the user profile and a rest context for the next user of the set of users that was created
 */
const createCollabsheet = function (adminRestContext, nrOfUsers, nrOfJoinedUsers, callback) {
  TestsUtil.generateTestUsers(adminRestContext, nrOfUsers, function (error, users) {
    assert.ok(!error);

    const VISIBILITY_PUBLIC = 'public';
    const userIds = map(path(['user', 'id']), users);
    const userValues = users;

    // Create a collaborative document where all the users are managers
    const name = TestsUtil.generateTestUserId('collabsheet');

    RestAPI.Content.createCollabsheet(
      userValues[0].restContext,
      name,
      'description',
      VISIBILITY_PUBLIC,
      userIds,
      [],
      [],
      [],
      function (error, content) {
        assert.ok(!error);

        const restContexts = _.pluck(userValues, 'restContext');
        async.each(
          restContexts,
          (eachUserToJoin, exit) => {
            RestAPI.Content.joinCollabDoc(eachUserToJoin, content.id, (error, data) => {
              if (error) exit(error);

              assert.ok(!error);
              exit(null, data);
            });
          },
          (error_) => {
            if (error_) return callback(error_);
            return callback(null, _.union([content, users], userValues));
          }
        );
      }
    );
  });
};

/**
 * Edit a spreadsheet
 *
 * @param {Object}        editor                  The user making that edit
 * @param {Object}        collabsheet             The collaborative spreadsheet
 * @oaran {Content}       content                 The content to write on the spreadsheet
 * @param {Function}      callback                Standard callback function
 * @param {Object}        callback.err            An  error that occurred, if any
 * @param {Object}        callback.jsonExport     The content of the spreadsheet in JSON format
 */
const editAndPublishCollabSheet = (editor, collabsheet, content, callback) => {
  setSheetContents(collabsheet.ethercalcRoomId, content, (error) => {
    assert.ok(!error);

    getJSON(collabsheet.ethercalcRoomId, (error, jsonExport) => {
      assert.ok(!error);
      return callback(null, jsonExport);
    });
  });
};

/**
 * Create a collaborative spreadsheet.
 *
 * @param  {Object}    		  creator                     A user that can be used to create the spreadsheet
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Content}        callback.contentObj     		The created collaborative spreadsheet
 */
const createCollabsheetForUser = function (creator, callback) {
  const name = TestsUtil.generateTestUserId('collabsheet');
  RestAPI.Content.createCollabsheet(
    creator.restContext,
    name,
    'description',
    'public',
    creator.userId,
    [],
    [],
    [],
    function (error, contentObject) {
      assert.ok(!error);

      RestAPI.Content.joinCollabDoc(creator.restContext, contentObject.id, function (error /* data */) {
        if (error) return callback(error);

        assert.ok(!error);
        return callback(null, contentObject);
      });
    }
  );
};

/**
 * Purge the members library. See @LibraryTestUtil.assertPurgeFreshLibrary for more details
 *
 * @param  {String}     contentId   The id of the content item whose members library to purge
 * @param  {Function}   callback    Standard callback function
 * @throws {AssertionError}         Thrown if there is an issue purging the library
 * @api private
 */
const _purgeMembersLibrary = function (contentId, callback) {
  LibraryTestUtil.assertPurgeFreshLibraries(ContentConstants.library.MEMBERS_LIBRARY_INDEX_NAME, [contentId], callback);
};

export {
  setupMultiTenantPrivacyEntities,
  assertCreateLinkSucceeds,
  assertCreateLinkFails,
  assertGetContentFails,
  assertDeleteContentSucceeds,
  assertEtherpadContentEquals,
  assertGetContentMembersFails,
  assertGetContentMembersSucceeds,
  assertUpdateContentMembersFails,
  assertUpdateContentMembersSucceeds,
  assertShareContentFails,
  assertShareContentSucceeds,
  getAllContentMembers,
  assertGetAllContentLibrarySucceeds,
  assertGetContentLibrarySucceeds,
  generateTestLinks,
  publishCollabDoc,
  createCollabDoc,
  createCollabsheet,
  createCollabsheetForUser,
  editAndPublishCollabSheet
};
