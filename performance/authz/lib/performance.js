var Context = require('oae-context').Context;
var Tenant = require('oae-tenants/lib/model').Tenant;
var AuthzAPI = require('oae-authz');
var AuthzUtil = require('oae-authz/lib/util');

/**
 * Load the user, group and membership data from the model-loader scripts specified in scriptsDir.
 *
 * @param {Array<String>}           tenantIds       The tenants to run concurrently. All tenants will have the same data loaded.
 * @param {Object}                  results         An object to which the dataload process can attach timing results
 * @param {Function(err, model)}    callback        The function invoked when dataloading is complete
 * @param {Object}                  callback.err    An error that occurred, if any
 */
module.exports.dataload = function(tenantIds, model, results, callback) {

    results.dataload = {};

    // status vars for loader tracking
    var start = new Date().getTime();
    var resultErr = false;
    var numTenants = tenantIds.length;
    var tenantsFinished = 0;

    var trackModelLoading = function(err, tenant) {
        if (resultErr) {
            // do nothing, we already exited
        } else if (err) {
            // we received an error (for the first time), invoke callback with error
            resultErr = err;
            callback(resultErr);
        } else {
            tenantsFinished++;
            if (tenantsFinished === numTenants) {

                var numMemberships = model.memberships.length * numTenants;
                var duration = new Date().getTime() - start;
                results.dataload.memberships = {};
                results.dataload.memberships.num = numMemberships;
                results.dataload.memberships.duration = duration;
                results.dataload.memberships.perSecond = (numMemberships*1000) / duration;

                callback();
            }
        }
    };

    var errorPersisting = function(err) {
        trackModelLoading(err, tenant);
    };
    for (var i = 0; i < tenantIds.length; i++) {
        var tenant = new Tenant(tenantIds[i], 'load-test', 'load-test', 2001, 'google.ca');
        persistModel(tenant, model, results.dataload, errorPersisting);
    }
};

/**
 * Run the performance test concurrently for the given tenants on the model. The performance test results
 * should be attached to the results parameter object.
 *
 * @param {Array<String>}   tenantIds       An array of tenant ids for which to run the tests
 * @param {Object}          model           The data model to test against
 * @param {Object}          results         A results object that aggregates resulting timing information
 * @param {Function(err)}   callback        The method invoked when the process completes
 * @param {Object}          callback.err    An error that occurred, if any
 */
module.exports.performanceTest = function(tenantIds, model, results, callback) {
    var performance = results.performanceTest = {};

    performanceTestValidPermissions(tenantIds, model, function(err, duration, totalChecks) {
        if (!err) {
            performance['valid-permissions'] = {
                'duration': duration,
                'checks': totalChecks,
                'checksPerSecond': (totalChecks*1000)/duration

            };

            performanceTestAllPermissions(tenantIds, model, 15000, function(err, duration, totalChecks) {
                if (!err) {
                    performance['all-permissions'] = {
                        'duration': duration,
                        'checks': totalChecks,
                        'checksPerSecond': (totalChecks*1000)/duration
                    };

                    callback();
                } else {
                    callback(err);
                }
            });
        } else {
            callback(err);
        }
    });
}

// Performance test known membership permission checks
var performanceTestValidPermissions = function(tenantIds, model, callback) {
    var checks = getValidPermissionChecks(model);
    console.log('Checking all valid %s membership permissions.', checks.length);
    checkPermissionsForTenants(tenantIds.slice(0), checks, true, callback);
}

// Performance test all potential membership checks. This will result in a lot of failures
var performanceTestAllPermissions = function(tenantIds, model, limit, callback) {
    // aggregate all potential checks
    var checks = getAllPermissionChecks(model, limit);
    console.log('Checking all potential %s membership permissions.', checks.length);
    checkPermissionsForTenants(tenantIds.slice(0), checks, null, callback);
}

