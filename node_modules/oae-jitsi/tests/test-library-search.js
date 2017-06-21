var _ = require('underscore');
var assert = require('assert');

var RestAPI = require('oae-rest');
var SearchTestsUtil = require('oae-search/lib/test/util');
var TestsUtil = require('oae-tests');

describe('Meeting Library Search', function () {

    // REST contexts we can use to do REST requests
    var anonymousRestContext = null;
    var camAdminRestContext = null;

    before(function (callback) {
        anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
        camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
        return callback();
    });

    describe('Library search', function () {

        it('verify searching through a meeting library', function (callback) {

            TestsUtil.generateTestUsers(camAdminRestContext, 1, function (err, user) {
                assert.ok(!err);
                var simong = _.values(user)[0];

                // Create 2 meetings
                var randomTextA = TestsUtil.generateRandomText(25);
                var randomTextB = TestsUtil.generateRandomText(25);

                RestAPI.MeetingsJitsi.createMeeting(simong.restContext, randomTextA, randomTextA, false, false, 'public', null, null, function (err, meetingA) {
                    assert.ok(!err);

                    RestAPI.MeetingsJitsi.createMeeting(simong.restContext, randomTextB, randomTextB, false, false, 'public', null, null, function (err, meetingB) {
                        assert.ok(!err);

                        // Ensure that the randomTextA meeting returns and scores better than randomTextB
                        SearchTestsUtil.searchAll(simong.restContext, 'meeting-jitsi-library', [simong.user.id], {'q': randomTextA}, function (err, results) {
                            assert.ok(!err);
                            assert.ok(results.results);

                            var doc = results.results[0];
                            assert.ok(doc);
                            assert.equal(doc.id, meetingA.id);
                            assert.equal(doc.displayName, randomTextA);
                            assert.equal(doc.description, randomTextA);

                            return callback();
                        });
                    });
                });
            });
            
        });

    });

});
