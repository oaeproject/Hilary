/*
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

import { assert } from 'chai';
import { format } from 'util';

import * as ActivityTestUtil from 'oae-activity/lib/test/util.js';
import * as ConfigTestUtil from 'oae-config/lib/test/util.js';
import * as ContentTestUtil from 'oae-content/lib/test/util.js';
import * as DiscussionsTestUtil from 'oae-discussions/lib/test/util.js';
import * as EmailTestUtil from 'oae-email/lib/test/util.js';
import * as FoldersTestUtil from 'oae-folders/lib/test/util.js';
import * as PrincipalsTestUtil from 'oae-principals/lib/test/util.js';
import * as Sanitization from 'oae-util/lib/sanitization.js';
import * as SearchTestUtil from 'oae-search/lib/test/util.js';
import * as TenantsAPI from 'oae-tenants';
import * as TenantsTestUtil from 'oae-tenants/lib/test/util.js';
import * as TestsUtil from 'oae-tests';
import * as UIAPI from 'oae-ui';

import * as AuthzInvitationsDAO from 'oae-authz/lib/invitations/dao.js';
import * as AuthzTestUtil from 'oae-authz/lib/test/util.js';
import * as AuthzUtil from 'oae-authz/lib/util.js';
import clone from 'clone';

import _ from 'underscore';

import { find, equals } from 'ramda';

describe('Invitations', () => {
  // Initialize some rest contexts for anonymous and admin users
  let anonymousRestContext = null;
  let camAdminRestContext = null;
  let globalAdminRestContext = null;

  const _randomString = () => TestsUtil.generateRandomText(1);

  /*!
   * This is a wrapper of `_.partial` that allows you to specify an argless function as a
   * parameter that will be invoked to derive the argument value on each invokation
   *
   * @param  {Function}   fn      The function to curry
   * @param  {...Object}  args    The variable number of arguments to partially apply the function with
   * @return {Function}           The partially applied function, just like `_.partial`, except any partial arguments that were functions are invoked on-the-fly for each invocation
   */
  const _partialWithFns = function (firstFn, ...args) {
    const firstArgs = args;

    // Return a function that does the call at the time it was called, but invoke any functions
    // given in the first set of arguments on-the-fly
    return function (...args) {
      const secondArgs = args;

      // Apply all the arguments from the first call on-the-fly
      const firstArgsApplied = [];
      for (let i = 0; i <= firstArgs.length; i++) {
        const arg = firstArgs[i];
        if (arg === _ || !_.isFunction(arg)) {
          firstArgsApplied.push(arg);
        } else {
          firstArgsApplied.push(arg());
        }
      }

      // Create the first partial with the applied arguments
      const firstFnPartial = _.partial.apply(null, [firstFn].concat(firstArgsApplied));

      // Now return the result of the partial function with the 2nd set of arguments verbatim
      return firstFnPartial(...secondArgs);
    };
  };

  /*!
   * Build a library of common functions across different known resource types
   */
  const resourceFns = {
    content: {
      createSucceeds: _partialWithFns(
        ContentTestUtil.assertCreateLinkSucceeds,
        _,
        _randomString,
        _randomString,
        _,
        'http://oae.local',
        _,
        _,
        [],
        _
      ),
      createFails: _partialWithFns(
        ContentTestUtil.assertCreateLinkFails,
        _,
        _randomString,
        _randomString,
        _,
        'http://oae.local',
        _,
        _,
        [],
        _,
        _
      ),
      shareSucceeds: ContentTestUtil.assertShareContentSucceeds,
      shareFails: ContentTestUtil.assertShareContentFails,
      setRolesSucceeds: ContentTestUtil.assertUpdateContentMembersSucceeds,
      setRolesFails: ContentTestUtil.assertUpdateContentMembersFails,
      getMembersSucceeds: _partialWithFns(ContentTestUtil.getAllContentMembers, _, _, null, _),
      getLibrarySucceeds: _partialWithFns(
        ContentTestUtil.assertGetAllContentLibrarySucceeds,
        _,
        _,
        null,
        _
      ),
      deleteSucceeds(adminRestContext, deleterRestContext, contentId, callback) {
        ContentTestUtil.assertDeleteContentSucceeds(deleterRestContext, contentId, callback);
      }
    },
    discussion: {
      createSucceeds: _partialWithFns(
        DiscussionsTestUtil.assertCreateDiscussionSucceeds,
        _,
        _randomString,
        _randomString,
        _,
        _,
        _,
        _
      ),
      createFails: _partialWithFns(
        DiscussionsTestUtil.assertCreateDiscussionFails,
        _,
        _randomString,
        _randomString,
        _,
        _,
        _,
        _,
        _
      ),
      shareSucceeds: DiscussionsTestUtil.assertShareDiscussionSucceeds,
      shareFails: DiscussionsTestUtil.assertShareDiscussionFails,
      setRolesSucceeds: DiscussionsTestUtil.assertUpdateDiscussionMembersSucceeds,
      setRolesFails: DiscussionsTestUtil.assertUpdateDiscussionMembersFails,
      getMembersSucceeds: _partialWithFns(
        DiscussionsTestUtil.getAllDiscussionMembers,
        _,
        _,
        null,
        _
      ),
      getLibrarySucceeds: _partialWithFns(
        DiscussionsTestUtil.assertGetAllDiscussionsLibrarySucceeds,
        _,
        _,
        null,
        _
      ),
      deleteSucceeds(adminRestContext, deleterRestContext, discussionId, callback) {
        DiscussionsTestUtil.assertDeleteDiscussionSucceeds(
          deleterRestContext,
          discussionId,
          callback
        );
      }
    },
    folder: {
      createSucceeds: _partialWithFns(
        FoldersTestUtil.assertCreateFolderSucceeds,
        _,
        _randomString,
        _randomString,
        _,
        _,
        _,
        _
      ),
      createFails: _partialWithFns(
        FoldersTestUtil.assertCreateFolderFails,
        _,
        _randomString,
        _randomString,
        _,
        _,
        _,
        _,
        _
      ),
      shareSucceeds: FoldersTestUtil.assertShareFolderSucceeds,
      shareFails: FoldersTestUtil.assertShareFolderFails,
      setRolesSucceeds: FoldersTestUtil.assertUpdateFolderMembersSucceeds,
      setRolesFails: FoldersTestUtil.assertUpdateFolderMembersFails,
      getMembersSucceeds: _partialWithFns(
        FoldersTestUtil.assertGetAllFolderMembersSucceeds,
        _,
        _,
        null,
        _
      ),
      getLibrarySucceeds: _partialWithFns(
        FoldersTestUtil.assertGetAllFoldersLibrarySucceeds,
        _,
        _,
        null,
        _
      ),
      deleteSucceeds(adminRestContext, deleterRestContext, folderId, callback) {
        FoldersTestUtil.assertDeleteFolderSucceeds(deleterRestContext, folderId, true, callback);
      }
    },
    group: {
      createSucceeds: _partialWithFns(
        PrincipalsTestUtil.assertCreateGroupSucceeds,
        _,
        _randomString,
        _randomString,
        _,
        'no',
        _,
        _,
        _
      ),
      createFails: _partialWithFns(
        PrincipalsTestUtil.assertCreateGroupFails,
        _,
        _randomString,
        _randomString,
        _,
        'no',
        _,
        _,
        _,
        _
      ),
      setRolesSucceeds: PrincipalsTestUtil.assertSetGroupMembersSucceeds,
      setRolesFails: PrincipalsTestUtil.assertSetGroupMembersFails,
      getMembersSucceeds: _partialWithFns(
        PrincipalsTestUtil.assertGetAllMembersLibrarySucceeds,
        _,
        _,
        null,
        _
      ),
      getLibrarySucceeds: _partialWithFns(
        PrincipalsTestUtil.assertGetAllMembershipsLibrarySucceeds,
        _,
        _,
        null,
        _
      ),
      deleteSucceeds: PrincipalsTestUtil.assertDeleteGroupSucceeds,
      restoreSucceeds: PrincipalsTestUtil.assertRestoreGroupSucceeds
    }
  };

  /*!
   * Build a library of the "member" role for all known resources types. "manager" is common for
   * all resources
   */
  const resourceMemberRoles = {
    content: 'viewer',
    discussion: 'member',
    folder: 'viewer',
    group: 'member'
  };

  /*!
   * Build a library of expected activity information after an invitation is accepted for each
   * resource type
   */
  const resourceAcceptActivityInfo = {
    content: {
      activityType: 'content-share',
      verb: 'share'
    },
    discussion: {
      activityType: 'discussion-share',
      verb: 'share'
    },
    folder: {
      activityType: 'folder-share',
      verb: 'share'
    },
    group: {
      activityType: 'group-add-member',
      verb: 'add'
    }
  };

  /*!
   * Define the library names for each respective resource type
   */
  const resourceLibraryInfo = {
    content: 'content-library',
    discussion: 'discussion-library',
    folder: 'folder-library',
    group: 'memberships-library'
  };

  before((callback) => {
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();
    return callback();
  });

  beforeEach((callback) => {
    // Ensure we start each test with no emails pending
    EmailTestUtil.collectAndFetchAllEmails(() => {
      return callback();
    });
  });

  describe('Create', () => {
    describe('Content', () => {
      /**
       * Test that verifies creating content with members and invitations saves invitations
       */
      it('verify creating content with members and invitations saves invitations', (callback) => {
        return _testInvitationsForCreate('content', callback);
      });

      /**
       * Test that verifies validation of creating content with invitations
       */
      it('verify validation of creating content with invitations', (callback) => {
        return _testInvitationsValidationForCreate('content', callback);
      });

      /**
       * Test that verifies authorization of creating content with invitations
       */
      it('verify authorization of creating content with invitations', (callback) => {
        return _testInvitationsAuthorizationForCreate('content', callback);
      });
    });

    describe('Discussion', () => {
      /**
       * Test that verifies creating discussions with members and invitations saves invitations
       */
      it('verify creating discussion with members and invitations saves invitations', (callback) => {
        return _testInvitationsForCreate('discussion', callback);
      });

      /**
       * Test that verifies validation of creating discussions with invitations
       */
      it('verify validation of creating discussion with invitations', (callback) => {
        return _testInvitationsValidationForCreate('discussion', callback);
      });

      /**
       * Test that verifies authorization of creating discussions with invitations
       */
      it('verify authorization of creating discussion with invitations', (callback) => {
        return _testInvitationsAuthorizationForCreate('discussion', callback);
      });
    });

    describe('Folder', () => {
      /**
       * Test that verifies creating folders with members and invitations saves invitations
       */
      it('verify creating folder with members and invitations saves invitations', (callback) => {
        return _testInvitationsForCreate('folder', callback);
      });

      /**
       * Test that verifies validation of creating folders with invitations
       */
      it('verify validation of creating folder with invitations', (callback) => {
        return _testInvitationsValidationForCreate('folder', callback);
      });

      /**
       * Test that verifies authorization of creating folders with invitations
       */
      it('verify authorization of creating folder with invitations', (callback) => {
        return _testInvitationsAuthorizationForCreate('folder', callback);
      });
    });

    describe('Group', () => {
      /**
       * Test that verifies creating groups with members and invitations saves invitations
       */
      it('verify creating group with members and invitations saves invitations', (callback) => {
        return _testInvitationsForCreate('group', callback);
      });

      /**
       * Test that verifies validation of creating groups with invitations
       */
      it('verify validation of creating group with invitations', (callback) => {
        return _testInvitationsValidationForCreate('group', callback);
      });

      /**
       * Test that verifies authorization of creating groups with invitations
       */
      it('verify authorization of creating group with invitations', (callback) => {
        return _testInvitationsAuthorizationForCreate('group', callback);
      });
    });
  });

  describe('Share', () => {
    describe('Content', () => {
      /**
       * Test that verifies sharing content with members and invitations saves invitations
       */
      it('verify sharing content with members and invitations saves invitations', (callback) => {
        return _testInvitationsForShare('content', callback);
      });

      /**
       * Test that verifies validation of content share with invitations
       */
      it('verify validation of content share with invitations', (callback) => {
        return _testInvitationsValidationForShare('content', callback);
      });

      /**
       * Test that verifies authorization of content share with invitations
       */
      it('verify authorization of content share with invitations', (callback) => {
        return _testInvitationsAuthorizationForShare('content', callback);
      });
    });

    describe('Discussion', () => {
      /**
       * Test that verifies sharing discussion with members and invitations saves invitations
       */
      it('verify sharing discussion with members and invitations saves invitations', (callback) => {
        return _testInvitationsForShare('discussion', callback);
      });

      /**
       * Test that verifies validation of discussion share with invitations
       */
      it('verify validation of discussion share with invitations', (callback) => {
        return _testInvitationsValidationForShare('discussion', callback);
      });

      /**
       * Test that verifies authorization of discussion share with invitations
       */
      it('verify authorization of discussion share with invitations', (callback) => {
        return _testInvitationsAuthorizationForShare('discussion', callback);
      });
    });

    describe('Folder', () => {
      /**
       * Test that verifies sharing folder with members and invitations saves invitations
       */
      it('verify sharing folder with members and invitations saves invitations', (callback) => {
        return _testInvitationsForShare('folder', callback);
      });

      /**
       * Test that verifies validation of folder share with invitations
       */
      it('verify validation of folder share with invitations', (callback) => {
        return _testInvitationsValidationForShare('folder', callback);
      });

      /**
       * Test that verifies authorization of folder share with invitations
       */
      it('verify authorization of folder share with invitations', (callback) => {
        return _testInvitationsAuthorizationForShare('folder', callback);
      });
    });
  });

  describe('Set Roles', () => {
    describe('Content', () => {
      /**
       * Test that verifies setting roles of content with members and invitations saves invitations
       */
      it('verify setting roles of content with members and invitations saves invitations', (callback) => {
        return _testInvitationsForSetRoles('content', callback);
      });

      /**
       * Test that verifies validation of setting roles of content with invitations
       */
      it('verify validation of setting roles of content with invitations', (callback) => {
        return _testInvitationsValidationForSetRoles('content', callback);
      });

      /**
       * Test that verifies authorization of setting roles of content with invitations
       */
      it('verify authorization of setting roles of content with invitations', (callback) => {
        return _testInvitationsAuthorizationForSetRoles('content', callback);
      });

      /**
       * Test that verifies removing one of multiple content invitations still allows the other
       * invited content items to be associated when accepted
       */
      it('verify removing one of multiple content invitations for an email', (callback) => {
        return _testInvitationsPartialRemoveRoles('content', callback);
      });
    });

    describe('Discussion', () => {
      /**
       * Test that verifies setting roles of discussion with members and invitations saves invitations
       */
      it('verify setting roles of discussion with members and invitations saves invitations', (callback) => {
        return _testInvitationsForSetRoles('discussion', callback);
      });

      /**
       * Test that verifies validation of setting roles of discussion with invitations
       */
      it('verify validation of setting roles of discussion with invitations', (callback) => {
        return _testInvitationsValidationForSetRoles('discussion', callback);
      });

      /**
       * Test that verifies authorization of setting roles of discussion with invitations
       */
      it('verify authorization of setting roles of discussion with invitations', (callback) => {
        return _testInvitationsAuthorizationForSetRoles('discussion', callback);
      });

      /**
       * Test that verifies removing one of multiple discussion invitations still allows the other
       * invited discussions to be associated when accepted
       */
      it('verify removing one of multiple discussion invitations for an email', (callback) => {
        return _testInvitationsPartialRemoveRoles('discussion', callback);
      });
    });

    describe('Folder', () => {
      /**
       * Test that verifies setting roles of folder with members and invitations saves invitations
       */
      it('verify setting roles of folder with members and invitations saves invitations', (callback) => {
        return _testInvitationsForSetRoles('folder', callback);
      });

      /**
       * Test that verifies validation of setting roles of folder with invitations
       */
      it('verify validation of setting roles of folder with invitations', (callback) => {
        return _testInvitationsValidationForSetRoles('folder', callback);
      });

      /**
       * Test that verifies authorization of setting roles of folder with invitations
       */
      it('verify authorization of setting roles of folder with invitations', (callback) => {
        return _testInvitationsAuthorizationForSetRoles('folder', callback);
      });

      /**
       * Test that verifies removing one of multiple folder invitations still allows the other
       * invited folders to be associated when accepted
       */
      it('verify removing one of multiple folder invitations for an email', (callback) => {
        return _testInvitationsPartialRemoveRoles('folder', callback);
      });
    });

    describe('Group', () => {
      /**
       * Test that verifies setting roles of group with members and invitations saves invitations
       */
      it('verify setting roles of group with members and invitations saves invitations', (callback) => {
        return _testInvitationsForSetRoles('group', callback);
      });

      /**
       * Test that verifies validation of setting roles of group with invitations
       */
      it('verify validation of setting roles of group with invitations', (callback) => {
        return _testInvitationsValidationForSetRoles('group', callback);
      });

      /**
       * Test that verifies authorization of setting roles of group with invitations
       */
      it('verify authorization of setting roles of group with invitations', (callback) => {
        return _testInvitationsAuthorizationForSetRoles('group', callback);
      });

      /**
       * Test that verifies removing one of multiple group invitations still allows the other
       * invited groups to be associated when accepted
       */
      it('verify removing one of multiple group invitations for an email', (callback) => {
        return _testInvitationsPartialRemoveRoles('group', callback);
      });
    });
  });

  describe('Accept', () => {
    describe('Content', () => {
      /**
       * Test that verifies accepting an invitation with content
       */
      it('verify accepting an invitation with content', (callback) => {
        _testInvitationAccept('content', callback);
      });

      /**
       * Test that verifies validation of accepting an invitation with content
       */
      it('verify validation of accepting an invitation with content', (callback) => {
        _testInvitationAcceptValidation('content', callback);
      });

      /**
       * Test that verifies authorization of accepting an invitation with content
       */
      it('verify authorization of accepting an invitation with content', (callback) => {
        _testInvitationAcceptAuthorization('content', callback);
      });
    });

    describe('Discussion', () => {
      /**
       * Test that verifies accepting an invitation with discussions
       */
      it('verify accepting an invitation with discussions', (callback) => {
        _testInvitationAccept('discussion', callback);
      });

      /**
       * Test that verifies validation of accepting an invitation with discussions
       */
      it('verify validation of accepting an invitation with discussions', (callback) => {
        _testInvitationAcceptValidation('discussion', callback);
      });

      /**
       * Test that verifies authorization of accepting an invitation with discussions
       */
      it('verify authorization of accepting an invitation with discussions', (callback) => {
        _testInvitationAcceptAuthorization('discussion', callback);
      });
    });

    describe('Folder', () => {
      /**
       * Test that verifies accepting an invitation with folders
       */
      it('verify accepting an invitation with folders', (callback) => {
        _testInvitationAccept('folder', callback);
      });

      /**
       * Test that verifies validation of accepting an invitation with folders
       */
      it('verify validation of accepting an invitation with folders', (callback) => {
        _testInvitationAcceptValidation('folder', callback);
      });

      /**
       * Test that verifies authorization of accepting an invitation with folders
       */
      it('verify authorization of accepting an invitation with folders', (callback) => {
        _testInvitationAcceptAuthorization('folder', callback);
      });
    });

    describe('Group', () => {
      /**
       * Test that verifies accepting an invitation with groups
       */
      it('verify accepting an invitation with groups', (callback) => {
        _testInvitationAccept('group', callback);
      });

      /**
       * Test that verifies validation of accepting an invitation with groups
       */
      it('verify validation of accepting an invitation with groups', (callback) => {
        _testInvitationAcceptValidation('group', callback);
      });

      /**
       * Test that verifies authorization of accepting an invitation with groups
       */
      it('verify authorization of accepting an invitation with groups', (callback) => {
        _testInvitationAcceptAuthorization('group', callback);
      });
    });
  });

  describe('Resend', () => {
    /**
     * Test that verifies the invitation email can be resent
     */
    it('verify it resends an aggregated email for each resource type', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
        assert.notExists(error);
        const { 0: creatingUser, 1: acceptingUser } = users;

        // Create one of each resource type with the creating user
        const email = _emailForTenant(global.oaeTests.tenants.cam);
        _createOneOfEachResourceType(creatingUser, 'public', [email], [], (resources) => {
          // Collect all the invitations, we're going to resend them instead
          EmailTestUtil.collectAndFetchAllEmails((messages) => {
            assert.strictEqual(messages.length, 1);

            // Once all invitations are resent, then accept them
            const _done = _.chain(resources)
              .size()
              .after(() => {
                const assertions = { role: 'manager', membersSize: 2, librarySize: 1 };
                _assertAcceptEmailInvitation(
                  creatingUser,
                  acceptingUser,
                  resources,
                  assertions,
                  () => {
                    return callback();
                  }
                );
              })
              .value();

            // Resend all invitations
            _.each(resources, (resource) => {
              AuthzTestUtil.assertResendInvitationSucceeds(
                creatingUser.restContext,
                resource.resourceType,
                resource.id,
                email,
                () => {
                  return _done();
                }
              );
            });
          });
        });
      });
    });
  });

  describe('Email', () => {
    /**
     * Test that verifies email invitation links to the proper tenant based on email domain
     */
    it('verify email invitation links to the proper tenant based on email domain', (callback) => {
      const fns = resourceFns.content;
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
        assert.notExists(error);
        const { 0: user } = users;

        const cambridgeEmail = _emailForTenant(global.oaeTests.tenants.cam);
        const guestEmail = _emailForDomain(TenantsTestUtil.generateTestTenantHost());
        fns.createSucceeds(
          user.restContext,
          'public',
          [cambridgeEmail],
          [guestEmail],
          (/* resource */) => {
            EmailTestUtil.collectAndFetchAllEmails((messages) => {
              // There should be 2 emails, one for cambridgeEmail and one for guestEmail
              assert.lengthOf(messages, 2);

              const cambridgeMessage = find(
                (message) => equals(message.to[0].address, cambridgeEmail.toLowerCase()),
                messages
              );

              const guestMessage = find(
                (message) => equals(message.to[0].address, guestEmail.toLowerCase()),
                messages
              );

              // Grab the invitation link from the messages
              const cambridgeInvitationUrl =
                AuthzTestUtil.parseInvitationUrlFromMessage(cambridgeMessage);
              const guestInvitationUrl = AuthzTestUtil.parseInvitationUrlFromMessage(guestMessage);

              // Ensure the links are to the proper tenancy
              assert.strictEqual(cambridgeInvitationUrl.host, global.oaeTests.tenants.cam.host);
              assert.strictEqual(guestInvitationUrl.host, TenantsAPI.getTenant('guest').host);

              return callback();
            });
          }
        );
      });
    });

    /**
     * Test that verifies an email domain is case insensitive when choosing
     * an invitation tenant
     */
    it('verify tenant email domain is case insensitive for choosing an invitation tenant', (callback) => {
      const fns = resourceFns.content;
      const tenantAlias = TenantsTestUtil.generateTestTenantAlias();
      const tenantHost = TenantsTestUtil.generateTestTenantHost();
      TestsUtil.createTenantWithAdmin(
        tenantAlias,
        tenantHost,
        (error, tenant, tenantAdminRestContext) => {
          assert.notExists(error);
          TestsUtil.generateTestUsers(tenantAdminRestContext, 1, (error, users) => {
            assert.notExists(error);
            const { 0: user } = users;

            /**
             * Use an email that differs from the tenant email domain only by case
             */
            const matchingEmailDomain = tenantHost.toUpperCase();
            const matchingEmail = _emailForDomain(matchingEmailDomain);
            fns.createSucceeds(
              user.restContext,
              'public',
              [matchingEmail],
              [],
              (/* resource */) => {
                EmailTestUtil.collectAndFetchAllEmails((messages) => {
                  assert.lengthOf(messages, 1);

                  const message = _.first(messages);
                  const toEmail = message.to[0].address;
                  const invitationUrl = AuthzTestUtil.parseInvitationUrlFromMessage(message);

                  assert.strictEqual(toEmail, matchingEmail.toLowerCase());
                  assert.strictEqual(invitationUrl.host, tenant.host);

                  return callback();
                });
              }
            );
          });
        }
      );
    });

    /**
     * Test that verifies it sends an aggregated email for all resource types
     */
    it('verify it sends an aggregated email for each resource type', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
        assert.notExists(error);
        const { 0: creatingUser, 1: acceptingUser } = users;

        // Generate the email to invite and ensure we start with an empty email queue
        const email = _emailForTenant(global.oaeTests.tenants.cam);
        // Create one of each resource type with the creating user
        _createOneOfEachResourceType(creatingUser, 'public', [email], [], (resources) => {
          // Ensure when the invitation is accepted from the email, all resources are
          // added to the user's respective libraries
          const assertions = { role: 'manager', membersSize: 2, librarySize: 1 };
          _assertAcceptEmailInvitation(creatingUser, acceptingUser, resources, assertions, () => {
            return callback();
          });
        });
      });
    });

    describe('Content', () => {
      /**
       * Test that verifies it sends an aggregated invitation for content of all visibilities on create
       */
      it('verify it sends an aggregated invitation for content of all visibilities on create', (callback) => {
        _testInvitationEmailVisibilityForCreate('content', callback);
      });

      /**
       * Test that verifies it sends an aggregated invitation for content of all visibilities on set roles
       */
      it('verify it sends an aggregated invitation for content of all visibilities on set roles', (callback) => {
        _testInvitationEmailVisibilityForSetRoles('content', callback);
      });

      /**
       * Test that verifies it sends an aggregated invitation for content of all visibilities on share
       */
      it('verify it sends an aggregated invitation for content of all visibilities on share', (callback) => {
        _testInvitationEmailVisibilityForShare('content', callback);
      });

      /**
       * Test that verifies it formats the title properly for various numbers of activities and
       * actors
       */
      it('verify formatting of content invitation email subject for different numbers of actors and activities', (callback) => {
        _testInvitationEmailSubject('content', 'discussion', callback);
      });

      /**
       * Test that verifies the HTML of content invitation emails
       */
      it('verify content invitation email html', (callback) => {
        const assertions = {
          oneResourceSummaryMatch: 'has invited you to the link ',
          twoResourceSummaryMatch: 'has invited you to collaborate on ',
          threeResourceSummaryMatch: 'has invited you to collaborate on '
        };

        return _testInvitationEmailHtmlTargets('content', assertions, callback);
      });

      /**
       * Test that verifies the HTML of content invitation accept emails
       */
      it('verify email aggregation and summary for accepting an invitation to content', (callback) => {
        const assertions = {
          oneResourceSummaryMatch: [' has accepted your invitation to the link &quot;'],
          twoResourceSummaryMatch: [' has accepted your invitation to &quot;'],
          threeResourceSummaryMatch: [' has accepted your invitation to &quot;']
        };

        _testInvitationAcceptEmailSummary('content', assertions, callback);
      });
    });

    describe('Discussion', () => {
      /**
       * Test that verifies it sends an aggregated invitation for discussions of all visibilities on create
       */
      it('verify it sends an aggregated invitation for discussions of all visibilities on create', (callback) => {
        _testInvitationEmailVisibilityForCreate('discussion', callback);
      });

      /**
       * Test that verifies it sends an aggregated invitation for discussions of all visibilities on set roles
       */
      it('verify it sends an aggregated invitation for discussions of all visibilities on set roles', (callback) => {
        _testInvitationEmailVisibilityForSetRoles('discussion', callback);
      });

      /**
       * Test that verifies it sends an aggregated invitation for discussions of all visibilities on share
       */
      it('verify it sends an aggregated invitation for discussions of all visibilities on share', (callback) => {
        _testInvitationEmailVisibilityForShare('discussion', callback);
      });

      /**
       * Test that verifies the HTML of discussion invitation emails
       */
      it('verify discussion invitation email html', (callback) => {
        const assertions = {
          oneResourceSummaryMatch: ' has invited you to the discussion ',
          twoResourceSummaryMatch: ' has invited you to the discussions ',
          threeResourceSummaryMatch: ' has invited you to the discussion '
        };

        return _testInvitationEmailHtmlTargets('discussion', assertions, callback);
      });

      /**
       * Test that verifies the HTML of discussion invitation accept emails
       */
      it('verify email aggregation and summary for accepting an invitation to discussion', (callback) => {
        const assertions = {
          oneResourceSummaryMatch: [' has accepted your invitation to the discussion &quot;'],
          twoResourceSummaryMatch: [' has accepted your invitation to the discussions &quot;'],
          threeResourceSummaryMatch: [' has accepted your invitation to the discussion &quot;']
        };

        _testInvitationAcceptEmailSummary('discussion', assertions, callback);
      });
    });

    describe('Folder', () => {
      /**
       * Test that verifies it sends an aggregated invitation for folders of all visibilities on create
       */
      it('verify it sends an aggregated invitation for folders of all visibilities on create', (callback) => {
        _testInvitationEmailVisibilityForCreate('folder', callback);
      });

      /**
       * Test that verifies it sends an aggregated invitation for folders of all visibilities on set roles
       */
      it('verify it sends an aggregated invitation for folders of all visibilities on set roles', (callback) => {
        _testInvitationEmailVisibilityForSetRoles('folder', callback);
      });

      /**
       * Test that verifies it sends an aggregated invitation for folders of all visibilities on share
       */
      it('verify it sends an aggregated invitation for folders of all visibilities on share', (callback) => {
        _testInvitationEmailVisibilityForShare('folder', callback);
      });

      /**
       * Test that verifies the HTML of folder invitation emails
       */
      it('verify folder invitation email html', (callback) => {
        const assertions = {
          oneResourceSummaryMatch: 'has invited you to the folder ',
          twoResourceSummaryMatch: 'has invited you to the folders ',
          threeResourceSummaryMatch: 'has invited you to the folder '
        };

        return _testInvitationEmailHtmlTargets('folder', assertions, callback);
      });

      /**
       * Test that verifies the HTML of folder invitation accept emails
       */
      it('verify email aggregation and summary for accepting an invitation to folder', (callback) => {
        const assertions = {
          oneResourceSummaryMatch: [' has accepted your invitation to the folder &quot;'],
          twoResourceSummaryMatch: [' has accepted your invitation to the folders &quot;'],
          threeResourceSummaryMatch: [' has accepted your invitation to the folder &quot;']
        };

        _testInvitationAcceptEmailSummary('folder', assertions, callback);
      });
    });

    describe('Group', () => {
      /**
       * Test that verifies it sends an aggregated invitation for groups of all visibilities on create
       */
      it('verify it sends an aggregated invitation for groups of all visibilities on create', (callback) => {
        _testInvitationEmailVisibilityForCreate('group', callback);
      });

      /**
       * Test that verifies it sends an aggregated invitation for groups of all visibilities on set roles
       */
      it('verify it sends an aggregated invitation for groups of all visibilities on set roles', (callback) => {
        _testInvitationEmailVisibilityForSetRoles('group', callback);
      });

      /**
       * Test that verifies the HTML of group invitation emails
       */
      it('verify group invitation email html', (callback) => {
        const assertions = {
          oneResourceSummaryMatch: 'has invited you to the group ',
          twoResourceSummaryMatch: 'has invited you to the groups ',
          threeResourceSummaryMatch: 'has invited you to the group '
        };

        return _testInvitationEmailHtmlTargets('group', assertions, callback);
      });

      /**
       * Test that verifies the HTML of group invitation accept emails
       */
      it('verify email aggregation and summary for accepting an invitation to group', (callback) => {
        const assertions = {
          oneResourceSummaryMatch: [' has accepted your invitation to the group &quot;'],
          twoResourceSummaryMatch: [' has accepted your invitation to the groups &quot;'],
          threeResourceSummaryMatch: [' has accepted your invitation to the group &quot;']
        };

        _testInvitationAcceptEmailSummary('group', assertions, callback);
      });
    });
  });

  describe('Activity', () => {
    /**
     * Test that verifies activity for all resource types and visibilities when an invitation is accepted
     */
    it('verify a separate activity is sent for each resource type when an invitation is accepted', (callback) => {
      _testActivityVisibilityForAccept('public', () => {
        _testActivityVisibilityForAccept('loggedin', () => {
          return _testActivityVisibilityForAccept('private', callback);
        });
      });
    });

    describe('Content', () => {
      it('verify the adapted activity summaries for content accept invitation activity', (callback) => {
        const assertions = {
          matches: [' the link &quot;', ' to &quot;', ' to &quot;']
        };
        _testInvitationAcceptAdaptedActivities('content', assertions, callback);
      });
    });

    describe('Discussion', () => {
      it('verify the adapted activity summaries for discussion accept invitation activity', (callback) => {
        const assertions = {
          matches: [' the discussion &quot;', ' the discussions &quot;', ' the discussion &quot;']
        };
        _testInvitationAcceptAdaptedActivities('discussion', assertions, callback);
      });
    });

    describe('Folder', () => {
      it('verify the adapted activity summaries for folder accept invitation activity', (callback) => {
        const assertions = {
          matches: [' the folder &quot;', ' the folders &quot;', ' the folder &quot;']
        };
        _testInvitationAcceptAdaptedActivities('folder', assertions, callback);
      });
    });

    describe('Group', () => {
      it('verify the adapted activity summaries for group accept invitation activity', (callback) => {
        const assertions = {
          resourceActivity: true,
          matches: [' the group &quot;', ' the groups &quot;', ' the group &quot;']
        };
        _testInvitationAcceptAdaptedActivities('group', assertions, callback);
      });
    });
  });

  describe('Delete', () => {
    describe('Content', () => {
      /**
       * Test that verifies content that gets deleted simply gets removed from invitations
       */
      it('verify content that gets deleted simply gets removed from invitations', (callback) => {
        _testHardDeleteForAccept('content', () => {
          return callback();
        });
      });
    });

    describe('Discussion', () => {
      /**
       * Test that verifies discussion that gets deleted simply gets removed from invitations
       */
      it('verify discussion that gets deleted simply gets removed from invitations', (callback) => {
        _testHardDeleteForAccept('discussion', () => {
          return callback();
        });
      });
    });

    describe('Folder', () => {
      /**
       * Test that verifies folder that gets deleted simply gets removed from invitations
       */
      it('verify folder that gets deleted simply gets removed from invitations', (callback) => {
        _testHardDeleteForAccept('folder', () => {
          return callback();
        });
      });
    });

    describe('Group', () => {
      /**
       * Test that verifies deleted group does not get added with invitation, but restoring adds it
       */
      it('verify deleted group does not get added with invitation, but restoring adds it', (callback) => {
        _testSoftDeleteForAccept('group', callback);
      });
    });
  });

  const _testInvitationAcceptAdaptedActivities = function (resourceType, assertions, callback) {
    const fns = resourceFns[resourceType];
    TestsUtil.generateTestUsers(camAdminRestContext, 3, (error, users) => {
      assert.notExists(error);
      const { 0: inviterUserInfo, 1: invitedUserInfo, 2: otherUserInfo } = users;
      const email = _emailForTenant(global.oaeTests.tenants.cam);

      const resources = [];

      // Share 1 of this resource and accept the invitation, while asserting the "accept invitation" activity summary
      fns.createSucceeds(inviterUserInfo.restContext, 'private', [email], [], (resource1) => {
        resources.push(resource1);

        let emailAssertions = { role: 'manager', membersSize: 2, librarySize: 1 };
        _assertAcceptEmailInvitation(
          inviterUserInfo,
          invitedUserInfo,
          [resource1],
          emailAssertions,
          () => {
            _assertAdaptedActivities(
              inviterUserInfo,
              invitedUserInfo,
              otherUserInfo,
              resources,
              assertions,
              () => {
                // Share a 2nd of this resource and accept the invitation, while asserting the "accept invitation" for the 2 items in the aggregated feed
                fns.createSucceeds(
                  inviterUserInfo.restContext,
                  'private',
                  [email],
                  [],
                  (resource2) => {
                    resources.push(resource2);

                    emailAssertions = { role: 'manager', membersSize: 2, librarySize: 2 };
                    _assertAcceptEmailInvitation(
                      inviterUserInfo,
                      invitedUserInfo,
                      [resource2],
                      emailAssertions,
                      () => {
                        _assertAdaptedActivities(
                          inviterUserInfo,
                          invitedUserInfo,
                          otherUserInfo,
                          resources,
                          assertions,
                          () => {
                            // Share a 3rd of this resource and accept the invitation, while asserting the "accept invitation" for the 3 items in the aggregated feed
                            fns.createSucceeds(
                              inviterUserInfo.restContext,
                              'private',
                              [email],
                              [],
                              (resource3) => {
                                resources.push(resource3);

                                emailAssertions = {
                                  role: 'manager',
                                  membersSize: 2,
                                  librarySize: 3
                                };
                                _assertAcceptEmailInvitation(
                                  inviterUserInfo,
                                  invitedUserInfo,
                                  [resource3],
                                  emailAssertions,
                                  () => {
                                    _assertAdaptedActivities(
                                      inviterUserInfo,
                                      invitedUserInfo,
                                      otherUserInfo,
                                      resources,
                                      assertions,
                                      () => {
                                        // If we don't want to check that the resource received activities, then we're done
                                        if (!assertions.resourceActivity) {
                                          return callback();
                                        }

                                        // Ensure the resource received an activity as well
                                        ActivityTestUtil.collectAndGetActivityStream(
                                          inviterUserInfo.restContext,
                                          resource1.id,
                                          null,
                                          (error, result) => {
                                            assert.notExists(error);
                                            assert.ok(result);
                                            assert.ok(_.isArray(result.items));

                                            // Has a create activity and an invitation accept activity
                                            assert.strictEqual(result.items.length, 2);

                                            const activity = result.items[0];
                                            assert.strictEqual(
                                              activity.actor['oae:id'],
                                              invitedUserInfo.user.id
                                            );
                                            assert.strictEqual(
                                              activity.object['oae:id'],
                                              inviterUserInfo.user.id
                                            );
                                            assert.strictEqual(
                                              activity.target['oae:id'],
                                              resource1.id
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
  };

  const _testInvitationAcceptEmailSummary = function (resourceType, assertions, callback) {
    const fns = resourceFns[resourceType];
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
      assert.notExists(error);
      const { 0: sharingUserInfo, 1: acceptingUserInfo } = users;
      const email = _emailForTenant(global.oaeTests.tenants.cam);

      /**
       * Share 1 of this resource and accept the invitation, while getting the
       * "accept invitation" activity email sent to the sharer
       */
      fns.createSucceeds(sharingUserInfo.restContext, 'private', [email], [], (resourceA) => {
        let emailAssertions = { role: 'manager', membersSize: 2, librarySize: 1 };
        _assertAcceptEmailInvitation(
          sharingUserInfo,
          acceptingUserInfo,
          [resourceA],
          emailAssertions,
          (message) => {
            const activities = ActivityTestUtil.parseActivityHtml(message.html);
            assert.strictEqual(activities.length, 1);

            _assertAcceptInvitationContainsResourceHtml(activities[0].summary.html, resourceA);
            _.each(assertions.oneResourceSummaryMatch, (oneResourceSummaryMatch) => {
              _assertContains(activities[0].summary.html, oneResourceSummaryMatch);
            });

            /**
             * Share 2 of this resource and accept the invitation, while getting the
             * "accept invitation" activity email sent to the sharer
             */
            fns.createSucceeds(
              sharingUserInfo.restContext,
              'private',
              [email],
              [],
              (resourceB1) => {
                fns.createSucceeds(
                  sharingUserInfo.restContext,
                  'private',
                  [email],
                  [],
                  (resourceB2) => {
                    emailAssertions = { role: 'manager', membersSize: 2, librarySize: 3 };
                    _assertAcceptEmailInvitation(
                      sharingUserInfo,
                      acceptingUserInfo,
                      [resourceB1, resourceB2],
                      emailAssertions,
                      (message) => {
                        const activities = ActivityTestUtil.parseActivityHtml(message.html);
                        assert.strictEqual(activities.length, 1);

                        _assertAcceptInvitationContainsResourceHtml(
                          activities[0].summary.html,
                          resourceB1
                        );
                        _assertAcceptInvitationContainsResourceHtml(
                          activities[0].summary.html,
                          resourceB2
                        );
                        _.each(assertions.twoResourceSummaryMatch, (twoResourceSummaryMatch) => {
                          _assertContains(activities[0].summary.html, twoResourceSummaryMatch);
                        });

                        // Share 3 of this resource and accept the invitation, while getting the
                        // "accept invitation" activity email sent to the sharer
                        fns.createSucceeds(
                          sharingUserInfo.restContext,
                          'private',
                          [email],
                          [],
                          (resourceC1) => {
                            fns.createSucceeds(
                              sharingUserInfo.restContext,
                              'private',
                              [email],
                              [],
                              (resourceC2) => {
                                fns.createSucceeds(
                                  sharingUserInfo.restContext,
                                  'private',
                                  [email],
                                  [],
                                  (resourceC3) => {
                                    const resourceCs = [resourceC1, resourceC2, resourceC3];
                                    emailAssertions = {
                                      role: 'manager',
                                      membersSize: 2,
                                      librarySize: 6
                                    };
                                    _assertAcceptEmailInvitation(
                                      sharingUserInfo,
                                      acceptingUserInfo,
                                      resourceCs,
                                      emailAssertions,
                                      (message) => {
                                        const activities = ActivityTestUtil.parseActivityHtml(
                                          message.html
                                        );
                                        assert.lengthOf(activities, 1);

                                        // Ensure the summary has at exactly one of the resources
                                        const numberMatchesDisplayName = _.chain(resourceCs)
                                          .pluck('displayName')
                                          .filter((displayName) => {
                                            return activities[0].summary.html.includes(displayName);
                                          })
                                          .size()
                                          .value();
                                        const numberMatchesProfilePath = _.chain(resourceCs)
                                          .pluck('profilePath')
                                          .filter((profilePath) => {
                                            return activities[0].summary.html.includes(profilePath);
                                          })
                                          .size()
                                          .value();

                                        assert.strictEqual(numberMatchesDisplayName, 1);
                                        assert.strictEqual(numberMatchesProfilePath, 1);

                                        _.each(
                                          assertions.threeResourceSummaryMatch,
                                          (threeResourceSummaryMatch) => {
                                            _assertContains(
                                              activities[0].summary.html,
                                              threeResourceSummaryMatch
                                            );
                                          }
                                        );
                                        _assertContains(activities[0].summary.html, 'and 2 others');

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
      });
    });
  };

  const _testInvitationEmailHtmlTargets = function (resourceType, assertions, callback) {
    const fns = resourceFns[resourceType];
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
      assert.notExists(error);
      const { 0: sharingUser } = users;
      const email = _emailForTenant(global.oaeTests.tenants.cam);

      // Single resource summary
      fns.createSucceeds(sharingUser.restContext, 'public', [email], [], (resourceA) => {
        assert.notExists(error);
        EmailTestUtil.collectAndFetchAllEmails((messages) => {
          assert.strictEqual(messages.length, 1);

          const activities = ActivityTestUtil.parseActivityHtml(messages[0].html);
          assert.strictEqual(activities.length, 1);

          _assertInvitationContainsResourceHtml(activities[0].summary.html, resourceA);
          _assertContains(activities[0].summary.html, assertions.oneResourceSummaryMatch);

          // 2 content items summary
          fns.createSucceeds(sharingUser.restContext, 'public', [email], [], (resourceB1) => {
            fns.createSucceeds(sharingUser.restContext, 'public', [email], [], (resourceB2) => {
              EmailTestUtil.collectAndFetchAllEmails((messages) => {
                assert.strictEqual(messages.length, 1);

                const activities = ActivityTestUtil.parseActivityHtml(messages[0].html);
                assert.strictEqual(activities.length, 1);

                _assertInvitationContainsResourceHtml(activities[0].summary.html, resourceB1);
                _assertInvitationContainsResourceHtml(activities[0].summary.html, resourceB2);
                _assertContains(activities[0].summary.html, assertions.twoResourceSummaryMatch);

                // 3 content items summary
                fns.createSucceeds(sharingUser.restContext, 'public', [email], [], (resourceC1) => {
                  fns.createSucceeds(
                    sharingUser.restContext,
                    'public',
                    [email],
                    [],
                    (resourceC2) => {
                      fns.createSucceeds(
                        sharingUser.restContext,
                        'public',
                        [email],
                        [],
                        (resourceC3) => {
                          EmailTestUtil.collectAndFetchAllEmails((messages) => {
                            assert.strictEqual(messages.length, 1);

                            const activities = ActivityTestUtil.parseActivityHtml(messages[0].html);
                            assert.strictEqual(activities.length, 1);

                            // Ensure the summary has at exactly one of the resources
                            const numberMatchesDisplayName = _.chain([
                              resourceC1,
                              resourceC2,
                              resourceC3
                            ])
                              .pluck('displayName')
                              .filter((displayName) => {
                                return activities[0].summary.html.includes(displayName);
                              })
                              .size()
                              .value();
                            const numberMatchesProfilePath = _.chain([
                              resourceC1,
                              resourceC2,
                              resourceC3
                            ])
                              .pluck('profilePath')
                              .filter((profilePath) => {
                                return activities[0].summary.html.includes(profilePath);
                              })
                              .size()
                              .value();

                            assert.strictEqual(numberMatchesDisplayName, 1);
                            assert.strictEqual(numberMatchesProfilePath, 0);
                            _assertContains(
                              activities[0].summary.html,
                              assertions.threeResourceSummaryMatch
                            );
                            _assertContains(activities[0].summary.html, 'and 2 others');

                            return callback();
                          });
                        }
                      );
                    }
                  );
                });
              });
            });
          });
        });
      });
    });
  };

  const _testInvitationEmailSubject = function (resourceType, resourceType2, callback) {
    const fns = resourceFns[resourceType];
    const fns2 = resourceFns[resourceType2];
    TestsUtil.generateTestUsers(camAdminRestContext, 5, (error, users) => {
      assert.notExists(error);
      const { 1: sharingUser1, 2: sharingUser2, 3: sharingUser3 } = users;

      // Verify that with 1 activity, the subject is what we would expect from the activity summary
      const email = _emailForTenant(global.oaeTests.tenants.cam);
      fns.createSucceeds(sharingUser1.restContext, 'public', [email], [], (resourceA1) => {
        fns.createSucceeds(sharingUser1.restContext, 'public', [email], [], (resourceA2) => {
          EmailTestUtil.collectAndFetchAllEmails((messages) => {
            assert.strictEqual(messages.length, 1);

            const { subject } = messages[0];
            assert.notStrictEqual(subject.indexOf(sharingUser1.user.displayName), -1);
            assert.notStrictEqual(subject.indexOf(resourceA1.displayName), -1);
            assert.notStrictEqual(subject.indexOf(resourceA2.displayName), -1);

            /**
             * Verify that with 2 activities and 1 actor, the subject is a little more generic,
             * but includes the name of the actor
             */
            fns.createSucceeds(
              sharingUser1.restContext,
              'public',
              [email],
              [],
              (/* resourceA1 */) => {
                fns2.createSucceeds(
                  sharingUser1.restContext,
                  'public',
                  [],
                  [email],
                  (/* resourceA2 */) => {
                    EmailTestUtil.collectAndFetchAllEmails((messages) => {
                      assert.lengthOf(messages, 1);

                      const { subject } = messages[0];
                      assert.strictEqual(
                        subject,
                        format('%s has invited you to collaborate', sharingUser1.user.displayName)
                      );

                      // Verify that with 2 activities and 2 actors, the subject includes the name of both
                      fns.createSucceeds(
                        sharingUser1.restContext,
                        'public',
                        [email],
                        [],
                        (/* resourceB1 */) => {
                          fns.createSucceeds(
                            sharingUser2.restContext,
                            'public',
                            [],
                            [email],
                            (/* resourceB2 */) => {
                              EmailTestUtil.collectAndFetchAllEmails((messages) => {
                                assert.strictEqual(messages.length, 1);

                                const { subject } = messages[0];
                                assert.notStrictEqual(
                                  subject.indexOf(sharingUser1.user.displayName),
                                  -1
                                );
                                assert.notStrictEqual(
                                  subject.indexOf(sharingUser2.user.displayName),
                                  -1
                                );

                                // Verify that with 3 activities and 3 actors, the
                                // subject shows 1 of the actors and indicates there
                                // are 2 others
                                fns.createSucceeds(
                                  sharingUser1.restContext,
                                  'public',
                                  [email],
                                  [],
                                  (/* resourceB1 */) => {
                                    fns.createSucceeds(
                                      sharingUser2.restContext,
                                      'public',
                                      [],
                                      [email],
                                      (/* resourceB2 */) => {
                                        fns.createSucceeds(
                                          sharingUser3.restContext,
                                          'public',
                                          [],
                                          [email],
                                          (/* resourceB2 */) => {
                                            EmailTestUtil.collectAndFetchAllEmails((messages) => {
                                              assert.lengthOf(messages, 1);

                                              const { subject } = messages[0];

                                              const numberMatches = _.chain([
                                                sharingUser1,
                                                sharingUser2,
                                                sharingUser3
                                              ])
                                                .pluck('user')
                                                .pluck('displayName')
                                                .filter((displayName) => {
                                                  return subject.includes(displayName);
                                                })
                                                .size()
                                                .value();
                                              assert.strictEqual(numberMatches, 1);
                                              assert.notStrictEqual(
                                                subject.indexOf('and 2 others'),
                                                -1
                                              );
                                              return callback();
                                            });
                                          }
                                        );
                                      }
                                    );
                                  }
                                );
                              });
                            }
                          );
                        }
                      );
                    });
                  }
                );
              }
            );
          });
        });
      });
    });
  };

  /*!
   * Ensure that when a resource is soft deleted (i.e., it's delete functionality is that of a
   * "mark" as deleted which can be restored), an invitation that is accepted for it doesn't
   * result in the resource being added to the user's library.
   *
   * Furthermore, ensure that when the resource is restored, the user who accepted the resource
   * then gets it in their resource library.
   *
   * @param  {String}         resourceType    The resource type for which to execute the test
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testSoftDeleteForAccept = function (resourceType, callback) {
    const fns = resourceFns[resourceType];
    _testHardDeleteForAccept(resourceType, (creatingUserInfo, acceptingUserInfo, resource) => {
      fns.restoreSucceeds(camAdminRestContext, camAdminRestContext, resource.id, () => {
        // Ensure that when the item is restored, the user becomes a member
        const assertions = { role: 'manager', membersSize: 2, librarySize: 1 };
        _assertRole(creatingUserInfo, acceptingUserInfo, resource, assertions, () => {
          return callback();
        });
      });
    });
  };

  /*!
   * Ensure that when a resource is hard deleted (i.e., it is deleted from the database and
   * cannot be restored), an invitation that is accepted for it doesn't result in the resource
   * being added to the user's library
   *
   * @param  {String}         resourceType    The resource type for which to execute the test
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testHardDeleteForAccept = function (resourceType, callback) {
    const fns = resourceFns[resourceType];

    // Create a resource with an email invited into it
    let email = _emailForTenant(global.oaeTests.tenants.cam);
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
      assert.notExists(error);
      const { 0: creatingUserInfo, 1: acceptingUserInfo } = users;

      // Create the resource, sending an invite to the target user
      fns.createSucceeds(creatingUserInfo.restContext, 'public', [email], [], (resource) => {
        email = email.toLowerCase();

        EmailTestUtil.collectAndFetchAllEmails((messages) => {
          assert.lengthOf(messages, 1);

          const message = _.first(messages);

          const token = new URL(
            AuthzTestUtil.parseInvitationUrlFromMessage(message).searchParams.get('url'),
            'http://localhost'
          ).searchParams.get('invitationToken');

          // Delete the resource before we have a chance to accept
          fns.deleteSucceeds(camAdminRestContext, creatingUserInfo.restContext, resource.id, () => {
            // Now accept the invitation, ensuring no resources are reported as being
            // added
            AuthzTestUtil.assertAcceptInvitationSucceeds(
              acceptingUserInfo.restContext,
              token,
              (result) => {
                assert.strictEqual(result.email, email);
                assert.lengthOf(result.resources, 0);

                // Ensure nothing went into the user's library
                fns.getLibrarySucceeds(
                  acceptingUserInfo.restContext,
                  acceptingUserInfo.user.id,
                  (libraryItems) => {
                    assert.lengthOf(libraryItems, 0);
                    return callback(creatingUserInfo, acceptingUserInfo, resource);
                  }
                );
              }
            );
          });
        });
      });
    });
  };

  /*!
   * Ensure that the appropriate activity is sent to a user when they accept an invitation for
   * any resource type. The resources that are created will be of the specified visibility, to
   * make it simple to create multiple variations of this test for different resource
   * visibilities
   *
   * @param  {String}         visibility      The visibility to use on the created resources
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testActivityVisibilityForAccept = function (visibility, callback) {
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
      assert.notExists(error);
      const { 0: creatingUserInfo, 1: acceptingUserInfo } = users;

      const email = _emailForTenant(global.oaeTests.tenants.cam);
      _createOneOfEachResourceType(creatingUserInfo, visibility, [email], [], (resources) => {
        const assertions = { role: 'manager', membersSize: 2, librarySize: 1 };
        _assertAcceptEmailInvitation(
          creatingUserInfo,
          acceptingUserInfo,
          resources,
          assertions,
          () => {
            ActivityTestUtil.collectAndGetActivityStream(
              acceptingUserInfo.restContext,
              acceptingUserInfo.user.id,
              null,
              (error, result) => {
                assert.notExists(error);

                const activities = result.items;

                // Ensure we have one accept activity for each resource
                assert.strictEqual(activities.length, _.size(resourceAcceptActivityInfo));
                _.each(resources, (resource) => {
                  // eslint-disable-next-line no-unused-expressions
                  resourceAcceptActivityInfo[resource.resourceType];
                  const matchingActivities = _.filter(activities, (activity) => {
                    return (
                      activity['oae:activityType'] === 'invitation-accept' &&
                      activity.verb === 'accept' &&
                      activity.actor['oae:id'] === acceptingUserInfo.user.id &&
                      activity.object['oae:id'] === creatingUserInfo.user.id &&
                      activity.target['oae:id'] === resource.id
                    );
                  });

                  assert.ok(matchingActivities);
                  assert.strictEqual(matchingActivities.length, 1);
                });

                return callback();
              }
            );
          }
        );
      });
    });
  };

  /*!
   * Ensure that an email is sent for the specified resource type regardless of its visibility
   * when invited VIA a "create" action. This test will ensure that resources of the specified
   * type will send an invitation email to the email that was invited, and that the information in
   * the "accept" link can be used to accept the invitation and gain access to the resources
   *
   * @param  {String}         resourceType    The resource type for which to execute the test
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testInvitationEmailVisibilityForCreate = function (resourceType, callback) {
    const fns = resourceFns[resourceType];
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
      assert.notExists(error);
      const { 0: creatingUser, 1: acceptingUser } = users;

      const email = _emailForTenant(global.oaeTests.tenants.cam);
      fns.createSucceeds(creatingUser.restContext, 'public', [email], [], (resource1) => {
        fns.createSucceeds(creatingUser.restContext, 'loggedin', [email], [], (resource2) => {
          fns.createSucceeds(creatingUser.restContext, 'private', [email], [], (resource3) => {
            const assertions = { role: 'manager', membersSize: 2, librarySize: 3 };
            _assertAcceptEmailInvitation(
              creatingUser,
              acceptingUser,
              [resource1, resource2, resource3],
              assertions,
              () => {
                return callback();
              }
            );
          });
        });
      });
    });
  };

  /*!
   * Ensure that an email is sent for the specified resource type regardless of its visibility
   * when invited VIA a "set roles" action. This test will ensure that resources of the specified
   * type will send an invitation email to the email that was invited, and that the information in
   * the "accept" link can be used to accept the invitation and gain access to the resources
   *
   * @param  {String}         resourceType    The resource type for which to execute the test
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testInvitationEmailVisibilityForSetRoles = function (resourceType, callback) {
    const fns = resourceFns[resourceType];
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
      assert.notExists(error);
      const { 0: creatingUser, 1: acceptingUser } = users;

      const email = _emailForTenant(global.oaeTests.tenants.cam);

      // Create a resource of each visibility
      fns.createSucceeds(creatingUser.restContext, 'public', [], [], (resource1) => {
        fns.createSucceeds(creatingUser.restContext, 'loggedin', [], [], (resource2) => {
          fns.createSucceeds(creatingUser.restContext, 'private', [], [], (resource3) => {
            const roleChange = _.object([[email, 'manager']]);

            // Set the accepting user as a manager on all 3 using set roles
            fns.setRolesSucceeds(
              creatingUser.restContext,
              creatingUser.restContext,
              resource1.id,
              roleChange,
              () => {
                fns.setRolesSucceeds(
                  creatingUser.restContext,
                  creatingUser.restContext,
                  resource2.id,
                  roleChange,
                  () => {
                    fns.setRolesSucceeds(
                      creatingUser.restContext,
                      creatingUser.restContext,
                      resource3.id,
                      roleChange,
                      () => {
                        // Ensure the user can accept the email invitation
                        const assertions = { role: 'manager', membersSize: 2, librarySize: 3 };
                        _assertAcceptEmailInvitation(
                          creatingUser,
                          acceptingUser,
                          [resource1, resource2, resource3],
                          assertions,
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
          });
        });
      });
    });
  };

  /*!
   * Ensure that an email is sent for the specified resource type regardless of its visibility
   * when invited VIA a "share" action. This test will ensure that resources of the specified
   * type will send an invitation email to the email that was invited, and that the information in
   * the "accept" link can be used to accept the invitation and gain access to the resources
   *
   * @param  {String}         resourceType    The resource type for which to execute the test
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testInvitationEmailVisibilityForShare = function (resourceType, callback) {
    const fns = resourceFns[resourceType];
    const memberRole = resourceMemberRoles[resourceType];

    TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
      assert.notExists(error);
      const { 0: creatingUser, 1: acceptingUser } = users;

      const email = _emailForTenant(global.oaeTests.tenants.cam);

      // Create a resource of each visibility
      fns.createSucceeds(creatingUser.restContext, 'public', [], [], (resource1) => {
        fns.createSucceeds(creatingUser.restContext, 'loggedin', [], [], (resource2) => {
          fns.createSucceeds(creatingUser.restContext, 'private', [], [], (resource3) => {
            // Share with each resource
            fns.shareSucceeds(
              creatingUser.restContext,
              creatingUser.restContext,
              resource1.id,
              [email],
              () => {
                fns.shareSucceeds(
                  creatingUser.restContext,
                  creatingUser.restContext,
                  resource2.id,
                  [email],
                  () => {
                    fns.shareSucceeds(
                      creatingUser.restContext,
                      creatingUser.restContext,
                      resource3.id,
                      [email],
                      () => {
                        // Ensure the user can accept the email invitation
                        const assertions = { role: memberRole, membersSize: 2, librarySize: 3 };
                        _assertAcceptEmailInvitation(
                          creatingUser,
                          acceptingUser,
                          [resource1, resource2, resource3],
                          assertions,
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
          });
        });
      });
    });
  };

  /*!
   * Ensure that when an invitation is accepted, the response and side-effects (i.e., gaining
   * access to the invited resources) work as expected
   *
   * @param  {String}         resourceType    The resource type for which to execute the test
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testInvitationAccept = function (resourceType, callback) {
    const fns = resourceFns[resourceType];
    const memberRole = resourceMemberRoles[resourceType];

    TestsUtil.generateTestUsers(camAdminRestContext, 3, (error, users) => {
      assert.notExists(error);
      const { 0: user0, 1: userManager, 2: userViewer } = users;

      const managerEmail = _emailForTenant(global.oaeTests.tenants.cam);
      const viewerEmail = _emailForTenant(global.oaeTests.tenants.cam);

      // Create a resource. 2 separate invitations will go out
      fns.createSucceeds(user0.restContext, 'public', [managerEmail], [viewerEmail], (resource) => {
        const resourceAuthzId = AuthzUtil.getAuthzId(resource);

        // Accept the manager invitation and ensure they show up in the members
        AuthzTestUtil.assertAcceptInvitationForEmailSucceeds(
          userManager.restContext,
          managerEmail,
          (result, invitations) => {
            assert.strictEqual(invitations.length, 1);

            const invitation = _.first(invitations);
            assert.strictEqual(invitation.resourceId, resourceAuthzId);
            assert.strictEqual(invitation.email, managerEmail.toLowerCase());
            assert.strictEqual(invitation.inviterUserId, user0.user.id);
            assert.strictEqual(invitation.role, 'manager');

            let assertions = { role: 'manager', membersSize: 2, librarySize: 1 };
            _assertRole(user0, userManager, resource, assertions, () => {
              // Accept the viewer invitation and ensure they show up in the members
              AuthzTestUtil.assertAcceptInvitationForEmailSucceeds(
                userViewer.restContext,
                viewerEmail,
                (result, invitations) => {
                  assert.strictEqual(invitations.length, 1);

                  const invitation = _.first(invitations);
                  assert.strictEqual(invitation.resourceId, resourceAuthzId);
                  assert.strictEqual(invitation.email, viewerEmail.toLowerCase());
                  assert.strictEqual(invitation.inviterUserId, user0.user.id);
                  assert.strictEqual(invitation.role, memberRole);

                  assertions = { role: memberRole, membersSize: 3, librarySize: 1 };
                  _assertRole(user0, userViewer, resource, assertions, () => {
                    return callback();
                  });
                }
              );
            });
          }
        );
      });
    });
  };

  /*!
   * Ensure authorization of accepting an invitation that contains a particular resource type.
   *
   * This also includes authorization revolving around the changed state of the inviting user. For
   * example, if the user who invited another has since been deleted, or is demoted/removed from
   * the resource, the invitation should still be successful.
   *
   * @param  {String}         resourceType    The resource type for which to execute the test
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testInvitationAcceptAuthorization = function (resourceType, callback) {
    const fns = resourceFns[resourceType];
    const memberRole = resourceMemberRoles[resourceType];

    TestsUtil.generateTestUsers(camAdminRestContext, 6, (error, users) => {
      assert.notExists(error);
      const { 0: user0, 1: user1, 2: user2, 4: user4, 5: user5 } = users;

      const email1 = _emailForTenant(global.oaeTests.tenants.cam);
      const email2 = _emailForTenant(global.oaeTests.tenants.cam);
      const email3 = _emailForTenant(global.oaeTests.tenants.cam);
      const email4 = _emailForTenant(global.oaeTests.tenants.cam);
      const email5 = _emailForTenant(global.oaeTests.tenants.cam);

      fns.createSucceeds(user0.restContext, 'private', [email1], [], (resource) => {
        // Accept as user1
        AuthzTestUtil.assertAcceptInvitationForEmailSucceeds(user1.restContext, email1, () => {
          // Ensure user1 can now set roles since they should be manager
          let roles = {};
          roles[email2] = 'manager';
          roles[email3] = memberRole;
          roles[email4] = memberRole;
          roles[email5] = memberRole;
          fns.setRolesSucceeds(user0.restContext, user1.restContext, resource.id, roles, () => {
            // Remove the user who invited email2 and ensure email2 invitation can still be accepted
            roles = {};
            roles[user1.user.id] = false;
            fns.setRolesSucceeds(user0.restContext, user0.restContext, resource.id, roles, () => {
              // Ensure email2 can still be accepted and makes user2 a manager
              AuthzTestUtil.assertAcceptInvitationForEmailSucceeds(
                user2.restContext,
                email2,
                () => {
                  _assertRole(user0, user2, resource, { role: 'manager' }, () => {
                    // Accept the "member" role invitation for email3 as user2, ensuring their role
                    // on the resource does not get demoted to the "member" role
                    AuthzTestUtil.assertAcceptInvitationForEmailSucceeds(
                      user2.restContext,
                      email3,
                      () => {
                        _assertRole(user0, user2, resource, { role: 'manager' }, () => {
                          // Delete user1 from the system, and ensure the user they
                          // invited can still accept their invitation
                          PrincipalsTestUtil.assertDeleteUserSucceeds(
                            camAdminRestContext,
                            camAdminRestContext,
                            user1.user.id,
                            () => {
                              // Accept the invitation for email4 and ensure it succeeds despite the fact that
                              // the user that invited them was deleted
                              AuthzTestUtil.assertAcceptInvitationForEmailSucceeds(
                                user4.restContext,
                                email4,
                                () => {
                                  _assertRole(user0, user4, resource, { role: memberRole }, () => {
                                    // Remove the invitation for email5, ensuring an invitation for email5 can still
                                    // be accepted, but it doesn't grant any access to the resource
                                    roles = {};
                                    roles[email5] = false;
                                    fns.setRolesSucceeds(
                                      user0.restContext,
                                      user0.restContext,
                                      resource.id,
                                      roles,
                                      () => {
                                        AuthzTestUtil.assertAcceptInvitationForEmailSucceeds(
                                          user5.restContext,
                                          email5,
                                          () => {
                                            _assertRole(
                                              user0,
                                              user5,
                                              resource,
                                              { role: false },
                                              () => {
                                                return callback();
                                              }
                                            );
                                          }
                                        );
                                      }
                                    );
                                  });
                                }
                              );
                            }
                          );
                        });
                      }
                    );
                  });
                }
              );
            });
          });
        });
      });
    });
  };

  /*!
   * Ensure parameter validation for accepting an invitation
   *
   * @param  {String}         resourceType    The resource type for which to execute the test
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testInvitationAcceptValidation = function (resourceType, callback) {
    const fns = resourceFns[resourceType];
    TestsUtil.generateTestUsers(camAdminRestContext, 3, (error, users) => {
      assert.notExists(error);
      const { 0: user0, 1: acceptingUser, 2: sneakyUser } = users;

      let email = _emailForTenant(global.oaeTests.tenants.cam);

      // Token is required
      AuthzTestUtil.assertAcceptInvitationFails(sneakyUser.restContext, null, 400, () => {
        // Token must exist
        AuthzTestUtil.assertAcceptInvitationFails(
          sneakyUser.restContext,
          'nonexistingtoken',
          404,
          () => {
            // Create a resource with an invitation
            fns.createSucceeds(user0.restContext, 'public', [email], [], (resource) => {
              // Lower-case the email now so we can work with the data layer, where the
              // email should have been lower-cased
              email = email.toLowerCase();

              AuthzInvitationsDAO.getTokensByEmails([email], (error, tokensByEmail) => {
                assert.notExists(error);

                const token = tokensByEmail[email];

                // User must be logged in to accept
                AuthzTestUtil.assertAcceptInvitationFails(anonymousRestContext, token, 401, () => {
                  // Sanity check we can accept with this token as authenticated user
                  AuthzTestUtil.assertAcceptInvitationSucceeds(
                    acceptingUser.restContext,
                    token,
                    () => {
                      // Ensure re-accepting this token as a sneaky user that intercepted it fails
                      AuthzTestUtil.assertAcceptInvitationFails(
                        sneakyUser.restContext,
                        token,
                        404,
                        () => {
                          // Ensure the accepting user became a manager of the resource
                          _assertRole(user0, acceptingUser, resource, { role: 'manager' }, () => {
                            // Ensure the sneaky user does not have the resource
                            _assertRole(
                              user0,
                              sneakyUser,
                              resource,
                              { role: false, membersSize: 2 },
                              () => {
                                return callback();
                              }
                            );
                          });
                        }
                      );
                    }
                  );
                });
              });
            });
          }
        );
      });
    });
  };

  /*!
   * Ensure that the invitations list is persisted appropriately with the expected roles when
   * an invitation occurrs in the resource "create" request
   *
   * @param  {String}         resourceType    The resource type for which to execute the test
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testInvitationsForCreate = function (resourceType, callback) {
    const fns = resourceFns[resourceType];
    TestsUtil.generateTestUsers(camAdminRestContext, 3, (error, users) => {
      assert.notExists(error);
      const { 0: user0, 1: userManager, 2: userViewer } = users;

      // Ensure a simple create mixed with a couple member users succeeds
      fns.createSucceeds(
        user0.restContext,
        'public',
        ['manager@oae.local', userManager.user.id],
        [userViewer.user.id, 'viewer@oae.local'],
        (/* resource */) => {
          return callback();
        }
      );
    });
  };

  /*!
   * Ensure parameter validation of inviting "email-like" strings when an invitation is attempted
   * in the resource "create" request
   *
   * @param  {String}         resourceType    The resource type for which to execute the test
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testInvitationsValidationForCreate = function (resourceType, callback) {
    const fns = resourceFns[resourceType];
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
      assert.notExists(error);
      const { 0: user0 } = users;

      // Ensure variations of email addresses fail
      fns.createFails(user0.restContext, 'public', ['invalid@email'], [], 400, (/* resource */) => {
        // Sanity check can be created with valid email
        fns.createSucceeds(
          user0.restContext,
          'public',
          ['manager@oae.local'],
          [],
          (/* resource */) => {
            return callback();
          }
        );
      });
    });
  };

  /*!
   * Ensure authorization of inviting users from a variety of different types of tenants when
   * inviting through the resource "create" action
   *
   * @param  {String}         resourceType    The resource type for which to execute the test
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testInvitationsAuthorizationForCreate = function (resourceType, callback) {
    const fns = resourceFns[resourceType];
    TestsUtil.setupMultiTenantPrivacyEntities((publicTenant0, publicTenant1, privateTenant0) => {
      // Ensure cannot create content associated to an email from a private tenant
      fns.createFails(
        privateTenant0.publicUser.restContext,
        'public',
        [_emailForTenantInfo(publicTenant0)],
        [],
        401,
        (/* resource */) => {
          // Ensure cannot create content associated to a private tenant
          fns.createFails(
            publicTenant0.publicUser.restContext,
            'public',
            [_emailForTenantInfo(privateTenant0)],
            [],
            401,
            (/* resource */) => {
              // Sanity check we can create content on our own private tenant
              fns.createSucceeds(
                privateTenant0.publicUser.restContext,
                'public',
                [_emailForTenantInfo(privateTenant0)],
                [],
                (/* resource */) => {
                  // Ensure a user can create a loggedin item and share it with an email of a user from another tenant
                  fns.createSucceeds(
                    publicTenant0.publicUser.restContext,
                    'loggedin',
                    [_emailForTenantInfo(publicTenant1)],
                    [],
                    (/* resource */) => {
                      // Ensure a user can create content and invite guests that end up on the guest tenant
                      fns.createSucceeds(
                        publicTenant0.publicUser.restContext,
                        'public',
                        ['thisemail0@defaultstoguest.local'],
                        [],
                        () => {
                          _disableInvitingGuests(publicTenant0.tenant.alias, () => {
                            // Invitations that end up on the guest tenant are disallowed
                            fns.createFails(
                              publicTenant0.publicUser.restContext,
                              'public',
                              ['thisemail0@defaultstoguest.local'],
                              [],
                              401,
                              () => {
                                // Sanity other invitations are still unchanged
                                fns.createFails(
                                  privateTenant0.publicUser.restContext,
                                  'public',
                                  [_emailForTenantInfo(publicTenant0)],
                                  [],
                                  401,
                                  (/* resource */) => {
                                    fns.createFails(
                                      publicTenant0.publicUser.restContext,
                                      'public',
                                      [_emailForTenantInfo(privateTenant0)],
                                      [],
                                      401,
                                      (/* resource */) => {
                                        fns.createSucceeds(
                                          privateTenant0.publicUser.restContext,
                                          'public',
                                          [_emailForTenantInfo(privateTenant0)],
                                          [],
                                          (/* resource */) => {
                                            fns.createSucceeds(
                                              publicTenant0.publicUser.restContext,
                                              'loggedin',
                                              [_emailForTenantInfo(publicTenant1)],
                                              [],
                                              (/* resource */) => {
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
                          });
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
  };

  /*!
   * Ensure that the invitations list is persisted appropriately with the expected roles when
   * an invitation occurrs in the resource "share" request
   *
   * @param  {String}         resourceType    The resource type for which to execute the test
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testInvitationsForShare = function (resourceType, callback) {
    const fns = resourceFns[resourceType];
    TestsUtil.generateTestUsers(camAdminRestContext, 3, (error, users) => {
      assert.notExists(error);
      const { 0: userSharer, 1: user0, 2: user1 } = users;
      fns.createSucceeds(userSharer.restContext, 'public', ['email1@oae.local'], [], (resource) => {
        // Ensure a simple share works as expected. It should add the new email (email2) and
        // not demote the existing email (email1)
        fns.shareSucceeds(
          userSharer.restContext,
          userSharer.restContext,
          resource.id,
          [user0.user.id, 'email1@oae.local', 'email2@oae.local', user1.user.id],
          () => {
            return callback();
          }
        );
      });
    });
  };

  /*!
   * Ensure parameter validation of inviting "email-like" strings when an invitation is attempted
   * in the resource "share" request
   *
   * @param  {String}         resourceType    The resource type for which to execute the test
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testInvitationsValidationForShare = function (resourceType, callback) {
    const fns = resourceFns[resourceType];
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
      assert.notExists(error);
      const { 0: user0 } = users;
      fns.createSucceeds(user0.restContext, 'public', [], [], (resource) => {
        // Ensure cannot share with a variation of an email address
        fns.shareFails(
          user0.restContext,
          user0.restContext,
          resource.id,
          ['email1@oae'],
          400,
          () => {
            // Sanity check share succeeds
            fns.shareSucceeds(
              user0.restContext,
              user0.restContext,
              resource.id,
              ['email1@oae.local'],
              () => {
                return callback();
              }
            );
          }
        );
      });
    });
  };

  /*!
   * Ensure authorization of inviting users from a variety of different types of tenants and
   * resource visibilities when inviting through the resource "share" action
   *
   * @param  {String}         resourceType    The resource type for which to execute the test
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testInvitationsAuthorizationForShare = function (resourceType, callback) {
    const fns = resourceFns[resourceType];
    TestsUtil.setupMultiTenantPrivacyEntities((publicTenant0, publicTenant1, privateTenant0) => {
      _testInvitationsAuthorizationForPublicShare(
        fns,
        publicTenant0,
        publicTenant1,
        privateTenant0,
        () => {
          _testInvitationsAuthorizationForLoggedinShare(
            fns,
            publicTenant0,
            publicTenant1,
            privateTenant0,
            () => {
              _testInvitationsAuthorizationForPrivateShare(
                fns,
                publicTenant0,
                publicTenant1,
                privateTenant0,
                () => {
                  _testInvitationsAuthorizationForNoGuestsShare(
                    fns,
                    publicTenant0,
                    publicTenant1,
                    privateTenant0,
                    callback
                  );
                }
              );
            }
          );
        }
      );
    });
  };

  /*!
   * Ensure the authorization constraints of sharing a resource with emails from a variety
   * of different types of tenants are as expected
   *
   * @param  {Object}         fns             The functions specification for the resource type to test, as given in `resourceFns`
   * @param  {Object}         publicTenant0   The tenant info of a public tenant
   * @param  {Object}         publicTenant1   The tenant info of another public tenant
   * @param  {Object}         privateTenant0  The tenant info of a private tenant
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testInvitationsAuthorizationForPublicShare = function (
    fns,
    publicTenant0,
    publicTenant1,
    privateTenant0,
    callback
  ) {
    const managerUser = publicTenant0.publicUser;
    const viewerUser = publicTenant0.loggedinUser;
    // Create public resource with a viewer
    fns.createSucceeds(managerUser.restContext, 'public', [], [viewerUser.user.id], (resource) => {
      // Ensure manager user can invite users from all tenants except private
      fns.shareSucceeds(
        managerUser.restContext,
        managerUser.restContext,
        resource.id,
        [_emailForTenantInfo(publicTenant0)],
        () => {
          fns.shareSucceeds(
            managerUser.restContext,
            managerUser.restContext,
            resource.id,
            [_emailForTenantInfo(publicTenant1)],
            () => {
              fns.shareSucceeds(
                managerUser.restContext,
                managerUser.restContext,
                resource.id,
                ['thisemail0@defaultstoguest.local'],
                () => {
                  fns.shareFails(
                    managerUser.restContext,
                    managerUser.restContext,
                    resource.id,
                    [_emailForTenantInfo(privateTenant0)],
                    401,
                    () => {
                      // Ensure viewer user can invite users from all tenants except private
                      fns.shareSucceeds(
                        managerUser.restContext,
                        viewerUser.restContext,
                        resource.id,
                        [_emailForTenantInfo(publicTenant0)],
                        () => {
                          fns.shareSucceeds(
                            managerUser.restContext,
                            viewerUser.restContext,
                            resource.id,
                            [_emailForTenantInfo(publicTenant1)],
                            () => {
                              fns.shareSucceeds(
                                managerUser.restContext,
                                viewerUser.restContext,
                                resource.id,
                                ['thisemail1@defaultstoguest.local'],
                                () => {
                                  fns.shareFails(
                                    managerUser.restContext,
                                    viewerUser.restContext,
                                    resource.id,
                                    [_emailForTenantInfo(privateTenant0)],
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
    });
  };

  /*!
   * Ensure the authorization constraints of sharing a loggedin resource with emails from a variety
   * of different types of tenants are as expected
   *
   * @param  {Object}         fns             The functions specification for the resource type to test, as given in `resourceFns`
   * @param  {Object}         publicTenant0   The tenant info of a public tenant
   * @param  {Object}         publicTenant1   The tenant info of another public tenant
   * @param  {Object}         privateTenant0  The tenant info of a private tenant
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testInvitationsAuthorizationForLoggedinShare = function (
    fns,
    publicTenant0,
    publicTenant1,
    privateTenant0,
    callback
  ) {
    const managerUser = publicTenant0.publicUser;
    const viewerUser = publicTenant0.loggedinUser;
    // Create loggedin resource with a viewer
    fns.createSucceeds(
      managerUser.restContext,
      'loggedin',
      [],
      [viewerUser.user.id],
      (resource) => {
        // Ensure manager user can invite users from all tenants except private
        fns.shareSucceeds(
          managerUser.restContext,
          managerUser.restContext,
          resource.id,
          [_emailForTenantInfo(publicTenant0)],
          () => {
            fns.shareSucceeds(
              managerUser.restContext,
              managerUser.restContext,
              resource.id,
              [_emailForTenantInfo(publicTenant1)],
              () => {
                fns.shareSucceeds(
                  managerUser.restContext,
                  managerUser.restContext,
                  resource.id,
                  ['thisemail0@defaultstoguest.local'],
                  () => {
                    fns.shareFails(
                      managerUser.restContext,
                      managerUser.restContext,
                      resource.id,
                      [_emailForTenantInfo(privateTenant0)],
                      401,
                      () => {
                        // Ensure viewer user can invite users from only their own tenant
                        fns.shareSucceeds(
                          managerUser.restContext,
                          viewerUser.restContext,
                          resource.id,
                          [_emailForTenantInfo(publicTenant0)],
                          () => {
                            fns.shareFails(
                              managerUser.restContext,
                              viewerUser.restContext,
                              resource.id,
                              [_emailForTenantInfo(publicTenant1)],
                              401,
                              () => {
                                fns.shareFails(
                                  managerUser.restContext,
                                  viewerUser.restContext,
                                  resource.id,
                                  ['thisemail1@defaultstoguest.local'],
                                  401,
                                  () => {
                                    fns.shareFails(
                                      managerUser.restContext,
                                      viewerUser.restContext,
                                      resource.id,
                                      [_emailForTenantInfo(privateTenant0)],
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
  };

  /*!
   * Ensure the authorization constraints of sharing a private resource with emails from a variety
   * of different types of tenants are as expected
   *
   * @param  {Object}         fns             The functions specification for the resource type to test, as given in `resourceFns`
   * @param  {Object}         publicTenant0   The tenant info of a public tenant
   * @param  {Object}         publicTenant1   The tenant info of another public tenant
   * @param  {Object}         privateTenant0  The tenant info of a private tenant
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testInvitationsAuthorizationForPrivateShare = function (
    fns,
    publicTenant0,
    publicTenant1,
    privateTenant0,
    callback
  ) {
    const managerUser = publicTenant0.publicUser;
    const viewerUser = publicTenant0.loggedinUser;
    // Create private resource with a viewer
    fns.createSucceeds(managerUser.restContext, 'private', [], [viewerUser.user.id], (resource) => {
      // Ensure manager user can invite users from all tenants except private
      fns.shareSucceeds(
        managerUser.restContext,
        managerUser.restContext,
        resource.id,
        [_emailForTenantInfo(publicTenant0)],
        () => {
          fns.shareSucceeds(
            managerUser.restContext,
            managerUser.restContext,
            resource.id,
            [_emailForTenantInfo(publicTenant1)],
            () => {
              fns.shareSucceeds(
                managerUser.restContext,
                managerUser.restContext,
                resource.id,
                ['thisemail@defaultstoguest.local'],
                () => {
                  fns.shareFails(
                    managerUser.restContext,
                    managerUser.restContext,
                    resource.id,
                    [_emailForTenantInfo(privateTenant0)],
                    401,
                    () => {
                      // Ensure viewer user can't invite anyone into a private item
                      fns.shareFails(
                        managerUser.restContext,
                        viewerUser.restContext,
                        resource.id,
                        [_emailForTenantInfo(publicTenant0)],
                        401,
                        () => {
                          fns.shareFails(
                            managerUser.restContext,
                            viewerUser.restContext,
                            resource.id,
                            [_emailForTenantInfo(publicTenant1)],
                            401,
                            () => {
                              fns.shareFails(
                                managerUser.restContext,
                                viewerUser.restContext,
                                resource.id,
                                ['thisemail@defaultstoguest.local'],
                                401,
                                () => {
                                  fns.shareFails(
                                    managerUser.restContext,
                                    viewerUser.restContext,
                                    resource.id,
                                    [_emailForTenantInfo(privateTenant0)],
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
    });
  };

  /*!
   * Ensure the authorization constraints of sharing a resource with guests on
   * a tenant that has disabled inviting guests
   *
   * @param  {Object}         fns             The functions specification for the resource type to test, as given in `resourceFns`
   * @param  {Object}         publicTenant0   The tenant info of a public tenant
   * @param  {Object}         publicTenant1   The tenant info of another public tenant
   * @param  {Object}         privateTenant0  The tenant info of a private tenant
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testInvitationsAuthorizationForNoGuestsShare = function (
    fns,
    publicTenant0,
    publicTenant1,
    privateTenant0,
    callback
  ) {
    _disableInvitingGuests(publicTenant0.tenant.alias, () => {
      const managerUser = publicTenant0.publicUser;
      const viewerUser = publicTenant0.loggedinUser;
      // Create public resource with a viewer
      fns.createSucceeds(
        managerUser.restContext,
        'public',
        [],
        [viewerUser.user.id],
        (resource) => {
          // Ensure manager users cannot invite emails that end up on the guest tenant
          fns.shareSucceeds(
            managerUser.restContext,
            managerUser.restContext,
            resource.id,
            [_emailForTenantInfo(publicTenant0)],
            () => {
              fns.shareSucceeds(
                managerUser.restContext,
                managerUser.restContext,
                resource.id,
                [_emailForTenantInfo(publicTenant1)],
                () => {
                  fns.shareFails(
                    managerUser.restContext,
                    managerUser.restContext,
                    resource.id,
                    ['thisemail0@defaultstoguest.local'],
                    401,
                    () => {
                      fns.shareFails(
                        managerUser.restContext,
                        managerUser.restContext,
                        resource.id,
                        [_emailForTenantInfo(privateTenant0)],
                        401,
                        () => {
                          // Ensure viewer user cannot invite emails that end up on the guest tenant
                          fns.shareSucceeds(
                            managerUser.restContext,
                            viewerUser.restContext,
                            resource.id,
                            [_emailForTenantInfo(publicTenant0)],
                            () => {
                              fns.shareSucceeds(
                                managerUser.restContext,
                                viewerUser.restContext,
                                resource.id,
                                [_emailForTenantInfo(publicTenant1)],
                                () => {
                                  fns.shareFails(
                                    managerUser.restContext,
                                    viewerUser.restContext,
                                    resource.id,
                                    ['thisemail1@defaultstoguest.local'],
                                    401,
                                    () => {
                                      fns.shareFails(
                                        managerUser.restContext,
                                        viewerUser.restContext,
                                        resource.id,
                                        [_emailForTenantInfo(privateTenant0)],
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
    });
  };

  /*!
   * Ensure that the invitations list is persisted appropriately with the expected roles when
   * an invitation occurrs in the resource "set roles" request
   *
   * @param  {String}         resourceType    The resource type for which to execute the test
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testInvitationsForSetRoles = function (resourceType, callback) {
    const fns = resourceFns[resourceType];
    const memberRole = resourceMemberRoles[resourceType];

    TestsUtil.generateTestUsers(camAdminRestContext, 3, (error, users) => {
      assert.notExists(error);
      const { 0: userSetRoles, 1: user0, 2: user1 } = users;
      fns.createSucceeds(
        userSetRoles.restContext,
        'public',
        ['email1@oae.local'],
        [],
        (resource) => {
          // Ensure a simple set roles works as expected. email1 should be demoted to the
          // member role, and email2 should be added as a manager
          const roles = {};
          roles[user0.user.id] = 'manager';
          roles[user1.user.id] = memberRole;
          roles['email1@oae.local'] = memberRole;
          roles['email2@oae.local'] = 'manager';

          // Set the roles for both members and invitations
          fns.setRolesSucceeds(
            userSetRoles.restContext,
            userSetRoles.restContext,
            resource.id,
            roles,
            () => {
              // Now remove them all, ensuring the states are updated appropriately
              const rolesRemove = AuthzTestUtil.createRoleChange(_.keys(roles), false);
              fns.setRolesSucceeds(
                userSetRoles.restContext,
                userSetRoles.restContext,
                resource.id,
                rolesRemove,
                () => {
                  return callback();
                }
              );
            }
          );
        }
      );
    });
  };

  /*!
   * Ensure that when an email that has multiple resource invitations has one
   * resource removed, the other resources are still accepted when the
   * invitation is accepted
   *
   * @param  {String}         resourceType    The resource type for which to execute the test
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testInvitationsPartialRemoveRoles = function (resourceType, callback) {
    const fns = resourceFns[resourceType];
    const memberRole = resourceMemberRoles[resourceType];

    const email = TestsUtil.generateTestEmailAddress();

    TestsUtil.generateTestUsers(camAdminRestContext, 2, (error, users) => {
      assert.notExists(error);
      const { 0: userSetRoles, 1: userAccept } = users;

      // Create 2 resources with the email address invited
      fns.createSucceeds(userSetRoles.restContext, 'public', [], [email], (resource1) => {
        fns.createSucceeds(userSetRoles.restContext, 'public', [], [email], (resource2) => {
          // Remove the email from one of the resources
          const roles = _.oaeObj(email, false);
          fns.setRolesSucceeds(
            userSetRoles.restContext,
            userSetRoles.restContext,
            resource1.id,
            roles,
            () => {
              // Accept the email invitation as the invited email user, ensuring they get access
              // to just the one resource (resource2)
              const assertions = { role: memberRole, membersSize: 2, librarySize: 1 };
              _assertAcceptEmailInvitation(
                userSetRoles,
                userAccept,
                [resource2],
                assertions,
                () => {
                  return callback();
                }
              );
            }
          );
        });
      });
    });
  };

  /*!
   * Ensure parameter validation of inviting "email-like" strings when an invitation is attempted
   * in the resource "set roles" request
   *
   * @param  {String}         resourceType    The resource type for which to execute the test
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testInvitationsValidationForSetRoles = function (resourceType, callback) {
    const fns = resourceFns[resourceType];
    TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
      assert.notExists(error);
      const { 0: user0 } = users;
      fns.createSucceeds(user0.restContext, 'public', [], [], (resource) => {
        // Ensure invalid email is rejected
        fns.setRolesFails(
          user0.restContext,
          user0.restContext,
          resource.id,
          { 'email1@oae': 'manager' },
          400,
          () => {
            // Ensure invalid role for email is rejected
            fns.setRolesFails(
              user0.restContext,
              user0.restContext,
              resource.id,
              { 'email1@oae.local': 'invalidrole' },
              400,
              () => {
                // Sanity check we can set roles with a valid role
                fns.setRolesSucceeds(
                  user0.restContext,
                  user0.restContext,
                  resource.id,
                  { 'email1@oae.local': 'manager' },
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
  };

  /*!
   * Ensure authorization of inviting users from a variety of different types of tenants when
   * inviting through the resource "set roles" action
   *
   * @param  {String}         resourceType    The resource type for which to execute the test
   * @param  {Function}       callback        Invoked when the test is complete
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _testInvitationsAuthorizationForSetRoles = function (resourceType, callback) {
    const fns = resourceFns[resourceType];
    const memberRole = resourceMemberRoles[resourceType];

    TestsUtil.setupMultiTenantPrivacyEntities((publicTenant0, publicTenant1, privateTenant0) => {
      const managerUser = publicTenant0.publicUser;
      const viewerUser = publicTenant0.loggedinUser;

      // Create public resource with a viewer
      fns.createSucceeds(
        managerUser.restContext,
        'public',
        [],
        [viewerUser.user.id],
        (resource) => {
          // Ensure viewer cannot invite VIA set roles
          fns.setRolesFails(
            managerUser.restContext,
            viewerUser.restContext,
            resource.id,
            { 'email1@oae.local': memberRole },
            401,
            () => {
              const rolesSameTenant = {};
              const rolesExternalPublicTenant = {};
              const rolesGuestTenant = { 'email1@oae.local': memberRole };
              const rolesExternalPrivateTenant = {};

              rolesSameTenant[_emailForTenantInfo(publicTenant0)] = memberRole;
              rolesExternalPublicTenant[_emailForTenantInfo(publicTenant1)] = memberRole;
              rolesExternalPrivateTenant[_emailForTenantInfo(privateTenant0)] = memberRole;

              // Ensure manager can set invitation roles for all emails they can interact with
              fns.setRolesSucceeds(
                managerUser.restContext,
                managerUser.restContext,
                resource.id,
                rolesSameTenant,
                () => {
                  fns.setRolesSucceeds(
                    managerUser.restContext,
                    managerUser.restContext,
                    resource.id,
                    rolesExternalPublicTenant,
                    () => {
                      fns.setRolesSucceeds(
                        managerUser.restContext,
                        managerUser.restContext,
                        resource.id,
                        rolesGuestTenant,
                        () => {
                          fns.setRolesFails(
                            managerUser.restContext,
                            managerUser.restContext,
                            resource.id,
                            rolesExternalPrivateTenant,
                            401,
                            () => {
                              // Ensure a user on a tenant that has disabled inviting guests
                              // cannot invite guests that end up on the guest tenant
                              _disableInvitingGuests(publicTenant0.tenant.alias, () => {
                                fns.setRolesSucceeds(
                                  managerUser.restContext,
                                  managerUser.restContext,
                                  resource.id,
                                  rolesSameTenant,
                                  () => {
                                    fns.setRolesSucceeds(
                                      managerUser.restContext,
                                      managerUser.restContext,
                                      resource.id,
                                      rolesExternalPublicTenant,
                                      () => {
                                        fns.setRolesFails(
                                          managerUser.restContext,
                                          managerUser.restContext,
                                          resource.id,
                                          rolesGuestTenant,
                                          401,
                                          () => {
                                            fns.setRolesFails(
                                              managerUser.restContext,
                                              managerUser.restContext,
                                              resource.id,
                                              rolesExternalPrivateTenant,
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
                              });
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
  };

  /*!
   * Disable inviting guests for a given tenant
   *
   * @param  {String}         tenantAlias     The alias of the tenant to disable the inviting guests feature for
   * @param  {Function}       callback        Invoked when the configuration has been updated
   * @throws {AssertionError}                 Thrown if any of the assertions fail
   */
  const _disableInvitingGuests = function (tenantAlias, callback) {
    ConfigTestUtil.updateConfigAndWait(
      globalAdminRestContext,
      tenantAlias,
      { 'oae-tenants/guests/allow': false },
      (error) => {
        assert.notExists(error);
        return callback();
      }
    );
  };

  const _assertAdaptedActivities = function (
    inviterUserInfo,
    invitedUserInfo,
    otherUserInfo,
    resources,
    assertions,
    callback
  ) {
    assertions = assertions || {};

    // Get the activities. We're not going to care what stream the activities came from, we
    // just need to get all activities associated to the people and resources in context
    ActivityTestUtil.collectAndGetActivityStream(
      inviterUserInfo.restContext,
      inviterUserInfo.user.id,
      null,
      (error, result) => {
        assert.notExists(error);

        const activity = _.first(result.items);
        _withAdaptedInfo(inviterUserInfo, activity, {}, (error, inviterUserInfo) => {
          assert.notExists(error);
          _withAdaptedInfo(invitedUserInfo, activity, {}, (error, invitedUserInfo) => {
            assert.notExists(error);
            _withAdaptedInfo(
              otherUserInfo,
              activity,
              {
                contextId: _.first(resources).id
              },
              (error, otherUserInfo) => {
                assert.notExists(error);
                _assertStandardInvitationAcceptSummaries(
                  inviterUserInfo,
                  invitedUserInfo,
                  otherUserInfo,
                  resources
                );

                // Check the resource-specific summary match against this number of resources
                const match = assertions.matches[resources.length - 1];
                _assertContains(inviterUserInfo.summary, match);
                _assertContains(invitedUserInfo.summary, match);
                _assertContains(otherUserInfo.summary, match);

                return callback();
              }
            );
          });
        });
      }
    );
  };

  const _assertStandardInvitationAcceptSummaries = function (
    inviterUserInfo,
    invitedUserInfo,
    otherUserInfo,
    resources
    /* , opts */
  ) {
    _assertNotContains(inviterUserInfo.summary, 'You ');
    _assertContains(inviterUserInfo.summary, invitedUserInfo.user.displayName);
    _assertContains(inviterUserInfo.summary, invitedUserInfo.user.profilePath);
    _assertContains(inviterUserInfo.summary, ' has accepted your invitation to ');

    // When the user who invited the user sees the activity from their activity feed, they see
    // the target resource(s) as the preview item(s)
    _.each(resources, (resource) => {
      assert.ok(_.findWhere(inviterUserInfo.previewItems, { 'oae:id': resource.id }));
    });

    _assertContains(invitedUserInfo.summary, 'You have accepted an invitation from');
    _assertNotContains(invitedUserInfo.summary, ' your ');
    _assertContains(invitedUserInfo.summary, inviterUserInfo.user.displayName);
    _assertContains(invitedUserInfo.summary, inviterUserInfo.user.profilePath);

    // When the user who was invited sees the activity from their activity feed, they see the
    // target resource(s) as the preview item(s)
    _.each(resources, (resource) => {
      assert.ok(_.findWhere(invitedUserInfo.previewItems, { 'oae:id': resource.id }));
    });

    _assertNotContains(otherUserInfo.summary, 'You ');
    _assertContains(otherUserInfo.summary, invitedUserInfo.user.displayName);
    _assertContains(otherUserInfo.summary, invitedUserInfo.user.profilePath);
    _assertContains(otherUserInfo.summary, ' has accepted an invitation from ');
    _assertNotContains(otherUserInfo.summary, ' your ');
    _assertContains(otherUserInfo.summary, inviterUserInfo.user.displayName);
    _assertContains(otherUserInfo.summary, inviterUserInfo.user.profilePath);

    // When an uninvolved user sees the activity from the context of one of the target resources
    // (e.g., the target group activity feed), they see the user who was invited into the group
    assert.strictEqual(otherUserInfo.previewItems.length, 1);
    assert.strictEqual(otherUserInfo.previewItems[0]['oae:id'], invitedUserInfo.user.id);

    const numberResources = _.size(resources);
    if (numberResources <= 2) {
      _.each(resources, (resource) => {
        _assertContains(inviterUserInfo.summary, resource.displayName);
        _assertContains(invitedUserInfo.summary, resource.displayName);
        _assertContains(otherUserInfo.summary, resource.displayName);
        _assertContains(inviterUserInfo.summary, resource.profilePath);
        _assertContains(invitedUserInfo.summary, resource.profilePath);
        _assertContains(otherUserInfo.summary, resource.profilePath);
      });
    }

    if (numberResources >= 2) {
      _assertContains(inviterUserInfo.summary, ' and ');
      _assertContains(invitedUserInfo.summary, ' and ');
      _assertContains(otherUserInfo.summary, ' and ');
    }

    if (numberResources > 2) {
      const label = format(' %s others', numberResources - 1);
      _assertContains(inviterUserInfo.summary, label);
      _assertContains(invitedUserInfo.summary, label);
      _assertContains(otherUserInfo.summary, label);

      // Ensure only 1 resource appears in the summary
      const numberMatches = _.chain(resources)
        .filter((resource) => {
          return (
            inviterUserInfo.summary.includes(resource.displayName) &&
            inviterUserInfo.summary.includes(resource.profilePath) &&
            invitedUserInfo.summary.includes(resource.displayName) &&
            invitedUserInfo.summary.includes(resource.profilePath) &&
            otherUserInfo.summary.includes(resource.displayName) &&
            otherUserInfo.summary.includes(resource.profilePath)
          );
        })
        .size()
        .value();
      assert.strictEqual(numberMatches, 1);
    }
  };

  /*!
   * Collect pending emails, ensure the following:
   *
   *  * Email Contents:   Ensure the contents of the email contains each of the specified
   *                      resources
   *  * Invitation Link:  Ensure the invitation link is present and contains a token that allows
   *                      the email recipient to accept the invitation, gaining access to the
   *                      specified resources
   *  * Accepting:        Ensure that when the email recipient accepts the invitation, they are
   *                      given all the specified resources in their respective libraries feeds
   *                      and searches. Also, it ensures that the members feed of the accepted
   *                      resource contains the user who accepted the invitation
   *
   * @param  {Object}         invitingUserInfo        The user info of the user who performed the invitation
   * @param  {Object}         acceptingUserInfo       The user info of the user who should accept the invitation
   * @param  {Resource[]}     resources               The resources we expect to be accepted in this email invitation
   * @param  {Object}         assertions              The assertion data according to the context o the data setup
   * @param  {String}         assertions.role         The role, if any, we expect the user to have on each resource after accepting
   * @param  {Number}         assertions.membersSize  The expected size of the resource members libraries after accepting
   * @param  {Number}         assertions.librarySize  The expected size of the respective resource library after accepting
   * @param  {Function}       callback                Invoked when the test is complete
   * @throws {AssertionError}                         Thrown if any of the assertions fail
   */
  const _assertAcceptEmailInvitation = function (
    invitingUserInfo,
    acceptingUserInfo,
    resources,
    assertions,
    callback
  ) {
    // Receive the email invitation, ensuring we only have 1
    EmailTestUtil.collectAndFetchAllEmails((messages) => {
      assert.strictEqual(_.size(messages), 1);

      const message = _.first(messages);

      // Ensure the subject contains the display name of the sender
      assert.notStrictEqual(message.subject.indexOf(invitingUserInfo.user.displayName), -1);

      // Ensure no direct resource profile paths are contained in the email, and that at least
      // one resource display name appears in the subject
      let hasOne = false;
      _.each(resources, (resource) => {
        _assertNotContains(message.html, resource.profilePath);
        if (message.subject.indexOf(resource.displayName)) {
          hasOne = true;
        }
      });
      assert.ok(hasOne);

      // Ensure the token in the email is functional
      const token = new URL(
        AuthzTestUtil.parseInvitationUrlFromMessage(message).searchParams.get('url'),
        'http://localhost'
      ).searchParams.get('invitationToken');
      AuthzTestUtil.assertAcceptInvitationSucceeds(acceptingUserInfo.restContext, token, () => {
        _assertRole(invitingUserInfo, acceptingUserInfo, resources, assertions, () => {
          // Collect the accept email and respond with it
          EmailTestUtil.collectAndFetchAllEmails((messages) => {
            assert.strictEqual(_.size(messages), 1);
            return callback(_.first(messages));
          });
        });
      });
    });
  };

  /*!
   * Ensure the potential member user has the given role (if any) on all the specified resources
   * including:
   *
   *  * Members Feed:     Ensure the members feed of the resource contains the resource
   *  * Library Feed:     Ensure the respective library feed of the user contains each resource
   *  * Library Search:   Ensure the respective library search of the user contains each resource
   *
   * @param  {Object}         managerUserInfo         The user info of a user who manages each resource
   * @param  {Object}         memberUserInfo          The user info of the user we are going to test for membership
   * @param  {Resource[]}     resources               The resources we are checking against for membership
   * @param  {Object}         assertions              The assertion data according to the context o the data setup
   * @param  {String}         assertions.role         The role, if any, we expect the user to have on each resource
   * @param  {Number}         assertions.membersSize  The expected size of the resource members libraries
   * @param  {Number}         assertions.librarySize  The expected size of the respective resource library
   * @param  {Function}       callback                Invoked when the test is complete
   * @throws {AssertionError}                         Thrown if any of the assertions fail
   */
  const _assertRole = function (managerUserInfo, memberUserInfo, resources, assertions, callback) {
    assertions = assertions || {};
    if (!_.isArray(resources)) {
      return _assertRole(managerUserInfo, memberUserInfo, [resources], assertions, callback);
    }

    if (_.isEmpty(resources)) {
      return callback();
    }

    resources = resources.slice();
    const resource = resources.shift();
    const fns = resourceFns[resource.resourceType];

    // Ensure the members library feed has/doesn't have the user with the specified role
    fns.getMembersSucceeds(managerUserInfo.restContext, resource.id, (members) => {
      if (_.isNumber(assertions.membersSize)) {
        assert.strictEqual(members.length, assertions.membersSize);
      }

      const memberInfo = _.find(members, (memberInfo) => {
        return memberInfo.profile.id === memberUserInfo.user.id;
      });

      if (assertions.role) {
        assert.ok(memberInfo);
        assert.strictEqual(memberInfo.role, assertions.role);
      } else {
        assert.ok(!memberInfo);
      }

      // Ensure the user's library for this type of resource has/doesn't have the resource
      fns.getLibrarySucceeds(memberUserInfo.restContext, memberUserInfo.user.id, (libraryItems) => {
        if (_.isNumber(assertions.librarySize)) {
          assert.strictEqual(libraryItems.length, assertions.librarySize);
        }

        const resourceItem = _.findWhere(libraryItems, { id: resource.id });
        if (assertions.role) {
          assert.ok(resourceItem);
        } else {
          assert.ok(!resourceItem);
        }

        // If we expect the user to have a role, we should ensure their respective resource
        // library has the item in it when searching. Otherwise, ensure it does not contain
        // the resource
        const searchAssertFn = assertions.role
          ? SearchTestUtil.assertSearchContains
          : SearchTestUtil.assertSearchNotContains;

        const libraryName = resourceLibraryInfo[resource.resourceType];
        searchAssertFn(
          memberUserInfo.restContext,
          libraryName,
          [memberUserInfo.user.id],
          null,
          [resource.id],
          () => {
            return _assertRole(managerUserInfo, memberUserInfo, resources, assertions, callback);
          }
        );
      });
    });
  };

  /*!
   * Ensure that the specified invitation email HTML indicates the specified resource without its
   * profile path. It should not have its profile path because it is not a link.
   *
   * @param  {String}         html        The html content to check
   * @param  {Resource}       resource    The resource to ensure is present in the html content
   * @throws {AssertionError}             Thrown if the conditions are not met
   */
  const _assertInvitationContainsResourceHtml = function (html, resource) {
    _assertContains(html, resource.displayName);
    _assertNotContains(html, resource.profilePath);
  };

  /*!
   * Ensure that the specified accepted invitation activity email HTML indicates the specified
   * resource
   *
   * @param  {String}         html        The html content to check
   * @param  {Resource}       resource    The resource to ensure is present in the html content
   * @throws {AssertionError}             Thrown if the conditions are not met
   */
  const _assertAcceptInvitationContainsResourceHtml = function (html, resource) {
    _assertContains(html, resource.displayName);
    _assertContains(html, resource.profilePath);
  };

  /*!
   * Ensure the source string contains the match string
   *
   * @param  {String}         sourceStr   The source string to match
   * @param  {String}         matchStr    The string to ensure is present in the source string
   * @throws {AssertionError}             Thrown if the conditions are not met
   */
  const _assertContains = function (sourceString, matchString) {
    if (!matchString) {
      assert.fail('Cannot assert against a falsey string');
    }

    assert.notStrictEqual(sourceString.indexOf(matchString), -1);
  };

  /*!
   * Ensure the source string does not contain the match string
   *
   * @param  {String}         sourceStr   The source string to match
   * @param  {String}         matchStr    The string to ensure is not present in the source string
   * @throws {AssertionError}             Thrown if the conditions are not met
   */
  const _assertNotContains = function (sourceString, matchString) {
    if (!matchString) {
      assert.fail('Cannot assert against a falsey string');
    }

    assert.strictEqual(sourceString.indexOf(matchString), -1);
  };

  /*!
   * Convenience function to create one of each type of resource with the specified access
   *
   * @param  {Object}         creatingUserInfo    The user info to use to create each resource
   * @param  {String}         visibility          The visibility to apply to each resource
   * @param  {String[]}       managerIds          The managers of the resource
   * @param  {String[]}       memberIds           The members of the resource
   * @param  {Function}       callback            Invoked when the test is complete
   * @param  {Resource[]}     callback.resources  The created resources
   * @throws {AssertionError}                     Thrown if any of the assertions fail
   */
  const _createOneOfEachResourceType = function (
    creatingUserInfo,
    visibility,
    managerIds,
    memberIds,
    callback
  ) {
    // Create a resource of each known type, aggregating them into the `createResults`
    // object
    const resources = [];
    const _done = _.chain(resourceFns)
      .size()
      .after(() => {
        return callback(resources);
      })
      .value();

    // Perform all the creates and kick off the assertions on the created resources
    // and invitations
    PrincipalsTestUtil.assertGetMeSucceeds(creatingUserInfo.restContext, (/* me */) => {
      _.each(resourceFns, (fns) => {
        fns.createSucceeds(
          creatingUserInfo.restContext,
          visibility,
          managerIds,
          memberIds,
          (resource) => {
            resources.push(resource);
            return _done();
          }
        );
      });
    });
  };

  /*!
   * Convenience function to extend the specified user info with the adapted preview items and
   * summary of the specified activity
   *
   * @param  {Object}     userInfo            The user info to extend
   * @param  {Activity}   activity            The activity whose adapted info to overlay
   * @param  {Object}     [opts]              Optional arguments
   * @param  {String}     [opts.contextId]    The context id for the adapted activity. Defaults to the user id of the user info
   * @return {Object}                         The user info with the adapted activity preview items and summary applied
   */
  const _withAdaptedInfo = function (userInfo, activity, options, callback) {
    options = options || {};
    options.contextId = options.contextId || userInfo.user.id;

    UIAPI.getActivityAdapter((error, adapter) => {
      assert.notExists(error);
      const adapted = adapter.adapt(
        options.contextId,
        userInfo.user,
        [clone(activity)],
        Sanitization
      );
      const { summary } = adapted[0];
      const previewItems = adapted[0].activityItems;
      const result = _.extend({}, userInfo, {
        previewItems,
        summary: UIAPI.translate(summary.i18nKey, null, summary.i18nArguments)
      });

      return callback(null, result);
    });
  };

  /*!
   * Create an email whose domain matches that of the specified tenant info
   *
   * @param  {Object}     tenantInfo  The tenant info object
   * @param  {String}     [username]  The username of the email. One will be randomly generated if unspecified
   * @return {String}                 The created email
   */
  const _emailForTenantInfo = function (tenantInfo, username) {
    return _emailForTenant(tenantInfo.tenant, username);
  };

  /*!
   * Create an email whose domain matches that of the specified tenant
   *
   * @param  {Tenant}     tenant      The tenant
   * @param  {String}     [username]  The username of the email. One will be randomly generated if unspecified
   * @return {String}                 The created email
   */
  const _emailForTenant = function (tenant, username) {
    return _emailForDomain(tenant.emailDomains[0], username);
  };

  /*!
   * Create an email with the specified host and username
   *
   * @param  {String}     host        The host
   * @param  {String}     [username]  The username of the email. One will be randomly generated if unspecified
   * @return {String}                 The created email
   */
  const _emailForDomain = function (host, username) {
    return format('%s@%s', username || TestsUtil.generateTestUserId(), host);
  };
});
