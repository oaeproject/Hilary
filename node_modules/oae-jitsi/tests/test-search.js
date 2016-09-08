var _ = require('underscore');
var assert = require('assert');

var AuthzUtil = require('oae-authz/lib/util');
var RestAPI = require('oae-rest');
var SearchTestsUtil = require('oae-search/lib/test/util');
var TestsUtil = require('oae-tests');

describe('Meeting Search', function () {

    // REST contexts we can use to do REST requests
    var anonymousRestContext = null;
    var camAdminRestContext = null;

    before(function (callback) {
        anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
        camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
        return callback();
    });

    describe('Indexing', function () {

        it('verify a meeting is correctly indexed when it is created', function (callback) {

            TestsUtil.generateTestUsers(camAdminRestContext, 1, function (err, user) {
                assert.ok(!err);
                var simong = _.values(user)[0];

                // Create a meeting
                var randomText = TestsUtil.generateRandomText(25);

                RestAPI.MeetingsJitsi.createMeeting(simong.restContext, randomText, randomText, false, false, 'public', null, null, function (err, meeting) {
                    assert.ok(!err);

                    // Ensure the meeting has been correctly indexed
                    SearchTestsUtil.searchAll(simong.restContext, 'general', null, {'resourceTypes': 'meeting-jitsi', 'q': randomText}, function (err, results) {
                        assert.ok(!err);
                        assert.ok(results.results);

                        var doc = results.results[0];
                        assert.ok(doc);
                        assert.equal(doc.id, meeting.id);
                        assert.equal(doc.displayName, randomText);
                        assert.equal(doc.description, randomText);
                        assert.equal(doc.profilePath, '/meeting-jitsi/' + global.oaeTests.tenants.cam.alias + '/' + AuthzUtil.getResourceFromId(meeting.id).resourceId);

                        return callback();
                    });
                });
            });

        });

        it('verify updating the meeting\'s metadata updates the index', function (callback) {

            TestsUtil.generateTestUsers(camAdminRestContext, 1, function (err, user) {
                assert.ok(!err);
                var simong = _.values(user)[0];

                // Create a meeting
                var randomTextA = TestsUtil.generateRandomText(25);
                var randomTextB = TestsUtil.generateRandomText(25);

                RestAPI.MeetingsJitsi.createMeeting(simong.restContext, randomTextA, randomTextA, false, false, 'public', null, null, function (err, meeting) {
                    assert.ok(!err);

                    // Update the meeting's metadata
                    RestAPI.MeetingsJitsi.updateMeeting(simong.restContext, meeting.id, {'displayName': randomTextB, 'description': randomTextB}, function (err) {
                        assert.ok(!err);

                        // Ensure the meeting is correctly indexed
                        SearchTestsUtil.searchAll(simong.restContext, 'general', null, {'resourceTypes': 'meeting-jitsi', 'q': randomTextB}, function (err, results) {
                            assert.ok(!err);
                            assert.ok(results.results);

                            var doc = results.results[0];
                            assert.ok(doc);
                            assert.equal(doc.id, meeting.id);
                            assert.equal(doc.displayName, randomTextB);
                            assert.equal(doc.description, randomTextB);
                            assert.equal(doc.profilePath, '/meeting-jitsi/' + global.oaeTests.tenants.cam.alias + '/' + AuthzUtil.getResourceFromId(meeting.id).resourceId);

                            return callback();
                        });
                    });
                });
            });

        });

    });

});
