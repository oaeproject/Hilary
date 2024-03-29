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

/* eslint-disable unicorn/no-array-callback-reference */
import assert from 'node:assert';
import _ from 'underscore';

import * as LibraryAPI from 'oae-library';
import * as OaeUtil from 'oae-util/lib/util.js';
import * as RestAPI from 'oae-rest';
import * as SearchTestUtil from 'oae-search/lib/test/util.js';

import * as AuthzAPI from 'oae-authz';
import * as AuthzDelete from 'oae-authz/lib/delete.js';
import * as AuthzInvitationsDAO from 'oae-authz/lib/invitations/dao.js';
import * as AuthzUtil from 'oae-authz/lib/util.js';

import * as PrincipalsTestUtil from 'oae-principals/lib/test/util.js';

/**
 * Delete the given resource by its id and ensure it completes successfully
 *
 * @param  {String}         resourceId      The id of the resource to try and delete
 * @param  {Function}       callback        Invoked when all assertions pass
 * @throws {AssertionError}                 Thrown if any assertions fail
 */
const assertSetDeletedSucceeds = function (resourceId, callback) {
  // Apply the delete operation
  AuthzDelete.setDeleted(resourceId, (error) => {
    assert.ok(!error);

    // Verify that it shows up being deleted
    return assertIsDeletedSucceeds([resourceId], [resourceId], callback);
  });
};

/**
 * Restore the given resource by its id and ensure it completes successfully
 *
 * @param  {String}         resourceId      The id of the resource to try and restore
 * @param  {Function}       callback        Invoked when all assertions pass
 * @throws {AssertionError}                 Thrown if any assertions fail
 */
const assertUnsetDeletedSucceeds = function (resourceId, callback) {
  // Apply the delete operation
  AuthzDelete.unsetDeleted(resourceId, (error) => {
    assert.ok(!error);

    // Verify that it doesn't show up as being deleted
    return assertIsDeletedSucceeds([resourceId], [], callback);
  });
};

/**
 * Accept the invitation pending for the given email address, ensuring the process succeeds
 *
 * @param  {RestContext}    restContext             The context of the current request
 * @param  {String}         email                   The email for which to accept the invitation
 * @param  {Function}       callback                Invoked when all assertions pass
 * @param  {Object}         callback.result         The result of the accept invitation request
 * @param  {Invitation[]}   callback.invitations    The invitations that were pending for the email
 * @param  {String}         callback.token          The token that was associated to the email
 * @throws {AssertionError}                         Thrown if any assertions fail
 */
const assertAcceptInvitationForEmailSucceeds = function (restContext, email, callback) {
  email = email.toLowerCase();
  AuthzInvitationsDAO.getTokensByEmails([email], (error, emailTokens) => {
    assert.ok(!error);

    const token = emailTokens[email];
    assertAcceptInvitationSucceeds(restContext, token, (result, invitations) =>
      // Be swell and give the token to the caller so they can try and re-use it if they dare
      callback(result, invitations, token)
    );
  });
};

/**
 * Accept the invitation pending for the given token, ensuring the process succeeds
 *
 * @param  {RestContext}    restContext             The context of the current request
 * @param  {String}         token                   The invitation token to accept
 * @param  {Function}       callback                Invoked when all assertions pass
 * @param  {Object}         callback.result         The result of the accept invitation request
 * @param  {Invitation[]}   callback.invitations    The invitations that were pending for the token
 * @throws {AssertionError}                         Thrown if any assertions fail
 */