// perform all the checks provided in the 'checks' array, concurrently for all provided tenants
var checkPermissionsForTenants = function(tenantIds, checks, expect, callback) {
    var tenantsToRun = tenantIds.length;
    var tenantsRun = 0;
    var resultErr = false;
    var start = new Date().getTime();

    var checkStatus = function(err) {
        if (resultErr) {
            // do nothing, we already erred
        } else if (err) {
            resultErr = err;
            return callback(resultErr);
        } else {
            tenantsRun++;
            if (tenantsRun === tenantsToRun) {
                var duration = new Date().getTime() - start;
                return callback(null, duration, tenantsToRun*checks.length);
            }
        }
    };

    // sweep permissions checks for all tenants
    for (var i = 0; i < tenantIds.length; i++) {
        checkPermissionsForTenant(tenantIds[i], checks.slice(0), expect, checkStatus);
    }
};

// perform all the checks in the provided 'checks' array for the given tenant
var checkPermissionsForTenant = function(tenantId, checks, expect, callback) {

    if (checks.length === 0) {
        return callback();
    }

    if (checks.length % 100 === 0) {
        console.log('[%s] %s permission checks remaining.', tenantId, checks.length);
    }

    var check = checks.pop();
    var groupUuid = AuthzUtil.toUuid('g', tenantId, check.groupId);
    var principalUuid = AuthzUtil.toUuid(check.principalType, tenantId, check.principalId);
    var permission = check.permission;

    AuthzAPI.isAllowed(principalUuid, permission, groupUuid, function(err, isAllowed) {
        if (!err) {
            if (expect === null || expect === isAllowed) {
                checkPermissionsForTenant(tenantId, checks, expect, callback);
            } else {
                callback("Check "+JSON.stringify(check)+" failed with isAllowed: "+isAllowed);
            }
            
        } else {
            callback(err);
        }
    });
}

// persist the given model for the given tenant.
var persistModel = function(tenant, model, results, callback) {

    var start = new Date().getTime();
    persistMemberships(tenant, model.memberships.slice(0), function(err) {
        if (!err) {
            return callback();
        } else {
            return callback(err);
        }
    });
}

// persist the given array of memberships
var persistMemberships = function(tenant, memberships, callback) {
    if (memberships.length === 0) {
        return callback();
    }

    if (memberships.length % 100 === 0) {
        console.log('[%s] MEMBERSHIPS - %s remaining.', tenant.alias, memberships.length);
    }

    var membership = memberships.pop();
    var creatorUuid = AuthzUtil.toUuid('u', tenant.alias, membership.creatorId);
    var groupUuid = AuthzUtil.toUuid('g', tenant.alias, membership.groupId);
    var memberUuid = AuthzUtil.toUuid(membership.memberType, tenant.alias, membership.memberId);

    if (creatorUuid !== memberUuid && groupUuid !== memberUuid) {
        var change = {};
        change[memberUuid] = membership.role;
        AuthzAPI.applyGroupMembershipChanges(groupUuid, change, function(err) {
            if (!err) {
                return persistMemberships(tenant, memberships, callback);
            } else {
                return callback(err);
            }
        });
    } else {
        return persistMemberships(tenant, memberships, callback);
    }
};

// Get all possible combinations of membership permission checks for the given model
var getAllPermissionChecks = function(model, limit) {
    var checks = [];
    var numAdded = 0;
    for (var i = 0; i < model.groups.length; i++) {
        var group = model.groups[i];
        // only include groups that have roles
        if (group.roles) {
            for (var j = 0; j < model.users.length; j++) {
                var user = model.users[j];
                if (numAdded <= limit) {
                    checks.push({
                        principalId: user.userid,
                        principalType: 'u',
                        permission: 'member',
                        groupId: group.id
                    });
                    numAdded++;
                }
            }
        }
    }
    return checks;
};

// Get all the positive membership permission checks for the given model
var getValidPermissionChecks = function(model) {
    var checks = [];
    for (var i = 0; i < model.memberships.length; i++) {
        var membership = model.memberships[i];
        checks.push({
            principalId: membership.memberId,
            principalType: membership.memberType,
            permission: membership.role,
            groupId: membership.groupId
        });
    }
    return checks;
};
