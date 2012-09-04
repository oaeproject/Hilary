var groupsApi = require('../lib/api.js');
var usersApi = require('../../users/lib/user.api.js');
var tenantApi = require('../../../util/Tenant.js');


var tenant = tenantApi.Tenant('cam', 'Cambridge', 3000);

var createPrincipals = function(test, callback) {
	var r = Math.floor(Math.random()*100000);
	var principals = 0;
	var createPrincipalDone = function(err) {
		if (err)
			return test.fail("ERROR: " + err);
			
		principals++;
		if (principals === 8) {
			callback(r);
		}
	};

	groupsApi.createGroup(tenant, 'oae-team-' + r, 'oae-team-' + r, createPrincipalDone);
	groupsApi.createGroup(tenant, 'backend-team-' + r, 'backend-team-' + r, createPrincipalDone);
	groupsApi.createGroup(tenant, 'ui-team-' + r, 'ui-team-' + r, createPrincipalDone);
	groupsApi.createGroup(tenant, 'canadian-' + r, 'canadian-' + r, createPrincipalDone);
	groupsApi.createGroup(tenant, 'not-canadian-' + r, 'not-canadian-' + r, createPrincipalDone);
	groupsApi.createGroup(tenant, 'belgian-' + r, 'belgian-' + r, createPrincipalDone);
	groupsApi.createGroup(tenant, 'west-flemish-' + r, 'west-flemish' + r, createPrincipalDone);
	groupsApi.createGroup(tenant, 'east-flemish-' + r, 'east-flemish' + r, createPrincipalDone);

	usersApi.createUser(tenant, 'Bert-' + r, 'Pareyn', createPrincipalDone);
	usersApi.createUser(tenant, 'Branden-' + r, 'Visser', createPrincipalDone);
	usersApi.createUser(tenant, 'Nicolaas-' + r, 'Matthijs', createPrincipalDone);
	usersApi.createUser(tenant, 'Simon-' + r, 'Gaeremynck', createPrincipalDone);
};

var createOAEStructure = function(test, callback) {
	createPrincipals(test, function(id){
		var checks = 0;
		var principalsAdded = function(err) {
			if (err)
				test.fail("ERROR: " + err);
			checks++;
			if (checks === 8) {
				callback(id)
			}
		}
		groupsApi.addGroupMembers('g:cam:canadian-' + id, ['u:cam:branden-' + id], principalsAdded);
		groupsApi.addGroupMembers('g:cam:not-canadian-' + id, ['u:cam:simon-' + id], principalsAdded);
		groupsApi.addGroupMembers('g:cam:belgian-' + id, ['g:cam:west-flemish-' + id, 'g:cam:east-flemish-' + id], principalsAdded);
		groupsApi.addGroupMembers('g:cam:west-flemish-' + id, ['u:cam:bert-' + id], principalsAdded);
		groupsApi.addGroupMembers('g:cam:east-flemish-' + id, ['u:cam:nicolaas-' + id], principalsAdded);
		groupsApi.addGroupMembers('g:cam:oae-team-' + id, ['g:cam:backend-team-' + id, 'g:cam:ui-team-' + id], principalsAdded);
		groupsApi.addGroupMembers('g:cam:backend-team-' + id, ['g:cam:canadian-' + id, 'g:cam:not-canadian-' + id], principalsAdded);
		groupsApi.addGroupMembers('g:cam:ui-team-' + id, ['g:cam:belgian-' + id], principalsAdded);
	});
};

assertGroupMembers = function(test, group_id, expected_members, callback) {
	groupsApi.getGroupMembers(group_id, false, function(err, members) {
		test.equal(members.length, expected_members.length, "Expected group '" + group_id + "' to have '" + expected_members.length + "' members.");
		for (var i = 0; i < expected_members.length; i++) {
			var has_principal = true;
			for (var c = 0; c < members.length; c++) {
				if (members[c] === expected_members[i]) {
					has_principal = true;
					break;
				}
			}
			test.ok(has_principal, "Group '" + group_id + "' does not contain: " + expected_members[i]);
		}
		callback();
	});
};

assertMemberOf = function(test, principal_id, expected_groups, callback) {
	groupsApi.memberOf(principal_id, false, function(err, groups) {
		test.equal(groups.length, expected_groups.length, "Expected principal '" + principal_id + "' to have '" + expected_groups.length + "' memberships: " + groups.join(","));
		for (var i = 0; i < expected_groups.length; i++) {
			var has_group = true;
			for (var c = 0; c < groups.length; c++) {
				if (groups[c] === expected_groups[i]) {
					has_group = true;
					break;
				}
			}
			test.ok(has_group, "Principal '" + principal_id + "' does not contain: " + expected_groups[i]);
		}
		callback();
	});
};