const assertAcceptInvitationSucceeds = function (restContext, token, callback) {
  // eslint-disable-next-line no-unused-vars
  PrincipalsTestUtil.assertGetMeSucceeds(restContext, (me) => {
    AuthzInvitationsDAO.getEmailByToken(token, (error, email) => {
      assert.ok(!error);

      // Get the invitations before accepting so we can provide them to the caller
      AuthzInvitationsDAO.getAllInvitationsByEmail(email, (error, invitationsBefore) => {
        assert.ok(!error);

        // Perform the accept action
        RestAPI.Invitations.acceptInvitation(restContext, token, (error, result) => {
          assert.ok(!error);

          // Get all the invitations again and ensure they're now empty for that email
          AuthzInvitationsDAO.getAllInvitationsByEmail(email, (error, invitationsAfter) => {
            assert.ok(!error);
            assert.strictEqual(invitationsAfter.length, 0);

            // Ensure libraries and search have time to finish indexing
            LibraryAPI.Index.whenUpdatesComplete(() => {
              SearchTestUtil.whenIndexingComplete(() =>
                // Respond with the invitations
                callback(result, invitationsBefore)
              );
            });
          });
        });
      });
    });
  });
};

/**
 * Attempt to accept the invitation pending for the given token, ensuring the process fails in the
 * specified manner
 *
 * @param  {RestContext}    restContext             The context of the current request
 * @param  {String}         token                   The invitation token to accept
 * @param  {Number}         httpCode                The expected HTTP code of the accept invitation request
 * @param  {Function}       callback                Invoked when all assertions pass
 * @param  {Object}         callback.result         The result of the accept invitation request
 * @param  {Invitation[]}   callback.invitations    The invitations that were pending for the token
 * @throws {AssertionError}                         Thrown if any assertions fail
 */
const assertAcceptInvitationFails = function (restContext, token, httpCode, callback) {
  // Get invitations before attempting to accept, if applicable. Since this a failure scenario, it
  // is possible that the token is completely invalid
  OaeUtil.invokeIfNecessary(token, AuthzInvitationsDAO.getEmailByToken, token, (error, email) => {
    OaeUtil.invokeIfNecessary(
      email,
      AuthzInvitationsDAO.getAllInvitationsByEmail,
      email,
      (error, invitationsBefore) => {
        // Perform the accept
        RestAPI.Invitations.acceptInvitation(restContext, token, (error_) => {
          assert.ok(error_);
          assert.strictEqual(error_.code, httpCode);

          // Ensure we get the same result from querying invitations to ensure that failing to
          // accept the invitation did not trash them
          OaeUtil.invokeIfNecessary(
            email,
            AuthzInvitationsDAO.getAllInvitationsByEmail,
            email,
            (error, invitationsAfter) => {
              assert.deepStrictEqual(invitationsBefore, invitationsAfter);
              return callback();
            }
          );
        });
      }
    );
  });
};

/**
 * Get the invitations associated to the resource id for the specified resource type
 *
 * @param  {RestContext}    restContext             The context of the current request
 * @param  {String}         resourceType            The type of resource for which to get invitations
 * @param  {String}         resourceId              The id of the resource
 * @param  {Function}       callback                Invoked when all assertions pass
 * @param  {Invitation[]}   callback.invitations    The invitations that are pending for the resource
 * @throws {AssertionError}                         Thrown if any assertions fail
 */
const assertGetInvitationsSucceeds = function (restContext, resourceType, resourceId, callback) {
  RestAPI.Invitations.getInvitations(restContext, resourceType, resourceId, (error, result) => {
    assert.ok(!error);
    return callback(result);
  });
};

/**
 * Atempt to get the invitations associated to the resource id for the specified resource type,
 * ensuring it fails in the specified manner
 *
 * @param  {RestContext}    restContext             The context of the current request
 * @param  {String}         resourceType            The type of resource for which to get invitations
 * @param  {String}         resourceId              The id of the resource
 * @param  {Number}         httpCode                The expected HTTP code of the get invitation request
 * @param  {Function}       callback                Invoked when all assertions pass
 * @param  {Invitation[]}   callback.invitations    The invitations that are pending for the resource
 * @throws {AssertionError}                         Thrown if any assertions fail
 */
const assertGetInvitationsFails = function (
  restContext,
  resourceType,
  resourceId,
  httpCode,
  callback
) {
  RestAPI.Invitations.getInvitations(restContext, resourceType, resourceId, (error, result) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);
    return callback(result);
  });
};

