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

import ActivityEmitter from 'oae-activity/lib/internal/emitter.js';

import _ from 'underscore';
import request from 'request';
import { logger } from 'oae-logger';
import * as TenantsAPI from 'oae-tenants';
import * as TenantsUtil from 'oae-tenants/lib/util.js';

import { ActivityConstants } from 'oae-activity/lib/constants.js';
import { setUpConfig } from 'oae-config';
import { TinCanAPIConstants } from './constants.js';

import * as TinCanModel from './model.js';

const log = logger('oae-doc');

const TinCanConfig = setUpConfig('oae-tincanapi');

let config = null;

/**
 * Initializes the TinCan API integration.
 * This will listen for OAE activities and will convert these into TinCan statements that can be posted to a Learning Record Store.
 *
 * @param  {Object}    config       Configuration for the TinCan API module
 * @param  {Function}  callback     Standard callback function
 */
const initializeTinCanAPI = function (_config, callback) {
  // Store the configuration values
  config = _config;

  // Listen for OAE activities that are taking place
  ActivityEmitter.on(ActivityConstants.events.ROUTED_ACTIVITIES, _processActivities);

  callback();
};

/**
 * Process a number of routed OAE activities and turn them into TinCan API statements. Each activity only needs to be posted
 * to the Learning Record Store once.
 *
 * @see ActivityAPI#EventEmitter
 * @api private
 */
const _processActivities = function (routedActivities) {
  // Object that will contain the statements for each tenant
  const tenantStatements = {};

  // Iterate over each target resource
  _.each(routedActivities, (streamTypeActivities, resourceId) => {
    // For each resource, there could be a number of stream types to which it was routed (e.g., activity and notification)
    _.each(streamTypeActivities, (activity, streamType) => {
      // A triggered activity can end up as multiple routed activities (one for the actor, one for the target, one for each follower, ...)
      // We only need to send a single statement per triggered activity and only for the actor.
      // We can do this by only sending a statement if the activityStreamId we're dealing with is the same as the activity's actor
      if (activity.actor[ActivityConstants.properties.OAE_ID] === resourceId && streamType === 'activity') {
        // Verify that a valid activity object has been provided
        if (!activity.object[activity.object.objectType]) {
          return;
        }

        // Stores the tenant alias to retrieve values from the configAPI later on
        const tenantAlias = activity.actor.user.tenant.alias;

        // If the object doesn't contain the tenant yet, we add the tenant as a new key. Each tenant will have an array containing
        // all the activities to be sent to the LRS for that tenant
        tenantStatements[tenantAlias] = tenantStatements[tenantAlias] || [];

        // Construct the actor's profile link
        const homePage = TenantsUtil.getBaseUrl(TenantsAPI.getTenant(tenantAlias)) + activity.actor.user.profilePath;

        // Fill the actor, verb and object objects
        const actor = new TinCanModel.TinCanActor(activity.actor.user.displayName, homePage);
        const verb = _mapVerb(activity.verb);
        const object = new TinCanModel.TinCanObject(
          activity.object['oae:id'],
          activity.object[activity.object.objectType].displayName,
          activity.object[activity.object.objectType].description
        );

        // Add a new statement to the array of statements
        tenantStatements[tenantAlias].push(new TinCanModel.TinCanStatement(actor, verb, object));
      }
    });
  });

  // A single batch request is done to the LRS for each tenant in the provided activities
  _.each(tenantStatements, sendStatementsToLRS);
};

/**
 * Function that maps an OAE activity verb to a TinCan API verb
 * @see /node_modules/oae-tincanapi/lib/constants.js
 *
 * @param  {String}     verb    OAE activity verb that needs to be mapped to a TinCan API verb
 * @return {VerbModel}          Mapped TinCan API verb
 * @api private
 */
const _mapVerb = function (oaeVerb) {
  let verb = null;

  switch (oaeVerb) {
    case ActivityConstants.verbs.ADD: {
      verb = TinCanAPIConstants.verbs.ADDED;

      break;
    }

    case ActivityConstants.verbs.CREATE: {
      verb = TinCanAPIConstants.verbs.CREATED;

      break;
    }

    case ActivityConstants.verbs.JOIN: {
      verb = TinCanAPIConstants.verbs.JOINED;

      break;
    }

    case ActivityConstants.verbs.POST: {
      verb = TinCanAPIConstants.verbs.POSTED;

      break;
    }

    case ActivityConstants.verbs.SHARE: {
      verb = TinCanAPIConstants.verbs.SHARED;

      break;
    }

    case ActivityConstants.verbs.UPDATE: {
      verb = TinCanAPIConstants.verbs.UPDATED;

      break;
    }

    default: {
      verb = TinCanAPIConstants.verbs.DEFAULT;
    }
  }

  return new TinCanModel.TinCanVerb(verb.id, verb.display);
};

/**
 * Submit a statement to the Learning Record Store.
 * @see http://rusticisoftware.github.io/TinCanJS/
 *
 * For testing in Terminal, paste the following string:
 * curl -H "X-Experience-API-Version: 1.0.0" https://[APP-ID]]:[APP-SECRET]@cloud.scorm.com/tc/[APP-ID]/statements?statementId=[STATEMENT-ID]
 *
 * @param  {TinCanStatement[]}   statements             Array of statements representing tenant activities
 * @param  {String}              tenantAlias            Alias for the tenant on which the activity took place
 */
const sendStatementsToLRS = function (statements, tenantAlias) {
  // Check if the Learning Record Store integration is enabled for the tenant
  if (TinCanConfig.getValue(tenantAlias, 'lrs', 'enabled')) {
    // Create an options object that can be submitted to the TinCan API
    const options = {
      method: 'POST',
      url: TinCanConfig.getValue(tenantAlias, 'lrs', 'endpoint'),
      timeout: config.timeout,
      auth: {
        user: TinCanConfig.getValue(tenantAlias, 'lrs', 'username'),
        pass: TinCanConfig.getValue(tenantAlias, 'lrs', 'password'),
        sendImmediately: true
      },
      headers: {
        'Content-Type': 'application/json',
        'X-Experience-API-Version': '1.0.0'
      },
      body: JSON.stringify(statements)
    };

    // Perform the request
    request(options, (error, response, body) => {
      if (error) {
        log().error({ err: error, body }, 'An error ocurred whilst sending statements to the LRS');
      }
    });
  }
};

export { initializeTinCanAPI, sendStatementsToLRS as sendActivitiesToLRS };
