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

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import _ from 'underscore';

import * as ContentDAO from 'oae-content/lib/internal/dao';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';

const PRIVATE = 'private';

describe('Content DAO', () => {
  // Rest contexts that will be used for requests
  let anonymousRestContext = null;
  let camAdminRestContext = null;

  /**
   * Function that will fill up the anonymous and tenant admin REST context
   */
  before(callback => {
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);

    // Log in the tenant admin so their cookie jar is set up appropriately
    RestAPI.User.getMe(camAdminRestContext, (err, meObj) => {
      assert.ok(!err);
      callback();
    });
  });

  /**
   * @return {Stream} Returns a stream that points to an image
   */
  const getStream = function() {
    return fs.createReadStream(path.join(__dirname, '/data/apereo.jpg'));
  };

  /**
   * Test that verifies the iterateAll functionality of the content DAO
   */
  it('verify ContentDAO iterateAll functionality', callback => {
    const contentName = TestsUtil.generateTestUserId('content-name');
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
      assert.ok(!err);

      const mrvisser = users[_.keys(users)[0]].user;
      const mrvisserRestCtx = users[_.keys(users)[0]].restContext;

      // Create the content item we will iterate over
      RestAPI.Content.createLink(
        mrvisserRestCtx,
        contentName,
        contentName,
        'public',
        'http://google.ca',
        null,
        null,
        [],
        (err, link) => {
          assert.ok(!err);

          let foundLink = false;

          /*!
           * Verifies that only the contentId is returned in the content row
           */
          const _onEach = function(contentRows, done) {
            // Ensure we only get the contentId of the content item
            _.each(contentRows, contentRow => {
              assert.strictEqual(
                _.keys(contentRow).length,
                1,
                'Expected to have only one key on the content row, the content id'
              );
              assert.ok(contentRow.contentId, 'Expected the row to have contentId');

              // Remember whether or not we found the link
              if (contentRow.contentId === link.id) {
                foundLink = true;
              }
            });

            done();
          };

          // Verify the link information when we iterate over it
          ContentDAO.Content.iterateAll(null, 100, _onEach, err => {
            assert.ok(!err, JSON.stringify(err, null, 4));
            assert.ok(foundLink, 'Expected to find the link we just created');

            foundLink = false;

            /*!
             * Verifies that only the contentId and displayName of the content rows are returned, and that they are
             * accurate.
             */
            const _onEach = function(contentRows, done) {
              // Ensure we only get the contentId and displayName of the content item
              _.each(contentRows, contentRow => {
                assert.strictEqual(
                  _.keys(contentRow).length,
                  2,
                  'Expected to have only two keys on the content row, the content id and displayName'
                );
                assert.ok(contentRow.contentId, 'Expected the row to have contentId');

                // Remember whether or not we found the link
                if (contentRow.contentId === link.id) {
                  // Verify the displayName is accurate
                  assert.strictEqual(contentRow.displayName, contentName);
                  foundLink = true;
                }
              });

              done();
            };

            // Do the same thing but fetch the contentId and the displayName, and ensure they match
            ContentDAO.Content.iterateAll(['contentId', 'displayName'], 100, _onEach, err => {
              assert.ok(!err, JSON.stringify(err, null, 4));
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
  it('verify RevisionDAO getAllRevisionsForContent functionality', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
      assert.ok(!err);

      const mrvisser = _.values(users)[0];
      RestAPI.Content.createFile(
        mrvisser.restContext,
        {
          displayName: 'Test Content 1',
          description: 'Test content description 1',
          visibility: PRIVATE,
          file: getStream,
          managers: [],
          viewers: [],
          folders: []
        },
        (err, contentObj) => {
          assert.ok(!err);
          assert.ok(contentObj);

          RestAPI.Content.updateFileBody(mrvisser.restContext, contentObj.id, getStream, err => {
            assert.ok(!err);
            RestAPI.Content.updateFileBody(mrvisser.restContext, contentObj.id, getStream, err => {
              assert.ok(!err);
              RestAPI.Content.updateFileBody(mrvisser.restContext, contentObj.id, getStream, err => {
                assert.ok(!err);
                RestAPI.Content.updateFileBody(mrvisser.restContext, contentObj.id, getStream, err => {
                  assert.ok(!err);

                  ContentDAO.Revisions.getAllRevisionsForContent([contentObj.id], (err, data) => {
                    assert.ok(!err);
                    assert.ok(data[contentObj.id]);
                    assert.ok(data[contentObj.id].length, 5);
                    _.each(data[contentObj.id], revision => {
                      assert.strictEqual(revision.contentId, contentObj.id);
                      assert.strictEqual(revision.filename, 'apereo.jpg');
                    });
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
