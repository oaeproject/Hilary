/*!
 * Copyright 2012 Sakai Foundation (SF) Licensed under the
 * Educational Community License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://www.osedu.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS"
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

var _ = require('underscore');
var assert = require('assert');

var ActivityTestsUtil = require('oae-activity/lib/test/util');
var RestAPI = require('oae-rest');
var RestContext = require('oae-rest/lib/model').RestContext;
var RestUtil = require('oae-rest/lib/util');
var TestsUtil = require('oae-tests/lib/util');

var camAdminRestContext = null;

/**
 * Function that will fill up the anonymous and admin REST context
 */
before(function(callback) {
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    callback();
});

describe('Following', function() {

    it('verify we can follow someone', function(callback) {
        TestsUtil.generateTestUsers(camAdminRestContext, 2, function(err, testUsers) {
            assert.ok(!err);
            var followerUser = testUsers[_.keys(testUsers)[0]];
            var followedUser = testUsers[_.keys(testUsers)[1]];

            RestUtil.RestRequest(followerUser.restContext, '/api/following/' + followedUser.user.id + '/follow', 'POST', null, function(err) {
                assert.ok(!err);

                RestUtil.RestRequest(followerUser.restContext, '/api/following/' + followerUser.user.id + '/following', 'GET', null, function(err, data) {
                    assert.ok(!err);
                    assert.ok(data);
                    assert.equal(data.length, 1);
                    assert.equal(data[0].id, followedUser.user.id);
                    callback();
                });
            });
        });
    });

    it('verify following activity and notifications', function(callback) {
        TestsUtil.generateTestUsers(camAdminRestContext, 2, function(err, testUsers) {
            assert.ok(!err);
            var followerUser = testUsers[_.keys(testUsers)[0]];
            var followedUser = testUsers[_.keys(testUsers)[1]];

            RestUtil.RestRequest(followerUser.restContext, '/api/following/' + followedUser.user.id + '/follow', 'POST', null, function(err) {
                assert.ok(!err);

                ActivityTestsUtil.collectAndGetActivityStream(followerUser.restContext, followerUser.user.id, null, function(err, stream) {
                    assert.ok(!err);
                    assert.equal(stream.items[0].actor['oae:id'], followerUser.user.id);
                    assert.equal(stream.items[0].object['oae:id'], followedUser.user.id);

                    ActivityTestsUtil.collectAndGetNotificationStream(followedUser.restContext, null, function(err, stream) {
                        assert.ok(!err);
                        assert.equal(stream.items[0].actor['oae:id'], followerUser.user.id);
                        assert.equal(stream.items[0].object['oae:id'], followedUser.user.id);
                        return setTimeout(callback, 5000);
                    });
                });
            });
        });
    });

});