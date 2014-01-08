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

var _ = require('underscore');
var assert = require('assert');

var AuthzUtil = require('oae-authz/lib/util');
var RestAPI = require('oae-rest');
var SearchTestsUtil = require('oae-search/lib/test/util');
var TestsUtil = require('oae-tests');

describe('Discussion Search', function() {

    // REST contexts we can use to do REST requests
    var anonymousRestContext = null;
    var camAdminRestContext = null;

    before(function(callback) {
        anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
        camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
        callback();
    });

    /**
     * Search for a discussion in a result set.
     *
     * @param  {Document[]} results         An array of search documents
     * @param  {String}     discussionId    The id of the discussion we should look for.
     * @return {Document}                   The discussion with id `discussionId` (or null if it could not be found).
     */
    var _getDocument = function(results, discussionId) {
        return _.find(results, function(result) { return result.id === discussionId; });
    };

    describe('Indexing', function() {
        /**
         * A test that verifies a discussion item is indexable and searchable.
         */
        it('verify indexing of a discussion', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestContext, 1, function(err, user) {
                assert.ok(!err);
                user = _.values(user)[0];

                var randomText = TestsUtil.generateRandomText(5);
                RestAPI.Discussions.createDiscussion(user.restContext, randomText, randomText, 'public', null, null, function(err, discussion) {
                    assert.ok(!err);

                    SearchTestsUtil.searchAll(user.restContext, 'general', null, {'resourceTypes': 'discussion', 'q': randomText}, function(err, results) {
                        assert.ok(!err);

                        var doc = _getDocument(results.results, discussion.id);
                        assert.ok(doc);
                        assert.equal(doc.displayName, randomText);
                        assert.equal(doc.description, randomText);
                        assert.equal(doc.profilePath, '/discussion/' + global.oaeTests.tenants.cam.alias + '/' + AuthzUtil.getResourceFromId(discussion.id).resourceId);
                        callback();
                    });
                });
            });
        });

        /**
         * Verifies that updating a discussion, updates the search index
         */
        it('verify updating the metadata for a discussion, updates the index', function(callback) {
            TestsUtil.generateTestUsers(camAdminRestContext, 1, function(err, user) {
                assert.ok(!err);
                user = _.values(user)[0];

                var randomText1 = TestsUtil.generateRandomText(5);
                var randomText2 = TestsUtil.generateRandomText(5);
                RestAPI.Discussions.createDiscussion(user.restContext, randomText1, randomText1, 'public', null, null, function(err, discussion) {
                    assert.ok(!err);

                    RestAPI.Discussions.updateDiscussion(user.restContext, discussion.id, {'displayName': randomText2, 'description': randomText2 }, function(err) {
                        assert.ok(!err);

                        SearchTestsUtil.searchAll(user.restContext, 'general', null, {'resourceTypes': 'discussion', 'q': randomText2}, function(err, results) {
                            assert.ok(!err);
                            var doc = _getDocument(results.results, discussion.id);
                            assert.ok(doc);
                            assert.equal(doc.displayName, randomText2);
                            assert.equal(doc.description, randomText2);
                            assert.equal(doc.profilePath, '/discussion/' + global.oaeTests.tenants.cam.alias + '/' + AuthzUtil.getResourceFromId(discussion.id).resourceId);
                            callback();
                        });
                    });
                });
            });
        });
    });
});