/**
 * Resend the invitations associated to the resource id for the specified resource type and email
 *
 * @param  {RestContext}    restContext             The context of the current request
 * @param  {String}         resourceType            The type of resource for which to resend an invitation
 * @param  {String}         resourceId              The id of the resource
 * @param  {String}         email                   The email of the resource invitation
 * @param  {Function}       callback                Invoked when all assertions pass
 * @throws {AssertionError}                         Thrown if any assertions fail
 */
const assertResendInvitationSucceeds = function (
  restContext,
  resourceType,
  resourceId,
  email,
  callback
) {
  RestAPI.Invitations.resendInvitation(restContext, resourceType, resourceId, email, (error) => {
    assert.ok(!error);
    return callback();
  });
};

/**
 * Attempt to resend the invitations associated to the resource id for the specified resource type
 * and email, ensuring it fails in the specified manner
 *
 * @param  {RestContext}    restContext             The context of the current request
 * @param  {String}         resourceType            The type of resource for which to resend an invitation
 * @param  {String}         resourceId              The id of the resource
 * @param  {String}         email                   The email of the resource invitation
 * @param  {Number}         httpCode                The expected HTTP code of the resend invitation request
 * @param  {Function}       callback                Invoked when all assertions pass
 * @throws {AssertionError}                         Thrown if any assertions fail
 */
const assertResendInvitationFails = function (
  restContext,
  resourceType,
  resourceId,
  email,
  httpCode,
  callback
) {
  RestAPI.Invitations.resendInvitation(restContext, resourceType, resourceId, email, (error) => {
    assert.ok(error);
    assert.strictEqual(error.code, httpCode);
    return callback();
  });
};

/**
 * Check that the `isDeleted` response is successful and indicates the expected resources are
 * deleted
 *
 * @param  {String[]}       resourceIdsToCheck  The ids of the resources to check for being deleted
 * @param  {String[]}       deletedResourceIds  The only resource ids we expected to be deleted
 * @param  {Function}       callback            Invoked when all assertions pass
 * @throws {AssertionError}                     Thrown if any assertions fail
 */
const assertIsDeletedSucceeds = function (resourceIdsToCheck, deletedResourceIds, callback) {
  AuthzDelete.isDeleted(resourceIdsToCheck, (error, deleted) => {
    assert.ok(!error);

    // Ensure the expected resource ids and only those ones appear as being deleted
    assert.strictEqual(_.keys(deleted).length, deletedResourceIds.length);
    _.each(deletedResourceIds, (deletedResourceId) => {
      assert.strictEqual(deleted[deletedResourceId], true);
    });

    return callback();
  });
};

/**
 * Check that the resource members graph returns the expected set of members
 *
 * @param  {String[]}       resourceIds     The ids of the resources whose members graph to get
 * @param  {String[][]}     expectedIds     An array of arrays contains the members lists we expect to get from the resource id at the same index in `resourceIds`
 * @param  {Function}       callback        Invoked when the assertions have succeeded on the members graph
 * @param  {AuthzGraph}     callback.graph  The members graph of the provided resource
 * @throws {AssertionError}                 Thrown if the graph wasn't as expected
 */
const assertAuthzMembersGraphIdsEqual = function (resourceIds, expectedIds, callback) {
  AuthzAPI.getAuthzMembersGraph(resourceIds, (error, graph) => {
    assert.ok(!error);

    const actualIds = _.chain(resourceIds)
      .map((resourceId) =>
        // Ensure all the ids are sorted since there is no contract for traversal order
        _.pluck(graph.traverseIn(resourceId), 'id').sort()
      )
      .value();

    // Ensure all the ids are sorted since there is no contract for traversal order
    expectedIds = _.map(expectedIds, (ids) => [...ids].sort());

    assert.deepStrictEqual(actualIds, expectedIds);
    return callback(graph);
  });
};

