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

import assert from 'node:assert';
import {
  values,
  mergeAll,
  not,
  assoc,
  pluck,
  map,
  path,
  of,
  is,
  __,
  compose,
  length,
  prop,
  toUpper,
  toLower,
  tail,
  isEmpty,
  head
} from 'ramda';

import { loginOnTenant } from 'oae-rest/lib/api.admin.js';
import { createLink } from 'oae-rest/lib/api.content.js';
import { createGroup } from 'oae-rest/lib/api.group.js';
import { createDiscussion } from 'oae-rest/lib/api.discussions.js';
import { flush } from 'oae-util/lib/redis.js';
import { assertVerifyEmailsSucceeds, assertUpdateUsersSucceeds } from 'oae-principals/lib/test/util.js';
import {
  whenIndexingComplete,
  assertSearchContains,
  assertSearchSucceeds,
  assertSearchNotContains,
  assertSearchEquals,
  assertSearchFails
} from 'oae-search/lib/test/util.js';
import {
  generateTestUsers,
  createTenantRestContext,
  createGlobalAdminRestContext,
  createTenantAdminRestContext,
  setupMultiTenantPrivacyEntities
} from 'oae-tests';
import { assertCreateFolderSucceeds } from 'oae-folders/lib/test/util.js';

const PUBLIC_USER = 'publicUser';
const PRIVATE_USER = 'privateUser';
const LOGGEDIN_USER = 'loggedinUser';
const EMAIL = 'email';
const PUBLIC = 'public';
const GENERAL = 'general';
const YES = 'yes';
const LOCALHOST = 'localhost';
const EMPTY_ARRAY = [];
const NO_PARAMS = null;
const NO_MANAGERS = null;
const NO_MEMBERS = null;
const NO_VIEWERS = null;
const NO_MANAGER_INFOS = null;
const NO_VIEWER_INFOS = null;
const NO_FOLDERS = [];

const getId = prop('id');
const getUserId = path(['user', 'id']);
const getEmail = path(['user', 'email']);
const getContext = prop('restContext');
const getUser = prop('user');
const isObject = is(Object);
const isGuestTenant = path(['tenant', 'isGuestTenant']);
const getTenantAlias = path(['tenant', 'alias']);

