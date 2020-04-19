/*!
 * Copyright 2015 Apereo Foundation (AF) Licensed under the
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
import _ from 'underscore';

import * as FoldersTestUtil from 'oae-folders/lib/test/util';
import * as PrincipalsTestUtil from 'oae-principals/lib/test/util';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import * as SearchTestUtil from 'oae-search/lib/test/util';

const PUBLIC = 'public';

describe('Email Search', () => {
  // Rest context that can be used every time we need to make a request as an anonymous user
  let anonymousRestContext = null;
  // Rest contexts that can be used every time we need to make a request as a tenant admin
  let camAdminRestContext = null;
  // Rest context that can be used every time we need to make a request as a global admin
  let globalAdminRestContext = null;
  let globalAdminOnTenantRestContext = null;

  /**
   * Function that will fill up the anonymous and admin REST context.
   *
   * Because we truncate the `Principals` table in one of our tests we need
   * to re-create the rest contexts for each test so we can ensure our admin
   * session will always point to a valid principal record
   */
  beforeEach(callback => {
    // Fill up anonymous rest context
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    // Fill up tenant admin rest contexts
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    // Fill up global admin rest context
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();

    // Log the global admin into a tenant so we can perform user-tenant requests with a global admin to test their access
    RestAPI.Admin.loginOnTenant(globalAdminRestContext, 'localhost', null, (err, ctx) => {
      assert.ok(!err);
      globalAdminOnTenantRestContext = ctx;
      return callback();
    });
  });

  /**
   * Run all the email search interaction tests
   *
   * @param  {Object[]}       tests               The array of test objects to execute
   * @param  {RestContext}    tests[i].restCtx    The rest context to use to run the email search request
   * @param  {User}           tests[i].target     The user who we will search for
   * @param  {Boolean}        tests[i].visible    Whether or not we expect the user to be in the search results
   * @param  {Function}       callback            Invoked when all tests and assertions have completed
   */
  const _runEmailSearchInteractionTests = function(tests, callback) {
    if (_.isEmpty(tests)) {
      return callback();
    }

    const test = tests.pop();
    const fn = test.visible ? SearchTestUtil.assertSearchContains : SearchTestUtil.assertSearchNotContains;
    const expectedResultCount = test.visible ? 1 : 0;
    fn(test.restCtx, 'email', null, { q: test.target.email }, [test.target.id], response => {
      assert.strictEqual(response.results.length, expectedResultCount);

      // Also search in all uppers and all lowers to verify search case insensitivity
      fn(test.restCtx, 'email', null, { q: test.target.email.toUpperCase() }, [test.target.id], response => {
        assert.strictEqual(response.results.length, expectedResultCount);
        fn(test.restCtx, 'email', null, { q: test.target.email.toLowerCase() }, [test.target.id], response => {
          assert.strictEqual(response.results.length, expectedResultCount);

          return _runEmailSearchInteractionTests(tests, callback);
        });
      });
    });
  };

  /**
   * Test that verifies email search authorizes search properly
   */
  it('verify authorization of email search', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, user) => {
      assert.ok(!err);

      // Only authenticated users can search by email
      SearchTestUtil.assertSearchFails(anonymousRestContext, 'email', null, { q: user.user.email }, 401, () => {
        SearchTestUtil.assertSearchEquals(
          user.restContext,
          'email',
          null,
          { q: user.user.email },
          [user.user.id],
          () => {
            SearchTestUtil.assertSearchEquals(
              camAdminRestContext,
              'email',
              null,
              { q: user.user.email },
              [user.user.id],
              () => {
                SearchTestUtil.assertSearchEquals(
                  globalAdminOnTenantRestContext,
                  'email',
                  null,
                  { q: user.user.email },
                  [user.user.id],
                  () => {
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

  /**
   * Test that verifies email search validates input properly
   */
  it('verify validation of email search', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, user) => {
      assert.ok(!err);

      // Missing and invalid email should fail
      SearchTestUtil.assertSearchFails(user.restContext, 'email', null, null, 400, () => {
        SearchTestUtil.assertSearchFails(user.restContext, 'email', null, { q: 'notanemail' }, 400, () => {
          // Sanity check user can perform an email search
          SearchTestUtil.assertSearchEquals(
            user.restContext,
            'email',
            null,
            { q: user.user.email },
            [user.user.id],
            () => {
              return callback();
            }
          );
        });
      });
    });
  });

  /**
   * Test that verifies that exact email search bypasses user profile visibility boundaries, but
   * does not violate tenant privacy boundaries
   */
  it('verify email search does not violate tenant interaction boundaries', callback => {
    TestsUtil.setupMultiTenantPrivacyEntities((publicTenant0, publicTenant1, privateTenant0, privateTenant1) => {
      _runEmailSearchInteractionTests(
        [
          // Public tenant user interaction with same-tenant users
          {
            restCtx: publicTenant0.publicUser.restContext,
            target: publicTenant0.publicUser.user,
            visible: true
          },
          {
            restCtx: publicTenant0.publicUser.restContext,
            target: publicTenant0.loggedinUser.user,
            visible: true
          },
          {
            restCtx: publicTenant0.publicUser.restContext,
            target: publicTenant0.privateUser.user,
            visible: true
          },

          // Public tenant user interaction with external public tenant users
          {
            restCtx: publicTenant0.publicUser.restContext,
            target: publicTenant1.publicUser.user,
            visible: true
          },
          {
            restCtx: publicTenant0.publicUser.restContext,
            target: publicTenant1.loggedinUser.user,
            visible: true
          },
          {
            restCtx: publicTenant0.publicUser.restContext,
            target: publicTenant1.privateUser.user,
            visible: true
          },

          // Public tenant user interaction with external private tenant users
          {
            restCtx: publicTenant0.publicUser.restContext,
            target: privateTenant0.publicUser.user,
            visible: false
          },
          {
            restCtx: publicTenant0.publicUser.restContext,
            target: privateTenant0.loggedinUser.user,
            visible: false
          },
          {
            restCtx: publicTenant0.publicUser.restContext,
            target: privateTenant0.privateUser.user,
            visible: false
          },

          // Private tenant user interaction with same-tenant users
          {
            restCtx: privateTenant0.publicUser.restContext,
            target: privateTenant0.publicUser.user,
            visible: true
          },
          {
            restCtx: privateTenant0.publicUser.restContext,
            target: privateTenant0.loggedinUser.user,
            visible: true
          },
          {
            restCtx: privateTenant0.publicUser.restContext,
            target: privateTenant0.privateUser.user,
            visible: true
          },

          // Private tenant user interaction with external public tenant users
          {
            restCtx: privateTenant0.publicUser.restContext,
            target: publicTenant0.publicUser.user,
            visible: false
          },
          {
            restCtx: privateTenant0.publicUser.restContext,
            target: publicTenant0.loggedinUser.user,
            visible: false
          },
          {
            restCtx: privateTenant0.publicUser.restContext,
            target: publicTenant0.privateUser.user,
            visible: false
          },

          // Private tenant user interaction with external private tenant users
          {
            restCtx: privateTenant0.publicUser.restContext,
            target: privateTenant1.publicUser.user,
            visible: false
          },
          {
            restCtx: privateTenant0.publicUser.restContext,
            target: privateTenant1.loggedinUser.user,
            visible: false
          },
          {
            restCtx: privateTenant0.publicUser.restContext,
            target: privateTenant1.privateUser.user,
            visible: false
          }
        ],
        callback
      );
    });
  });

  /**
   * Test that verifies interact scope will return all users that match a given email address
   */
  it('verify email search returns all users that match a particular email', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, userInfos, userInfo0, userInfo1, userInfo2) => {
      assert.ok(!err);

      const allUserIds = _.chain([userInfo0, userInfo1, userInfo2])
        .pluck('user')
        .pluck('id')
        .value();
      const updateUserIds = _.chain([userInfo1, userInfo2])
        .pluck('user')
        .pluck('id')
        .value();
      PrincipalsTestUtil.assertUpdateUsersSucceeds(
        camAdminRestContext,
        updateUserIds,
        { email: userInfo0.user.email },
        (users, tokens) => {
          const userInfoTokens = _.map(users, user => {
            return {
              token: tokens[user.id],
              userInfo: {
                restContext: userInfos[user.id].restContext,
                user: users[user.id]
              }
            };
          });

          PrincipalsTestUtil.assertVerifyEmailsSucceeds(userInfoTokens, () => {
            // Create one of each resource with the email address as the display name so
            // we can ensure they don't come out of the search
            RestAPI.Content.createLink(
              userInfo0.restContext,
              {
                displayName: userInfo0.user.email,
                description: userInfo0.user.email,
                visibility: PUBLIC,
                link: 'google.com',
                managers: [],
                viewers: [],
                folders: []
              },
              (err, link) => {
                assert.ok(!err);
                RestAPI.Group.createGroup(
                  userInfo0.restContext,
                  userInfo0.user.email,
                  userInfo0.user.email,
                  'public',
                  'yes',
                  null,
                  null,
                  (err, group) => {
                    assert.ok(!err);
                    RestAPI.Discussions.createDiscussion(
                      userInfo0.restContext,
                      userInfo0.user.email,
                      userInfo0.user.email,
                      'public',
                      null,
                      null,
                      (err, discussion) => {
                        assert.ok(!err);
                        FoldersTestUtil.assertCreateFolderSucceeds(
                          userInfo0.restContext,
                          userInfo0.user.email,
                          userInfo0.user.email,
                          'public',
                          null,
                          null,
                          folder => {
                            SearchTestUtil.whenIndexingComplete(() => {
                              // Sanity check that the resources we just created can be searched with the email
                              const allResourceIds = _.pluck([link, group, discussion, folder], 'id');
                              SearchTestUtil.assertSearchContains(
                                userInfo0.restContext,
                                'general',
                                null,
                                { q: userInfo0.user.email },
                                allResourceIds,
                                () => {
                                  // Now ensure that only the users come out of the email search
                                  SearchTestUtil.assertSearchEquals(
                                    userInfo0.restContext,
                                    'email',
                                    null,
                                    { q: userInfo0.user.email },
                                    allUserIds,
                                    () => {
                                      return callback();
                                    }
                                  );
                                }
                              );
                            });
                          }
                        );
                      }
                    );
                  }
                );
              }
            );
          });
        }
      );
    });
  });

  /**
   * Test that verifies that the email search endpoint returns the tenant that matches the email domain
   */
  it('verify email search returns the tenant that matches the email domain', callback => {
    TestsUtil.setupMultiTenantPrivacyEntities((publicTenant0, publicTenant1, privateTenant0, privateTenant1) => {
      SearchTestUtil.whenIndexingComplete(() => {
        SearchTestUtil.assertSearchSucceeds(
          publicTenant0.publicUser.restContext,
          'email',
          null,
          { q: privateTenant1.publicUser.user.email },
          data => {
            assert.ok(_.isObject(data.tenant));
            assert.ok(!data.tenant.isGuestTenant);
            assert.strictEqual(data.tenant.alias, privateTenant1.tenant.alias);

            // Search for an email address that would end up on the guest tenant
            SearchTestUtil.assertSearchSucceeds(
              publicTenant0.publicUser.restContext,
              'email',
              null,
              { q: 'an.email@ends.up.on.the.guest.tenant.com' },
              data => {
                assert.ok(_.isObject(data.tenant));
                assert.ok(data.tenant.isGuestTenant);
                return callback();
              }
            );
          }
        );
      });
    });
  });
});