/**
 * Check that the principal memberships graph returns the expected set of memberships
 *
 * @param  {String}         principalId     The id of the principal whose memberships graph to get
 * @param  {String[]}       expectedIds     The expected membership ids
 * @param  {Function}       callback        Invoked when the assertions have succeeded on the memberships graph
 * @param  {AuthzGraph}     callback.graph  The memberships graph of the provided principal
 * @throws {AssertionError}                 Thrown if the graph wasn't as expected
 */
const assertPrincipalMembershipsGraphIdsEqual = function (principalId, expectedIds, callback) {
  AuthzAPI.getPrincipalMembershipsGraph(principalId, (error, graph) => {
    assert.ok(!error);
    assert.deepStrictEqual(
      _.pluck(graph.traverseOut(principalId), 'id').sort(),
      [...expectedIds].sort()
    );
    return callback(graph);
  });
};

/**
 * Ensure that the provided actual membership is equal to the expected membership after the
 * membership delta has been applied to the actual membership. All memberships objects are the
 * standard authz membership representation where the key is the principal id and the value is the
 * role the user has on some resource
 *
 * @param  {Object}     membershipBeforeDelta   The actual membership before any membership updates
 * @param  {Object}     [membershipDelta]       The actual changes that were applied to the membership. If not specified, the actual membership will be compared directly with the expected membership without change
 * @param  {Object}     membershipAfterDelta    The membership after the updates (if any) are applied
 * @throws {AssertionError}                     Thrown if the membership after the delta is not equal to the initial membership with the delta applied
 */
const assertMemberRolesEquals = function (before, delta, after) {
  // Narrow down the deltas to only resource roles
  const principalIdDelta = {};
  _.each(delta, (role, targetId) => {
    const target = AuthzUtil.parseShareTarget(targetId);
    if (target.principalId) {
      principalIdDelta[target.principalId] = role;
    }
  });

  _assertDeltaEquals(before, principalIdDelta, after);
};

/**
 * Ensure that the provided actual email roles are equal to the expected email roles after the
 * delta has been applied to the actual email roles. All email roles objects are the standard authz
 * membership representation where the key is the principal id and the value is the role the user
 * has on some resource
 *
 * @param  {Object}     membershipBeforeDelta   The actual membership before any membership updates
 * @param  {Object}     [membershipDelta]       The actual changes that were applied to the membership. If not specified, the actual membership will be compared directly with the expected membership without change
 * @param  {Object}     membershipAfterDelta    The membership after the updates (if any) are applied
 * @throws {AssertionError}                     Thrown if the membership after the delta is not equal to the initial membership with the delta applied
 */
const assertEmailRolesEquals = function (before, delta, after) {
  // Narrow down the deltas to only email roles
  const emails = _.chain(delta)
    .keys()
    .map(AuthzUtil.parseShareTarget)
    .filter((target) => !target.principalId)
    .pluck('email')
    .value();
  delta = _.chain(delta).oaeMapKeys(_toLowerCase).pick(emails).value();
  after = _.oaeMapKeys(after, _toLowerCase);
  _assertDeltaEquals(before, delta, after);
};

/**
 * Create a memberships graph based on the one provided
 *
 * @param  {AuthzGraph}     graph       The graph representing the memberships
 * @param  {Function}       callback    Invoked when the memberships graph has been created
 * @throws {AssertionError}             Thrown if there is an error persisting the memberships graph
 */
const assertCreateMembershipsGraphSucceeds = function (graph, callback, _ops) {
  if (!_ops) {
    _ops = _.chain(graph.getNodes())
      .pluck('id')
      .filter((parentId) => !_.isEmpty(graph.getInEdgesOf(parentId)))
      .map((parentId) => {
        const roles = {};
        _.each(graph.getInEdgesOf(parentId), (edge) => {
          roles[edge.from.id] = edge.role || 'member';
        });

        return { id: parentId, roles };
      })
      .value();

    return assertCreateMembershipsGraphSucceeds(graph, callback, _ops);
  }

  if (_.isEmpty(_ops)) {
    return callback();
  }

  const op = _ops.shift();
  AuthzAPI.updateRoles(op.id, op.roles, (error) => {
    assert.ok(!error);
    return assertCreateMembershipsGraphSucceeds(graph, callback, _ops);
  });
};