assertExplodedGroupUsers = function(test, group_id, expected_users, callback) {
	groupsApi.getGroupUsers(group_id, function(err, users) {
		if (err)
			return test.fail("ERROR: " + err);

		test.equal(users.length, expected_users.length, "Expected principal '" + group_id + "' to have '" + expected_users.length + "' users.");
		for (var i = 0; i < expected_users.length; i++) {
			var has_user = true;
			for (var c = 0; c < users.length; c++) {
				if (users[c] === expected_users[i]) {
					has_user = true;
					break;
				}
			}
			test.ok(has_user, "Group '" + group_id + "' does not contain: " + expected_users[i]);
		}
		callback();
	});
};
exports.testSimpleGroupStructure = function(test) {
	createOAEStructure(test, function(id) {
		// Create the oae-team tree in a way that is NOT topdown or bottomup.
		var memberships = 0;
		var checks = 0;
		var done = function() {
			checks++;
			if (checks === 11) {
				test.done();
			}
		};

		// The group members should only return the direct children.
		assertGroupMembers(test, 'g:cam:oae-team-' + id, ['g:cam:backend-team-' + id, 'g:cam:ui-team-' + id], done);
		assertGroupMembers(test, 'g:cam:backend-team-' + id, ['g:cam:canadian-' + id, 'g:cam:not-canadian-' + id], done);
		assertGroupMembers(test, 'g:cam:canadian-' + id, ['u:cam:branden-' + id], done);
		assertGroupMembers(test, 'g:cam:not-canadian-' + id, ['u:cam:simon-' + id], done);
		assertGroupMembers(test, 'g:cam:belgian-' + id, ['g:cam:west-flemish-' + id, 'g:cam:east-flemish-' + id], done);
		assertGroupMembers(test, 'g:cam:west-flemish-' + id, ['u:cam:bert-' + id], done);
		assertGroupMembers(test, 'g:cam:east-flemish-' + id, ['u:cam:nicolaas-' + id], done);

		// ALL groups should be listed against a principal.
		assertMemberOf(test, 'u:cam:bert-' + id, ['g:cam:oae-team-' + id, 'g:cam:ui-team-' + id, 'g:cam:belgian-' + id, 'g:cam:west-flemish-' + id], done);
		assertMemberOf(test, 'u:cam:nicolaas-' + id, ['g:cam:oae-team-' + id, 'g:cam:ui-team-' + id, 'g:cam:belgian-' + id, 'g:cam:east-flemish-' + id], done);
		assertMemberOf(test, 'u:cam:branden-' + id, ['g:cam:oae-team-' + id, 'g:cam:backend-team-' + id, 'g:cam:not-canadian-' + id], done);
		assertMemberOf(test, 'u:cam:simon-' + id, ['g:cam:oae-team-' + id, 'g:cam:backend-team-' + id, 'g:cam:canadian-' + id], done);

	});
};

exports.testExploding = function(test) {
	createOAEStructure(test, function(id) {
		var checks = 0;
		var done = function(err) {
			checks++;
			if (checks === 7) {
				test.done();
			}
		};
		assertExplodedGroupUsers(test, 'g:cam:oae-team-' + id, ['u:cam:bert-' + id, 'u:cam:branden-' + id, 'u:cam:nicolaas-' + id, 'u:cam:simon-' + id], done);
		assertExplodedGroupUsers(test, 'g:cam:backend-team-' + id, ['u:cam:simon-' + id, 'u:cam:branden-' + id], done);
		assertExplodedGroupUsers(test, 'g:cam:canadian-' + id, ['u:cam:branden-' + id], done);
		assertExplodedGroupUsers(test, 'g:cam:not-canadian-' + id, ['u:cam:simon-' + id], done);
		assertExplodedGroupUsers(test, 'g:cam:belgian-' + id, ['u:cam:bert-' + id, 'u:cam:nicolaas-' + id], done);
		assertExplodedGroupUsers(test, 'g:cam:west-flemish-' + id, ['u:cam:bert-' + id], done);
		assertExplodedGroupUsers(test, 'g:cam:east-flemish-' + id, ['u:cam:nicolaas-' + id], done);
	});
};