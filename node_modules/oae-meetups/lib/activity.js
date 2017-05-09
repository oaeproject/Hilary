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

var _ = require('underscore');

var ActivityAPI = require('oae-activity');
var ActivityConstants = require('oae-activity/lib/constants').ActivityConstants;
var ActivityModel = require('oae-activity/lib/model');
var User = require('oae-principals/lib/model').User;

var MeetupsAPI = require('./api');
var MeetupsConstants = require('./constants').MeetupsConstants;
var MeetupsDAO = require('./internal/dao');

ActivityAPI.registerActivityType(MeetupsConstants.activity.ACTIVITY_MEETUP_JOIN, {
    'groupBy': [{'object': true}],
    'streams': {
        'activity': {
            'router': {
                'actor': ['self', 'followers'],
                'object': ['self', 'members']
            }
        },
        'notification': {
            'router': {
                'object': ['managers']
            }
        }
    }
});

/*!
 * Post a meetup-join activity when a user joins a meetup.
 */
MeetupsAPI.on(MeetupsConstants.events.JOIN_MEETUP, function(ctx, group) {
    var millis = Date.now();
    var actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {'user': ctx.user()});
    var objectResource = new ActivityModel.ActivitySeedResource('group', group.id, {'group': group});
    var activityType = MeetupsConstants.activity.ACTIVITY_MEETUP_JOIN;

    var activitySeed = new ActivityModel.ActivitySeed(activityType, millis, ActivityConstants.verbs.POST, actorResource, objectResource);
    ActivityAPI.postActivity(ctx, activitySeed);
});