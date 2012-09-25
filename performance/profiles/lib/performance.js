/*
 * Copyright 2012 Sakai Foundation (SF) Licensed under the
 * Educational Community License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://www.osedu.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS"
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */


var principalsAPI = require('oae-principals');
var permissionsAPI = require('oae-permissions');
var ProfileAPI = require('oae-profiles');
var rolesUtil = require('oae-roles/lib/util');
var Context = require('oae-context').Context;
var Tenant = require('oae-tenants/lib/model').Tenant;
var User = require('oae-principals/lib/model').User;


/**
 * Load the user and profile data from the model-loader scripts specified in scriptsDir.
 *
 * @param {Array<String>}           tenantIds       The tenants to run concurrently. All tenants will have the same data loaded.
 * @param {Object}                  results         An object to which the dataload process can attach timing results
 * @param {Function(err, model)}    callback        The function invoked when dataloading is complete
 * @param {Object}                  callback.err    An error that occurred, if any
 */
module.exports.dataload = function(tenantIds, model, results, callback) {
    // Because bcrypt is computationally slow (by design)
    // it doesn't allow for a proper benchmark.
    // Therefor we create the users seperate from the dataload timing.

    var tenantUsersLoaded = 0;
    tenantIds.forEach(function(tenantId) {
        var tenant = new Tenant(tenantId, 'load-test', 'load-test', 2001, 'google.ca');
        persistUsers(tenant, model.users.slice(0), function(err) {
            tenantUsersLoaded++;
            if (err) {
                return callback(err);
            }

            if (tenantUsersLoaded === tenantIds.length) {
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
                            callback();
                        }
                    }
                };

                tenantIds.forEach(function(tenantId) {
                    var tenant = new Tenant(tenantId, 'load-test', 'load-test', 2001, 'google.ca');
                    persistModel(tenant, model, results.dataload, function(err) {
                        trackModelLoading(err, tenant);
                    });
                });
            }
        });
    });
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

    performanceTestGetFullProfile(tenantIds, model, function(err, duration, totalProfiles) {
        if (!err) {
            performance['get-full-profile'] = {
                'duration': duration,
                'profiles': totalProfiles,
                'profilesPerSecond': (totalProfiles*1000)/duration,
                'msg': 'Each profile consists out of a basic profile (in Principals) and 2 profile sections'
            };
            callback();
        } else {
            callback(err);
        }
    });
};

/**
 * This method will get a full profile for each user that is defined in
 * `model.users` concurrently for each tenant defined in `tenantIds`.
 *
 * @param {String}                              tenantIds           A unique alias for a tenant.
 * @param {Object}                              model               An object that holds the data necessary for running this
 *                                                                  performance benchmark. In this case, only a key `users` with
 *                                                                  an array of user objects is required.
 * @param {Function(err, duration, profiles)}   callback            A callback method.
 * @param {Object}                              callback.err        An error object (if any)
 * @param {Number}                              callback.duration   The time in milliseconds it took to run the performance benchmark for all the tenants.
 * @param {Number}                              callback.profiles   The number of profiles that have been retrieved per tenant.
 */
var performanceTestGetFullProfile = function(tenantIds, model, callback) {
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
                return callback(null, duration, model.users.length);
            }
        }
    }

    tenantIds.forEach(function(tenantId) {
        var tenant = new Tenant(tenantId, 'load-test', 'load-test', 2001, 'google.ca');
        getFullProfileForTenant(tenant, model.users.slice(0), checkStatus);
    });
};

/**
 * Retrieve a gull profile each users as defined in the `users` array in the provided tenant.
 * A full profile exists out of the retrieval of a basic profile and 2 profile sections.
 * @param {Tenant}          tenant          A tenant object.
 * @param {Array<Object>}   users           A users array that needs to be retrieved.
 * @param {Function(err)}   callback        A callback method
 * @param {Object}          callback.err    An error object (if any)
 */
var getFullProfileForTenant = function(tenant, users, callback) {
    if (users.length === 0) {
        return callback();
    }

    var user = users.pop();
    var principalUuid = rolesUtil.toUuid('u', tenant.alias, user.userid);
    var ctx = new Context(tenant, new User(tenant.alias, principalUuid));
    principalsAPI.getBasicProfile(ctx, principalUuid, function(err, profile) {
        if (err) {
            return callback(err);
        }
        ProfileAPI.getSection(ctx, principalUuid, 'aboutme', function(err, section) {
            if (err) {
                return callback(err);
            }
            ProfileAPI.getSection(ctx, principalUuid, 'publications', function(err, section) {
                if (err) {
                    return callback(err);
                }
                return getFullProfileForTenant(tenant, users, callback);
            });
        });
    });
};

/**
 * Persists the model that is pertinant to his profile benchmark.
 * In this case that would be the profiles for each user for the given tenant.
 *
 * @param {Tenant}         tenant           Tenant object.
 * @param {Object}         model            An object that holds the data necessary for running this
 *                                          performance benchmark. In this case, only a key `users` with
 *                                          an array of user objects is required.
 * @param {[type]}         results          An object that can be used to store the results (time) in.
 * @param {Function(err)}  callback         A callback method
 * @param {Object}         callback.err     An error object (if any)
 */
var persistModel = function(tenant, model, results, callback) {
    results.profileSections = {};

    var start = new Date().getTime();
    var now = null;
    persistProfiles(tenant, model.users.slice(0), function(err) {
        if (!err) {
            now = new Date().getTime();
            results.profileSections.num = model.users.length * 2;
            results.profileSections.time = now - start;
            results.profileSections.perSecond = (model.users.length*1000*2) / results.profileSections.time;

            callback();
        } else {
            return callback(err);
        }
    });
};

/**
 * Persist the profiles for each user in the `users` array.
 *
 * @param {Tenant}         tenant           Tenant object.
 * @param {Object}         users            An array of user objects.
 * @param {Function(err)}  callback         A callback method
 * @param {Object}         callback.err     An error object (if any)
 */
var persistProfiles = function(tenant, users, callback) {
    if (users.length === 0) {
        return callback();
    }

    var user = users.pop();
    var ctx = new Context(tenant, null);
    var principalUuid = rolesUtil.toUuid('u', tenant.alias, user.userid);
    var ctx = new Context(tenant, new User(tenant.alias, principalUuid));
    ProfileAPI.setSection(ctx, principalUuid, 'aboutme', user.aboutMe.aboutMePrivacy, user.aboutMe, true, function(err) {
        if (!err) {
            ProfileAPI.setSection(ctx, principalUuid, 'publications', user.publications.publicationsPrivacy, user.publications, true, function(err) {
                if(!err) {
                    return persistProfiles(tenant, users, callback);
                } else {
                    console.log(err);
                    return callback(err);
                }
            });
        } else {
            console.log(err);
            return callback(err);
        }
    });
};

/**
 * Create an account for each user in the `users` array.
 *
 * @param {Tenant}         tenant           Tenant object.
 * @param {Object}         users            An array of user objects.
 * @param {Function(err)}  callback         A callback method
 * @param {Object}         callback.err     An error object (if any)
 */
var persistUsers = function(tenant, users, callback) {
    if (users.length === 0) {
        return callback();
    }

    var user = users.pop();
    var ctx = new Context(tenant, null);
    principalsAPI.createUser(ctx, user.userid, user.userid, user.userAccountPrivacy, 'en_GB', 'Europe/London', user.firstName, user.lastName, user.basicInfo.displayName, function(err, userUuid) {
        if (!err) {
            return persistUsers(tenant, users, callback);
        } else {
            return callback(err);
        }
    });
};