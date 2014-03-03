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
 * An ORCID Access Token
 *
 * @param  {String}       accessToken    The ORCID access token (e.g. 7c2e9852-1de6-43df-b2da-f0f65b351b96)
 * @param  {Number}       expiryDate     The expiry date of the token in milliseconds (e.g. 1392316959923)
 * @return {AccessToken}                 An AccessToken model
 */
module.exports.AccessToken = function(accessToken, expiryDate) {
    var that = {};
    that.accessToken = accessToken;
    that.expiryDate = expiryDate;
    return that;
};
