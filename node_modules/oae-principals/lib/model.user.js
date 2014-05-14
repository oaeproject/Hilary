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

var util = require('util');

var AuthzUtil = require('oae-authz/lib/util');
var TenantsAPI = require('oae-tenants');

/**
 * The User model.
 *
 * @param  {String}     tenantAlias                     The tenant this user belongs to.
 * @param  {String}     id                              The globally unique userId for this user. e.g.: u:cam:johndoe
 * @param  {String}     displayName                     The display name of the user
 * @param  {Object}     [opts]                          Optional additional user properties
 * @param  {String}     [opts.visibility]               The visibility of this user account. e.g.: loggedin
 * @param  {String}     [opts.email]                    The email of the user
 * @param  {String}     [opts.locale]                   The user's locale
 * @param  {String}     [opts.publicAlias]              The name of the user which is displayed to a user who does not have access to view the user
 * @param  {String}     [opts.smallPictureUri]          The uri of the small picture. It will be made available at user.picture.smallUri
 * @param  {String}     [opts.mediumPictureUri]         The uri of the medium picture. It will be made available at user.picture.mediumUri
 * @param  {String}     [opts.largePictureUri]          The uri of the large picture. It will be made available at user.picture.largeUri
 * @param  {Number}     [opts.notificationsUnread]      The number of notifications that are unread for user
 * @param  {Number}     [opts.notificationsLastRead]    The last time, in millis since the epoc, the notifications for the user were read
 * @param  {Date}       [opts.acceptedTC]               The timestamp at which the user accepted the Terms and Conditions
 * @param  {Date}       [opts.lastModified]             The timestamp at which the user's profile was last changed
 * @param  {String}     [opts.emailPreference]          The user's email preference. One of {@see PrincipalConstants.emailPreferences}
 * @param  {Boolean}    [opts.isGlobalAdmin]            Whether or not the user is a global admin
 * @param  {Boolean}    [opts.isTenantAdmin]            Whether or not the user is a tenant admin
 */
module.exports.User = function(tenantAlias, id, displayName, opts) {
    opts = opts || {};

    // Explicit checks on true for admin.
    var _isGlobalAdmin = (opts.isGlobalAdmin === true);
    var _isTenantAdmin = (opts.isTenantAdmin === true);

    var tenant = TenantsAPI.getTenant(tenantAlias);
    var resourceId = AuthzUtil.getResourceFromId(id).resourceId;

    var that = {};
    that.tenant = tenant.compact();
    that.id = id;
    that.displayName = displayName;
    that.visibility = opts.visibility;
    that.email = opts.email;
    that.locale = opts.locale;
    that.publicAlias = opts.publicAlias;
    that.picture = {};
    if (opts.smallPictureUri) {
        that.picture.smallUri = opts.smallPictureUri;
    }
    if (opts.mediumPictureUri) {
        that.picture.mediumUri = opts.mediumPictureUri;
    }
    if (opts.largePictureUri) {
        that.picture.largeUri = opts.largePictureUri;
    }
    that.profilePath = '/user/' + tenantAlias + '/' + resourceId;
    that.resourceType = 'user';
    that.notificationsUnread = opts.notificationsUnread;
    that.notificationsLastRead = opts.notificationsLastRead;
    that.acceptedTC = opts.acceptedTC;
    that.lastModified = opts.lastModified;
    that.emailPreference = opts.emailPreference;

    /**
     * Check if a user is a global admin
     *
     * @return {Boolean} Whether or not this user is a global admin.
     */
    that.isGlobalAdmin = function() {
        return _isGlobalAdmin;
    };

    /**
     * Whether or not this user is a tenant admin for the provided tenant.
     *
     * @param  {String}  tenantAlias    The tenant this user is supposed to be an admin of.
     * @return {Boolean}                Whether or not the user is a tenant admin.
     */
    that.isTenantAdmin = function(tenantAlias) {
        return (_isTenantAdmin && tenantAlias === that.tenant.alias);
    };

    /**
     * Checks for both tenant admin as global admin.
     *
     * @param  {Object}  tenantAlias    The tenant this user could a tenant admin of.
     * @return {Boolean}                Whether this user is a tenant or global admin.
     */
    that.isAdmin = function(tenantAlias) {
        return (that.isTenantAdmin(tenantAlias) || that.isGlobalAdmin());
    };

    return that;
};