describe('Email Search', () => {
  // Rest context that can be used every time we need to make a request as an anonymous user
  let asAnonymousUser = null;

  // Rest context that can be used every time we need to make a request as a tenant admin
  let asTenantAdmin = null;

  // Rest context that can be used every time we need to make a request as a global admin
  let asGlobalAdmin = null;

  before((done) => flush(done));

  /**
   * Function that will fill up the anonymous and admin REST context.
   *
   * Because we truncate the `Principals` table in one of our tests we need
   * to re-create the rest contexts for each test so we can ensure our admin
   * session will always point to a valid principal record
   */
  beforeEach((callback) => {
    const someTenantHost = global.oaeTests.tenants.cam.host;

    asAnonymousUser = createTenantRestContext(someTenantHost);
    asTenantAdmin = createTenantAdminRestContext(someTenantHost);
    asGlobalAdmin = createGlobalAdminRestContext();

    /**
     * Log the global admin into a tenant so we can perform user-tenant requests with a
     * global admin to test their access
     */
    const targetInternalUrl = null;
    loginOnTenant(asGlobalAdmin, LOCALHOST, targetInternalUrl, (error, ctx) => {
      assert.ok(not(error));
      asGlobalAdmin = ctx;

      callback();
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
  const _runEmailSearchInteractionTests = function (tests, callback) {
    if (isEmpty(tests)) return callback();

    const nextTest = head(tests);
    const someUserContext = nextTest.restCtx;
    const someUserEmail = nextTest.target.email;
    const someUserId = nextTest.target.id;

    const isTestVisible = prop('visible', nextTest);
    const numberOfResults = compose(length, prop('results'));

    let assertToRun = assertSearchNotContains;
    let expectedResultCount = 0;
    if (isTestVisible) {
      assertToRun = assertSearchContains;
      expectedResultCount = 1;
    }

    assertToRun(someUserContext, EMAIL, NO_PARAMS, { q: someUserEmail }, of(someUserId), (response) => {
      assert.strictEqual(numberOfResults(response), expectedResultCount);

      // Also search in all uppers and all lowers to verify search case insensitivity
      assertToRun(nextTest.restCtx, EMAIL, NO_PARAMS, { q: toUpper(someUserEmail) }, of(someUserId), (response) => {
        assert.strictEqual(numberOfResults(response), expectedResultCount);

        assertToRun(nextTest.restCtx, EMAIL, NO_PARAMS, { q: toLower(someUserEmail) }, of(someUserId), (response) => {
          assert.strictEqual(numberOfResults(response), expectedResultCount);

          tests = tail(tests);
          return _runEmailSearchInteractionTests(tests, callback);
        });
      });
    });
  };

  /**
   * Test that verifies email search authorizes search properly
   */
  it('verify authorization of email search', (callback) => {
    generateTestUsers(asTenantAdmin, 1, EMPTY_ARRAY, (error, users) => {
      assert.ok(not(error));

      const johnDoe = head(users);
      const asJohnDoe = johnDoe.restContext;
      const johnDoeId = johnDoe.user.id;
      const johnDoeEmail = johnDoe.user.email;

      // Only authenticated users can search by email
      assertSearchFails(asAnonymousUser, EMAIL, NO_PARAMS, { q: johnDoeEmail }, 401, () => {
        assertSearchEquals(asJohnDoe, EMAIL, NO_PARAMS, { q: johnDoeEmail }, [johnDoeId], () => {
          assertSearchEquals(asTenantAdmin, EMAIL, NO_PARAMS, { q: johnDoeEmail }, [johnDoeId], () => {
            assertSearchEquals(asGlobalAdmin, EMAIL, NO_PARAMS, { q: johnDoeEmail }, [johnDoeId], () => callback());
          });
        });
      });
    });
  });

  /**
   * Test that verifies email search validates input properly
   */
  it('verify validation of email search', (callback) => {
    generateTestUsers(asTenantAdmin, 1, EMPTY_ARRAY, (error, users) => {
      assert.ok(not(error));

      const johnDoe = head(users);
      const asJohnDoe = johnDoe.restContext;
      const johnDoeId = johnDoe.user.id;
      const johnDoeEmail = johnDoe.user.email;

      // Missing and invalid email should fail
      assertSearchFails(asJohnDoe, EMAIL, NO_PARAMS, null, 400, () => {
        assertSearchFails(asJohnDoe, EMAIL, NO_PARAMS, { q: 'notanemail' }, 400, () => {
          // Sanity check user can perform an email search
          assertSearchEquals(asJohnDoe, EMAIL, NO_PARAMS, { q: johnDoeEmail }, [johnDoeId], () => callback());
        });
      });
    });
  });

  /**
   * Test that verifies that exact email search bypasses user profile visibility boundaries, but
   * does not violate tenant privacy boundaries
   */
  it('verify email search does not violate tenant interaction boundaries', (callback) => {
    setupMultiTenantPrivacyEntities((publicTenant0, publicTenant1, privateTenant0, privateTenant1) => {
      const fromPublicTenant0 = prop(__, publicTenant0);
      const publicUserFromPublicTenant0 = fromPublicTenant0(PUBLIC_USER);
      const loggedinUserFromPublicTenant0 = fromPublicTenant0(LOGGEDIN_USER);
      const privateUserFromPublicTenant0 = fromPublicTenant0(PRIVATE_USER);

      const fromPrivateTenant0 = prop(__, privateTenant0);
      const publicUserFromPrivateTenant0 = fromPrivateTenant0(PUBLIC_USER);
      const loggedinUserFromPrivateTenant0 = fromPrivateTenant0(LOGGEDIN_USER);
      const privateUserFromPrivateTenant0 = fromPrivateTenant0(PRIVATE_USER);

      const fromPublicTenant1 = prop(__, publicTenant1);
      const publicUserFromPublicTenant1 = fromPublicTenant1(PUBLIC_USER);
      const loggedinUserFromPublicTenant1 = fromPublicTenant1(LOGGEDIN_USER);
      const privateUserFromPublicTenant1 = fromPublicTenant1(PRIVATE_USER);

      const fromPrivateTenant1 = prop(__, privateTenant1);
      const publicUserFromPrivateTenant1 = fromPrivateTenant1(PUBLIC_USER);
      const loggedinUserFromPrivateTenant1 = fromPrivateTenant1(LOGGEDIN_USER);
      const privateUserFromPrivateTenant1 = fromPrivateTenant1(PRIVATE_USER);

      _runEmailSearchInteractionTests(
        [
          // Public tenant user interaction with same-tenant users
          {
            restCtx: getContext(publicUserFromPublicTenant0),
            target: getUser(publicUserFromPublicTenant0),
            visible: true
          },
          {
            restCtx: getContext(publicUserFromPublicTenant0),
            target: getUser(loggedinUserFromPublicTenant0),
            visible: true
          },
          {
            restCtx: getContext(publicUserFromPublicTenant0),
            target: getUser(privateUserFromPublicTenant0),
            visible: true
          },

          // Public tenant user interaction with external public tenant users
          {
            restCtx: getContext(publicUserFromPublicTenant0),
            target: getUser(publicUserFromPublicTenant1),
            visible: true
          },
          {
            restCtx: getContext(publicUserFromPublicTenant0),
            target: getUser(loggedinUserFromPublicTenant1),
            visible: true
          },
          {
            restCtx: getContext(publicUserFromPublicTenant0),
            target: getUser(privateUserFromPublicTenant1),
            visible: true
          },

          // Public tenant user interaction with external private tenant users
          {
            restCtx: getContext(publicUserFromPublicTenant0),
            target: getUser(publicUserFromPrivateTenant0),
            visible: false
          },
          {
            restCtx: getContext(publicUserFromPublicTenant0),
            target: getUser(loggedinUserFromPrivateTenant0),
            visible: false
          },
          {
            restCtx: getContext(publicUserFromPublicTenant0),
            target: getUser(privateUserFromPrivateTenant0),
            visible: false
          },

          // Private tenant user interaction with same-tenant users
          {
            restCtx: getContext(publicUserFromPrivateTenant0),
            target: getUser(publicUserFromPrivateTenant0),
            visible: true
          },
          {
            restCtx: getContext(publicUserFromPrivateTenant0),
            target: getUser(loggedinUserFromPrivateTenant0),
            visible: true
          },
          {
            restCtx: getContext(publicUserFromPrivateTenant0),
            target: getUser(privateUserFromPrivateTenant0),
            visible: true
          },

          // Private tenant user interaction with external public tenant users
          {
            restCtx: getContext(publicUserFromPrivateTenant0),
            target: getUser(publicUserFromPublicTenant0),
            visible: false
          },
          {
            restCtx: getContext(publicUserFromPrivateTenant0),
            target: getUser(loggedinUserFromPublicTenant0),
            visible: false
          },
          {
            restCtx: getContext(publicUserFromPrivateTenant0),
            target: getUser(privateUserFromPublicTenant0),
            visible: false
          },

          // Private tenant user interaction with external private tenant users
          {
            restCtx: getContext(publicUserFromPrivateTenant0),
            target: getUser(publicUserFromPrivateTenant1),
            visible: false
          },
          {
            restCtx: getContext(publicUserFromPrivateTenant0),
            target: getUser(loggedinUserFromPrivateTenant1),
            visible: false
          },
          {
            restCtx: getContext(publicUserFromPrivateTenant0),
            target: getUser(privateUserFromPrivateTenant1),
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
  it('verify email search returns all users that match a particular email', (callback) => {
    generateTestUsers(asTenantAdmin, 3, EMPTY_ARRAY, (error, createdUsers) => {
      assert.ok(not(error));

      const [fonseca, meireles, barbosa] = createdUsers;

      const userInfos = compose(
        mergeAll,
        map((each) => assoc(getUserId(each), each, {}))
      )([fonseca, meireles, barbosa]);
      const allUserIds = map(getUserId, [fonseca, meireles, barbosa]);
      const userIdsToUpdate = map(getUserId, [meireles, barbosa]);

      assertUpdateUsersSucceeds(asTenantAdmin, userIdsToUpdate, { email: getEmail(fonseca) }, (users, tokens) => {
        const userInfoTokens = compose(
          values,
          map((eachUser) => ({
            token: prop(getId(eachUser), tokens),
            userInfo: {
              restContext: getContext(prop(getId(eachUser), userInfos)),
              user: prop(getId(eachUser), users)
            }
          }))
        )(users);

        assertVerifyEmailsSucceeds(userInfoTokens, () => {
          /**
           * Create one of each resource with the email address as the display name so
           * we can ensure they don't come out of the search
           */
          createLink(
            getContext(fonseca),
            {
              displayName: getEmail(fonseca),
              description: getEmail(fonseca),
              visibility: PUBLIC,
              link: 'google.com',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, link) => {
              assert.ok(not(error));

              createGroup(
                getContext(fonseca),
                getEmail(fonseca),
                getEmail(fonseca),
                PUBLIC,
                YES,
                NO_MANAGERS,
                NO_MEMBERS,
                (error, group) => {
                  assert.ok(not(error));

                  createDiscussion(
                    getContext(fonseca),
                    getEmail(fonseca),
                    getEmail(fonseca),
                    PUBLIC,
                    NO_MANAGERS,
                    NO_MEMBERS,
                    (error, discussion) => {
                      assert.ok(not(error));

                      assertCreateFolderSucceeds(
                        getContext(fonseca),
                        getEmail(fonseca),
                        getEmail(fonseca),
                        PUBLIC,
                        NO_MANAGER_INFOS,
                        NO_VIEWER_INFOS,
                        (folder) => {
                          whenIndexingComplete(() => {
                            /**
                             * Sanity check that the resources we just created can be
                             * searched with the email
                             */
                            const allResourceIds = pluck('id', [link, group, discussion, folder]);

                            assertSearchContains(
                              getContext(fonseca),
                              GENERAL,
                              NO_PARAMS,
                              { q: getEmail(fonseca) },
                              allResourceIds,
                              () => {
                                // Now ensure that only the users come out of the email search
                                assertSearchEquals(
                                  getContext(fonseca),
                                  EMAIL,
                                  NO_PARAMS,
                                  { q: getEmail(fonseca) },
                                  allUserIds,
                                  () => callback()
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
      });
    });
  });

  /**
   * Test that verifies that the email search endpoint returns the tenant that matches the email domain
   */
  it('verify email search returns the tenant that matches the email domain', (callback) => {
    setupMultiTenantPrivacyEntities((publicTenant0, publicTenant1, privateTenant0, privateTenant1) => {
      const fromPublicTenant0 = prop(__, publicTenant0);
      const publicUserFromPublicTenant0 = fromPublicTenant0(PUBLIC_USER);

      const fromPrivateTenant1 = prop(__, privateTenant1);
      const publicUserFromPrivateTenant1 = fromPrivateTenant1(PUBLIC_USER);

      whenIndexingComplete(() => {
        assertSearchSucceeds(
          getContext(publicUserFromPublicTenant0),
          EMAIL,
          NO_PARAMS,
          { q: getEmail(publicUserFromPrivateTenant1) },
          (data) => {
            assert.ok(isObject(data.tenant));
            assert.ok(not(isGuestTenant(data)));
            assert.strictEqual(getTenantAlias(data), getTenantAlias(privateTenant1));

            // Search for an email address that would end up on the guest tenant
            assertSearchSucceeds(
              getContext(publicUserFromPublicTenant0),
              EMAIL,
              NO_PARAMS,
              { q: 'an.email@ends.up.on.the.guest.tenant.com' },
              (data) => {
                assert.ok(isObject(data.tenant));
                assert.ok(isGuestTenant(data));

                return callback();
              }
            );
          }
        );
      });
    });
  });
});
