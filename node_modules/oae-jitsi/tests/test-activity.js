var _ = require('underscore');
var assert = require('assert');

var RestAPI = require('oae-rest');
var TestsUtil = require('oae-tests');
var EmailTestsUtil = require('oae-email/lib/test/util');
var ActivityTestsUtil = require('oae-activity/lib/test/util');

describe('Meeting Activity', function () {

    // Rest contexts that can be used performing rest requests
    var anonymousCamRestContext = null;
    var camAdminRestContext = null;

    before(function (callback) {
        anonymousCamRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
        camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
        return callback();
    });

    /**
     * Drain the email queue
     */
    beforeEach(function (callback) {
        EmailTestsUtil.clearEmailCollections(callback);
    });

    describe('Meeting activities', function () {

        it('verify creating a meeting results in an activity being generated', function (callback) {

            TestsUtil.generateTestUsers(camAdminRestContext, 1, function (err, user) {
                var simon = _.values(user)[0];

                // Create a meeting
                var randomText = TestsUtil.generateRandomText(25);
                RestAPI.MeetingsJitsi.createMeeting(simon.restContext, randomText, randomText, false, false, 'private', null, null, function (err, meeting) {
                    assert.ok(!err);

                    // Collect the activities
                    ActivityTestsUtil.collectAndGetActivityStream(simon.restContext, simon.user.id, null, function (err, activityStream) {
                        assert.ok(!err);

                        // Verify the meeting-jitsi-create activity
                        var activity = activityStream.items[0];
                        assert.ok(activity);
                        assert.equal(activity['oae:activityType'], 'meeting-jitsi-create');
                        assert.equal(activity.actor['oae:id'], simon.user.id);
                        assert.equal(activity.object['oae:id'], meeting.id);

                        return callback();
                    });
                });
            });

        });

        it('verify updating a meeting results in an activity being generated', function (callback) {

            TestsUtil.generateTestUsers(camAdminRestContext, 1, function (err, user) {
                var simon = _.values(user)[0];

                // Create a meeting
                var randomText = TestsUtil.generateRandomText(25);
                RestAPI.MeetingsJitsi.createMeeting(simon.restContext, randomText, randomText, false, false, 'private', null, null, function (err, meeting) {
                    assert.ok(!err);

                    // Update the meeting
                    RestAPI.MeetingsJitsi.updateMeeting(simon.restContext, meeting.id, {'displayName': 'Ravens'}, function (err, meetingProfile) {
                        assert.ok(!err);
                        assert.ok(meetingProfile);

                        // Collect the activities
                        ActivityTestsUtil.collectAndGetActivityStream(simon.restContext, simon.user.id, null, function (err, activityStream) {
                            assert.ok(!err);

                            // Verify the meeting-jitsi-update activity
                            var activity = activityStream.items[0];
                            assert.ok(activity);
                            assert.equal(activity['oae:activityType'], 'meeting-jitsi-update');
                            assert.equal(activity.actor['oae:id'], simon.user.id);
                            assert.equal(activity.object['oae:id'], meeting.id);

                            return callback();
                        });
                    });
                });
            });

        });

        it('verify sharing a meeting results in an activity being generated', function (callback) {

            TestsUtil.generateTestUsers(camAdminRestContext, 2, function (err, users) {
                var simon = _.values(users)[0];
                var nico = _.values(users)[1];

                // Create a meeting
                var randomText = TestsUtil.generateRandomText(25);
                RestAPI.MeetingsJitsi.createMeeting(simon.restContext, randomText, randomText, false, false, 'private', null, null, function (err, meeting) {
                    assert.ok(!err);

                    // Share the meeting
                    var updates = {};
                    updates[nico.user.id] = 'member';
                    RestAPI.MeetingsJitsi.updateMembers(simon.restContext, meeting.id, updates, function (err) {
                        assert.ok(!err);

                        // Collect the activities
                        ActivityTestsUtil.collectAndGetActivityStream(simon.restContext, simon.user.id, null, function (err, activityStream) {
                            assert.ok(!err);

                            // Verify the meeting-jitsi-share activity
                            var activity = activityStream.items[0];
                            assert.ok(activity);
                            assert.equal(activity['oae:activityType'], 'meeting-jitsi-share');
                            assert.equal(activity.actor['oae:id'], simon.user.id);
                            assert.equal(activity.object['oae:id'], meeting.id);
                            assert.equal(activity.target['oae:id'], nico.user.id);

                            return callback();
                        });
                    });
                });
            });

        });

        it('verify updating user role of a meeting results in an activity being generated', function (callback) {

            TestsUtil.generateTestUsers(camAdminRestContext, 12, function (err, users) {
                var simon = _.values(users)[0];
                var nico = _.values(users)[1];

                // Create a meeting
                var randomText = TestsUtil.generateRandomText(25);
                RestAPI.MeetingsJitsi.createMeeting(simon.restContext, randomText, randomText, false, false, 'private', null, [nico.user.id], function (err, meeting) {
                    assert.ok(!err);

                    // Update one user role in the meeting
                    var updates = {};
                    updates[nico.user.id] = 'manager';
                    RestAPI.MeetingsJitsi.updateMembers(simon.restContext, meeting.id, updates, function (err) {
                        assert.ok(!err);

                        // Collect the activities
                        ActivityTestsUtil.collectAndGetActivityStream(simon.restContext, simon.user.id, null, function (err, activityStream) {
                            assert.ok(!err);

                            // Verify the meeting-jitsi-share activity
                            var activity = activityStream.items[0];
                            assert.ok(activity);
                            assert.equal(activity['oae:activityType'], 'meeting-jitsi-update-member-role');
                            assert.equal(activity.actor['oae:id'], simon.user.id);
                            assert.equal(activity.object['oae:id'], nico.user.id);
                            assert.equal(activity.target['oae:id'], meeting.id);

                            return callback();
                        });
                    });
                });
            });

        });

        it('verify posting a message in a meeting results in an activity being generated', function (callback) {

            TestsUtil.generateTestUsers(camAdminRestContext, 1, function (err, users) {
                assert.ok(!err);

                var simon = _.values(users)[0];

                // Create the meeting
                var randomText = TestsUtil.generateRandomText(25);
                RestAPI.MeetingsJitsi.createMeeting(simon.restContext, randomText, randomText, false, false, 'private', null, null, function (err, meeting) {
                    assert.ok(!err);

                    // Send a message
                    RestAPI.MeetingsJitsi.createComment(simon.restContext, meeting.id, '<b>Nice meeting.</b>', null, function (err, simonMessage) {
                        assert.ok(!err);

                        // Collect the activities
                        ActivityTestsUtil.collectAndGetActivityStream(simon.restContext, simon.user.id, null, function (err, activityStream) {
                            assert.ok(!err);

                            // Verify the meeting-jitsi-message activity
                            var activity = activityStream.items[0];
                            assert.ok(activity);
                            assert.equal(activity['oae:activityType'], 'meeting-jitsi-message');
                            assert.equal(activity.actor['oae:id'], simon.user.id);
                            assert.equal(activity.object['oae:id'], meeting.id + '#' + activity.object['published']);

                            return callback();
                        });
                    });
                });

            });

        });

    });

    describe('Meeting emails', function () {

        /**
         * Create one public and one private user
         *
         * @param  {RestContext}    restCtx                         The context with which to create the user and content
         * @param  {Function}       callback                        Standard callback function
         * @param  {User}           callback.privateUser            The created private user
         * @param  {Meeting}        callback.publicUser             The created public user
         */
        var createPrivateAndPublicUsers = function (restCtx, callback) {

            TestsUtil.generateTestUsers(restCtx, 2, function (err, users) {
                var simon = _.values(users)[0];
                var nico = _.values(users)[1];

                // Simon is private and nico is public
                var nicoUpdate = {'email': nico.user.email};
                var simonUpdate = {
                    'email': simon.user.email,
                    'visibility': 'private',
                    'publicAlias': 'swappedFromPublicAlias'
                };

                // Update the users
                RestAPI.User.updateUser(nico.restContext, nico.user.id, nicoUpdate, function (err) {
                    assert.ok(!err);

                    RestAPI.User.updateUser(simon.restContext, simon.user.id, simonUpdate, function (err) {
                        assert.ok(!err);

                        return callback(simon, nico);
                    });
                });
            });

        };

        it('verify an email is sent to the members when a meeting is created and privacy is respected', function (callback) {

            // Create one private and one public user
            createPrivateAndPublicUsers(camAdminRestContext, function (privateUser, publicUser) {

                // Create a meeting
                var randomText = TestsUtil.generateRandomText(5);
                RestAPI.MeetingsJitsi.createMeeting(privateUser.restContext, randomText, randomText, false, false, 'private', null, [publicUser.user.id], function (err, meeting) {
                    assert.ok(!err);

                    // Collect the email queue
                    EmailTestsUtil.collectAndFetchAllEmails(function (emails) {

                        // There should be exactly one email
                        assert.equal(emails.length, 1);

                        var stringEmail = JSON.stringify(emails[0]);
                        var email = emails[0];

                        // Sanity check that the email is to the invated member
                        assert.equal(email.to[0].address, publicUser.user.email);

                        // Ensure some data expected to be in the email is there
                        assert.notEqual(stringEmail.indexOf(privateUser.restContext.hostHeader), -1);
                        assert.notEqual(stringEmail.indexOf(meeting.profilePath), -1);
                        assert.notEqual(stringEmail.indexOf(meeting.displayName), -1);

                        // Ensure private data is nowhere to be found
                        assert.equal(stringEmail.indexOf(privateUser.user.displayName), -1);
                        assert.equal(stringEmail.indexOf(privateUser.user.email), -1);
                        assert.equal(stringEmail.indexOf(privateUser.user.locale), -1);

                        // Ensure the public alias of the private user is present
                        assert.notEqual(stringEmail.indexOf('swappedFromPublicAlias'), -1);

                        return callback();
                    });
                });

            });

        });

        it('verify an email is sent to the target users when a meeting is shared and privacy is respected', function (callback) {

            createPrivateAndPublicUsers(camAdminRestContext, function (privateUser, publicUser) {

                // Create a meeting
                var randomText = TestsUtil.generateRandomText(5);
                RestAPI.MeetingsJitsi.createMeeting(privateUser.restContext, randomText, randomText, false, false, 'private', null, null, function (err, meeting) {
                    assert.ok(!err);

                    // Collect a first time the email queue to empty it
                    EmailTestsUtil.collectAndFetchAllEmails(function (emails) {

                        // Share the meeting
                        var updates = {};
                        updates[publicUser.user.id] = 'member';
                        RestAPI.MeetingsJitsi.updateMembers(privateUser.restContext, meeting.id, updates, function (err) {
                            assert.ok(!err);

                            // Collect a second time the email queue
                            EmailTestsUtil.collectAndFetchAllEmails(function (emails) {

                                // There should be exactly one email
                                assert.equal(emails.length, 1);

                                var stringEmail = JSON.stringify(emails[0]);
                                var email = emails[0];

                                // Sanity check that the email is to the shared target
                                assert.equal(email.to[0].address, publicUser.user.email);

                                // Ensure some data expected to be in the email is there
                                assert.notEqual(stringEmail.indexOf(privateUser.restContext.hostHeader), -1);
                                assert.notEqual(stringEmail.indexOf(meeting.profilePath), -1);
                                assert.notEqual(stringEmail.indexOf(meeting.displayName), -1);

                                // Ensure private data is nowhere to be found
                                assert.equal(stringEmail.indexOf(privateUser.user.displayName), -1);
                                assert.equal(stringEmail.indexOf(privateUser.user.email), -1);
                                assert.equal(stringEmail.indexOf(privateUser.user.locale), -1);

                                // Ensure the public alias of the private user is present
                                assert.notEqual(stringEmail.indexOf('swappedFromPublicAlias'), -1);

                                return callback();
                            });
                        });
                    });
                });
            });

        });

        it('verify an email is sent to the meeting managers when the meeting\'s metadata are updated and privacy is respected', function (callback) {

            createPrivateAndPublicUsers(camAdminRestContext, function (privateUser, publicUser) {

                TestsUtil.generateTestUsers(camAdminRestContext, 1, function (err, user) {
                    var randomUser = _.values(user)[0];

                    // Create a meeting
                    var randomText = TestsUtil.generateRandomText(5);
                    RestAPI.MeetingsJitsi.createMeeting(privateUser.restContext, randomText, randomText, false, false, 'private', [publicUser.user.id], [randomUser.user.id], function (err, meeting) {
                        assert.ok(!err);

                        // Collect a first time the email queue to empty it
                        EmailTestsUtil.collectAndFetchAllEmails(function (emails) {

                            // Update the meeting's metadata
                            var updates = {'displayName': 'new-display-name'};
                            RestAPI.MeetingsJitsi.updateMeeting(privateUser.restContext, meeting.id, updates, function (err, meeting) {
                                assert.ok(!err);

                                // Collect a second time the email queue
                                EmailTestsUtil.collectAndFetchAllEmails(function (emails) {

                                    // There should be exactly one email
                                    assert.equal(emails.length, 1);

                                    var stringEmail = JSON.stringify(emails[0]);
                                    var email = emails[0];

                                    // Sanity check that the email is to the shared target
                                    assert.equal(email.to[0].address, publicUser.user.email);

                                    // Ensure some data expected to be in the email is there
                                    assert.notEqual(stringEmail.indexOf(privateUser.restContext.hostHeader), -1);
                                    assert.notEqual(stringEmail.indexOf(meeting.profilePath), -1);
                                    assert.notEqual(stringEmail.indexOf(meeting.displayName), -1);

                                    // Ensure private data is nowhere to be found
                                    assert.equal(stringEmail.indexOf(privateUser.user.displayName), -1);
                                    assert.equal(stringEmail.indexOf(privateUser.user.email), -1);
                                    assert.equal(stringEmail.indexOf(privateUser.user.locale), -1);

                                    // Ensure the public alias of the private user is present
                                    assert.notEqual(stringEmail.indexOf('swappedFromPublicAlias'), -1);

                                    return callback();
                                });
                            });
                        });
                    });
                });
            });

        });

        it('verify an email is sent to the meeting members when someone posts a message and privacy is respected', function (callback) {

            createPrivateAndPublicUsers(camAdminRestContext, function (privateUser, publicUser) {

                // Create a meeting
                var randomText = TestsUtil.generateRandomText(5);
                RestAPI.MeetingsJitsi.createMeeting(privateUser.restContext, randomText, randomText, false, false, 'private', [publicUser.user.id], null, function (err, meeting) {
                    assert.ok(!err);

                    // Collect a first time the email queue to empty it
                    EmailTestsUtil.collectAndFetchAllEmails(function (emails) {

                        // Post a comment
                        RestAPI.MeetingsJitsi.createComment(privateUser.restContext, meeting.id, 'Hello world !', null, function (err) {
                            assert.ok(!err);

                            // Collect a second time the email queue
                            EmailTestsUtil.collectAndFetchAllEmails(function (emails) {

                                // There should be exactly one email
                                assert.equal(emails.length, 1);

                                var stringEmail = JSON.stringify(emails[0]);
                                var email = emails[0];

                                // Sanity check that the email is to the shared target
                                assert.equal(email.to[0].address, publicUser.user.email);

                                // Ensure some data expected to be in the email is there
                                assert.notEqual(stringEmail.indexOf(privateUser.restContext.hostHeader), -1);
                                assert.notEqual(stringEmail.indexOf(meeting.profilePath), -1);
                                assert.notEqual(stringEmail.indexOf(meeting.displayName), -1);

                                // Ensure private data is nowhere to be found
                                assert.equal(stringEmail.indexOf(privateUser.user.displayName), -1);
                                assert.equal(stringEmail.indexOf(privateUser.user.email), -1);
                                assert.equal(stringEmail.indexOf(privateUser.user.locale), -1);

                                // Ensure the public alias of the private user is present
                                assert.notEqual(stringEmail.indexOf('swappedFromPublicAlias'), -1);

                                return callback();
                            });
                        });
                    });
                });
            });

        });

    });

});
