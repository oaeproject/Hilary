var util = require('util');

var AuthzUtil = require('oae-authz/lib/util');

var Meeting = module.exports.Meeting = function (tenant, id, createdBy, displayName, description, chat, contactList, visibility, created, lastModified) {
    var resourceId =  AuthzUtil.getResourceFromId(id).resourceId;
    var that = {};
    that.tenant = tenant;
    that.id = id;
    that.createdBy = createdBy;
    that.displayName = displayName;
    that.description = description;
    that.chat = chat;
    that.contactList = contactList;
    that.visibility = visibility;
    that.created = created;
    that.lastModified = lastModified;
    that.profilePath = util.format('/meeting-jitsi/%s/%s', tenant.alias, resourceId);
    that.resourceType = 'meeting-jitsi';
    
    return that;
};