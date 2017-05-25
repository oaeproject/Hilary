var _ = require('underscore');
var assert = require('assert');

var LibraryAPI = require('oae-library');
var RestAPI = require('oae-rest');

var TestsUtil = require('oae-tests');

describe('Meeting libraries', function () {

    var camAnonymousRestCtx = null;
    var camAdminRestCtx = null;
    var gtAdminRestCtx = null;

    beforeEach(function () {
        camAnonymousRestCtx = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
        camAdminRestCtx = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
        gtAdminRestCtx = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    });

    /**
     * Creates an user and fills his library with meeting items.
     * 
     * @param  {RestContext}    restCtx                         The context with which to create the user and content
     * @param  {String}         userVisibility                  The visibility for the new user
     * @param  {Function}       callback                        Standard callback function
     * @param  {User}           callback.user                   The created user
     * @param  {Meeting}        callback.privateMeeting         The private meeting
     * @param  {Meeting}        callback.loggedinMeeting        The loggedin meeting
     * @param  {Meeting}        callback.publicMeeting          The public meeting
     */
    var createUserAndLibrary = function (restCtx, userVisibility, callback) {

        // Create an user with the proper visibility
        TestsUtil.generateTestUsers(restCtx, 1, function (err, users) {
            var user = _.values(users)[0];
            RestAPI.User.updateUser(user.restContext, user.user.id, {'visibility': userVisibility}, function (err) {
                assert.ok(!err);

                // Fill up the user library with 3 meeting items
                RestAPI.MeetingsJitsi.createMeeting(user.restContext, 'name', 'description', false, false, 'private', null, null, function (err, privateMeeting) {
                    assert.ok(!err);

                    RestAPI.MeetingsJitsi.createMeeting(user.restContext, 'name', 'description', false, false, 'loggedin', null, null, function (err, loggedinMeeting) {
                        assert.ok(!err);

                        RestAPI.MeetingsJitsi.createMeeting(user.restContext, 'name', 'description', false, false, 'public', null, null, function (err, publicMeeting) {
                            assert.ok(!err);

                            return callback(user, privateMeeting, loggedinMeeting, publicMeeting);
                        });
                    });
                });
            });
        });

    };

    /**
     * Creates a group and fills its library with meeting items.
     * 
     * @param  {RestContext}    restCtx                         The context with which to create the user and content
     * @param  {String}         groupLibrary                    The visibility for the new group
     * @param  {Function}       callback                        Standard callback function
     * @param  {User}           callback.user                   The created user
     * @param  {Meeting}        callback.privateMeeting         The private meeting
     * @param  {Meeting}        callback.loggedinMeeting        The loggedin meeting
     * @param  {Meeting}        callback.publicMeeting          The public meeting
     */
    var createGroupAndLibrary = function (restCtx, groupVisibility, callback) {

        RestAPI.Group.createGroup(restCtx, 'displayName', 'description', groupVisibility, 'no', [], [], function (err, group) {
            assert.ok(!err);

            // Fill up the group library with 3 meeting items
            RestAPI.MeetingsJitsi.createMeeting(restCtx, 'name', 'description', false, false, 'private', [group.id], null, function (err, privateMeeting) {
                assert.ok(!err);

                RestAPI.MeetingsJitsi.createMeeting(restCtx, 'name', 'description', false, false, 'loggedin', [group.id], null, function (err, loggedinMeeting) {
                    assert.ok(!err);

                    RestAPI.MeetingsJitsi.createMeeting(restCtx, 'name', 'description', false, false, 'public', [group.id], null, function (err, publicMeeting) {
                        assert.ok(!err);

                        return callback(group, privateMeeting, loggedinMeeting, publicMeeting);
                    });
                });
            });
        });

    };

    /**
     * Checks a principal library.
     * 
     * @param  {RestContext}    restCtx             The context to use to do the request
     * @param  {String}         libraryOwnerId      The principal for which to retrieve the library
     * @param  {Boolean}        expectAccess        Whether or not retrieving the library should be successfull
     * @param  {Meeting[]}      expectedItems       The expected meetings that should return
     * @param  {Function}       callback            Standard callback function
     */
    var checkLibrary = function (restCtx, libraryOwnerId, expectAccess, expectedItems, callback) {

        RestAPI.MeetingsJitsi.getMeetingsLibrary(restCtx, libraryOwnerId, function (err, items) {
            if (!expectAccess) {
                assert.equal(err.code, 401);
                assert.ok(!items);
            }
            else {
                assert.ok(!err);

                // Make sure only the exptected items are returned
                assert.equal(items.results.length, expectedItems.length);
                _.each(expectedItems, function (expectedMeeting) {
                    assert.ok(_.filter(items.results, function (meeting) {
                            return meeting.id === expectedMeeting.id;
                        })
                    );
                });
            }

            return callback();
        });

    };

    describe('User libraries', function () {

        var users = {};

        beforeEach(function (callback) {

            createUserAndLibrary(camAdminRestCtx, 'private', function (user, privateMeeting, loggedinMeeting, publicMeeting) {
                users.private = {
                    user: user,
                    privateMeeting: privateMeeting,
                    loggedinMeeting: loggedinMeeting,
                    publicMeeting: publicMeeting
                };
                
                createUserAndLibrary(camAdminRestCtx, 'loggedin', function (user, privateMeeting, loggedinMeeting, publicMeeting) {
                    users.loggedin = {
                        user: user,
                        privateMeeting: privateMeeting,
                        loggedinMeeting: loggedinMeeting,
                        publicMeeting: publicMeeting
                    };

                    createUserAndLibrary(camAdminRestCtx, 'public', function (user, privateMeeting, loggedinMeeting, publicMeeting) {
                        users.public = {
                            user: user,
                            privateMeeting: privateMeeting,
                            loggedinMeeting: loggedinMeeting,
                            publicMeeting: publicMeeting
                        };
                        
                        return callback();
                    });
                });
            });

        });

        it('should only send the public stream of public users for an anonymous user', function (callback) {

            checkLibrary(camAnonymousRestCtx, users.public.user.user.id, true, [users.public.publicMeeting], function () {
                checkLibrary(camAnonymousRestCtx, users.loggedin.user.user.id, false, [], function () {
                    checkLibrary(camAnonymousRestCtx, users.private.user.user.id, false, [], function () {
                        return callback();
                    });
                });
            });

        });

        it('should only send the loggedin stream of public and loggedin users for a loggedin user on the same tenant', function (callback) {

            TestsUtil.generateTestUsers(camAdminRestCtx, 1, function (err, myUsers) {
                var anotherUser = _.values(myUsers)[0];
                
                checkLibrary(anotherUser.restContext, users.public.user.user.id, true, [users.public.publicMeeting, users.public.loggedinMeeting], function () {
                    checkLibrary(anotherUser.restContext, users.loggedin.user.user.id, true, [users.loggedin.publicMeeting, users.loggedin.loggedinMeeting], function () {
                        checkLibrary(anotherUser.restContext, users.private.user.user.id, false, [], function () {
                            return callback();
                        });
                    });
                });
            });

        });

        it('should only send the public stream of public users for a loggedin user on *another* tenant', function (callback) {

            TestsUtil.generateTestUsers(gtAdminRestCtx, 1, function (err, myUsers) {
                var otherTenantUser = _.values(myUsers)[0];

                checkLibrary(otherTenantUser.restContext, users.public.user.user.id, true, [users.public.publicMeeting], function () {
                    checkLibrary(otherTenantUser.restContext, users.loggedin.user.user.id, false, [], function () {
                        checkLibrary(otherTenantUser.restContext, users.private.user.user.id, false, [], function () {
                            return callback();
                        });
                    });
                });
            });

        });

        it('should send all the meeting library items for the owner of the library', function (callback) {

            checkLibrary(users.private.user.restContext, users.private.user.user.id, true, [users.private.privateMeeting, users.private.loggedinMeeting, users.private.publicMeeting], function () {
                checkLibrary(users.loggedin.user.restContext, users.loggedin.user.user.id, true, [users.loggedin.privateMeeting, users.loggedin.loggedinMeeting, users.loggedin.publicMeeting], function () {
                    checkLibrary(users.public.user.restContext, users.public.user.user.id, true, [users.public.privateMeeting, users.public.loggedinMeeting, users.public.publicMeeting], function () {
                        return callback();
                    });
                });
            });

        });

        it('should properly add the meeting to the user meeting library when the user gains access to the meeting', function (callback) {

            TestsUtil.generateTestUsers(camAdminRestCtx, 2, function (err, users, mrvisser, nicolaas) {
                assert.ok(!err);

                // Create a meeting as mrvisser
                RestAPI.MeetingsJitsi.createMeeting(mrvisser.restContext, 'name', 'descr', false, false, 'public', null, null, function (err, meeting) {
                    assert.ok(!err);

                    // Seed mrvisser's and nicolaas's meeting libraries to ensure it does not get built from scratch
                    RestAPI.MeetingsJitsi.getMeetingsLibrary(mrvisser.restContext, mrvisser.user.id, function (err) {
                        assert.ok(!err);

                        RestAPI.MeetingsJitsi.getMeetingsLibrary(nicolaas.restContext, nicolaas.user.id, function (err) {
                            assert.ok(!err);

                            // Make nicolaas a member of the meeting
                            var updates = {};
                            updates[nicolaas.user.id] = 'member';

                            RestAPI.MeetingsJitsi.updateMembers(mrvisser.restContext, meeting.id, updates, function (err) {
                                assert.ok(!err);

                                // Ensure the meeting is still in mrvisser's and nicolaas's meeting libraries
                                RestAPI.MeetingsJitsi.getMeetingsLibrary(mrvisser.restContext, mrvisser.user.id, function (err, result) {
                                    assert.ok(!err);
                                    var libraryEntry = result.results[0];
                                    assert.ok(libraryEntry);
                                    assert.strictEqual(libraryEntry.id, meeting.id);

                                    RestAPI.MeetingsJitsi.getMeetingsLibrary(nicolaas.restContext, nicolaas.user.id, function (err, result) {
                                        assert.ok(!err);
                                        libraryEntry = result.results[0];
                                        assert.ok(libraryEntry);
                                        assert.strictEqual(libraryEntry.id, meeting.id);
                                        
                                        return callback();
                                    });
                                });
                            });
                        });
                    });
                });
            });

        });

    });

    // TODO move at the end of the file 
    describe('Group libraries', function () {

        var groups = {};

        beforeEach(function (callback) {

            createGroupAndLibrary(camAdminRestCtx, 'private', function (group, privateMeeting, loggedinMeeting, publicMeeting) {
                groups.private = {
                    group: group,
                    privateMeeting: privateMeeting,
                    loggedinMeeting: loggedinMeeting,
                    publicMeeting: publicMeeting
                };

                createGroupAndLibrary(camAdminRestCtx, 'loggedin', function (group, privateMeeting, loggedinMeeting, publicMeeting) {
                    groups.loggedin = {
                        group: group,
                        privateMeeting: privateMeeting,
                        loggedinMeeting: loggedinMeeting,
                        publicMeeting: publicMeeting
                    };

                    createGroupAndLibrary(camAdminRestCtx, 'public', function (group, privateMeeting, loggedinMeeting, publicMeeting) {
                        groups.public = {
                            group: group,
                            privateMeeting: privateMeeting,
                            loggedinMeeting: loggedinMeeting,
                            publicMeeting: publicMeeting
                        };

                        return callback();
                    });
                });
            });

        });

        it('should only send the public stream of public groups for an anonymous user', function (callback) {

            checkLibrary(camAnonymousRestCtx, groups.public.group.id, true, [groups.public.publicMeeting], function () {
                checkLibrary(camAnonymousRestCtx, groups.loggedin.group.id, false, [], function () {
                    checkLibrary(camAnonymousRestCtx, groups.private.group.id, false, [], function () {
                        return callback();
                    });
                });
            });

        });

        it('should only send the loggedin stream of public and loggedin groups for a loggedin user on the same tenant', function (callback) {

            TestsUtil.generateTestUsers(camAdminRestCtx, 1, function (err, users) {
                assert.ok(!err);

                var anotherUser = _.values(users)[0];
                checkLibrary(anotherUser.restContext, groups.public.group.id, true, [groups.public.publicMeeting, groups.public.loggedinMeeting], function () {
                    checkLibrary(anotherUser.restContext, groups.loggedin.group.id, true, [groups.loggedin.publicMeeting, groups.loggedin.loggedinMeeting], function () {
                        checkLibrary(anotherUser.restContext, groups.private.group.id, false, [], function () {
                            return callback();
                        });
                    });
                });
            });

        });

        it('should only send the public stream of public groups for a loggedin user on *another* tenant', function (callback) {

            TestsUtil.generateTestUsers(gtAdminRestCtx, 1, function (err, users) {
                assert.ok(!err);

                var anotherTenantUser = _.values(users)[0];
                checkLibrary(anotherTenantUser.restContext, groups.public.group.id, true, [groups.public.publicMeeting], function () {
                    checkLibrary(anotherTenantUser.restContext, groups.loggedin.group.id, false, [], function () {
                        checkLibrary(anotherTenantUser.restContext, groups.private.group.id, false, [], function () {
                            return callback();
                        });
                    });
                });
            });

        });

        it('should send all the meeting library items for a member of the group', function (callback) {

            checkLibrary(camAdminRestCtx, groups.public.group.id, true, [groups.public.publicMeeting, groups.public.loggedinMeeting, groups.public.privateMeeting], function () {
                checkLibrary(camAdminRestCtx, groups.loggedin.group.id, true, [groups.loggedin.publicMeeting, groups.loggedin.loggedinMeeting, groups.loggedin.privateMeeting], function () {
                    checkLibrary(camAdminRestCtx, groups.private.group.id, true, [groups.private.publicMeeting, groups.private.loggedinMeeting, groups.private.privateMeeting], function () {
                        return callback();
                    });
                });
            });

        });

        it('should add the meeting to the group meeting library when the group has been added to the meeting', function (callback) {

            TestsUtil.generateTestUsers(camAdminRestCtx, 1, function (err, users, mrvisser) {
                assert.ok(!err);

                // Create a group to play with
                RestAPI.Group.createGroup(mrvisser.restContext, 'displayName', 'description', 'private', 'no', [], [], function (err, group) {

                    // Create a meeting as mrvisser
                    RestAPI.MeetingsJitsi.createMeeting(mrvisser.restContext, 'name', 'descr', false, false, 'public', null, null, function (err, meeting) {
                        assert.ok(!err);

                        // Seed mrvisser's and the group's meeting libraries to ensure it does not get built from scratch
                        RestAPI.MeetingsJitsi.getMeetingsLibrary(mrvisser.restContext, mrvisser.user.id, function (err) {
                            assert.ok(!err);

                            RestAPI.MeetingsJitsi.getMeetingsLibrary(mrvisser.restContext, group.id, function (err) {
                                assert.ok(!err);

                                // Make the group a member of the meeting
                                var updates = {};
                                updates[group.id] = 'member';

                                RestAPI.MeetingsJitsi.updateMembers(mrvisser.restContext, meeting.id, updates, function (err) {
                                    assert.ok(!err);

                                    // Ensure the meeting is still in mrvisser's and the group's meeting libraries
                                    RestAPI.MeetingsJitsi.getMeetingsLibrary(mrvisser.restContext, mrvisser.user.id, function (err, result) {
                                        assert.ok(!err);
                                        var libraryEntry = result.results[0];
                                        assert.ok(libraryEntry);
                                        assert.strictEqual(libraryEntry.id, meeting.id);

                                        RestAPI.MeetingsJitsi.getMeetingsLibrary(mrvisser.restContext, group.id, function (err, result) {
                                            assert.ok(!err);
                                            libraryEntry = result.results[0];
                                            assert.ok(libraryEntry);
                                            assert.strictEqual(libraryEntry.id, meeting.id);
                                            
                                            return callback();
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });

        });

    });

});
