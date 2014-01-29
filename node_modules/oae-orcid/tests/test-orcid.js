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

var ConfigTestUtil = require('oae-config/lib/test/util');
var OrcidConfig = require('oae-config').config('oae-orcid');
var OrcidDAO = require('oae-orcid/lib/internal/dao');
var PrincipalsAPI = require('oae-principals');
var RestAPI = require('oae-rest');
var RestContext = require('oae-rest/lib/model').RestContext;
var RestUtil = require('oae-rest/lib/util');
var TestsUtil = require('oae-tests');

// Mocking ORCID server
var server = null;
var port = null;

// Initialize some variables
var CREATED_ORCID_ID = null;
var ORCID_EMAIL = null;
var ORCID_ID = '1234-5678-9012-3456';

/**
 * Register routes for the mock API
 *
 * @param  {Function}  callback    Standard callback function
 */
var _createTestServer = function(callback) {

    // Create a new Express application to mock the ORCID API
    TestsUtil.createTestServer(function(_app, _server, _port) {
        server = _server;
        port = _port;

        // Mock ORCID token endpoint
        _app.post('/oauth/token', function(req, res) {
            res.send(200, {
                'access_token': ORCID_ID,
                'expires_in': Date.now() + 600000
            });
        });

        // Mock ORCID create record endpoint
        _app.post('/v1.1/orcid-profile', function(req, res) {
            var IdHashes = [];
            for (var i=0; i<4; i++) {
                IdHashes.push(Math.floor(Math.random() * 9999));
            }
            res.setHeader('location', 'http://localhost:' + port + '/' + IdHashes.join('-'));
            res.send(201);
        });

        // Mock ORCID search endpoint
        _app.get('/search/orcid-bio', function(req, res) {

            // Mock an ORCID profile
            var body = {
                'message-version': '1.1',
                'orcid-profile': {
                    'orcid': {
                        'value': ORCID_ID
                    }
                }
            };

            // Mock a query without results
            if (req.query.q !== 'email:' + ORCID_EMAIL) {
                body = {
                    'message-version': '1.1',
                    'orcid-search-results': {
                        'orcid-search-result': [],
                        'num-found': 0
                    }
                };
            }
            res.send(200, body);
        });

        // Mock ORCID public profile endpoint
        _app.get('/:id', function(req, res) {
            res.send(200, {
                'message-version': '1.1',
                'orcid-profile': {
                    'orcid': {
                        'value': ORCID_ID
                    }
                }
            });
        });

        return callback();
    });
};

