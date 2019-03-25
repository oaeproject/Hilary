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
const ConfigTestUtil = require('oae-config/lib/test/util');
const RestAPI = require('oae-rest');
const { RestContext } = require('oae-rest/lib/model');
const TestsUtil = require('oae-tests');

const ContentTestUtil = require('oae-content/lib/test/util');

describe('Content', () => {
  // Rest context that can be used every time we need to make a request as an anonymous user
  let anonymousRestContext = null;
  // Rest contexts that can be used every time we need to make a request as a tenant admin
  let camAdminRestContext = null;
  let gtAdminRestContext = null;
  // Rest context that can be used every time we need to make a request as a global admin
  let globalAdminRestContext = null;

  /**
   * Function that will fill up the anonymous and tenant admin REST context
   */
  before(callback => {
    // Fill up anonymous rest context
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    // Fill up tenant admin rest contexts
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    gtAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.gt.host);
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
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
    const verifyShare = function(
      actorUserRestContext,
      objectContent,
      targetPrincipalId,
      targetRestContext,
      validateEmail,
      expectedHttpCode,
      callback
    ) {
      // Get the me object of the target in case we need to do a validated share with their
      // email
      RestAPI.User.getMe(targetRestContext, (err, me) => {
        assert.ok(!err);

        // If we've chosen to use a user id that is validated with email, then attach the
        // email to the user id
        let targetId = targetPrincipalId;
        if (_.isString(validateEmail)) {
          targetId = util.format('%s:%s', validateEmail, targetPrincipalId);
        } else if (validateEmail) {
          targetId = util.format('%s:%s', me.email, targetPrincipalId);
        }

        RestAPI.Content.shareContent(actorUserRestContext, objectContent.id, [targetId], err => {
          if (expectedHttpCode === 200) {
            assert.ok(!err);
          } else {
            assert.strictEqual(err.code, expectedHttpCode);
          }

          // If we shared with an email, use the target rest context as the principal id
          // whose library to check
          const targetId = AuthzUtil.isEmail(targetPrincipalId) ? me.id : targetPrincipalId;

          // Sanity check that the item appears in the library, if applicable
          RestAPI.Content.getLibrary(targetRestContext, targetId, null, 100, (err, data) => {
            assert.ok(!err);
            const library = data.results;
            if (expectedHttpCode === 200) {
              assert.ok(_.findWhere(library, { id: objectContent.id }));
            } else {
              assert.ok(!_.findWhere(library, { id: objectContent.id }));
            }

            return callback();
          });
        });
      });
    };

    /**
     * Test that verifies that a public user A from a public tenant A can access a public content item from a external tenant B
     */
    it('verify user can access public content from external tenant', callback => {
      ContentTestUtil.setupMultiTenantPrivacyEntities(
        (publicTenantA, publicTenantB, privateTenantA, privateTenantB) => {
          // Accessing public content in a public tenant from a public tenant should succeed
          RestAPI.Content.getContent(
            publicTenantA.publicUser.restContext,
            publicTenantB.publicContent.id,
            (err, contentObj) => {
              assert.ok(!err);
              assert.ok(contentObj);
              assert.strictEqual(contentObj.id, publicTenantB.publicContent.id);

              // Accessing loggedin content in a public tenant from a public tenant should fail
              RestAPI.Content.getContent(
                publicTenantA.publicUser.restContext,
                publicTenantB.loggedinContent.id,
                (err, contentObj) => {
                  assert.strictEqual(err.code, 401);
                  assert.ok(!contentObj);
                  // Accessing private content in a public tenant from a public tenant should fail
                  RestAPI.Content.getContent(
                    publicTenantA.publicUser.restContext,
                    publicTenantB.privateContent.id,
                    (err, contentObj) => {
                      assert.strictEqual(err.code, 401);
                      assert.ok(!contentObj);
                      callback();
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
     * Test that verifies the object -> target sharing permutations
     */
    it('verify content sharing permutations from object to target (users)', callback => {
      ContentTestUtil.setupMultiTenantPrivacyEntities(
        (publicTenantA, publicTenantB, privateTenantA, privateTenantB) => {
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
        }
      );
    });

    /**
     * Test that verifies the object -> target sharing permutations using the target user email
     * address
     */
    it('verify content sharing permutations from object to target by email address (users)', callback => {
      ContentTestUtil.setupMultiTenantPrivacyEntities(
        (publicTenantA, publicTenantB, privateTenantA, privateTenantB) => {
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
        }
      );
    });

    /**
     * Test that verifies the object -> target sharing permutations
     */
    it('verify content sharing permutations from object to target (non joinable groups)', callback => {
      ContentTestUtil.setupMultiTenantPrivacyEntities(
        (publicTenantA, publicTenantB, privateTenantA, privateTenantB) => {
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
                                                                                    privateTenantA.publicUser
                                                                                      .restContext,
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
        }
      );
    });

    it('verify content sharing permutations from object to target (joinable groups)', callback => {
      ContentTestUtil.setupMultiTenantPrivacyEntities(
        (publicTenantA, publicTenantB, privateTenantA, privateTenantB) => {
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
        }
      );
    });

    /**
     * Test that verifies the actor -> object sharing permutations
     */
    it('verify content sharing permutations from actor to object', callback => {
      ContentTestUtil.setupMultiTenantPrivacyEntities(
        (publicTenantA, publicTenantB, privateTenantA, privateTenantB) => {
          // Create some more users as we can only share it with a target user once.
          TestsUtil.generateTestUsers(publicTenantA.adminRestContext, 3, (err, users) => {
            assert.ok(!err);
            const targetUsers = _.values(users);

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
                        // All cases where the TenantA tenant admin does not have implicit access to the content item, the operation should fail with a 401 error
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
        }
      );
    });

    /**
     * Test that verifies the actor -> target sharing permutations when the sharing user has
     * provided a correct validation email
     */
    it('verify content sharing permutations from actor to target (users) with email only', callback => {
      ContentTestUtil.setupMultiTenantPrivacyEntities((publicTenantA, publicTenantB, privateTenantA) => {
        // Ensure the user cannot share with the private user of their own tenant without a
        // proper validation email
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
                    // Ensure the user can never share with a user
                    // from a private tenant, even if they know
                    // their email address
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
    it('verify content sharing permutations from actor to target (users) with a validating email', callback => {
      ContentTestUtil.setupMultiTenantPrivacyEntities((publicTenantA, publicTenantB, privateTenantA) => {
        // Ensure the user cannot share with the private user of their own tenant without a
        // proper validation email
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
                    // Ensure the user cannot share with a loggedin or private user of
                    // another public tenant withoutproper validation email
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
                                            // Ensure the user can never share with a user
                                            // from a private tenant, even if they know
                                            // their email address
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
    it('verify content sharing permutations from actor to target (users)', callback => {
      ContentTestUtil.setupMultiTenantPrivacyEntities(
        (publicTenantA, publicTenantB, privateTenantA, privateTenantB) => {
          // Create some more users as we can only share it with a target user once.
          TestsUtil.generateTestUsers(publicTenantB.adminRestContext, 3, (err, users) => {
            assert.ok(!err);

            const targetUsers = _.values(users);

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
                        // These cases should fail:
                        //  * Sharing with any user in a private tenant (regardless of their visibility setting)
                        //  * Sharing with a private or loggedin user in a public tenant
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
                                                                                  privateTenantA.privateUser
                                                                                    .restContext,
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
        }
      );
    });

    /**
     * Test that verifies the actor -> target sharing permutations
     */
    it.only('verify content sharing permutations from actor to target (non joinable groups)', callback => {
      ContentTestUtil.setupMultiTenantPrivacyEntities(
        (publicTenantA, publicTenantB, privateTenantA, privateTenantB) => {
          // Create some more users as we can only share it with a target user once.
          TestsUtil.generateTestGroups(publicTenantB.adminRestContext, 3, function(...args) {
            const groups = _.pluck(args, 'group');

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
                        // These cases should fail:
                        //  * Sharing with any user in a private tenant (regardless of their visibility setting)
                        //  * Sharing with a private or loggedin user in a public tenant
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
                                                                                  privateTenantA.privateUser
                                                                                    .restContext,
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
        }
      );
    });

    // TODO: issue-1492 I think this is mostly buggy behaviour, all of these asserts to 20
    it.only('verify content sharing permutations from actor to target (joinable groups)', callback => {
      ContentTestUtil.setupMultiTenantPrivacyEntities(
        (publicTenantA, publicTenantB, privateTenantA, privateTenantB) => {
          // Create some more users as we can only share it with a target user once.
          TestsUtil.generateTestGroups(publicTenantB.adminRestContext, 3, function(...args) {
            const groups = _.pluck(args, 'group');

            // These cases should fail:
            //  * Sharing with any user in a private tenant (regardless of their visibility setting)
            //  * Sharing with a private or loggedin user in a public tenant
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
        }
      );
    });

    /**
     * Test that verifies that a user from an external tenant is limited to only the public content library of users
     */
    it('verify user sees only public libraries of external tenant users', callback => {
      // Create 2 users in tenant A (cam)
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, userA, userA2) => {
        assert.ok(!err);

        // Create a user in tenant B (gt)
        TestsUtil.generateTestUsers(gtAdminRestContext, 1, (err, users, userB) => {
          assert.ok(!err);

          // Create "public" content in tenant A
          RestAPI.Content.createLink(
            userA.restContext,
            'Yahoo',
            'Yahoo Website',
            'public',
            'http://www.yahoo.ca',
            [userA.user.id],
            [],
            [],
            (err, publicContentA) => {
              assert.ok(!err);

              // Create "loggedin" content in tenant A
              RestAPI.Content.createLink(
                userA.restContext,
                'Google',
                'Google Website',
                'loggedin',
                'http://google.com',
                [userA.user.id],
                [],
                [],
                (err, loggedInContentA) => {
                  assert.ok(!err);

                  // Verify user A2 can see both public and logged in content items
                  RestAPI.Content.getLibrary(userA2.restContext, userA.user.id, null, 10, (err, libraryA) => {
                    assert.ok(!err);
                    assert.strictEqual(libraryA.results.length, 2);

                    // Verify user B cannot see the loggedin content item, but can see the public content item
                    RestAPI.Content.getLibrary(userB.restContext, userA.user.id, null, 10, (err, libraryA) => {
                      assert.ok(!err);
                      assert.strictEqual(libraryA.results.length, 1);
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
    it('verify user sees only public library of external tenant groups', callback => {
      // Create a user in tenant A (cam)
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, userA) => {
        assert.ok(!err);

        // Create a user in tenant B (gt)
        TestsUtil.generateTestUsers(gtAdminRestContext, 1, (err, users, userB) => {
          assert.ok(!err);

          // Create a group in tenant A
          const groupName = TestsUtil.generateTestUserId();
          RestAPI.Group.createGroup(userA.restContext, groupName, groupName, 'public', 'no', [], [], (err, groupA) => {
            assert.ok(!err);

            // Create "public" content in tenant A
            RestAPI.Content.createLink(
              userA.restContext,
              'Yahoo',
              'Yahoo Website',
              'public',
              'http://www.yahoo.ca',
              [userA.user.id],
              [groupA.id],
              [],
              (err, publicContentA) => {
                assert.ok(!err);

                // Create "loggedin" content in tenant A
                RestAPI.Content.createLink(
                  userA.restContext,
                  'Google',
                  'Google Website',
                  'loggedin',
                  'http://google.com',
                  [userA.user.id],
                  [groupA.id],
                  [],
                  (err, loggedInContentA) => {
                    assert.ok(!err);

                    // Verify user A can see both public and logged in content items for the group
                    RestAPI.Content.getLibrary(userA.restContext, groupA.id, null, 10, (err, libraryA) => {
                      assert.ok(!err);
                      assert.strictEqual(libraryA.results.length, 2);

                      // Verify user B cannot see the loggedin content item, but can see the public content item
                      RestAPI.Content.getLibrary(userB.restContext, groupA.id, null, 10, (err, libraryB) => {
                        assert.ok(!err);
                        assert.strictEqual(libraryB.results.length, 1);
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
    it('verify users from a private tenant can be updated/removed as content members', callback => {
      TestsUtil.setupMultiTenantPrivacyEntities((publicTenantA, publicTenantB, privateTenantA, privateTenantB) => {
        const actor = publicTenantA.publicUser;
        const sharedUser = publicTenantB.publicUser.user;

        RestAPI.Content.createLink(
          actor.restContext,
          'Yahoo',
          'Yahoo Website',
          'public',
          'http://www.yahoo.ca',
          [],
          [sharedUser.id],
          [],
          (err, contentObj) => {
            assert.ok(!err);

            // Make that tenant private
            ConfigTestUtil.updateConfigAndWait(
              globalAdminRestContext,
              publicTenantB.tenant.alias,
              { 'oae-tenants/tenantprivacy/tenantprivate': true },
              err => {
                assert.ok(!err);

                // Changing the role of a user from a private tenant (that was already a member) should work
                const update = {};
                update[sharedUser.id] = 'manager';
                RestAPI.Content.updateMembers(actor.restContext, contentObj.id, update, err => {
                  assert.ok(!err);
                  // Verify that the user is still there and is a manager
                  RestAPI.Content.getMembers(actor.restContext, contentObj.id, null, 10, (err, data) => {
                    assert.ok(!err);
                    const sharedMember = _.find(data.results, member => {
                      return member.profile.id === sharedUser.id;
                    });
                    assert.strictEqual(sharedMember.profile.id, publicTenantB.publicUser.user.id);
                    assert.ok(sharedMember.role, 'manager');

                    // Removing a private user (that was already a member) should work
                    update[sharedUser.id] = false;
                    RestAPI.Content.updateMembers(actor.restContext, contentObj.id, update, err => {
                      assert.ok(!err);
                      // Verify that the user has been removed
                      RestAPI.Content.getMembers(actor.restContext, contentObj.id, null, 10, (err, data) => {
                        assert.ok(!err);
                        assert.ok(
                          !_.find(data.results, member => {
                            return member.profile.id === sharedUser.id;
                          })
                        );
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
