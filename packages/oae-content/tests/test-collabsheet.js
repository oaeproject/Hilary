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

describe('Collaborative spreadsheets', function () {
  // Rest context that can be used every time we need to make a request as a tenant admin
  let camAdminRestContext = null;

  /**
   * Function that will fill up the anonymous and tenant admin REST context
   */
  before(function (callback) {
    // Fill up tenant admin rest contexts
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);

    return callback();
  });

  /**
   * Test that verifies the request parameters get validated when joining a collaborative spreadsheet
   */
  it('verify basic parameter validation when joining a collaborative spreadsheet', function (callback) {
    generateTestUsers(camAdminRestContext, 1, function (error, users) {
      assert.notExists(error);
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
        (error, link) => {
          assert.notExists(error);

          joinCollabDoc(asJohnDoe, link.id, (error_) => {
            assert.strictEqual(error_.code, 400);

            createCollabsheet(
              asJohnDoe,
              'Test sheet',
              'description',
              PRIVATE,
              NO_MANAGERS,
              NO_EDITORS,
              NO_VIEWERS,
              NO_FOLDERS,
              (error, contentObject) => {
                assert.notExists(error);

                joinCollabDoc(asJohnDoe, ' ', (error__) => {
                  assert.strictEqual(error__.code, 400);

                  joinCollabDoc(asJohnDoe, 'invalid-id', (error__) => {
                    assert.strictEqual(error__.code, 400);

                    // Test collabsheets can be joined
                    joinCollabDoc(asJohnDoe, contentObject.id, (error, data) => {
                      assert.notExists(error);
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
  it('verify joining a room respects the content permissions', function (callback) {
    generateTestUsers(camAdminRestContext, 3, function (error, users) {
      assert.notExists(error);

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
        (error, contentObject) => {
          assert.notExists(error);

          joinCollabDoc(asHomer, contentObject.id, (error, data) => {
            assert.notExists(error);
            assert.ok(data);

            // marge has no access yet, so joining should result in a 401
            joinCollabDoc(asMarge, contentObject.id, (error, data) => {
              assert.strictEqual(error.code, 401);
              assert.isNotOk(data);

              // Share it with marge, viewers still can't edit(=join) though
              const members = {};
              members[marge.user.id] = VIEWER;

              updateMembers(asHomer, contentObject.id, members, (error_) => {
                assert.notExists(error_);

                // marge can see the spreadsheet, but he cannot join in and start editing it
                joinCollabDoc(asMarge, contentObject.id, function (error, data) {
                  assert.strictEqual(error.code, 401);
                  assert.isNotOk(data);

                  // Now that we make marge a manager, he should be able to join
                  members[marge.user.id] = MANAGER;
                  updateMembers(asHomer, contentObject.id, members, (error_) => {
                    assert.notExists(error_);

                    // marge should now be able to access it
                    joinCollabDoc(asMarge, contentObject.id, (error, data) => {
                      assert.notExists(error);
                      assert.ok(data);

                      // Add Stuart as an editor, he should be able to join
                      members[bart.user.id] = EDITOR;
                      updateMembers(asHomer, contentObject.id, members, (error_) => {
                        assert.notExists(error_);

                        // Stuart should now be able to access it
                        joinCollabDoc(asBart, contentObject.id, (error, data) => {
                          assert.notExists(error);
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
  it('verify that ethercalc related properties cannot be set on the content object', function (callback) {
    generateTestUsers(camAdminRestContext, 1, function (error, users) {
      assert.notExists(error);

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
        (error, contentObject) => {
          assert.notExists(error);

          // Try updating any of the ethercalc properties
          updateContent(asHomer, contentObject.id, { ethercalcRoomId: 'bleh' }, (error_) => {
            assert.strictEqual(error_.code, 400);

            // Update a regular property
            updateContent(asHomer, contentObject.id, { displayName: 'bleh' }, (error, updatedContentObject) => {
              assert.notExists(error);
              assert.isNotOk(updatedContentObject.downloadPath);

              // Double-check the the content item didn't change
              getContent(asHomer, contentObject.id, (error, latestContentObject) => {
                assert.notExists(error);
                assert.strictEqual(contentObject.ethercalcGroupId, latestContentObject.ethercalcGroupId);
                assert.strictEqual(contentObject.ethercalcRoomId, latestContentObject.ethercalcRoomId);

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
  it('verify ethercalc spreadsheet starts with empty spreadsheet', function (callback) {
    // Create a collaborative spreadsheet to test with
    ContentTestUtil.createCollabsheet(camAdminRestContext, 1, 1, (error, collabsheet) => {
      assert.notExists(error);

      const { 0: content } = collabsheet;
      // Ensure the content of the ethercalc starts as empty
      Ethercalc.getHTML(content.ethercalcRoomId, function (error, html) {
        assert.notExists(error);
        assert.strictEqual(Ethercalc.isContentEmpty(html), true);

        return callback();
      });
    });
  });
});
