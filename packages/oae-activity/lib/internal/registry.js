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

import { format } from 'node:util';
import _ from 'underscore';

const activityStreams = {};
const activityTypes = {};
const activityEntityTypes = {};
const activityEntityAssociations = {};

/**
 * Register an activity stream
 *
 * @see ActivityAPI#registerActivityStreamType
 */
const registerActivityStreamType = function (activityStreamType, options) {
  if (activityStreams[activityStreamType]) {
    throw new Error(format('Attempted to register duplicate activity stream type "%s"', activityStreamType));
  }

  activityStreams[activityStreamType] = options;
};

/**
 * Get the activity stream options for an activity stream
 *
 * @see ActivityAPI#getRegisteredActivityStreamType
 */
const getRegisteredActivityStreamType = function (activityStreamType) {
  return activityStreams[activityStreamType];
};

/**
 * Register special activity behaviour
 *
 * @see ActivityAPI#registerActivityType
 */
const registerActivityType = function (activityType, options) {
  if (activityTypes[activityType]) {
    throw new Error(format('Attempted to register duplicate activity type of type "%s"', activityType));
  }

  if (_.isEmpty(options.streams)) {
    throw new Error('Missing or empty streams configuration');
  }

  // Iterate over each stream and ensure that they have a router declaration
  _.each(options.streams, (streamConfig, streamName) => {
    if (!streamConfig || _.isEmpty(streamConfig.router)) {
      throw new Error(format('Missing or empty router for stream "%s"', streamName));
    }

    // Iterate over the defined routers in the stream's router config
    // In this case entityName will be one of `actor`, `object` or `target`
    _.each(options.streams[streamName].router, function (assocations, entityName) {
      if (_.isEmpty(assocations)) {
        throw new Error(
          format('Missing or empty associations for stream "%s" and entity "%s"', streamName, entityName)
        );
      }
    });
  });

  activityTypes[activityType] = options;
};

/**
 * Get all the registered activity types in the system
 *
 * @return {Object}     All the registered activity types in the system
 * @see #registerActivityType
 */
const getRegisteredActivityTypes = function () {
  return activityTypes;
};

/**
 * Register special entity behaviour
 *
 * @see ActivityAPI#registerActivityEntity
 */
const registerActivityEntityType = function (activityEntityType, options) {
  if (activityEntityTypes[activityEntityType]) {
    throw new Error(format('Attempted to register duplicate activity entity type of type "%s"', activityEntityType));
  }

  activityEntityTypes[activityEntityType] = options;
};

/**
 * Get all the registered activity entity types in the system
 *
 * @return {Object}     All the registered activity types in the system
 */
const getRegisteredActivityEntityTypes = function () {
  return activityEntityTypes;
};

/**
 * Register an activity entity association
 *
 * @see ActivityAPI#registerActivityEntityAssociation
 */
const registerActivityEntityAssociation = function (activityEntityType, associationName, associationFunction) {
  if (
    activityEntityAssociations[activityEntityType] &&
    activityEntityAssociations[activityEntityType][associationName]
  ) {
    throw new Error(
      format(
        'Attempted to register duplicate activity entity association of type "%s" and name "%s"',
        activityEntityType,
        associationName
      )
    );
  }

  activityEntityAssociations[activityEntityType] = activityEntityAssociations[activityEntityType] || {};
  activityEntityAssociations[activityEntityType][associationName] = associationFunction;
};

/**
 * Get all the registered activity entity associations in the system
 *
 * @return {Object}     All the registered activity entity associations in the system
 */
const getRegisteredActivityEntityAssociations = function () {
  return activityEntityAssociations;
};

export {
  registerActivityStreamType,
  getRegisteredActivityStreamType,
  registerActivityType,
  getRegisteredActivityTypes,
  registerActivityEntityType,
  getRegisteredActivityEntityTypes,
  registerActivityEntityAssociation,
  getRegisteredActivityEntityAssociations
};
