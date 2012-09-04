var http = require('http');
var querystring = require('querystring');

var NR_OF_GROUPS = 5000;
var MAX_MEMBERS_PER_GROUP = 20;
var failedRequests = 0;

http.Agent.defaultMaxSockets = 50;
http.globalAgent.maxSockets = 50;

var createGroup = function(name, description, callback) {
	http.get('http://localhost:2001/groups/create?name=' + name + '&description=' + description, function(res) {
		if (res.statusCode != 201) {
			failedRequests++;
		}
		callback();
	}).on('error', function(e) {
		console.log(e);
	  	failedRequests++;
	  	callback();
	});
};

var addPrincipalsToGroup = function(group_id, principals, callback) {
	http.get("http://localhost:2001/groups/members/add?id=" + group_id + principals, function(res) {
		if (res.statusCode != 200) {
			failedRequests++;
		}
		callback();
	}).on('error', function(e) {
	  	failedRequests++;
	  	callback();
	});
};


// Generate 5000 groups.
var groups = [];
for (var i = 0; i < NR_OF_GROUPS;i++) {
	var r = Math.floor(Math.random()*10000000);
	groups.push({'id': 'g:cam:group-test-' + r + '-' + i, 'name': 'group-test-' + r + '-'  + i, 'description': 'Thisisatestforgroupnumber' + r + '-'  + i});
}

// Generate a random nr of members for each group.
var totalMemberships = 0;
for (var i = 0; i < NR_OF_GROUPS;i++) {
	groups[i]['members'] = [];
	var members = 1 + Math.floor(Math.random()*MAX_MEMBERS_PER_GROUP);
	totalMemberships += members;
	var principals = "";
	while (members > 0) {
		var r = Math.floor(Math.random()*NR_OF_GROUPS);
		principals += "&principals=" + groups[r]['id'];
		members--;
	}
	groups[i]['principals'] = principals;
}
console.log("Group memberships will be: "+totalMemberships);




// create the 5000 groups.
var createGroupDone = 0;
var createGroupCallback = function() {
	createGroupDone++;
	if (createGroupDone === NR_OF_GROUPS) {
		console.timeEnd("group-creation");
		console.log("Failed requests: " + failedRequests);
	}
}

console.time("group-creation");
for (var i = 0; i < NR_OF_GROUPS;i++) {
	createGroup(groups[i]['name'], groups[i]['description'], createGroupCallback);
}



// Do the memberships.
var membershipGroupDone = 0;
failedRequests = 0;
var membershipGroupCallback = function() {
	membershipGroupDone++;
	if (membershipGroupDone === NR_OF_GROUPS) {
		console.timeEnd("group-membership");
		console.log("Failed requests: " + failedRequests);
		console.log("Total membership requests: " + totalMemberships);
	}
}

console.time("group-membership");
for (var i = 0; i < NR_OF_GROUPS;i++) {
	addPrincipalsToGroup(groups[i]['id'], groups[i]['principals'], membershipGroupCallback);
}