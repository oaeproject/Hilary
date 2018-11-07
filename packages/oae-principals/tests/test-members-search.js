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

const assert = require('assert');
const util = require('util');
const _ = require('underscore');

const AuthzUtil = require('oae-authz/lib/util');
const RestAPI = require('oae-rest');
const SearchTestsUtil = require('oae-search/lib/test/util');
const TestsUtil = require('oae-tests');

describe('Members Library Search', () => {
  /*!
     * Get the document with the specified id from the search results.
     *
     * @param  {SearchResult}  results     The search results object
     * @param  {String}        docId       The id of the document to search
     * @return {Object}                    The search document. `null` if it didn't exist
     */
  const _getDocById = function(results, docId) {
    for (let i = 0; i < results.results.length; i++) {
      const doc = results.results[i];
      if (doc.id === docId) {
        return doc;
      }
    }
    return null;
  };

  // REST contexts we can use to do REST requests
  let anonymousRestContext = null;
  let camAdminRestContext = null;
  let gtAdminRestContext = null;
  let doerRestContext = null;

  // A number of users and groups that are used for group members environment setup. See setup comments in `before` method for more info
  let privateUserMember = null;
  let loggedinUserMember = null;
  let publicUserMember = null;
  let targetPublicGroup = null;
  let targetLoggedinGroup = null;
  let targetPrivateGroup = null;
  let publicGroupMember = null;
  let privateGroupMember = null;
  const doerUser = null;

  before(callback => {
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    gtAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);

    /*!
         * Creates the following variable setup for testing members search:
         *
         * Users:
         *  privateUserMember:  A user with visibility 'private'. Is a member of all the target groups.
         *  loggedinUserMember: A user with visibility 'loggedin'. Is a member of all the target groups.
         *  publicUserMember:   A user with visibility 'public'. Is a member of all the target groups.
         *
         * Target Groups:
         *  targetPublicGroup:      A group with visibility 'public' that will be a target of members search.
         *  targetLoggedinGroup:    A group with visibility 'loggedin' that will be a target of members search.
         *  targetPrivateGroup:     A group with visibility 'private' that will be a target of members search.
         *
         * Member Groups:
         *  publicGroupMember:      A group with visibility 'public'. Is a member of all the target groups.
         *  privateGroupMember:     A group with visibility 'private'. Is a member of all the target groups.
         */
    TestsUtil.generateTestUsers(
      camAdminRestContext,
      4,
      (err, users, doer, publicUser, loggedinUser, privateUser) => {
        assert.ok(!err);

        doerRestContext = doer.restContext;
        publicUserMember = publicUser.user;

        const loggedinOpts = {
          visibility: 'loggedin',
          publicAlias: 'LoggedinHidden'
        };
        RestAPI.User.updateUser(
          loggedinUser.restContext,
          loggedinUser.user.id,
          loggedinOpts,
          (err, loggedinUser) => {
            assert.ok(!err);
            loggedinUserMember = loggedinUser;

            const privateOpts = {
              visibility: 'private',
              publicAlias: 'PrivateHidden'
            };
            RestAPI.User.updateUser(
              privateUser.restContext,
              privateUser.user.id,
              privateOpts,
              (err, privateUser) => {
                assert.ok(!err);
                privateUserMember = privateUser;

                RestAPI.Group.createGroup(
                  doerRestContext,
                  TestsUtil.generateTestUserId('targetPublicGroup'),
                  TestsUtil.generateTestUserId('targetPublicGroup'),
                  'public',
                  'no',
                  [],
                  [],
                  (err, _targetPublicGroup) => {
                    assert.ok(!err);
                    targetPublicGroup = _targetPublicGroup;

                    RestAPI.Group.createGroup(
                      doerRestContext,
                      TestsUtil.generateTestUserId('targetLoggedinGroup'),
                      TestsUtil.generateTestUserId('targetLoggedinGroup'),
                      'loggedin',
                      'no',
                      [],
                      [],
                      (err, _targetLoggedinGroup) => {
                        assert.ok(!err);
                        targetLoggedinGroup = _targetLoggedinGroup;

                        RestAPI.Group.createGroup(
                          doerRestContext,
                          TestsUtil.generateTestUserId('targetPrivateGroup'),
                          TestsUtil.generateTestUserId('targetPrivateGroup'),
                          'private',
                          'no',
                          [],
                          [],
                          (err, _targetPrivateGroup) => {
                            assert.ok(!err);
                            targetPrivateGroup = _targetPrivateGroup;

                            RestAPI.Group.createGroup(
                              doerRestContext,
                              TestsUtil.generateTestUserId('publicGroupMemberAlias'),
                              TestsUtil.generateTestUserId('publicGroupMemberAlias'),
                              'public',
                              'no',
                              [],
                              [],
                              (err, _publicGroupMember) => {
                                assert.ok(!err);
                                publicGroupMember = _publicGroupMember;

                                RestAPI.Group.createGroup(
                                  doerRestContext,
                                  TestsUtil.generateTestUserId('privateGroupMemberAlias'),
                                  TestsUtil.generateTestUserId('privateGroupMemberAlias'),
                                  'private',
                                  'no',
                                  [],
                                  [],
                                  (err, _privateGroupMember) => {
                                    assert.ok(!err);
                                    privateGroupMember = _privateGroupMember;

                                    const memberships = {};
                                    memberships[publicGroupMember.id] = 'member';
                                    memberships[privateGroupMember.id] = 'member';
                                    memberships[publicUserMember.id] = 'member';
                                    memberships[loggedinUserMember.id] = 'member';
                                    memberships[privateUserMember.id] = 'member';

                                    // Set the members of the groups with the cam admin since they are the only ones with access to make the private
                                    // user a member
                                    RestAPI.Group.setGroupMembers(
                                      camAdminRestContext,
                                      targetPublicGroup.id,
                                      memberships,
                                      err => {
                                        assert.ok(!err);

                                        RestAPI.Group.setGroupMembers(
                                          camAdminRestContext,
                                          targetLoggedinGroup.id,
                                          memberships,
                                          err => {
                                            assert.ok(!err);

                                            RestAPI.Group.setGroupMembers(
                                              camAdminRestContext,
                                              targetPrivateGroup.id,
                                              memberships,
                                              err => {
                                                assert.ok(!err);
                                                return callback();
                                              }
                                            );
                                          }
                                        );
                                      }
                                    );
                                  }
                                );
                              }
                            );
                          }
                        );
                      }
                    );
                  }
                );
              }
            );
          }
        );
      }
    );
  });

  /**
   * Test that verifies a user cannot search members of something that is not a valid group id or non-existing group
   */
  it('verify cannot search for invalid or non-existent group', callback => {
    SearchTestsUtil.searchAll(
      anonymousRestContext,
      'members-library',
      ['not-a-group-id'],
      null,
      (err, results) => {
        assert.ok(err);
        assert.strictEqual(err.code, 400);
        assert.ok(!results);

        SearchTestsUtil.searchAll(
          anonymousRestContext,
          'members-library',
          [util.format('g:%s:nonexistent-group-id', global.oaeTests.tenants.cam.alias)],
          null,
          (err, results) => {
            assert.ok(err);
            assert.strictEqual(err.code, 404);
            assert.ok(!results);
            return callback();
          }
        );
      }
    );
  });

  /**
   * Test that verifies the member visibility of a group members search
   */
  it('verify public group members visibility', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, jack, jane) => {
      assert.ok(!err);
      TestsUtil.generateTestUsers(gtAdminRestContext, 1, (err, users, darthVader) => {
        assert.ok(!err);

        const changes = {};
        changes[jack.user.id] = 'member';
        RestAPI.Group.setGroupMembers(doerRestContext, targetPublicGroup.id, changes, err => {
          assert.ok(!err);

          // Verify results and visibility for anonymous user
          SearchTestsUtil.searchAll(
            anonymousRestContext,
            'members-library',
            [targetPublicGroup.id],
            null,
            (err, results) => {
              assert.ok(!err);
              const publicUserResult = _getDocById(results, publicUserMember.id);
              const loggedinUserResult = _getDocById(results, loggedinUserMember.id);
              const privateUserResult = _getDocById(results, privateUserMember.id);
              const privateGroupResult = _getDocById(results, privateGroupMember.id);
              const publicGroupResult = _getDocById(results, publicGroupMember.id);

              // Verify anonymous only sees public members
              assert.ok(publicUserResult);
              assert.ok(!loggedinUserResult);
              assert.ok(!privateUserResult);
              assert.ok(!privateGroupResult);
              assert.ok(publicGroupResult);

              // Verify user visibility. Loggedin and private should have their publicAlias swapped into the title
              assert.strictEqual(publicUserResult.displayName, publicUserMember.displayName);
              assert.strictEqual(publicGroupResult.displayName, publicGroupMember.displayName);

              // Verify that the correct resourceTypes are set
              assert.strictEqual(publicUserResult.resourceType, 'user');
              assert.strictEqual(publicGroupResult.resourceType, 'group');

              // Verify that the correct profilePaths are set
              assert.strictEqual(
                publicUserResult.profilePath,
                '/user/' +
                  publicUserResult.tenant.alias +
                  '/' +
                  AuthzUtil.getResourceFromId(publicUserResult.id).resourceId
              );
              assert.strictEqual(
                publicGroupResult.profilePath,
                '/group/' +
                  publicGroupResult.tenant.alias +
                  '/' +
                  AuthzUtil.getResourceFromId(publicGroupResult.id).resourceId
              );

              // Verify results and visibility for cross-tenant user
              SearchTestsUtil.searchAll(
                darthVader.restContext,
                'members-library',
                [targetPublicGroup.id],
                null,
                (err, results) => {
                  assert.ok(!err);

                  const publicUserResult = _getDocById(results, publicUserMember.id);
                  const loggedinUserResult = _getDocById(results, loggedinUserMember.id);
                  const privateUserResult = _getDocById(results, privateUserMember.id);
                  const privateGroupResult = _getDocById(results, privateGroupMember.id);
                  const publicGroupResult = _getDocById(results, publicGroupMember.id);

                  // Verify cross-tenant user only sees public members
                  assert.ok(publicUserResult);
                  assert.ok(!loggedinUserResult);
                  assert.ok(!privateUserResult);
                  assert.ok(!privateGroupResult);
                  assert.ok(publicGroupResult);

                  // Verify user visibility. Loggedin and private should have their publicAlias swapped into the title
                  assert.strictEqual(publicUserResult.displayName, publicUserMember.displayName);
                  assert.strictEqual(publicGroupResult.displayName, publicGroupMember.displayName);

                  // Verify that the correct resourceTypes are set
                  assert.strictEqual(publicUserResult.resourceType, 'user');
                  assert.strictEqual(publicGroupResult.resourceType, 'group');

                  // Verify that the correct profilePaths are set
                  assert.strictEqual(
                    publicUserResult.profilePath,
                    '/user/' +
                      publicUserResult.tenant.alias +
                      '/' +
                      AuthzUtil.getResourceFromId(publicUserResult.id).resourceId
                  );
                  assert.strictEqual(
                    publicGroupResult.profilePath,
                    '/group/' +
                      publicGroupResult.tenant.alias +
                      '/' +
                      AuthzUtil.getResourceFromId(publicGroupResult.id).resourceId
                  );

                  // Verify results and visibility for loggedin user
                  SearchTestsUtil.searchAll(
                    jane.restContext,
                    'members-library',
                    [targetPublicGroup.id],
                    null,
                    (err, results) => {
                      assert.ok(!err);
                      const publicUserResult = _getDocById(results, publicUserMember.id);
                      const loggedinUserResult = _getDocById(results, loggedinUserMember.id);
                      const privateUserResult = _getDocById(results, privateUserMember.id);
                      const privateGroupResult = _getDocById(results, privateGroupMember.id);
                      const publicGroupResult = _getDocById(results, publicGroupMember.id);

                      // Verify user doesn't see private users and groups
                      assert.ok(publicUserResult);
                      assert.ok(loggedinUserResult);
                      assert.ok(!privateUserResult);
                      assert.ok(!privateGroupResult);
                      assert.ok(publicGroupResult);

                      // Verify user visibility. Private should have their publicAlias swapped into the title
                      assert.strictEqual(
                        publicUserResult.displayName,
                        publicUserMember.displayName
                      );
                      assert.strictEqual(
                        loggedinUserResult.displayName,
                        loggedinUserMember.displayName
                      );

                      // There should be no extra right now because we haven't added extension properties
                      assert.ok(!loggedinUserResult.extra);

                      assert.strictEqual(loggedinUserResult._extra, undefined);
                      assert.strictEqual(loggedinUserResult.q_high, undefined);
                      assert.strictEqual(loggedinUserResult.q_low, undefined);
                      assert.strictEqual(loggedinUserResult.sort, undefined);
                      assert.strictEqual(
                        publicGroupResult.displayName,
                        publicGroupMember.displayName
                      );

                      // Verify that the correct resourceTypes are set
                      assert.strictEqual(publicUserResult.resourceType, 'user');
                      assert.strictEqual(publicGroupResult.resourceType, 'group');

                      // Verify that the correct profilePaths are set
                      assert.strictEqual(
                        publicUserResult.profilePath,
                        '/user/' +
                          publicUserResult.tenant.alias +
                          '/' +
                          AuthzUtil.getResourceFromId(publicUserResult.id).resourceId
                      );
                      assert.strictEqual(
                        loggedinUserResult.profilePath,
                        '/user/' +
                          loggedinUserResult.tenant.alias +
                          '/' +
                          AuthzUtil.getResourceFromId(loggedinUserResult.id).resourceId
                      );
                      assert.strictEqual(
                        publicGroupResult.profilePath,
                        '/group/' +
                          publicGroupResult.tenant.alias +
                          '/' +
                          AuthzUtil.getResourceFromId(publicGroupResult.id).resourceId
                      );

                      // Verify results and visibility for member user
                      SearchTestsUtil.searchAll(
                        jack.restContext,
                        'members-library',
                        [targetPublicGroup.id],
                        null,
                        (err, results) => {
                          assert.ok(!err);
                          const publicUserResult = _getDocById(results, publicUserMember.id);
                          const loggedinUserResult = _getDocById(results, loggedinUserMember.id);
                          const privateUserResult = _getDocById(results, privateUserMember.id);
                          const privateGroupResult = _getDocById(results, privateGroupMember.id);
                          const publicGroupResult = _getDocById(results, publicGroupMember.id);

                          // Verify member user sees all members, even private
                          assert.ok(publicUserResult);
                          assert.ok(loggedinUserResult);
                          assert.ok(privateUserResult);
                          assert.ok(privateGroupResult);
                          assert.ok(publicGroupResult);

                          // Verify user visibility. Private should have their publicAlias swapped into the title
                          assert.strictEqual(
                            publicUserResult.displayName,
                            publicUserMember.displayName
                          );
                          assert.strictEqual(
                            loggedinUserResult.displayName,
                            loggedinUserMember.displayName
                          );

                          // There should be no extra right now because we haven't added extension properties
                          assert.ok(!loggedinUserResult.extra);
                          assert.strictEqual(loggedinUserResult._extra, undefined);
                          assert.strictEqual(loggedinUserResult.q_high, undefined);
                          assert.strictEqual(loggedinUserResult.q_low, undefined);
                          assert.strictEqual(loggedinUserResult.sort, undefined);
                          assert.strictEqual(
                            privateUserResult.displayName,
                            privateUserMember.publicAlias
                          );
                          assert.strictEqual(
                            publicGroupResult.displayName,
                            publicGroupMember.displayName
                          );
                          assert.strictEqual(
                            privateGroupResult.displayName,
                            privateGroupMember.displayName
                          );

                          // Verify that the correct resourceTypes are set
                          assert.strictEqual(publicUserResult.resourceType, 'user');
                          assert.strictEqual(loggedinUserResult.resourceType, 'user');
                          assert.strictEqual(privateUserResult.resourceType, 'user');
                          assert.strictEqual(publicGroupResult.resourceType, 'group');
                          assert.strictEqual(privateGroupResult.resourceType, 'group');

                          // Verify that the correct profilePaths are set
                          assert.strictEqual(
                            publicUserResult.profilePath,
                            '/user/' +
                              publicUserResult.tenant.alias +
                              '/' +
                              AuthzUtil.getResourceFromId(publicUserResult.id).resourceId
                          );
                          assert.strictEqual(
                            loggedinUserResult.profilePath,
                            '/user/' +
                              loggedinUserResult.tenant.alias +
                              '/' +
                              AuthzUtil.getResourceFromId(loggedinUserResult.id).resourceId
                          );
                          assert.strictEqual(privateUserResult.profilePath, undefined);
                          assert.strictEqual(
                            publicGroupResult.profilePath,
                            '/group/' +
                              publicGroupResult.tenant.alias +
                              '/' +
                              AuthzUtil.getResourceFromId(publicGroupResult.id).resourceId
                          );
                          assert.strictEqual(
                            privateGroupResult.profilePath,
                            '/group/' +
                              privateGroupResult.tenant.alias +
                              '/' +
                              AuthzUtil.getResourceFromId(privateGroupResult.id).resourceId
                          );

                          return callback();
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        });
      });
    });
  });

  /**
   * Test that verifies that anonymous and cross-tenant users cannot see the group members of a loggedin group
   */
  it('verify loggedin group members access', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, jack, jane) => {
      assert.ok(!err);
      TestsUtil.generateTestUsers(gtAdminRestContext, 1, (err, users, darthVader) => {
        assert.ok(!err);

        const changes = {};
        changes[jack.user.id] = 'member';
        RestAPI.Group.setGroupMembers(doerRestContext, targetLoggedinGroup.id, changes, err => {
          assert.ok(!err);

          // Verify anonymous cannot see loggedin group
          SearchTestsUtil.searchAll(
            anonymousRestContext,
            'members-library',
            [targetLoggedinGroup.id],
            null,
            (err, results) => {
              assert.ok(err);
              assert.strictEqual(err.code, 401);
              assert.ok(!results);

              // Verify results and visibility for cross-tenant user. Cross-tenant user cannot see memberships of 'loggedin' groups from other tenants
              SearchTestsUtil.searchAll(
                darthVader.restContext,
                'members-library',
                [targetLoggedinGroup.id],
                null,
                (err, results) => {
                  assert.ok(err);
                  assert.strictEqual(err.code, 401);
                  assert.ok(!results);

                  // Verify results and visibility for loggedin user
                  SearchTestsUtil.searchAll(
                    jane.restContext,
                    'members-library',
                    [targetLoggedinGroup.id],
                    null,
                    (err, results) => {
                      assert.ok(!err);
                      const publicUserResult = _getDocById(results, publicUserMember.id);
                      const loggedinUserResult = _getDocById(results, loggedinUserMember.id);
                      const privateUserResult = _getDocById(results, privateUserMember.id);
                      const privateGroupResult = _getDocById(results, privateGroupMember.id);
                      const publicGroupResult = _getDocById(results, publicGroupMember.id);

                      // Verify only public and loggedin members are returned
                      assert.ok(publicUserResult);
                      assert.ok(loggedinUserResult);
                      assert.ok(!privateUserResult);
                      assert.ok(!privateGroupResult);
                      assert.ok(publicGroupResult);

                      // Verify user visibility. Private should have their publicAlias swapped into the title
                      assert.strictEqual(
                        publicUserResult.displayName,
                        publicUserMember.displayName
                      );
                      assert.strictEqual(
                        loggedinUserResult.displayName,
                        loggedinUserMember.displayName
                      );

                      // There should be no extra right now because we haven't added extension properties
                      assert.ok(!loggedinUserResult.extra);

                      assert.strictEqual(loggedinUserResult._extra, undefined);
                      assert.strictEqual(loggedinUserResult.q_high, undefined);
                      assert.strictEqual(loggedinUserResult.q_low, undefined);
                      assert.strictEqual(loggedinUserResult.sort, undefined);
                      assert.strictEqual(
                        publicGroupResult.displayName,
                        publicGroupMember.displayName
                      );

                      // Verify that the correct resourceTypes are set
                      assert.strictEqual(publicUserResult.resourceType, 'user');
                      assert.strictEqual(loggedinUserResult.resourceType, 'user');
                      assert.strictEqual(publicGroupResult.resourceType, 'group');

                      // Verify that the correct profilePaths are set
                      assert.strictEqual(
                        publicUserResult.profilePath,
                        '/user/' +
                          publicUserResult.tenant.alias +
                          '/' +
                          AuthzUtil.getResourceFromId(publicUserResult.id).resourceId
                      );
                      assert.strictEqual(
                        loggedinUserResult.profilePath,
                        '/user/' +
                          loggedinUserResult.tenant.alias +
                          '/' +
                          AuthzUtil.getResourceFromId(loggedinUserResult.id).resourceId
                      );
                      assert.strictEqual(
                        publicGroupResult.profilePath,
                        '/group/' +
                          publicGroupResult.tenant.alias +
                          '/' +
                          AuthzUtil.getResourceFromId(publicGroupResult.id).resourceId
                      );

                      // Verify results and visibility for member user
                      SearchTestsUtil.searchAll(
                        jack.restContext,
                        'members-library',
                        [targetLoggedinGroup.id],
                        null,
                        (err, results) => {
                          assert.ok(!err);
                          const publicUserResult = _getDocById(results, publicUserMember.id);
                          const loggedinUserResult = _getDocById(results, loggedinUserMember.id);
                          const privateUserResult = _getDocById(results, privateUserMember.id);
                          const privateGroupResult = _getDocById(results, privateGroupMember.id);
                          const publicGroupResult = _getDocById(results, publicGroupMember.id);

                          // Verify member sees all
                          assert.ok(publicUserResult);
                          assert.ok(loggedinUserResult);
                          assert.ok(privateUserResult);
                          assert.ok(privateGroupResult);
                          assert.ok(publicGroupResult);

                          // Verify user visibility. Private should have their publicAlias swapped into the title
                          assert.strictEqual(
                            publicUserResult.displayName,
                            publicUserMember.displayName
                          );
                          assert.strictEqual(
                            loggedinUserResult.displayName,
                            loggedinUserMember.displayName
                          );

                          // There should be no extra right now because we haven't added extension properties
                          assert.ok(!loggedinUserResult.extra);

                          assert.strictEqual(loggedinUserResult._extra, undefined);
                          assert.strictEqual(loggedinUserResult.q_high, undefined);
                          assert.strictEqual(loggedinUserResult.q_low, undefined);
                          assert.strictEqual(loggedinUserResult.sort, undefined);
                          assert.strictEqual(
                            privateUserResult.displayName,
                            privateUserMember.publicAlias
                          );
                          assert.strictEqual(
                            publicGroupResult.displayName,
                            publicGroupMember.displayName
                          );
                          assert.strictEqual(
                            privateGroupResult.displayName,
                            privateGroupMember.displayName
                          );

                          // Verify that the correct resourceTypes are set
                          assert.strictEqual(publicUserResult.resourceType, 'user');
                          assert.strictEqual(loggedinUserResult.resourceType, 'user');
                          assert.strictEqual(privateUserResult.resourceType, 'user');
                          assert.strictEqual(publicGroupResult.resourceType, 'group');
                          assert.strictEqual(privateGroupResult.resourceType, 'group');

                          // Verify that the correct profilePaths are set
                          assert.strictEqual(
                            publicUserResult.profilePath,
                            '/user/' +
                              publicUserResult.tenant.alias +
                              '/' +
                              AuthzUtil.getResourceFromId(publicUserResult.id).resourceId
                          );
                          assert.strictEqual(
                            loggedinUserResult.profilePath,
                            '/user/' +
                              loggedinUserResult.tenant.alias +
                              '/' +
                              AuthzUtil.getResourceFromId(loggedinUserResult.id).resourceId
                          );
                          assert.strictEqual(privateUserResult.profilePath, undefined);
                          assert.strictEqual(
                            publicGroupResult.profilePath,
                            '/group/' +
                              publicGroupResult.tenant.alias +
                              '/' +
                              AuthzUtil.getResourceFromId(publicGroupResult.id).resourceId
                          );
                          assert.strictEqual(
                            privateGroupResult.profilePath,
                            '/group/' +
                              privateGroupResult.tenant.alias +
                              '/' +
                              AuthzUtil.getResourceFromId(privateGroupResult.id).resourceId
                          );

                          return callback();
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        });
      });
    });
  });

  /**
   * Test that verifies only members can search the group members of a private group.
   */
  it('verify private group members access', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, jack, jane) => {
      assert.ok(!err);
      TestsUtil.generateTestUsers(gtAdminRestContext, 1, (err, users, darthVader) => {
        assert.ok(!err);

        const changes = {};
        changes[jack.user.id] = 'member';
        RestAPI.Group.setGroupMembers(doerRestContext, targetPrivateGroup.id, changes, err => {
          assert.ok(!err);

          // Verify anonymous cannot see members of private group
          SearchTestsUtil.searchAll(
            anonymousRestContext,
            'members-library',
            [targetPrivateGroup.id],
            null,
            (err, results) => {
              assert.ok(err);
              assert.strictEqual(err.code, 401);
              assert.ok(!results);

              // Verify cross-tenant user cannot see members of private group
              SearchTestsUtil.searchAll(
                darthVader.restContext,
                'members-library',
                [targetPrivateGroup.id],
                null,
                (err, results) => {
                  assert.ok(err);
                  assert.strictEqual(err.code, 401);
                  assert.ok(!results);

                  // Verify loggedin user cannot see members of private group
                  SearchTestsUtil.searchAll(
                    jane.restContext,
                    'members-library',
                    [targetPrivateGroup.id],
                    null,
                    (err, results) => {
                      assert.ok(err);
                      assert.strictEqual(err.code, 401);
                      assert.ok(!results);

                      // Verify results and visibility for member user
                      SearchTestsUtil.searchAll(
                        jack.restContext,
                        'members-library',
                        [targetPrivateGroup.id],
                        null,
                        (err, results) => {
                          assert.ok(!err);
                          const publicUserResult = _getDocById(results, publicUserMember.id);
                          const loggedinUserResult = _getDocById(results, loggedinUserMember.id);
                          const privateUserResult = _getDocById(results, privateUserMember.id);
                          const privateGroupResult = _getDocById(results, privateGroupMember.id);
                          const publicGroupResult = _getDocById(results, publicGroupMember.id);

                          // Verify member sees all
                          assert.ok(publicUserResult);
                          assert.ok(loggedinUserResult);
                          assert.ok(privateUserResult);
                          assert.ok(privateGroupResult);
                          assert.ok(publicGroupResult);

                          // Verify user visibility. Private should have their publicAlias swapped into the title
                          assert.strictEqual(
                            publicUserResult.displayName,
                            publicUserMember.displayName
                          );
                          assert.strictEqual(
                            loggedinUserResult.displayName,
                            loggedinUserMember.displayName
                          );

                          // There should be no extra right now because we haven't added extension properties
                          assert.ok(!loggedinUserResult.extra);

                          assert.strictEqual(loggedinUserResult._extra, undefined);
                          assert.strictEqual(loggedinUserResult.q_high, undefined);
                          assert.strictEqual(loggedinUserResult.q_low, undefined);
                          assert.strictEqual(loggedinUserResult.sort, undefined);
                          assert.strictEqual(
                            privateUserResult.displayName,
                            privateUserMember.publicAlias
                          );
                          assert.strictEqual(
                            publicGroupResult.displayName,
                            publicGroupMember.displayName
                          );
                          assert.strictEqual(
                            privateGroupResult.displayName,
                            privateGroupMember.displayName
                          );

                          // Verify that the correct resourceTypes are set
                          assert.strictEqual(publicUserResult.resourceType, 'user');
                          assert.strictEqual(loggedinUserResult.resourceType, 'user');
                          assert.strictEqual(privateUserResult.resourceType, 'user');
                          assert.strictEqual(publicGroupResult.resourceType, 'group');
                          assert.strictEqual(privateGroupResult.resourceType, 'group');

                          // Verify that the correct profilePaths are set
                          assert.strictEqual(
                            publicUserResult.profilePath,
                            '/user/' +
                              publicUserResult.tenant.alias +
                              '/' +
                              AuthzUtil.getResourceFromId(publicUserResult.id).resourceId
                          );
                          assert.strictEqual(
                            loggedinUserResult.profilePath,
                            '/user/' +
                              loggedinUserResult.tenant.alias +
                              '/' +
                              AuthzUtil.getResourceFromId(loggedinUserResult.id).resourceId
                          );
                          assert.strictEqual(privateUserResult.profilePath, undefined);
                          assert.strictEqual(
                            publicGroupResult.profilePath,
                            '/group/' +
                              publicGroupResult.tenant.alias +
                              '/' +
                              AuthzUtil.getResourceFromId(publicGroupResult.id).resourceId
                          );
                          assert.strictEqual(
                            privateGroupResult.profilePath,
                            '/group/' +
                              privateGroupResult.tenant.alias +
                              '/' +
                              AuthzUtil.getResourceFromId(privateGroupResult.id).resourceId
                          );

                          return callback();
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        });
      });
    });
  });

  /**
   * Test that verifies when a member is removed from a group, that principal no longer turns up in the members search.
   */
  it('verify remove from group reflects in members', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, jack, jane) => {
      assert.ok(!err);

      const changes = {};
      changes[jack.user.id] = 'member';
      RestAPI.Group.setGroupMembers(doerRestContext, targetLoggedinGroup.id, changes, err => {
        assert.ok(!err);

        // Verify jack exists for jane
        SearchTestsUtil.searchAll(
          jane.restContext,
          'members-library',
          [targetLoggedinGroup.id],
          null,
          (err, results) => {
            assert.ok(!err);
            const jackDoc = _getDocById(results, jack.user.id);
            assert.ok(jackDoc);

            // Remove jack and verify he no longer returns in searches
            changes[jack.user.id] = false;
            RestAPI.Group.setGroupMembers(doerRestContext, targetLoggedinGroup.id, changes, err => {
              assert.ok(!err);

              SearchTestsUtil.searchAll(
                jane.restContext,
                'members-library',
                [targetLoggedinGroup.id],
                null,
                (err, results) => {
                  assert.ok(!err);
                  const jackDoc = _getDocById(results, jack.user.id);
                  assert.ok(!jackDoc);
                  return callback();
                }
              );
            });
          }
        );
      });
    });
  });

  /**
   * Test that verifies paging in the members search feed
   */
  it('verify paging works correcly in the members search', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, jack, jane) => {
      assert.ok(!err);

      const changes = {};
      changes[jack.user.id] = 'member';
      changes[jane.user.id] = 'member';
      RestAPI.Group.setGroupMembers(doerRestContext, targetLoggedinGroup.id, changes, err => {
        assert.ok(!err);

        // Grab the first 2 members of the group, we will page these 2
        SearchTestsUtil.searchRefreshed(
          doerRestContext,
          'members-library',
          [targetLoggedinGroup.id],
          { limit: 2, start: 0 },
          (err, results) => {
            assert.ok(!err);
            assert.ok(results.results);
            assert.strictEqual(results.results.length, 2);

            // Get the ids of the first 2 expected results.
            const firstId = results.results[0].id;
            const secondId = results.results[1].id;

            assert.ok(firstId);
            assert.ok(secondId);

            // Get the first page, ensure it is the first document. We don't need refreshing because we haven't updated anything since the previous refresh
            RestAPI.Search.search(
              doerRestContext,
              'members-library',
              [targetLoggedinGroup.id],
              { limit: 1, start: 0 },
              (err, results) => {
                assert.ok(!err);
                assert.ok(results.results);
                assert.strictEqual(results.results.length, 1);
                assert.strictEqual(results.results[0].id, firstId);

                // Get the second page, ensure it is the second document
                RestAPI.Search.search(
                  doerRestContext,
                  'members-library',
                  [targetLoggedinGroup.id],
                  { limit: 1, start: 1 },
                  (err, results) => {
                    assert.ok(!err);
                    assert.ok(results.results);
                    assert.strictEqual(results.results.length, 1);
                    assert.strictEqual(results.results[0].id, secondId);
                    return callback();
                  }
                );
              }
            );
          }
        );
      });
    });
  });
});