/**
 * Create an object that can be used to update resource roles from a list of principal ids and a
 * specified role to apply
 *
 * @param  {String[]}           principalIds    The ids of the principals whose role to change on a resource
 * @param  {String|Boolean}     role            The role to apply, or `false` if the change is to remove the principal from the resource
 * @return {Object}                             The role change object keyed by principal ids, where the value is the role change to apply
 */
const createRoleChange = function (principalIds, role) {
  const roleChange = {};
  _.each(principalIds, (principalId) => {
    roleChange[principalId] = role;
  });
  return roleChange;
};

/**
 * Get a simple `MemberRoles` object from a list of member profiles along with their roles
 *
 * @param  {Object[]}       members     The array of member objects containing `profile` and `role` returned from the content members library
 * @return {MemberRoles}                The member roles in the library result
 */
const getMemberRolesFromResults = function (members) {
  const memberRoles = {};
  _.each(members, (member) => {
    memberRoles[member.profile.id] = member.role;
  });
  return memberRoles;
};

/**
 * Get a simple EmailRoles object from a list of invitations
 *
 * @param  {Invitation[]}   invitation  The invitations from which to extract the emails and roles
 * @return {EmailRoles}                 The email roles in the invitation list
 */
const getEmailRolesFromResults = function (invitations) {
  const emailRoles = {};
  _.each(invitations, (invitation) => {
    emailRoles[invitation.email] = invitation.role;
  });
  return emailRoles;
};

/**
 * Given an email message, parse the invitation URL out of it, if any. If there is no invitation
 * url, then an assertion error is thrown
 *
 * @param  {Object}         message     The email message
 * @return {String}                     The invitation url
 * @throws {AssertionError}             Thrown if there is no invitation url
 */
const parseInvitationUrlFromMessage = function (message) {
  const match = message.html.match(
    /href="(https?:\/\/[^/]+\/signup\?url=%2F%3FinvitationToken%3D[^"]+)"/
  );

  assert.ok(match);
  assert.strictEqual(match.length, 2);
  return new URL(match[1], 'http://localhost');
};

/**
 * Ensure that when the `delta` IdRoles is applied to the `before` IdRoles, the result equals that
 * of the `after` IdRoles
 *
 * @param  {IdRoles}        before  The base id roles
 * @param  {IdRoles}        delta   The id role changes to apply
 * @param  {IdRoles}        after   The expected result from applying the `delta` to the `before`
 * @throws {AssertionError}         Thrown if the  `delta` application does not result in the `after` roles
 * @api private
 */
const _assertDeltaEquals = function (before, delta, after) {
  const expectedAfter = _.extend({}, before);
  _.each(delta, (role, id) => {
    if (role === false) {
      delete expectedAfter[id];
    } else {
      expectedAfter[id] = role;
    }
  });

  assert.deepStrictEqual(after, expectedAfter);
};

/**
 * Lower case the given string
 *
 * @param  {String}     str     The string to lower case
 * @return {String}             The string in lower case
 * @api private
 */
const _toLowerCase = function (string) {
  return string.toLowerCase();
};

export {
  assertSetDeletedSucceeds,
  assertUnsetDeletedSucceeds,
  assertAcceptInvitationForEmailSucceeds,
  assertAcceptInvitationSucceeds,
  assertAcceptInvitationFails,
  assertGetInvitationsSucceeds,
  assertGetInvitationsFails,
  assertResendInvitationSucceeds,
  assertResendInvitationFails,
  assertIsDeletedSucceeds,
  assertAuthzMembersGraphIdsEqual,
  assertPrincipalMembershipsGraphIdsEqual,
  assertMemberRolesEquals,
  assertEmailRolesEquals,
  assertCreateMembershipsGraphSucceeds,
  createRoleChange,
  getMemberRolesFromResults,
  getEmailRolesFromResults,
  parseInvitationUrlFromMessage
};
