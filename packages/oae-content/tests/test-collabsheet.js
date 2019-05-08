/*
 * Copyright 2018 Apereo Foundation (AF) Licensed under the
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
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import * as ContentTestUtil from 'oae-content/lib/test/util';
import * as Ethercalc from 'oae-content/lib/internal/ethercalc';

import _ from 'underscore';

describe('Collaborative spreadsheets', function() {
  // Rest context that can be used every time we need to make a request as an anonymous user
  let anonymousRestContext = null;
  // Rest context that can be used every time we need to make a request as a tenant admin
  let camAdminRestContext = null;

  // Once the server has started up, get the ethercalc configuration and store it in this variable
  let testConfig = null;

  /**
   * Function that will fill up the anonymous and tenant admin REST context
   */
  before(function(callback) {
    // Fill up anonymous rest context
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    // Fill up tenant admin rest contexts
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    // Get the original test config
    testConfig = Ethercalc.getConfig();
    return callback();
  });

  /**
   * Test that verifies the request parameters get validated when joining a collaborative spreadsheet
   */
  it('verify basic parameter validation when joining a collaborative spreadsheet', function(callback) {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, function(err, users) {
      assert.ok(!err);
      const ctx = _.values(users)[0].restContext;

      // Check that we can't join a content item that's not collaborative
      RestAPI.Content.createLink(
        ctx,
        'Test link',
        'Test description',
        'public',
        'http://www.oaeproject.org/',
        [],
        [],
        [],
        function(err, link) {
          assert.ok(!err);

          RestAPI.Content.joinCollabDoc(ctx, link.id, function(err) {
            assert.equal(err.code, 400);

            RestAPI.Content.createCollabsheet(ctx, 'Test sheet', 'description', 'private', [], [], [], [], function(
              err,
              contentObj
            ) {
              assert.ok(!err);

              RestAPI.Content.joinCollabDoc(ctx, ' ', function(err) {
                assert.equal(err.code, 400);

                RestAPI.Content.joinCollabDoc(ctx, 'invalid-id', function(err) {
                  assert.equal(err.code, 400);

                  // Test collabsheets can be joined
                  RestAPI.Content.joinCollabDoc(ctx, contentObj.id, function(err, data) {
                    assert.ok(!err);
                    assert.ok(data);
                    callback();
                  });
                });
              });
            });
          });
        }
      );
    });
  });

  /**
   * Test that verifies that you can only join a collaborative spreadsheet if you have manager or editor permissions
   */
  it('verify joining a room respects the content permissions', function(callback) {
    TestsUtil.generateTestUsers(camAdminRestContext, 3, function(err, users) {
      assert.ok(!err);
      const simonCtx = _.values(users)[0].restContext;
      const brandenCtx = _.values(users)[1].restContext;
      const stuartCtx = _.values(users)[2].restContext;

      // Simon creates a collaborative spreadsheet that's private
      const name = TestsUtil.generateTestUserId();
      RestAPI.Content.createCollabsheet(simonCtx, name, 'description', 'private', [], [], [], [], function(
        err,
        contentObj
      ) {
        assert.ok(!err);

        RestAPI.Content.joinCollabDoc(simonCtx, contentObj.id, function(err, data) {
          assert.ok(!err);
          assert.ok(data);

          // Branden has no access yet, so joining should result in a 401
          RestAPI.Content.joinCollabDoc(brandenCtx, contentObj.id, function(err, data) {
            assert.equal(err.code, 401);
            assert.ok(!data);

            // Share it with branden, viewers still can't edit(=join) though
            const members = {};
            members[_.keys(users)[1]] = 'viewer';
            RestAPI.Content.updateMembers(simonCtx, contentObj.id, members, function(err) {
              assert.ok(!err);

              // Branden can see the spreadsheet, but he cannot join in and start editing it
              RestAPI.Content.joinCollabDoc(brandenCtx, contentObj.id, function(err, data) {
                assert.equal(err.code, 401);
                assert.ok(!data);

                // Now that we make Branden a manager, he should be able to join
                members[_.keys(users)[1]] = 'manager';
                RestAPI.Content.updateMembers(simonCtx, contentObj.id, members, function(err) {
                  assert.ok(!err);

                  // Branden should now be able to access it
                  RestAPI.Content.joinCollabDoc(brandenCtx, contentObj.id, function(err, data) {
                    assert.ok(!err);
                    assert.ok(data);

                    // Add Stuart as an editor, he should be able to join
                    members[_.keys(users)[2]] = 'editor';
                    RestAPI.Content.updateMembers(simonCtx, contentObj.id, members, function(err) {
                      assert.ok(!err);

                      // Stuart should now be able to access it
                      RestAPI.Content.joinCollabDoc(stuartCtx, contentObj.id, function(err, data) {
                        assert.ok(!err);
                        assert.ok(data);

                        return callback();
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies that `ethercalcRoomId` cannot be set.
   */
  it('verify that ethercalc related properties cannot be set on the content object', function(callback) {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, function(err, users) {
      assert.ok(!err);
      const simonCtx = _.values(users)[0].restContext;

      const name = TestsUtil.generateTestUserId('collabsheet');
      RestAPI.Content.createCollabsheet(simonCtx, name, 'description', 'public', [], [], [], [], function(
        err,
        contentObj
      ) {
        assert.ok(!err);

        // Try updating any of the ethercalc properties
        RestAPI.Content.updateContent(simonCtx, contentObj.id, { ethercalcRoomId: 'bleh' }, function(err) {
          assert.equal(err.code, 400);
          // Update a regular property
          RestAPI.Content.updateContent(simonCtx, contentObj.id, { displayName: 'bleh' }, function(
            err,
            updatedContentObj
          ) {
            assert.ok(!err);
            assert.ok(!updatedContentObj.downloadPath);

            // Double-check the the content item didn't change
            RestAPI.Content.getContent(simonCtx, contentObj.id, function(err, latestContentObj) {
              assert.ok(!err);
              assert.equal(contentObj.ethercalcGroupId, latestContentObj.ethercalcGroupId);
              assert.equal(contentObj.ethercalcRoomId, latestContentObj.ethercalcRoomId);
              return callback();
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies that a collabsheet is created and initialized with no content
   */
  it('verify ethercalc spreadsheet starts with empty spreadsheet', function(callback) {
    // Create a collaborative spreadsheet to test with
    ContentTestUtil.createCollabsheet(camAdminRestContext, 1, 1, (err, collabsheet) => {
      const [content, users, simon] = collabsheet;
      // Ensure the content of the ethercalc starts as empty
      Ethercalc.getHTML(content.ethercalcRoomId, function(err, html) {
        assert.ok(!err);
        assert.ok(Ethercalc.isContentEmpty(html));
        return callback();
      });
    });
  });
});