describe('OrcidAPI', function() {

    // Rest context that can be used every time we need to make a request as a global admin
    var globalAdminRestContext = null;
    // Rest context that can be used every time we need to make a request as a tenant admin
    var camAdminRestContext = null;
    // User object that can be used every time we need to make a request as a tenant user
    var johnUser = null;
    // Rest context that can be used every time we need to make a request as an anonymous user
    var anonymousCamRestContext = null;

    /**
     * Initializes the admin REST contexts
     */
    before(function(callback) {

        // Fill up the global admin rest context
        globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
        // Fill up the cam admin rest context
        camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
        // Fill up the anonymous rest context
        anonymousCamRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);

        // Fill up the john user rest context
        TestsUtil.generateTestUsers(camAdminRestContext, 1, function(err, users, john) {
            assert.ok(!err);

            // Generate an email address
            ORCID_EMAIL = 'user' + String(Math.round(Math.random() * 1000000000)) + '@domain' +  String(Math.round(Math.random() * 1000000000)) + '.org';

            // Update the email address of the john user
            RestAPI.User.updateUser(john.restContext, john.user.id, { 'email': ORCID_EMAIL }, function(err) {
                assert.ok(!err);
                johnUser = john;

                // Create a test server
                _createTestServer(function() {

                    // Set the mock public endpoint for the ORCID API
                    ConfigTestUtil.updateConfigAndWait(camAdminRestContext, null, {'oae-orcid/api/public': 'http://localhost:' + port}, function(err) {
                        assert.ok(!err);

                        // Set the mock member endpoint for the ORCID API
                        ConfigTestUtil.updateConfigAndWait(camAdminRestContext, null, {'oae-orcid/api/member': 'http://localhost:' + port}, function(err) {
                            assert.ok(!err);
                            return callback();
                        });
                    });
                });
            });
        });
    });

    /**
     * Disables the ORCID implementation and restores the mock API endpoints for the tenant after each test
     */
    afterEach(function(callback) {
        ConfigTestUtil.updateConfigAndWait(camAdminRestContext, null, {'oae-orcid/api/enabled': false}, function(err) {
            assert.ok(!err);
            return callback();
        });
    });

    /**
     * Close the mock ORCID API server
     */
    after(function(callback) {
        return server.close(callback);
    });

    /**
     * Test that verifies that no request are sent when ORCID integration is disabled for tenant
     */
    it('verify ORCID integration enabled', function(callback) {

        // Request an ORCID record
        RestAPI.Orcid.getOrcidRecord(camAdminRestContext, {'id': ORCID_ID}, function(err, record) {
            assert.ok(err);
            assert.equal(err.code, 401);
            assert.equal(err.msg, 'ORCID integration is not enabled for tenant');
            return callback();
        });
    });

    /**
     * Test that verifies that the correct parameters are specified when requesting an ORCID record
     */
    it('verify that the correct parameters are specified when requesting an ORCID record', function(callback) {

        // Enable ORCID integration for tenant
        ConfigTestUtil.updateConfigAndWait(camAdminRestContext, null, {'oae-orcid/api/enabled': true}, function(err) {
            assert.ok(!err);

            // Request an ORCID record
            RestAPI.Orcid.getOrcidRecord(johnUser.restContext, {'wrongParameter': 'someValue'}, function(err, record) {
                assert.ok(err);
                assert.equal(err.code, 400);
                return callback();
            });
        });
    });

    /**
     * Test that verifies that a correct response is returned when searching by a unexisting member's email
     */
    it('verify ORCID search by unregistered email returns correct response', function(callback) {

        // Enable ORCID integration for tenant
        ConfigTestUtil.updateConfigAndWait(camAdminRestContext, null, {'oae-orcid/api/enabled': true}, function(err) {
            assert.ok(!err);

            // Request an ORCID record
            RestAPI.Orcid.getOrcidRecord(johnUser.restContext, {'email': 'wrong@mail.address.com'}, function(err, record) {
                assert.ok(!err);
                assert.ok(record['message-version']);
                assert.ok(record['orcid-search-results']);
                assert.equal(record['orcid-search-results']['orcid-search-result'].length, 0);
                assert.equal(record['orcid-search-results']['num-found'], 0);
                return callback();
            });
        });
    });

    /**
     * Test that verifies the user's profile doesn't show an ORCID id property
     */
    it('verify that when a user has no ORCID id, no property is visible on the user\'s profile', function(callback) {
        RestAPI.User.getUser(johnUser.restContext, johnUser.user.id, function(err, user) {
            assert.ok(!err);
            assert.ok(user.orcid);
            assert.ok(!user.orcid.id);
            return callback();
        });
    });

    /**
     * Test that verifies that a new member record can be created
     */
    it('verify creating a new ORCID record is successful', function(callback) {
        // Enable ORCID integration for tenant
        ConfigTestUtil.updateConfigAndWait(camAdminRestContext, null, {'oae-orcid/api/enabled': true}, function(err) {
            assert.ok(!err);

            // Request an ORCID record
            RestAPI.Orcid.createOrcidMemberRecord(johnUser.restContext, function(err, orcidId) {
                assert.ok(!err);
                assert.ok(orcidId.match(/(\d{4}\-?)+/g));
                CREATED_ORCID_ID = orcidId;

                // Check if the ORCID id has actually been added to the database
                OrcidDAO.getOrcidIdFromUser(johnUser.user.id, function(err, orcidId) {
                    assert.ok(!err);
                    assert.equal(CREATED_ORCID_ID, orcidId);
                    return callback();
                });
            });
        });
    });

    /**
     * Test that verifies that adding an existing member results in an error
     */
    it('verify adding duplicate ORCID records returns error', function(callback) {

        // Enable ORCID integration for tenant
        ConfigTestUtil.updateConfigAndWait(camAdminRestContext, null, {'oae-orcid/api/enabled': true}, function(err) {
            assert.ok(!err);

            // Request an ORCID record
            RestAPI.Orcid.createOrcidMemberRecord(johnUser.restContext, function(err) {
                assert.ok(err);
                assert.equal(err.code, 400);
                return callback();
            });
        });
    });

    /**
     * Test that verifies the ORCID id has been added to the user's profile
     */
    it('verify the orcidId property is visible on the user\'s profile after creating an ORCID id', function(callback) {
        RestAPI.User.getUser(johnUser.restContext, johnUser.user.id, function(err, user) {
            assert.ok(!err);
            assert.ok(user.orcid);
            assert.ok(user.orcid.id);
            assert.equal(user.orcid.id, CREATED_ORCID_ID);
            return callback();
        });
    });

    /**
     * Test that verifies that a member record is returned when searching by a registered member's email
     */
    it('verify ORCID search by registered email returns member record', function(callback) {

        // Enable ORCID integration for tenant
        ConfigTestUtil.updateConfigAndWait(camAdminRestContext, null, {'oae-orcid/api/enabled': true}, function(err) {
            assert.ok(!err);

            // Request an ORCID record
            RestAPI.Orcid.getOrcidRecord(johnUser.restContext, {'email': ORCID_EMAIL}, function(err, record) {
                assert.ok(!err);
                assert.ok(record['message-version']);
                return callback();
            });
        });
    });

    /**
     * Test that verifies that only registered users can request ORCID records
     */
    it('verify only registered tenant admins and users can request ORCID records', function(callback) {

        // Enable ORCID integration for tenant
        ConfigTestUtil.updateConfigAndWait(camAdminRestContext, null, {'oae-orcid/api/enabled': true}, function(err) {
            assert.ok(!err);

            // Request an ORCID record via the global admin user
            RestAPI.Orcid.getOrcidRecord(globalAdminRestContext, {'id': ORCID_ID}, function(err, record) {
                assert.ok(err);
                assert.equal(err.code, 404);

                // Request an ORCID record with the cam admin user
                RestAPI.Orcid.getOrcidRecord(camAdminRestContext, {'id': ORCID_ID}, function(err, record) {
                    assert.ok(!err);
                    assert.ok(record['message-version']);
                    assert.ok(record['orcid-profile']);
                    assert.ok(record['orcid-profile']['orcid']);
                    assert.equal(record['orcid-profile']['orcid']['value'], ORCID_ID);

                    // Request an ORCID record with the john user
                    RestAPI.Orcid.getOrcidRecord(johnUser.restContext, {'id': ORCID_ID}, function(err, record) {
                        assert.ok(!err);
                        assert.ok(record['message-version']);
                        assert.ok(record['orcid-profile']);
                        assert.ok(record['orcid-profile']['orcid']);
                        assert.equal(record['orcid-profile']['orcid']['value'], ORCID_ID);

                        RestAPI.Orcid.getOrcidRecord(anonymousCamRestContext, {'id': ORCID_ID}, function(err, record) {
                            assert.ok(err);
                            assert.equal(err.code, 401);
                            return callback();
                        });
                    });
                });
            });
        });
    });
});
