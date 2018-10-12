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

const _ = require('underscore');
const request = require('request');

const log = require('oae-logger').logger('telemetry-circonus');

let circonusConfig = null;

/**
 * Will push data into redis and publish histogram data to circonus via HTTPTrap
 */
const init = function(telemetryConfig) {
  circonusConfig = telemetryConfig.circonus || {};
};

/**
 * Publishes the given telemetry data to a circonus HTTPTrap.
 *
 * @param  {Object}     data    The telemetry data to publish in the format: `module -> name -> value`
 */
const publish = function(data) {
  if (!data || _.isEmpty(data)) {
    return;
  }

  // Expand the data into a circonus friendly object
  let metricsToSend = 0;
  const circonusData = {};
  _.each(data, (nameValue, module) => {
    circonusData[module] = {};
    _.each(nameValue, (value, name) => {
      metricsToSend++;
      circonusData[module][name] = {
        _value: value,
        _type: 'I'
      };
    });
  });

  // Do not send empty data to circonus
  if (metricsToSend === 0) {
    return;
  }

  log().trace({ data: circonusData }, 'Publishing telemetry data to circonus');

  const requestOpts = {
    method: 'PUT',
    uri: circonusConfig.url,
    body: JSON.stringify(circonusData),
    strictSSL: false
  };

  // Invoke the HTTP request to the circonus HTTP Trap
  request(requestOpts, (err, response, body) => {
    if (err) {
      return log().warn({ err }, 'Error publishing telemetry data to circonus');
    }
    if (response.statusCode !== 200) {
      return log().warn(
        { body, code: response.statusCode },
        'Circonus replied with a non-200 response'
      );
    }

    return log().info('Sent %d metrics to circonus', metricsToSend);
  });
};

module.exports = {
  init,
  publish
};
