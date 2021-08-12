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

import _ from 'underscore';
import locale from 'locale';

import * as OAE from 'oae-util/lib/oae.js';

import * as UserRESTEndpoints from 'oae-principals/lib/rest.user.js';
import * as GroupRESTEndpoints from 'oae-principals/lib/rest.group.js';

import * as userConfig from '../config/user.js';
import PrincipalsAPI from './api.js';

/**
 * Locale
 */
let languages = userConfig.user.elements.defaultLanguage.list;

// Make languages into an array of just the values as that's what locale needs
languages = _.map(languages, (lang) => {
  return lang.value;
});

// Use the locale middleware
OAE.tenantServer.use(locale(languages));

/*!
 * Copy the request locale into the context
 */
OAE.tenantServer.use((request, response, next) => {
  // The `locale` middleware will have added a `rawLocale` property. The `rawLocale.defaulted`
  // property indicates whether or not a best match was found
  request.ctx.locale(request.rawLocale);
  return next();
});

/**
 * Terms and conditions
 */

/*!
 * Adds middleware that will check if the user has accepted the Terms and Conditions, if enabled.
 * If the user hasn't accepted the Terms and Conditions, all POST requests (excluding whitelisted post requests) will be prevented.
 */
OAE.tenantServer.use((request, response, next) => {
  const { ctx } = request;
  const user = ctx.user();

  // The Terms and Conditions middleware is only applicable on logged in users who try to interact with the system
  // excluding a set of whitelisted endpoints
  if (
    user &&
    !_.contains(['GET', 'HEAD'], request.method) &&
    PrincipalsAPI.needsToAcceptTermsAndConditions(ctx) &&
    !_isWhiteListed(request.path)
  ) {
    return response
      .status(419)
      .send('You need to accept the Terms and Conditions before you can interact with this tenant');
  }

  return next();
});

/**
 * Checks if a URL is whitelisted from the Terms and Conditions requirements
 *
 * @param  {String}     url     The URL to check
 * @return {Boolean}            `true` if the user doesn't have to accept the Terms and Conditions in order to POST to this url, `false` otherwise
 * @api private
 */
const _isWhiteListed = function (url) {
  return url.indexOf('/api/auth') === 0 || url.indexOf('/api/user') === 0;
};

/// /////////////////
// REST ENDPOINTS //
/// /////////////////

/**
 * @REST postCrop
 *
 * Crop the large picture for a principal
 *
 * @Server      tenant
 * @Method      POST
 * @Path        /crop
 * @FormParam   {string}        principalId             The id of the group to crop the picture for
 * @FormParam   {number}        width                   The width of the square that needs to be cropped out
 * @FormParam   {number}        x                       The x coordinate of the top left corner to start cropping at
 * @FormParam   {number}        y                       The y coordinate of the top left corner to start cropping at
 * @Return      {Principal}                             The updated principal
 * @HttpResponse                200                     Picture updated
 * @HttpResponse                400                     A principal id must be provided
 * @HttpResponse                400                     The width value must be a positive integer
 * @HttpResponse                400                     The x value must be a positive integer
 * @HttpResponse                400                     The y value must be a positive integer
 * @HttpResponse                400                     This principal has no large picture
 * @HttpResponse                401                     You have to be logged in to be able to update a picture
 */
OAE.tenantRouter.on('post', '/api/crop', (request, response) => {
  PrincipalsAPI.generateSizes(
    request.ctx,
    request.body.principalId,
    request.body.x,
    request.body.y,
    request.body.width,
    (error, data) => {
      if (error) {
        return response.status(error.code).send(error.msg);
      }

      return response.status(200).send(data);
    }
  );
});
