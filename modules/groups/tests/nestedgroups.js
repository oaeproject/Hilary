var express = require('express');

var OAE = require('../../../util/OAE');
var tenantApi = require('../../../util/Tenant');

var groupApi = require('../lib/api.js');

var r = Math.floor(Math.random()*10000000);
var tenant = tenantApi.Tenant('cam', 'Cambridge', 2001);

var groups = {};

var distributedGroups = 0;

// Create 5000 users.
var query = "BEGIN BATCH USING CONSISTENCY ONE \n";
var parameters = [];
for (var i = 0; i < 5000; i++) {
	query += 'UPDATE Principals SET user_first_name=?, user_last_name=? WHERE principal_id = ?; \n ';
	parameters.push("first-" + r + "-" + i);
	parameters.push("last-" + r + "-" + i);
	parameters.push("u:cam:user" + r + "-" + i);
}
query += "APPLY BATCH;";
OAE.runQuery(query, parameters, function (err) {
	if (err) {
		console.log("Failed to create users");
		console.log(err);
		return;
	}

	console.log("Users created.");

	// Create 250 Groups.
	var query = "BEGIN BATCH USING CONSISTENCY ONE \n";
	var parameters = [];
	for (var i = 0; i < 250; i++) {
		query += 'UPDATE Principals SET group_title=?, group_description=? WHERE principal_id = ?; \n ';
		parameters.push("title-" + r + "-" + i);
		parameters.push("desc-" + r + "-" + i);
		parameters.push("g:cam:group" + r + "-" + i);
		groups["g:cam:group" + r + "-" + i] = "g:cam:group" + r + "-" + i;
	}
	query += "APPLY BATCH;";
	OAE.runQuery(query, parameters, function (err) {
		if (err) {
			console.log("Failed to create groups");
			console.log(err);
			return;
		}

		console.log("Groups created.");

		// Distribute users over groups.
		var createdGroup = function() {
			console.log("Users distributed.");
			// Add groups to one big group.
			addGroupsTo("g:cam:group" + r + "-0");
		};

		var next = function(i) {
			if (i < 250) {
				var principals = [];
				for (var u = 0; u < 20; u++) {
					principals.push("u:cam:user" + r + "-" + i*20 + u);
				}
				groupApi.addGroupMembers(tenant, "g:cam:group" + r + "-" + i, principals, function (err) {
					if (err) {
						console.log("Failed to distribute users");
						console.log(err);
						return;
					}
					console.log("Distributed users over group " + i);
					next(i+1);
				});
			}
			else {
				createdGroup(err);
			}
		}
		next(0);
	});

});

var remainingGroups = 250;
var addGroupsTo = function(parent) {
	// Select a random amount of groups.
	var n = Math.min(Math.floor(Math.random() * 20), remainingGroups);

	console.log("Adding " + n + " groups to " + parent);
	var principals = [];
	for (var i = 0; i < n; i++) {
		remainingGroups--;
		principals.push("g:cam:group" + r + "-" + remainingGroups);
	}
	groupApi.addGroupMembers(tenant, parent, principals, function() {
		console.log("");
		if (remainingGroups > 0) {
			// Distribute some groups over the n groups.
			for (var i = 0; i < n;i++) {
				addGroupsTo(principals[i]);
			}
		}
	});
};