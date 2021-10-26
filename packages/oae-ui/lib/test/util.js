/*
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

import _ from 'underscore';
import * as ConfigTestUtil from 'oae-config/lib/test/util.js';
import * as UIAPI from 'oae-ui';

/**
 * Updates the skin variables for a tenant and waits till the CSS has been regenerated.
 *
 * @param  {RestContext}    restCtx             The RestContext to make to post with. This should be a global or tenant admin.
 * @param  {String}         tenantAlias         The alias of the tenant for which the skin should be changed.
 * @param  {Object}         skinConfig          The config that contains the CSS variables.
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {Object}         callback.response   The response from the Config REST API.
 */
const updateSkinAndWait = function (restCtx, tenantAlias, skinConfig, callback) {
  let calledBack = false;
  let requestReturned = false;
  let skinFileParsed = false;

  let responseArgs = null;

  /*!
   * Monitors the result of both the updateConfig web request and the internal `skinParsed` event
   * to only callback when both the request has executed completely and the asynchronous parse process
   * has completed.
   *
   * @param  {Object}     err     An error that occured in either request
   */
  const _callback = function (error) {
    if (calledBack) {
      // Already called back, do nothing
    } else if (error) {
      // Received an error from either rest endpoint or skin parse, throw the error
      calledBack = true;
      return callback(error);
    } else if (requestReturned && skinFileParsed) {
      // Call the callback with the arguments from the web request
      calledBack = true;
      return callback(null, responseArgs);
    }
  };

  const configUpdate = {};
  _.each(skinConfig, (value, key) => {
    configUpdate['oae-ui/skin/variables/' + key] = value;
  });
  ConfigTestUtil.updateConfigAndWait(restCtx, tenantAlias, configUpdate, (...args) => {
    const error = _.first(args);
    if (error) {
      // Remove this listener, since it may not be invoked and "leak" due to this error
      UIAPI.emitter.removeListener('skinParsed', _updateListener);
      return _callback(error);
    }

    responseArgs = args;
    requestReturned = true;
    return _callback();
  });

  /*!
   * Handles the `skinParsed` event, simply notifying the `_callback` that the skin has been parsed.
   *
   * @see UIAPI events for parameter description
   */
  const _updateListener = function () {
    skinFileParsed = true;
    return _callback();
  };

  UIAPI.emitter.once('skinParsed', _updateListener);
};

export { updateSkinAndWait };
