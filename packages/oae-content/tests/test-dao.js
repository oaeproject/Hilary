/*
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

import { assert } from 'chai';
import fs from 'fs';
import path from 'path';
import { equals, keys, forEach } from 'ramda';

import * as ContentDAO from 'oae-content/lib/internal/dao';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';

const { iterateAll } = ContentDAO.Content;
const { createFile, updateFileBody } = RestAPI.Content;
const { generateTestUsers, generateTestUserId, createTenantAdminRestContext } = TestsUtil;
const { createLink } = RestAPI.Content;
const { getMe } = RestAPI.User;
const { getAllRevisionsForContent } = ContentDAO.Revisions;

const NO_MANAGERS = [];
const NO_FOLDERS = [];
const NO_VIEWERS = [];
const PUBLIC = 'public';
const PRIVATE = 'private';

describe('Content DAO', () => {
  // Rest contexts that will be used for requests
  let asCambridgeTenantAdmin = null;

  /**
   * Function that will fill up the anonymous and tenant admin REST context
   */
  before((callback) => {
    asCambridgeTenantAdmin = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);

    // Log in the tenant admin so their cookie jar is set up appropriately
    getMe(asCambridgeTenantAdmin, (error /* , me */) => {
      assert.notExists(error);
      callback();
    });
  });

  /**
   * @return {Stream} Returns a stream that points to an image
   */
  const getStream = () => fs.createReadStream(path.join(__dirname, '/data/apereo.jpg'));

  /**
   * Test that verifies the iterateAll functionality of the content DAO
   */
  it('verify ContentDAO iterateAll functionality', (callback) => {
    const contentName = generateTestUserId('content-name');
    generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
      assert.notExists(error);

      const { 0: homer } = users;
      const asHomer = homer.restContext;

      // Create the content item we will iterate over
      createLink(
        asHomer,
        {
          displayName: contentName,
          description: contentName,
          visibility: PUBLIC,
          link: 'http://google.ca',
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (error, link) => {
          assert.notExists(error);

          let foundLink = false;

          /*!
           * Verifies that only the contentId is returned in the content row
           */
          const _onEach = function (contentRows, done) {
            // Ensure we only get the contentId of the content item
            forEach((contentRow) => {
              assert.lengthOf(keys(contentRow), 1, 'Expected to have only one key on the content row, the content id');
              assert.ok(contentRow.contentId, 'Expected the row to have contentId');

              // Remember whether or not we found the link
              if (equals(contentRow.contentId, link.id)) {
                foundLink = true;
              }
            }, contentRows);

            done();
          };

          // Verify the link information when we iterate over it
          iterateAll(null, 100, _onEach, (error_) => {
            assert.isNotOk(error_, JSON.stringify(error_, null, 4));
            assert.ok(foundLink, 'Expected to find the link we just created');

            foundLink = false;

            /*!
             * Verifies that only the contentId and displayName of the content rows are returned, and that they are
             * accurate.
             */
            const _onEach = function (contentRows, done) {
              // Ensure we only get the contentId and displayName of the content item
              forEach((contentRow) => {
                assert.lengthOf(
                  keys(contentRow),
                  2,
                  'Expected to have only two keys on the content row, the content id and displayName'
                );
                assert.ok(contentRow.contentId, 'Expected the row to have contentId');

                // Remember whether or not we found the link
                if (equals(contentRow.contentId, link.id)) {
                  // Verify the displayName is accurate
                  assert.strictEqual(contentRow.displayName, contentName);
                  foundLink = true;
                }
              }, contentRows);

              done();
            };

            // Do the same thing but fetch the contentId and the displayName, and ensure they match
            iterateAll(['contentId', 'displayName'], 100, _onEach, (error_) => {
              assert.isNotOk(error_, JSON.stringify(error_, null, 4));
              assert.ok(foundLink, 'Expected to find the link we just created');
              return callback();
            });
          });
        }
      );
    });
  });

  /**
   * Test that verifies the RevisionDAO getAllRevisionsForContent functionality
   */
  it('verify RevisionDAO getAllRevisionsForContent functionality', (callback) => {
    generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
      assert.notExists(error);

      const { 0: homer } = users;
      const asHomer = homer.restContext;

      createFile(
        asHomer,
        {
          displayName: 'Test Content 1',
          description: 'Test content description 1',
          visibility: PRIVATE,
          file: getStream,
          managers: NO_MANAGERS,
          viewers: NO_VIEWERS,
          folders: NO_FOLDERS
        },
        (error, contentObject) => {
          assert.notExists(error);
          assert.ok(contentObject);

          updateFileBody(asHomer, contentObject.id, getStream, (error_) => {
            assert.notExists(error_);
            updateFileBody(asHomer, contentObject.id, getStream, (error_) => {
              assert.notExists(error_);
              updateFileBody(asHomer, contentObject.id, getStream, (error_) => {
                assert.notExists(error_);
                updateFileBody(asHomer, contentObject.id, getStream, (error_) => {
                  assert.notExists(error_);

                  getAllRevisionsForContent([contentObject.id], (error, data) => {
                    assert.notExists(error);
                    assert.ok(data[contentObject.id]);
                    assert.ok(data[contentObject.id].length, 5);

                    forEach((revision) => {
                      assert.strictEqual(revision.contentId, contentObject.id);
                      assert.strictEqual(revision.filename, 'apereo.jpg');
                    }, data[contentObject.id]);

                    return callback();
                  });
                });
              });
            });
          });
        }
      );
    });
  });
});
