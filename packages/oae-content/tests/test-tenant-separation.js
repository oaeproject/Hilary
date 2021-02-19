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

import { assert } from 'chai';
import { format } from 'util';

import * as AuthzUtil from 'oae-authz/lib/util';
import * as ConfigTestUtil from 'oae-config/lib/test/util';
import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests';
import * as ContentTestUtil from 'oae-content/lib/test/util';

import { pathSatisfies, is, map, prop, last, propSatisfies, equals, find } from 'ramda';

const isString = is(String);
const is200 = equals(200);

const { getMembers, updateMembers, createLink, getLibrary, getContent, shareContent } = RestAPI.Content;
const { getMe } = RestAPI.User;
const { isEmail } = AuthzUtil;
const { createGroup } = RestAPI.Group;
const { updateConfigAndWait } = ConfigTestUtil;
const { setupMultiTenantPrivacyEntities } = ContentTestUtil;
const {
  createTenantAdminRestContext,
  createGlobalAdminRestContext,
  generateTestUserId,
  generateTestGroups,
  generateTestUsers
} = TestsUtil;

const ID = 'id';
const PROFILE = 'profile';
const PUBLIC = 'public';
const NOT_JOINABLE = 'no';
const MANAGER = 'manager';
const LOGGED_IN = 'loggedin';
const NO_VIEWERS = [];
const NO_MANAGERS = [];
const NO_FOLDERS = [];

