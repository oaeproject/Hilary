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
 * visibilitys and limitations under the License.
 */

/**
 * A TinCan API Statement model
 * @see http://rusticisoftware.github.io/TinCanJS/doc/api/latest/classes/TinCan.Statement.html
 *
 * @param  {Actor}      actor           TinCan API Actor information
 * @param  {Verb}       verb            TinCan API Verb information
 * @param  {Object}     object          TinCan API Object information
 * @return {Statement}                  TinCan API Statement containing the body for the request to TinCan
 */
module.exports.TinCanStatement = function(actor, verb, object) {
    var that = {};
    that.actor = actor;
    that.verb = verb;
    that.object = object;
    return that;
};

/**
 * A TinCan API Actor model
 * @see http://rusticisoftware.github.io/TinCanJS/doc/api/latest/classes/TinCan.Agent.html
 *
 * @param  {String}  displayName        The display name of the user performing the action
 * @param  {String}  homePage           The link to the user's profile
 * @return {Actor}                      TinCan API Actor model containing information about the actor
 */
module.exports.TinCanActor = function(displayName, homePage) {
    var that = {};
    that.name = displayName;
    that.objectType = 'Agent';
    that.account = {
        'homePage': homePage,
        'name': displayName
    };
    return that;
};

/**
 * A TinCan API Object model
 * @see http://rusticisoftware.github.io/TinCanJS/doc/api/latest/classes/TinCan.Activity.html
 *
 * @param  {String}  id                 The id of the object of the activity (e.g. c:tenant1:lJpuyNZL-)
 * @param  {String}  displayName        The display name of the activity object (e.g. the title of the link, discussion...)
 * @param  {String}  description        The description of the activity object
 * @return {Object}                     TinCan API Object model containing information about the object
 */
module.exports.TinCanObject = function(id, displayName, description) {
    var that = {};
    that.id = id;
    that.objectType = 'Activity';
    that.definition = {
        'name': {
            'en-US': displayName
        },
        'description': {
            'en-US': description
        }
    };
    return that;
};

/**
 * A TinCan API Verb model
 * @see http://adlnet.gov/expapi/verbs
 * @see http://rusticisoftware.github.io/TinCanJS/doc/api/latest/classes/TinCan.Verb.html
 *
 * @param  {String}  id                 The TinCan identifier of the verb
 * @param  {String}  display            The display name of the verb
 * @return {Verb}                       TinCan API Verb model containing information about the verb
 */
module.exports.TinCanVerb = function(id, display) {
    var that = {};
    that.id = id;
    that.display = {
        'en-US': display
    };
    return that;
};
