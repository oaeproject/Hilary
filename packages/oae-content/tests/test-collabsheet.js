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

import { assert } from 'chai';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import * as ContentTestUtil from 'oae-content/lib/test/util';
import * as Ethercalc from 'oae-content/lib/internal/ethercalc';

const { generateTestUserId, generateTestUsers } = TestsUtil;
const { updateContent, getContent, joinCollabDoc, createLink, createCollabsheet, updateMembers } = RestAPI.Content;

const NO_MANAGERS = [];
const NO_VIEWERS = [];
const NO_EDITORS = [];
const NO_FOLDERS = [];
const PUBLIC = 'public';
const PRIVATE = 'private';
const EDITOR = 'editor';
const MANAGER = 'manager';
const VIEWER = 'viewer';

describe('Collaborative spreadsheets', function() {
  // Rest context that can be used every time we need to make a request as a tenant admin
  let camAdminRestContext = null;

  /**
   * Function that will fill up the anonymous and tenant admin REST context
   */
  before(function(callback) {
    // Fill up tenant admin rest contexts
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);

    return callback();
  });

  /**
   * Test that verifies the request parameters get validated when joining a collaborative spreadsheet
   */
  it('verify basic parameter validation when joining a collaborative spreadsheet', function(callback) {
    generateTestUsers(camAdminRestContext, 1, function(err, users) {
      assert.notExists(err);
      const { 0: johnDoe } = users;
      const asJohnDoe = johnDoe.restContext;

      // Check that we can't join a content item that's not collaborative

      createLink(
        asJohnDoe,
        {
          displayName: 'Test link',
          description: 'Test description',
          PUBLIC,
          link: 'http://www.oaeproject.org/',
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (err, link) => {
          assert.notExists(err);

          joinCollabDoc(asJohnDoe, link.id, err => {
            assert.strictEqual(err.code, 400);

            createCollabsheet(
              asJohnDoe,
              'Test sheet',
              'description',
              PRIVATE,
              NO_MANAGERS,
              NO_EDITORS,
              NO_VIEWERS,
              NO_FOLDERS,
              (err, contentObj) => {
                assert.notExists(err);

                joinCollabDoc(asJohnDoe, ' ', err => {
                  assert.strictEqual(err.code, 400);

                  joinCollabDoc(asJohnDoe, 'invalid-id', err => {
                    assert.strictEqual(err.code, 400);

                    // Test collabsheets can be joined
                    joinCollabDoc(asJohnDoe, contentObj.id, (err, data) => {
                      assert.notExists(err);
                      assert.ok(data);

                      callback();
                    });
                  });
                });
              }
            );
          });
        }
      );
    });
  });

  /**
   * Test that verifies that you can only join a collaborative spreadsheet if you have manager or editor permissions
   */
  it('verify joining a room respects the content permissions', function(callback) {
    generateTestUsers(camAdminRestContext, 3, function(err, users) {
      assert.notExists(err);

      const { 0: homer, 1: marge, 2: bart } = users;
      const asHomer = homer.restContext;
      const asMarge = marge.restContext;
      const asBart = bart.restContext;

      // homer creates a collaborative spreadsheet that's private
      const name = generateTestUserId();
      createCollabsheet(
        asHomer,
        name,
        'description',
        PRIVATE,
        NO_MANAGERS,
        NO_EDITORS,
        NO_VIEWERS,
        NO_FOLDERS,
        (err, contentObj) => {
          assert.notExists(err);

          joinCollabDoc(asHomer, contentObj.id, (err, data) => {
            assert.notExists(err);
            assert.ok(data);

            // marge has no access yet, so joining should result in a 401
            joinCollabDoc(asMarge, contentObj.id, (err, data) => {
              assert.strictEqual(err.code, 401);
              assert.isNotOk(data);

              // Share it with marge, viewers still can't edit(=join) though
              const members = {};
              members[marge.user.id] = VIEWER;

              updateMembers(asHomer, contentObj.id, members, err => {
                assert.notExists(err);

                // marge can see the spreadsheet, but he cannot join in and start editing it
                joinCollabDoc(asMarge, contentObj.id, function(err, data) {
                  assert.strictEqual(err.code, 401);
                  assert.isNotOk(data);

                  // Now that we make marge a manager, he should be able to join
                  members[marge.user.id] = MANAGER;
                  updateMembers(asHomer, contentObj.id, members, err => {
                    assert.notExists(err);

                    // marge should now be able to access it
                    joinCollabDoc(asMarge, contentObj.id, (err, data) => {
                      assert.notExists(err);
                      assert.ok(data);

                      // Add Stuart as an editor, he should be able to join
                      members[bart.user.id] = EDITOR;
                      updateMembers(asHomer, contentObj.id, members, err => {
                        assert.notExists(err);

                        // Stuart should now be able to access it
                        joinCollabDoc(asBart, contentObj.id, (err, data) => {
                          assert.notExists(err);
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
        }
      );
    });
  });

  /**
   * Test that verifies that `ethercalcRoomId` cannot be set.
   */
  it('verify that ethercalc related properties cannot be set on the content object', function(callback) {
    generateTestUsers(camAdminRestContext, 1, function(err, users) {
      assert.notExists(err);

      const { 0: homer } = users;
      const asHomer = homer.restContext;
      const name = generateTestUserId('collabsheet');

      createCollabsheet(
        asHomer,
        name,
        'description',
        'public',
        NO_MANAGERS,
        NO_EDITORS,
        NO_VIEWERS,
        NO_FOLDERS,
        (err, contentObj) => {
          assert.notExists(err);

          // Try updating any of the ethercalc properties
          updateContent(asHomer, contentObj.id, { ethercalcRoomId: 'bleh' }, err => {
            assert.strictEqual(err.code, 400);

            // Update a regular property
            updateContent(asHomer, contentObj.id, { displayName: 'bleh' }, (err, updatedContentObj) => {
              assert.notExists(err);
              assert.isNotOk(updatedContentObj.downloadPath);

              // Double-check the the content item didn't change
              getContent(asHomer, contentObj.id, (err, latestContentObj) => {
                assert.notExists(err);
                assert.strictEqual(contentObj.ethercalcGroupId, latestContentObj.ethercalcGroupId);
                assert.strictEqual(contentObj.ethercalcRoomId, latestContentObj.ethercalcRoomId);

                return callback();
              });
            });
          });
        }
      );
    });
  });

  /**
   * Test that verifies that a collabsheet is created and initialized with no content
   */
  it('verify ethercalc spreadsheet starts with empty spreadsheet', function(callback) {
    // Create a collaborative spreadsheet to test with
    ContentTestUtil.createCollabsheet(camAdminRestContext, 1, 1, (err, collabsheet) => {
      assert.notExists(err);

      const { 0: content } = collabsheet;
      // Ensure the content of the ethercalc starts as empty
      Ethercalc.getHTML(content.ethercalcRoomId, function(err, html) {
        assert.notExists(err);
        assert.strictEqual(Ethercalc.isContentEmpty(html), true);

        return callback();
      });
    });
  });
});