describe('Content', () => {
  // Rest contexts that can be used every time we need to make a request as a tenant admin
  let asCambridgeTenantAdmin = null;
  let asGeorgiaTenantAdmin = null;
  // Rest context that can be used every time we need to make a request as a global admin
  let asGlobalAdmin = null;

  /**
   * Function that will fill up the anonymous and tenant admin REST context
   */
  before((callback) => {
    // Fill up tenant admin rest contexts
    asCambridgeTenantAdmin = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    asGeorgiaTenantAdmin = createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    asGlobalAdmin = createGlobalAdminRestContext();
    return callback();
  });

  describe('Tenant separation', () => {
    /**
     * Shares a content item with a user and verifies whether or not the object is in the
     * target user his library.
     *
     * @param  {RestContext}        actorUserRestContext    The context that should perform the sharing. Make sure this user has access on the piece of content.
     * @param  {Content}            objectContent           The piece of content that should be shared
     * @param  {String}             targetPrincipalId       The principal ID the content should be shared with
     * @param  {RestContext}        targetRestContext       A context to use to verify the content item ended up in the library (or not).
     * @param  {String|Boolean}     [validateEmail]         If a string, indicates the email to use to validate the user id share target in the share operation. If a boolean, will use the target's verified email to validate it. If false-y, then the user id will be shared with unvalidated
     * @param  {Number}             expectedHttpCode        The expected HTTP status code
     * @param  {Function}           callback                Standard callback function
     */
    const verifyShare = function (
      asActorUser,
      objectContent,
      targetPrincipalId,
      asTargetUser,
      validateEmail,
      expectedHttpCode,
      callback
    ) {
      // Get the me object of the target in case we need to do a validated share with their email
      getMe(asTargetUser, (error, me) => {
        assert.notExists(error);

        // If we've chosen to use a user id that is validated with email, then attach the email to the user id
        let targetId = targetPrincipalId;
        if (isString(validateEmail)) {
          targetId = format('%s:%s', validateEmail, targetPrincipalId);
        } else if (validateEmail) {
          targetId = format('%s:%s', me.email, targetPrincipalId);
        }

        shareContent(asActorUser, objectContent.id, [targetId], (error_) => {
          if (is200(expectedHttpCode)) {
            assert.notExists(error_);
          } else {
            assert.strictEqual(error_.code, expectedHttpCode);
          }

          // If we shared with an email, use the target rest context as the principal id whose library to check
          const targetId = isEmail(targetPrincipalId) ? me.id : targetPrincipalId;

          // Sanity check that the item appears in the library, if applicable
          getLibrary(asTargetUser, targetId, null, 100, (error, data) => {
            assert.notExists(error);
            const library = data.results;
            const foundIt = find(propSatisfies(equals(objectContent.id), ID), library);
            if (is200(expectedHttpCode)) {
              assert.ok(foundIt);
            } else {
              assert.isNotOk(foundIt);
            }

            return callback();
          });
        });
      });
    };

    /**
     * Test that verifies that a public user A from a public tenant A can access a public content item from a external tenant B
     */
    it('verify user can access public content from external tenant', (callback) => {
      setupMultiTenantPrivacyEntities((publicTenantA, publicTenantB /* , privateTenantA, privateTenantB */) => {
        const asPublicUserOnTenantA = publicTenantA.publicUser.restContext;

        // Accessing public content in a public tenant from a public tenant should succeed
        getContent(asPublicUserOnTenantA, publicTenantB.publicContent.id, (error, contentObject) => {
          assert.notExists(error);
          assert.ok(contentObject);
          assert.strictEqual(contentObject.id, publicTenantB.publicContent.id);

          // Accessing loggedin content in a public tenant from a public tenant should fail
          getContent(asPublicUserOnTenantA, publicTenantB.loggedinContent.id, (error, contentObject) => {
            assert.strictEqual(error.code, 401);
            assert.isNotOk(contentObject);

            // Accessing private content in a public tenant from a public tenant should fail
            getContent(asPublicUserOnTenantA, publicTenantB.privateContent.id, (error, contentObject) => {
              assert.strictEqual(error.code, 401);
              assert.isNotOk(contentObject);
              callback();
            });
          });
        });
      });
    });

    /**
     * Test that verifies the object -> target sharing permutations
     */
    it('verify content sharing permutations from object to target (users)', (callback) => {
      setupMultiTenantPrivacyEntities((publicTenantA, publicTenantB, privateTenantA /* , privateTenantB */) => {
        // In all these cases, the target user should see the content item in his library
        verifyShare(
          publicTenantB.adminRestContext,
          publicTenantB.publicContent,
          publicTenantA.publicUser.user.id,
          publicTenantA.publicUser.restContext,
          false,
          200,
          () => {
            verifyShare(
              publicTenantB.adminRestContext,
              publicTenantB.loggedinContent,
              publicTenantA.publicUser.user.id,
              publicTenantA.publicUser.restContext,
              false,
              200,
              () => {
                verifyShare(
                  publicTenantB.adminRestContext,
                  publicTenantB.privateContent,
                  publicTenantA.publicUser.user.id,
                  publicTenantA.publicUser.restContext,
                  false,
                  200,
                  () => {
                    // These cases should fail
                    verifyShare(
                      publicTenantB.adminRestContext,
                      publicTenantB.publicContent,
                      privateTenantA.loggedinUser.user.id,
                      privateTenantA.loggedinUser.restContext,
                      false,
                      401,
                      () => {
                        verifyShare(
                          publicTenantB.adminRestContext,
                          publicTenantB.loggedinContent,
                          privateTenantA.loggedinUser.user.id,
                          privateTenantA.loggedinUser.restContext,
                          false,
                          401,
                          () => {
                            verifyShare(
                              publicTenantB.adminRestContext,
                              publicTenantB.privateContent,
                              privateTenantA.loggedinUser.user.id,
                              privateTenantA.loggedinUser.restContext,
                              false,
                              401,
                              () => {
                                verifyShare(
                                  publicTenantB.adminRestContext,
                                  publicTenantB.publicContent,
                                  privateTenantA.privateUser.user.id,
                                  privateTenantA.privateUser.restContext,
                                  false,
                                  401,
                                  () => {
                                    verifyShare(
                                      publicTenantB.adminRestContext,
                                      publicTenantB.loggedinContent,
                                      privateTenantA.privateUser.user.id,
                                      privateTenantA.privateUser.restContext,
                                      false,
                                      401,
                                      () => {
                                        verifyShare(
                                          publicTenantB.adminRestContext,
                                          publicTenantB.privateContent,
                                          privateTenantA.privateUser.user.id,
                                          privateTenantA.privateUser.restContext,
                                          false,
                                          401,
                                          () => {
                                            verifyShare(
                                              publicTenantB.adminRestContext,
                                              publicTenantB.publicContent,
                                              publicTenantA.loggedinUser.user.id,
                                              publicTenantA.loggedinUser.restContext,
                                              false,
                                              401,
                                              () => {
                                                verifyShare(
                                                  publicTenantB.adminRestContext,
                                                  publicTenantB.loggedinContent,
                                                  publicTenantA.loggedinUser.user.id,
                                                  publicTenantA.loggedinUser.restContext,
                                                  false,
                                                  401,
                                                  () => {
                                                    verifyShare(
                                                      publicTenantB.adminRestContext,
                                                      publicTenantB.privateContent,
                                                      publicTenantA.loggedinUser.user.id,
                                                      publicTenantA.loggedinUser.restContext,
                                                      false,
                                                      401,
                                                      () => {
                                                        verifyShare(
                                                          publicTenantB.adminRestContext,
                                                          publicTenantB.publicContent,
                                                          publicTenantA.privateUser.user.id,
                                                          publicTenantA.privateUser.restContext,
                                                          false,
                                                          401,
                                                          () => {
                                                            verifyShare(
                                                              publicTenantB.adminRestContext,
                                                              publicTenantB.loggedinContent,
                                                              publicTenantA.privateUser.user.id,
                                                              publicTenantA.privateUser.restContext,
                                                              false,
                                                              401,
                                                              () => {
                                                                verifyShare(
                                                                  publicTenantB.adminRestContext,
                                                                  publicTenantB.privateContent,
                                                                  publicTenantA.privateUser.user.id,
                                                                  publicTenantA.privateUser.restContext,
                                                                  false,
                                                                  401,
                                                                  () => {
                                                                    // Sharing a content item with public users from private tenants should fail
                                                                    verifyShare(
                                                                      publicTenantB.adminRestContext,
                                                                      publicTenantB.publicContent,
                                                                      privateTenantA.publicUser.user.id,
                                                                      privateTenantA.publicUser.restContext,
                                                                      false,
                                                                      401,
                                                                      () => {
                                                                        verifyShare(
                                                                          publicTenantB.adminRestContext,
                                                                          publicTenantB.loggedinContent,
                                                                          privateTenantA.publicUser.user.id,
                                                                          privateTenantA.publicUser.restContext,
                                                                          false,
                                                                          401,
                                                                          () => {
                                                                            verifyShare(
                                                                              publicTenantB.adminRestContext,
                                                                              publicTenantB.privateContent,
                                                                              privateTenantA.publicUser.user.id,
                                                                              privateTenantA.publicUser.restContext,
                                                                              false,
                                                                              401,
                                                                              callback
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
    });

    /**
     * Test that verifies the object -> target sharing permutations using the target user email
     * address
     */
    it('verify content sharing permutations from object to target by email address (users)', (callback) => {
      setupMultiTenantPrivacyEntities((publicTenantA, publicTenantB, privateTenantA /* , privateTenantB */) => {
        // In all these cases, the target user should see the content item in his library
        verifyShare(
          publicTenantB.adminRestContext,
          publicTenantB.publicContent,
          publicTenantA.publicUser.user.email.toUpperCase(),
          publicTenantA.publicUser.restContext,
          false,
          200,
          () => {
            verifyShare(
              publicTenantB.adminRestContext,
              publicTenantB.loggedinContent,
              publicTenantA.publicUser.user.email.toUpperCase(),
              publicTenantA.publicUser.restContext,
              false,
              200,
              () => {
                verifyShare(
                  publicTenantB.adminRestContext,
                  publicTenantB.privateContent,
                  publicTenantA.publicUser.user.email.toUpperCase(),
                  publicTenantA.publicUser.restContext,
                  false,
                  200,
                  () => {
                    verifyShare(
                      publicTenantB.adminRestContext,
                      publicTenantB.publicContent,
                      publicTenantA.loggedinUser.user.email.toUpperCase(),
                      publicTenantA.loggedinUser.restContext,
                      false,
                      200,
                      () => {
                        verifyShare(
                          publicTenantB.adminRestContext,
                          publicTenantB.loggedinContent,
                          publicTenantA.loggedinUser.user.email.toUpperCase(),
                          publicTenantA.loggedinUser.restContext,
                          false,
                          200,
                          () => {
                            verifyShare(
                              publicTenantB.adminRestContext,
                              publicTenantB.privateContent,
                              publicTenantA.loggedinUser.user.email.toUpperCase(),
                              publicTenantA.loggedinUser.restContext,
                              false,
                              200,
                              () => {
                                verifyShare(
                                  publicTenantB.adminRestContext,
                                  publicTenantB.publicContent,
                                  publicTenantA.privateUser.user.email.toUpperCase(),
                                  publicTenantA.privateUser.restContext,
                                  false,
                                  200,
                                  () => {
                                    verifyShare(
                                      publicTenantB.adminRestContext,
                                      publicTenantB.loggedinContent,
                                      publicTenantA.privateUser.user.email.toUpperCase(),
                                      publicTenantA.privateUser.restContext,
                                      false,
                                      200,
                                      () => {
                                        verifyShare(
                                          publicTenantB.adminRestContext,
                                          publicTenantB.privateContent,
                                          publicTenantA.privateUser.user.email.toUpperCase(),
                                          publicTenantA.privateUser.restContext,
                                          false,
                                          200,
                                          () => {
                                            // These cases should fail
                                            verifyShare(
                                              publicTenantB.adminRestContext,
                                              publicTenantB.publicContent,
                                              privateTenantA.loggedinUser.user.email.toUpperCase(),
                                              privateTenantA.loggedinUser.restContext,
                                              false,
                                              401,
                                              () => {
                                                verifyShare(
                                                  publicTenantB.adminRestContext,
                                                  publicTenantB.loggedinContent,
                                                  privateTenantA.loggedinUser.user.email.toUpperCase(),
                                                  privateTenantA.loggedinUser.restContext,
                                                  false,
                                                  401,
                                                  () => {
                                                    verifyShare(
                                                      publicTenantB.adminRestContext,
                                                      publicTenantB.privateContent,
                                                      privateTenantA.loggedinUser.user.email.toUpperCase(),
                                                      privateTenantA.loggedinUser.restContext,
                                                      false,
                                                      401,
                                                      () => {
                                                        verifyShare(
                                                          publicTenantB.adminRestContext,
                                                          publicTenantB.publicContent,
                                                          privateTenantA.privateUser.user.email.toUpperCase(),
                                                          privateTenantA.privateUser.restContext,
                                                          false,
                                                          401,
                                                          () => {
                                                            verifyShare(
                                                              publicTenantB.adminRestContext,
                                                              publicTenantB.loggedinContent,
                                                              privateTenantA.privateUser.user.email.toUpperCase(),
                                                              privateTenantA.privateUser.restContext,
                                                              false,
                                                              401,
                                                              () => {
                                                                verifyShare(
                                                                  publicTenantB.adminRestContext,
                                                                  publicTenantB.privateContent,
                                                                  privateTenantA.privateUser.user.email.toUpperCase(),
                                                                  privateTenantA.privateUser.restContext,
                                                                  false,
                                                                  401,
                                                                  () => {
                                                                    // Sharing a content item with public users from private tenants should fail
                                                                    verifyShare(
                                                                      publicTenantB.adminRestContext,
                                                                      publicTenantB.publicContent,
                                                                      privateTenantA.publicUser.user.email.toUpperCase(),
                                                                      privateTenantA.publicUser.restContext,
                                                                      false,
                                                                      401,
                                                                      () => {
                                                                        verifyShare(
                                                                          publicTenantB.adminRestContext,
                                                                          publicTenantB.loggedinContent,
                                                                          privateTenantA.publicUser.user.email.toUpperCase(),
                                                                          privateTenantA.publicUser.restContext,
                                                                          false,
                                                                          401,
                                                                          () => {
                                                                            verifyShare(
                                                                              publicTenantB.adminRestContext,
                                                                              publicTenantB.privateContent,
                                                                              privateTenantA.publicUser.user.email.toUpperCase(),
                                                                              privateTenantA.publicUser.restContext,
                                                                              false,
                                                                              401,
                                                                              callback
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
    });

    /**
     * Test that verifies the object -> target sharing permutations
     */
    it('verify content sharing permutations from object to target (non joinable groups)', (callback) => {
      setupMultiTenantPrivacyEntities((publicTenantA, publicTenantB, privateTenantA /* , privateTenantB */) => {
        // In all these cases, the target user should see the content item in his library
        verifyShare(
          publicTenantB.adminRestContext,
          publicTenantB.publicContent,
          publicTenantA.publicGroup.id,
          publicTenantA.publicUser.restContext,
          false,
          200,
          () => {
            verifyShare(
              publicTenantB.adminRestContext,
              publicTenantB.loggedinContent,
              publicTenantA.publicGroup.id,
              publicTenantA.publicUser.restContext,
              false,
              200,
              () => {
                verifyShare(
                  publicTenantB.adminRestContext,
                  publicTenantB.privateContent,
                  publicTenantA.publicGroup.id,
                  publicTenantA.publicUser.restContext,
                  false,
                  200,
                  () => {
                    // These cases should fail
                    verifyShare(
                      publicTenantB.adminRestContext,
                      publicTenantB.publicContent,
                      privateTenantA.loggedinNotJoinableGroup.id,
                      privateTenantA.loggedinUser.restContext,
                      false,
                      401,
                      () => {
                        verifyShare(
                          publicTenantB.adminRestContext,
                          publicTenantB.publicContent,
                          privateTenantA.loggedinNotJoinableGroup.id,
                          privateTenantA.loggedinUser.restContext,
                          false,
                          401,
                          () => {
                            verifyShare(
                              publicTenantB.adminRestContext,
                              publicTenantB.loggedinContent,
                              privateTenantA.loggedinNotJoinableGroup.id,
                              privateTenantA.loggedinUser.restContext,
                              false,
                              401,
                              () => {
                                verifyShare(
                                  publicTenantB.adminRestContext,
                                  publicTenantB.privateContent,
                                  privateTenantA.loggedinNotJoinableGroup.id,
                                  privateTenantA.loggedinUser.restContext,
                                  false,
                                  401,
                                  () => {
                                    verifyShare(
                                      publicTenantB.adminRestContext,
                                      publicTenantB.publicContent,
                                      privateTenantA.privateNotJoinableGroup.id,
                                      privateTenantA.privateUser.restContext,
                                      false,
                                      401,
                                      () => {
                                        verifyShare(
                                          publicTenantB.adminRestContext,
                                          publicTenantB.loggedinContent,
                                          privateTenantA.privateNotJoinableGroup.id,
                                          privateTenantA.privateUser.restContext,
                                          false,
                                          401,
                                          () => {
                                            verifyShare(
                                              publicTenantB.adminRestContext,
                                              publicTenantB.privateContent,
                                              privateTenantA.privateNotJoinableGroup.id,
                                              privateTenantA.privateUser.restContext,
                                              false,
                                              401,
                                              () => {
                                                // Issue-1402: if this was a joinableGroup, then it would succeed (200)
                                                // Not sure why, potential bug here
                                                verifyShare(
                                                  publicTenantB.adminRestContext,
                                                  publicTenantB.publicContent,
                                                  publicTenantA.loggedinNotJoinableGroup.id,
                                                  publicTenantA.loggedinUser.restContext,
                                                  false,
                                                  401,
                                                  () => {
                                                    // Issue-1402: if this was a joinableGroup, then it would succeed (200)
                                                    // Not sure why, potential bug here
                                                    verifyShare(
                                                      publicTenantB.adminRestContext,
                                                      publicTenantB.loggedinContent,
                                                      publicTenantA.loggedinNotJoinableGroup.id,
                                                      publicTenantA.loggedinUser.restContext,
                                                      false,
                                                      401,
                                                      () => {
                                                        verifyShare(
                                                          publicTenantB.adminRestContext,
                                                          publicTenantB.privateContent,
                                                          publicTenantA.loggedinNotJoinableGroup.id,
                                                          publicTenantA.loggedinUser.restContext,
                                                          false,
                                                          401,
                                                          () => {
                                                            verifyShare(
                                                              publicTenantB.adminRestContext,
                                                              publicTenantB.publicContent,
                                                              publicTenantA.privateNotJoinableGroup.id,
                                                              publicTenantA.privateUser.restContext,
                                                              false,
                                                              401,
                                                              () => {
                                                                verifyShare(
                                                                  publicTenantB.adminRestContext,
                                                                  publicTenantB.loggedinContent,
                                                                  publicTenantA.privateNotJoinableGroup.id,
                                                                  publicTenantA.privateUser.restContext,
                                                                  false,
                                                                  401,
                                                                  () => {
                                                                    verifyShare(
                                                                      publicTenantB.adminRestContext,
                                                                      publicTenantB.privateContent,
                                                                      publicTenantA.privateNotJoinableGroup.id,
                                                                      publicTenantA.privateUser.restContext,
                                                                      false,
                                                                      401,
                                                                      () => {
                                                                        // Sharing a content item with public group from private tenants should fail
                                                                        verifyShare(
                                                                          publicTenantB.adminRestContext,
                                                                          publicTenantB.publicContent,
                                                                          privateTenantA.publicGroup.id,
                                                                          privateTenantA.publicUser.restContext,
                                                                          false,
                                                                          401,
                                                                          () => {
                                                                            verifyShare(
                                                                              publicTenantB.adminRestContext,
                                                                              publicTenantB.loggedinContent,
                                                                              privateTenantA.publicGroup.id,
                                                                              privateTenantA.publicUser.restContext,
                                                                              false,
                                                                              401,
                                                                              () => {
                                                                                verifyShare(
                                                                                  publicTenantB.adminRestContext,
                                                                                  publicTenantB.privateContent,
                                                                                  privateTenantA.publicGroup.id,
                                                                                  privateTenantA.publicUser.restContext,
                                                                                  false,
                                                                                  401,
                                                                                  callback
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
    });

    it('verify content sharing permutations from object to target (joinable groups)', (callback) => {
      setupMultiTenantPrivacyEntities((publicTenantA, publicTenantB, privateTenantA /* , privateTenantB */) => {
        // These cases should fail
        verifyShare(
          publicTenantB.adminRestContext,
          publicTenantB.publicContent,
          privateTenantA.loggedinJoinableGroup.id,
          privateTenantA.loggedinUser.restContext,
          false,
          401,
          () => {
            verifyShare(
              publicTenantB.adminRestContext,
              publicTenantB.loggedinContent,
              privateTenantA.loggedinJoinableGroup.id,
              privateTenantA.loggedinUser.restContext,
              false,
              401,
              () => {
                verifyShare(
                  publicTenantB.adminRestContext,
                  publicTenantB.privateContent,
                  privateTenantA.loggedinJoinableGroup.id,
                  privateTenantA.loggedinUser.restContext,
                  false,
                  401,
                  () => {
                    verifyShare(
                      publicTenantB.adminRestContext,
                      publicTenantB.publicContent,
                      privateTenantA.privateJoinableGroup.id,
                      privateTenantA.privateUser.restContext,
                      false,
                      401,
                      () => {
                        verifyShare(
                          publicTenantB.adminRestContext,
                          publicTenantB.loggedinContent,
                          privateTenantA.privateJoinableGroup.id,
                          privateTenantA.privateUser.restContext,
                          false,
                          401,
                          () => {
                            verifyShare(
                              publicTenantB.adminRestContext,
                              publicTenantB.privateContent,
                              privateTenantA.privateJoinableGroup.id,
                              privateTenantA.privateUser.restContext,
                              false,
                              401,
                              callback
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
    });

    /**
     * Test that verifies the actor -> object sharing permutations
     */
    it('verify content sharing permutations from actor to object', (callback) => {
      setupMultiTenantPrivacyEntities((publicTenantA, publicTenantB, privateTenantA /* , privateTenantB */) => {
        const asAdminToPublicTenantA = publicTenantA.adminRestContext;

        // Create some more users as we can only share it with a target user once.
        generateTestUsers(asAdminToPublicTenantA, 3, (error, users) => {
          assert.notExists(error);
          const targetUsers = users;

          // In all these cases, the target user should see the content item in his library
          verifyShare(
            publicTenantA.adminRestContext,
            publicTenantB.publicContent,
            targetUsers[0].user.id,
            targetUsers[0].restContext,
            false,
            200,
            () => {
              verifyShare(
                publicTenantA.adminRestContext,
                publicTenantB.publicContent,
                targetUsers[1].user.id,
                targetUsers[1].restContext,
                false,
                200,
                () => {
                  verifyShare(
                    publicTenantA.adminRestContext,
                    publicTenantB.publicContent,
                    targetUsers[2].user.id,
                    targetUsers[2].restContext,
                    false,
                    200,
                    () => {
                      /**
                       * All cases where the TenantA tenant admin
                       * does not have implicit access to the content item,
                       * other operation should fail with a 401 error
                       */
                      verifyShare(
                        publicTenantA.adminRestContext,
                        publicTenantB.loggedinContent,
                        publicTenantA.publicUser.user.id,
                        publicTenantA.publicUser.restContext,
                        false,
                        401,
                        () => {
                          verifyShare(
                            publicTenantA.adminRestContext,
                            publicTenantB.loggedinContent,
                            publicTenantA.publicUser.user.id,
                            publicTenantA.publicUser.restContext,
                            false,
                            401,
                            () => {
                              verifyShare(
                                publicTenantA.adminRestContext,
                                publicTenantB.loggedinContent,
                                publicTenantA.publicUser.user.id,
                                publicTenantA.publicUser.restContext,
                                false,
                                401,
                                () => {
                                  verifyShare(
                                    publicTenantA.adminRestContext,
                                    publicTenantB.privateContent,
                                    publicTenantA.publicUser.user.id,
                                    publicTenantA.publicUser.restContext,
                                    false,
                                    401,
                                    () => {
                                      verifyShare(
                                        publicTenantA.adminRestContext,
                                        publicTenantB.privateContent,
                                        publicTenantA.publicUser.user.id,
                                        publicTenantA.publicUser.restContext,
                                        false,
                                        401,
                                        () => {
                                          verifyShare(
                                            publicTenantA.adminRestContext,
                                            publicTenantB.privateContent,
                                            publicTenantA.publicUser.user.id,
                                            publicTenantA.publicUser.restContext,
                                            false,
                                            401,
                                            () => {
                                              verifyShare(
                                                publicTenantA.adminRestContext,
                                                privateTenantA.publicContent,
                                                publicTenantA.publicUser.user.id,
                                                publicTenantA.publicUser.restContext,
                                                false,
                                                401,
                                                () => {
                                                  verifyShare(
                                                    publicTenantA.adminRestContext,
                                                    privateTenantA.loggedinContent,
                                                    publicTenantA.publicUser.user.id,
                                                    publicTenantA.publicUser.restContext,
                                                    false,
                                                    401,
                                                    () => {
                                                      verifyShare(
                                                        publicTenantA.adminRestContext,
                                                        privateTenantA.privateContent,
                                                        publicTenantA.publicUser.user.id,
                                                        publicTenantA.publicUser.restContext,
                                                        false,
                                                        401,
                                                        callback
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
            }
          );
        });
      });
    });

    /**
     * Test that verifies the actor -> target sharing permutations when the sharing user has
     * provided a correct validation email
     */
    it('verify content sharing permutations from actor to target (users) with email only', (callback) => {
      setupMultiTenantPrivacyEntities((publicTenantA, publicTenantB, privateTenantA) => {
        /**
         * Ensure the user cannot share with the private user of their own tenant
         * without a proper validation email
         */
        verifyShare(
          publicTenantA.publicUser.restContext,
          publicTenantA.publicContent,
          publicTenantA.privateUser.user.email,
          publicTenantA.privateUser.restContext,
          false,
          200,
          () => {
            // Ensure the user can share with a loggedin or private user of
            // another public tenant by email
            verifyShare(
              publicTenantA.publicUser.restContext,
              publicTenantA.publicContent,
              publicTenantB.loggedinUser.user.email,
              publicTenantB.loggedinUser.restContext,
              false,
              200,
              () => {
                verifyShare(
                  publicTenantA.publicUser.restContext,
                  publicTenantA.publicContent,
                  publicTenantB.privateUser.user.email,
                  publicTenantB.privateUser.restContext,
                  false,
                  200,
                  () => {
                    /**
                     * Ensure the user can never share with a user
                     * from a private tenant, even if they know
                     * their email address
                     */
                    verifyShare(
                      publicTenantA.publicUser.restContext,
                      publicTenantA.publicContent,
                      privateTenantA.publicUser.user.email,
                      privateTenantA.publicUser.restContext,
                      false,
                      401,
                      () => {
                        verifyShare(
                          publicTenantA.publicUser.restContext,
                          publicTenantA.publicContent,
                          privateTenantA.loggedinUser.user.email,
                          privateTenantA.loggedinUser.restContext,
                          false,
                          401,
                          () => {
                            verifyShare(
                              publicTenantA.publicUser.restContext,
                              publicTenantA.publicContent,
                              privateTenantA.privateUser.user.email,
                              privateTenantA.privateUser.restContext,
                              false,
                              401,
                              () => {
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
      });
    });

    /**
     * Test that verifies the actor -> target sharing permutations when the sharing user has
     * provided a correct validation email
     */
    it('verify content sharing permutations from actor to target (users) with a validating email', (callback) => {
      setupMultiTenantPrivacyEntities((publicTenantA, publicTenantB, privateTenantA) => {
        /**
         * Ensure the user cannot share with the private user of their own tenant without a
         * proper validation email
         */
        verifyShare(
          publicTenantA.publicUser.restContext,
          publicTenantA.publicContent,
          publicTenantA.privateUser.user.id,
          publicTenantA.privateUser.restContext,
          false,
          401,
          () => {
            verifyShare(
              publicTenantA.publicUser.restContext,
              publicTenantA.publicContent,
              publicTenantA.privateUser.user.id,
              publicTenantA.privateUser.restContext,
              'invalid@email.com',
              401,
              () => {
                verifyShare(
                  publicTenantA.publicUser.restContext,
                  publicTenantA.publicContent,
                  publicTenantA.privateUser.user.id,
                  publicTenantA.privateUser.restContext,
                  true,
                  200,
                  () => {
                    /**
                     * Ensure the user cannot share with a loggedin or private user of
                     * another public tenant without proper validation email
                     */
                    verifyShare(
                      publicTenantA.publicUser.restContext,
                      publicTenantA.publicContent,
                      publicTenantB.loggedinUser.user.id,
                      publicTenantB.loggedinUser.restContext,
                      false,
                      401,
                      () => {
                        verifyShare(
                          publicTenantA.publicUser.restContext,
                          publicTenantA.publicContent,
                          publicTenantB.loggedinUser.user.id,
                          publicTenantB.loggedinUser.restContext,
                          'invalid@email.com',
                          401,
                          () => {
                            verifyShare(
                              publicTenantA.publicUser.restContext,
                              publicTenantA.publicContent,
                              publicTenantB.loggedinUser.user.id,
                              publicTenantB.loggedinUser.restContext,
                              true,
                              200,
                              () => {
                                verifyShare(
                                  publicTenantA.publicUser.restContext,
                                  publicTenantA.publicContent,
                                  publicTenantB.privateUser.user.id,
                                  publicTenantB.privateUser.restContext,
                                  false,
                                  401,
                                  () => {
                                    verifyShare(
                                      publicTenantA.publicUser.restContext,
                                      publicTenantA.publicContent,
                                      publicTenantB.privateUser.user.id,
                                      publicTenantB.privateUser.restContext,
                                      'invalid@email.com',
                                      401,
                                      () => {
                                        verifyShare(
                                          publicTenantA.publicUser.restContext,
                                          publicTenantA.publicContent,
                                          publicTenantB.privateUser.user.id,
                                          publicTenantB.privateUser.restContext,
                                          true,
                                          200,
                                          () => {
                                            /**
                                             * Ensure the user can never share with a user
                                             * from a private tenant, even if they know
                                             * their email address
                                             */
                                            verifyShare(
                                              publicTenantA.publicUser.restContext,
                                              publicTenantA.publicContent,
                                              privateTenantA.publicUser.user.id,
                                              privateTenantA.publicUser.restContext,
                                              true,
                                              401,
                                              () => {
                                                verifyShare(
                                                  publicTenantA.publicUser.restContext,
                                                  publicTenantA.publicContent,
                                                  privateTenantA.loggedinUser.user.id,
                                                  privateTenantA.loggedinUser.restContext,
                                                  true,
                                                  401,
                                                  () => {
                                                    verifyShare(
                                                      publicTenantA.publicUser.restContext,
                                                      publicTenantA.publicContent,
                                                      privateTenantA.privateUser.user.id,
                                                      privateTenantA.privateUser.restContext,
                                                      true,
                                                      401,
                                                      () => {
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
          }
        );
      });
    });

    /**
     * Test that verifies the actor -> target sharing permutations
     */
    it('verify content sharing permutations from actor to target (users)', (callback) => {
      setupMultiTenantPrivacyEntities((publicTenantA, publicTenantB, privateTenantA /* , privateTenantB */) => {
        const asAdminToPublicTenantB = publicTenantB.adminRestContext;
        // Create some more users as we can only share it with a target user once.
        generateTestUsers(asAdminToPublicTenantB, 3, (error, targetUsers) => {
          assert.notExists(error);

          // In all these cases, the target user should see the content item in their library because they are public users
          verifyShare(
            publicTenantA.publicUser.restContext,
            publicTenantA.publicContent,
            targetUsers[0].user.id,
            targetUsers[0].restContext,
            false,
            200,
            () => {
              verifyShare(
                publicTenantA.loggedinUser.restContext,
                publicTenantA.publicContent,
                targetUsers[1].user.id,
                targetUsers[0].restContext,
                false,
                200,
                () => {
                  verifyShare(
                    publicTenantA.privateUser.restContext,
                    publicTenantA.publicContent,
                    targetUsers[2].user.id,
                    targetUsers[0].restContext,
                    false,
                    200,
                    () => {
                      /**
                       * These cases should fail:
                       * * Sharing with any user in a private tenant (regardless of their visibility setting)
                       * * Sharing with a private or loggedin user in a public tenant
                       */
                      verifyShare(
                        publicTenantA.publicUser.restContext,
                        publicTenantA.publicContent,
                        publicTenantB.loggedinUser.user.id,
                        publicTenantB.loggedinUser.restContext,
                        false,
                        401,
                        () => {
                          verifyShare(
                            publicTenantA.loggedinUser.restContext,
                            publicTenantA.publicContent,
                            publicTenantB.loggedinUser.user.id,
                            publicTenantB.loggedinUser.restContext,
                            false,
                            401,
                            () => {
                              verifyShare(
                                publicTenantA.privateUser.restContext,
                                publicTenantA.publicContent,
                                publicTenantB.loggedinUser.user.id,
                                publicTenantB.loggedinUser.restContext,
                                false,
                                401,
                                () => {
                                  verifyShare(
                                    publicTenantA.publicUser.restContext,
                                    publicTenantA.publicContent,
                                    publicTenantB.privateUser.user.id,
                                    publicTenantB.privateUser.restContext,
                                    false,
                                    401,
                                    () => {
                                      verifyShare(
                                        publicTenantA.loggedinUser.restContext,
                                        publicTenantA.publicContent,
                                        publicTenantB.privateUser.user.id,
                                        publicTenantB.privateUser.restContext,
                                        false,
                                        401,
                                        () => {
                                          verifyShare(
                                            publicTenantA.privateUser.restContext,
                                            publicTenantA.publicContent,
                                            publicTenantB.privateUser.user.id,
                                            publicTenantB.privateUser.restContext,
                                            false,
                                            401,
                                            () => {
                                              verifyShare(
                                                publicTenantA.publicUser.restContext,
                                                publicTenantA.publicContent,
                                                privateTenantA.publicUser.user.id,
                                                privateTenantA.publicUser.restContext,
                                                false,
                                                401,
                                                () => {
                                                  verifyShare(
                                                    publicTenantA.loggedinUser.restContext,
                                                    publicTenantA.publicContent,
                                                    privateTenantA.publicUser.user.id,
                                                    privateTenantA.publicUser.restContext,
                                                    false,
                                                    401,
                                                    () => {
                                                      verifyShare(
                                                        publicTenantA.privateUser.restContext,
                                                        publicTenantA.publicContent,
                                                        privateTenantA.publicUser.user.id,
                                                        privateTenantA.publicUser.restContext,
                                                        false,
                                                        401,
                                                        () => {
                                                          verifyShare(
                                                            publicTenantA.publicUser.restContext,
                                                            publicTenantA.publicContent,
                                                            privateTenantA.loggedinUser.user.id,
                                                            privateTenantA.loggedinUser.restContext,
                                                            false,
                                                            401,
                                                            () => {
                                                              verifyShare(
                                                                publicTenantA.loggedinUser.restContext,
                                                                publicTenantA.publicContent,
                                                                privateTenantA.loggedinUser.user.id,
                                                                privateTenantA.loggedinUser.restContext,
                                                                false,
                                                                401,
                                                                () => {
                                                                  verifyShare(
                                                                    publicTenantA.privateUser.restContext,
                                                                    publicTenantA.publicContent,
                                                                    privateTenantA.loggedinUser.user.id,
                                                                    privateTenantA.loggedinUser.restContext,
                                                                    false,
                                                                    401,
                                                                    () => {
                                                                      verifyShare(
                                                                        publicTenantA.publicUser.restContext,
                                                                        publicTenantA.publicContent,
                                                                        privateTenantA.privateUser.user.id,
                                                                        privateTenantA.privateUser.restContext,
                                                                        false,
                                                                        401,
                                                                        () => {
                                                                          verifyShare(
                                                                            publicTenantA.loggedinUser.restContext,
                                                                            publicTenantA.publicContent,
                                                                            privateTenantA.privateUser.user.id,
                                                                            privateTenantA.privateUser.restContext,
                                                                            false,
                                                                            401,
                                                                            () => {
                                                                              verifyShare(
                                                                                publicTenantA.privateUser.restContext,
                                                                                publicTenantA.publicContent,
                                                                                privateTenantA.privateUser.user.id,
                                                                                privateTenantA.privateUser.restContext,
                                                                                false,
                                                                                401,
                                                                                callback
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
      });
    });

    /**
     * Test that verifies the actor -> target sharing permutations
     */
    it('verify content sharing permutations from actor to target (non joinable groups)', (callback) => {
      setupMultiTenantPrivacyEntities((publicTenantA, publicTenantB, privateTenantA /* , privateTenantB */) => {
        const asAdminToPublicTenantB = publicTenantB.adminRestContext;
        // Create some more users as we can only share it with a target user once.
        generateTestGroups(asAdminToPublicTenantB, 3, function (...args) {
          const groups = map(prop('group'), last(args));

          // In all these cases, the target user should see the content item in his library
          verifyShare(
            publicTenantA.publicUser.restContext,
            publicTenantA.publicContent,
            groups[0].id,
            publicTenantB.adminRestContext,
            false,
            200,
            () => {
              verifyShare(
                publicTenantA.loggedinUser.restContext,
                publicTenantA.publicContent,
                groups[1].id,
                publicTenantB.adminRestContext,
                false,
                200,
                () => {
                  verifyShare(
                    publicTenantA.privateUser.restContext,
                    publicTenantA.publicContent,
                    groups[2].id,
                    publicTenantB.adminRestContext,
                    false,
                    200,
                    () => {
                      /**
                       * These cases should fail:
                       * * Sharing with any user in a private tenant (regardless of their visibility setting)
                       * * Sharing with a private or loggedin user in a public tenant
                       */
                      verifyShare(
                        publicTenantA.publicUser.restContext,
                        publicTenantA.publicContent,
                        publicTenantB.loggedinNotJoinableGroup.id,
                        publicTenantB.loggedinUser.restContext,
                        false,
                        401,
                        () => {
                          verifyShare(
                            publicTenantA.loggedinUser.restContext,
                            publicTenantA.publicContent,
                            publicTenantB.loggedinNotJoinableGroup.id,
                            publicTenantB.loggedinUser.restContext,
                            false,
                            401,
                            () => {
                              verifyShare(
                                publicTenantA.privateUser.restContext,
                                publicTenantA.publicContent,
                                publicTenantB.loggedinNotJoinableGroup.id,
                                publicTenantB.loggedinUser.restContext,
                                false,
                                401,
                                () => {
                                  verifyShare(
                                    publicTenantA.publicUser.restContext,
                                    publicTenantA.publicContent,
                                    publicTenantB.privateNotJoinableGroup.id,
                                    publicTenantB.privateUser.restContext,
                                    false,
                                    401,
                                    () => {
                                      verifyShare(
                                        publicTenantA.loggedinUser.restContext,
                                        publicTenantA.publicContent,
                                        publicTenantB.privateNotJoinableGroup.id,
                                        publicTenantB.privateUser.restContext,
                                        false,
                                        401,
                                        () => {
                                          verifyShare(
                                            publicTenantA.privateUser.restContext,
                                            publicTenantA.publicContent,
                                            publicTenantB.privateNotJoinableGroup.id,
                                            publicTenantB.privateUser.restContext,
                                            false,
                                            401,
                                            () => {
                                              verifyShare(
                                                publicTenantA.publicUser.restContext,
                                                publicTenantA.publicContent,
                                                privateTenantA.publicGroup.id,
                                                privateTenantA.publicUser.restContext,
                                                false,
                                                401,
                                                () => {
                                                  verifyShare(
                                                    publicTenantA.loggedinUser.restContext,
                                                    publicTenantA.publicContent,
                                                    privateTenantA.publicGroup.id,
                                                    privateTenantA.publicUser.restContext,
                                                    false,
                                                    401,
                                                    () => {
                                                      verifyShare(
                                                        publicTenantA.privateUser.restContext,
                                                        publicTenantA.publicContent,
                                                        privateTenantA.publicGroup.id,
                                                        privateTenantA.publicUser.restContext,
                                                        false,
                                                        401,
                                                        () => {
                                                          verifyShare(
                                                            publicTenantA.publicUser.restContext,
                                                            publicTenantA.publicContent,
                                                            privateTenantA.loggedinNotJoinableGroup.id,
                                                            privateTenantA.loggedinUser.restContext,
                                                            false,
                                                            401,
                                                            () => {
                                                              verifyShare(
                                                                publicTenantA.loggedinUser.restContext,
                                                                publicTenantA.publicContent,
                                                                privateTenantA.loggedinNotJoinableGroup.id,
                                                                privateTenantA.loggedinUser.restContext,
                                                                false,
                                                                401,
                                                                () => {
                                                                  verifyShare(
                                                                    publicTenantA.privateUser.restContext,
                                                                    publicTenantA.publicContent,
                                                                    privateTenantA.loggedinNotJoinableGroup.id,
                                                                    privateTenantA.loggedinUser.restContext,
                                                                    false,
                                                                    401,
                                                                    () => {
                                                                      verifyShare(
                                                                        publicTenantA.publicUser.restContext,
                                                                        publicTenantA.publicContent,
                                                                        privateTenantA.privateNotJoinableGroup.id,
                                                                        privateTenantA.privateUser.restContext,
                                                                        false,
                                                                        401,
                                                                        () => {
                                                                          verifyShare(
                                                                            publicTenantA.loggedinUser.restContext,
                                                                            publicTenantA.publicContent,
                                                                            privateTenantA.privateNotJoinableGroup.id,
                                                                            privateTenantA.privateUser.restContext,
                                                                            false,
                                                                            401,
                                                                            () => {
                                                                              verifyShare(
                                                                                publicTenantA.privateUser.restContext,
                                                                                publicTenantA.publicContent,
                                                                                privateTenantA.privateNotJoinableGroup
                                                                                  .id,
                                                                                privateTenantA.privateUser.restContext,
                                                                                false,
                                                                                401,
                                                                                callback
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
      });
    });

    // TODO: issue-1492 I think this is mostly buggy behaviour, all of these asserts to 20
    it('verify content sharing permutations from actor to target (joinable groups)', (callback) => {
      setupMultiTenantPrivacyEntities((publicTenantA, publicTenantB, privateTenantA /* , privateTenantB */) => {
        const asAdminToPublicTenantB = publicTenantB.adminRestContext;

        // Create some more users as we can only share it with a target user once.
        generateTestGroups(asAdminToPublicTenantB, 3, () => {
          /**
           * These cases should fail:
           * * Sharing with any user in a private tenant (regardless of their visibility setting)
           * * Sharing with a private or loggedin user in a public tenant
           */
          verifyShare(
            publicTenantA.publicUser.restContext,
            publicTenantA.publicContent,
            publicTenantB.loggedinJoinableGroup.id,
            publicTenantB.loggedinUser.restContext,
            false,
            200,
            () => {
              verifyShare(
                publicTenantA.loggedinUser.restContext,
                publicTenantA.publicContent,
                publicTenantB.loggedinJoinableGroup.id,
                publicTenantB.loggedinUser.restContext,
                false,
                200,
                () => {
                  verifyShare(
                    publicTenantA.privateUser.restContext,
                    publicTenantA.publicContent,
                    publicTenantB.loggedinJoinableGroup.id,
                    publicTenantB.loggedinUser.restContext,
                    false,
                    200,
                    () => {
                      verifyShare(
                        publicTenantA.publicUser.restContext,
                        publicTenantA.publicContent,
                        publicTenantB.privateJoinableGroup.id,
                        publicTenantB.privateUser.restContext,
                        false,
                        200,
                        () => {
                          verifyShare(
                            publicTenantA.loggedinUser.restContext,
                            publicTenantA.publicContent,
                            publicTenantB.privateJoinableGroup.id,
                            publicTenantB.privateUser.restContext,
                            false,
                            200,
                            () => {
                              verifyShare(
                                publicTenantA.privateUser.restContext,
                                publicTenantA.publicContent,
                                publicTenantB.privateJoinableGroup.id,
                                publicTenantB.privateUser.restContext,
                                false,
                                200,
                                () => {
                                  verifyShare(
                                    publicTenantA.publicUser.restContext,
                                    publicTenantA.publicContent,
                                    privateTenantA.loggedinJoinableGroup.id,
                                    privateTenantA.loggedinUser.restContext,
                                    false,
                                    401,
                                    () => {
                                      verifyShare(
                                        publicTenantA.loggedinUser.restContext,
                                        publicTenantA.publicContent,
                                        privateTenantA.loggedinJoinableGroup.id,
                                        privateTenantA.loggedinUser.restContext,
                                        false,
                                        401,
                                        () => {
                                          verifyShare(
                                            publicTenantA.privateUser.restContext,
                                            publicTenantA.publicContent,
                                            privateTenantA.loggedinJoinableGroup.id,
                                            privateTenantA.loggedinUser.restContext,
                                            false,
                                            401,
                                            () => {
                                              verifyShare(
                                                publicTenantA.publicUser.restContext,
                                                publicTenantA.publicContent,
                                                privateTenantA.privateJoinableGroup.id,
                                                privateTenantA.privateUser.restContext,
                                                false,
                                                401,
                                                () => {
                                                  verifyShare(
                                                    publicTenantA.loggedinUser.restContext,
                                                    publicTenantA.publicContent,
                                                    privateTenantA.privateJoinableGroup.id,
                                                    privateTenantA.privateUser.restContext,
                                                    false,
                                                    401,
                                                    () => {
                                                      verifyShare(
                                                        publicTenantA.privateUser.restContext,
                                                        publicTenantA.publicContent,
                                                        privateTenantA.privateJoinableGroup.id,
                                                        privateTenantA.privateUser.restContext,
                                                        false,
                                                        401,
                                                        callback
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
            }
          );
        });
      });
    });

    /**
     * Test that verifies that a user from an external tenant is limited to only the public content library of users
     */
    it('verify user sees only public libraries of external tenant users', (callback) => {
      // Create 2 users in tenant A (cam)
      generateTestUsers(asCambridgeTenantAdmin, 2, (error, users) => {
        assert.notExists(error);

        const { 0: homer, 1: marge } = users;
        const asHomer = homer.restContext;
        const asMarge = marge.restContext;

        // Create a user in tenant B (gt)
        generateTestUsers(asGeorgiaTenantAdmin, 1, (error, users) => {
          assert.notExists(error);

          const { 0: lisa } = users;
          const asLisa = lisa.restContext;

          // Create "public" content in tenant A
          createLink(
            asHomer,
            {
              displayName: 'Yahoo',
              description: 'Yahoo Website',
              visibility: PUBLIC,
              link: 'http://www.yahoo.ca',
              managers: [homer.user.id],
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (error, publicContentA) => {
              assert.notExists(error);

              // Create "loggedin" content in tenant A
              createLink(
                asHomer,
                {
                  displayName: 'Google',
                  description: 'Google Website',
                  visibility: LOGGED_IN,
                  link: 'http://google.com',
                  managers: [homer.user.id],
                  viewers: NO_VIEWERS,
                  folders: NO_FOLDERS
                },
                (error /* , loggedInContentA */) => {
                  assert.notExists(error);

                  // Verify user A2 can see both public and logged in content items
                  getLibrary(asMarge, homer.user.id, null, 10, (error, libraryA) => {
                    assert.notExists(error);
                    assert.lengthOf(libraryA.results, 2);

                    // Verify user B cannot see the loggedin content item, but can see the public content item
                    getLibrary(asLisa, homer.user.id, null, 10, (error, libraryA) => {
                      assert.notExists(error);
                      assert.lengthOf(libraryA.results, 1);
                      assert.strictEqual(libraryA.results[0].id, publicContentA.id);

                      return callback();
                    });
                  });
                }
              );
            }
          );
        });
      });
    });

    /**
     * Test that verifies that users from an external tenant are limited to a group's public content library
     */
    it('verify user sees only public library of external tenant groups', (callback) => {
      // Create a user in tenant A (cam)
      generateTestUsers(asCambridgeTenantAdmin, 1, (error, users) => {
        assert.notExists(error);

        const { 0: homer } = users;
        const asHomer = homer.restContext;

        // Create a user in tenant B (gt)
        generateTestUsers(asGeorgiaTenantAdmin, 1, (error, users) => {
          assert.notExists(error);
          const { 0: marge } = users;
          const asMarge = marge.restContext;

          // Create a group in tenant A
          const groupName = generateTestUserId();
          createGroup(asHomer, groupName, groupName, PUBLIC, NOT_JOINABLE, [], [], (error, groupA) => {
            assert.notExists(error);

            // Create "public" content in tenant A
            createLink(
              asHomer,
              {
                displayName: 'Yahoo',
                description: 'Yahoo Website',
                visibility: PUBLIC,
                link: 'http://www.yahoo.ca',
                managers: [homer.user.id],
                viewers: [groupA.id],
                folders: NO_FOLDERS
              },
              (error, publicContentA) => {
                assert.notExists(error);

                // Create "loggedin" content in tenant A
                createLink(
                  asHomer,
                  {
                    displayName: 'Google',
                    description: 'Google Website',
                    visibility: LOGGED_IN,
                    link: 'http://google.com',
                    managers: [homer.user.id],
                    viewers: [groupA.id],
                    folders: NO_FOLDERS
                  },
                  (error /* , loggedInContentA */) => {
                    assert.notExists(error);

                    // Verify user A can see both public and logged in content items for the group
                    getLibrary(asHomer, groupA.id, null, 10, (error, libraryA) => {
                      assert.notExists(error);
                      assert.lengthOf(libraryA.results, 2);

                      // Verify user B cannot see the loggedin content item, but can see the public content item
                      getLibrary(asMarge, groupA.id, null, 10, (error, libraryB) => {
                        assert.notExists(error);
                        assert.lengthOf(libraryB.results, 1);
                        assert.strictEqual(libraryB.results[0].id, publicContentA.id);

                        return callback();
                      });
                    });
                  }
                );
              }
            );
          });
        });
      });
    });

    /**
     * Verify that users who are members of a piece of content and originate from a tenant
     * who has changed their tenant privacy, can still be interacted with
     */
    it('verify users from a private tenant can be updated/removed as content members', (callback) => {
      setupMultiTenantPrivacyEntities((publicTenantA, publicTenantB /* , privateTenantA, privateTenantB */) => {
        const actor = publicTenantA.publicUser;
        const asActor = actor.restContext;
        const sharedUser = publicTenantB.publicUser.user;

        createLink(
          asActor,
          {
            displayName: 'Yahoo',
            description: 'Yahoo Website',
            visibility: PUBLIC,
            link: 'http://www.yahoo.ca',
            managers: NO_MANAGERS,
            viewers: [sharedUser.id],
            folders: NO_FOLDERS
          },
          (error, contentObject) => {
            assert.notExists(error);

            // Make that tenant private
            updateConfigAndWait(
              asGlobalAdmin,
              publicTenantB.tenant.alias,
              { 'oae-tenants/tenantprivacy/tenantprivate': true },
              (error_) => {
                assert.notExists(error_);

                // Changing the role of a user from a private tenant (that was already a member) should work
                const update = {};
                update[sharedUser.id] = MANAGER;

                updateMembers(asActor, contentObject.id, update, (error_) => {
                  assert.notExists(error_);
                  // Verify that the user is still there and is a manager
                  getMembers(asActor, contentObject.id, null, 10, (error, data) => {
                    assert.notExists(error);

                    const sharedMember = find(pathSatisfies(equals(sharedUser.id), [PROFILE, ID]), data.results);
                    assert.strictEqual(sharedMember.profile.id, publicTenantB.publicUser.user.id);
                    assert.ok(sharedMember.role, MANAGER);

                    // Removing a private user (that was already a member) should work
                    update[sharedUser.id] = false;

                    updateMembers(asActor, contentObject.id, update, (error_) => {
                      assert.notExists(error_);

                      // Verify that the user has been removed
                      getMembers(asActor, contentObject.id, null, 10, (error, data) => {
                        assert.notExists(error);

                        assert.isNotOk(find(pathSatisfies(equals(sharedUser.id), [PROFILE, ID]), data.results));
                        callback();
                      });
                    });
                  });
                });
              }
            );
          }
        );
      });
    });
  });
});
