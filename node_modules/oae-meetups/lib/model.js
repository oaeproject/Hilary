/*!
 * Copyright 2017 Apereo Foundation (AF) Licensed under the
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

 var MeetupsConstants = require('./constants');

/**
 * A model object that represents a meetup object.
 *
 * @param  {Tenant}         tenant          The tenant to which this meetup is associated
 * @param  {String}         id              The id of the meetup
 * @param  {String}         createdBy       The id of the user who created the meetup
 * @param  {String}         displayName     The display name of the meetup
 * @param  {String}         record    	    Flag indicating that the meetup may be recorded
 * @param  {Number}         created         The timestamp (millis since epoch) at which the meetup was created
 * @return {Meetup}                        The meetup with the data provided
 */
var Meetup = module.exports.Meetup = function(tenant, id, createdBy, displayName, record, created) {
    var that = {};
    that.tenant = tenant;
    that.id = id;
    that.createdBy = createdBy;
    that.displayName = displayName;
    that.record = record;
    that.created = created;
    that.resourceType = MeetupsConstants.resourceTypes.MEETUP;
    return that;
};

/**
 * A model object that represents a recording object.
 *
 * @param  {String}         id              The id of the recording
 * @param  {String}         contentId       The id of the content resource
 * @param  {String}         createdBy       The id of the user who created the recording
 * @param  {Number}         created         The timestamp (millis since epoch) at which the recording was created
 * @return {Recording}                        The recording with the data provided
 */
var Recording = module.exports.Recording = function(id, contentId, createdBy, created) {
    var that = {};
    that.id = id;
    that.contentId = contentId;
    that.createdBy = createdBy;
    that.created = created;
    that.resourceType = MeetupsConstants.resourceTypes.RECORDING;
    return that;
};
