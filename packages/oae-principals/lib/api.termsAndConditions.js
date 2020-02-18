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

/* eslint-disable unicorn/filename-case */
import { setUpConfig } from 'oae-config';
import { Validator as validator } from 'oae-util/lib/validator';
const { isUserId, isLoggedInUser, otherwise } = validator;
import { pipe, not } from 'ramda';

import * as AuthzUtil from 'oae-authz/lib/util';
import * as PrincipalsDAO from './internal/dao';
import * as PrincipalsUtil from './util';

const PrincipalsConfig = setUpConfig('oae-principals');

/**
 * Get the Terms and Conditions text for a tenant.
 * If no locale is provided the following will be applied to get a suitable locale:
 *
 * * If the user is logged in, try to get it from the user object
 * * Check the locale on the context
 * * Fall back to the Terms and Conditions as specified in the `default` locale
 *
 * If a locale was specified or retrieved from the user/context but no Terms and Conditions are available in that locale
 * the Terms and Conditions as specified in the `default` locale will be returned
 *
 * @param  {Context}    ctx             Standard context object containing the current user and the current tenant
 * @param  {String}     [locale]        The locale in which the Terms and Conditions should be retrieved. Defaults to the default Terms and Conditions
 * @return {Object}                     An object that holds a `text` key with the Terms and Conditions in the requested locale and a `lastUpdate` key that holds the timestamp when the config was last updated
 */
const getTermsAndConditions = function(ctx, locale) {
  locale = locale || ctx.resolvedLocale();

  // Grab the internationalizable field. This will return an object with each Terms and Conditions keyed against its locale
  const termsAndConditions = PrincipalsConfig.getValue(ctx.tenant().alias, 'termsAndConditions', 'text');

  return {
    text: termsAndConditions[locale] || termsAndConditions.default,
    lastUpdate: PrincipalsConfig.getLastUpdated(ctx.tenant().alias, 'termsAndConditions', 'text').getTime()
  };
};

/**
 * Accept the Terms and Conditions
 *
 * @param  {String}     userId          The id of the user accepting the Terms and Conditions
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {User}       callback.user   The updated user
 */
const acceptTermsAndConditions = function(ctx, userId, callback) {
  // One cannot accept the Terms and Conditions if it has not been enabled
  const isDisabled = not(PrincipalsConfig.getValue(ctx.tenant().alias, 'termsAndConditions', 'enabled'));
  if (isDisabled) {
    return callback({
      code: 400,
      msg: 'The Terms and Conditions are not enabled, there is no need to accept them'
    });
  }

  // Perform some basic validation
  try {
    pipe(
      isUserId,
      otherwise({
        code: 400,
        msg: 'Invalid userId passed in'
      })
    )(userId);

    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'Only logged in users can accept the Terms and Conditions'
      })
    )(ctx);
  } catch (error) {
    return callback(error);
  }

  // Only a tenant/global admin or the user themself can accept the Terms and Conditions
  const userTenant = AuthzUtil.getPrincipalFromId(userId).tenantAlias;
  if (ctx.user().id === userId || ctx.user().isAdmin(userTenant)) {
    // Accept the Terms and Conditions
    PrincipalsDAO.acceptTermsAndConditions(userId, err => {
      if (err) {
        return callback(err);
      }

      // Retrieve the updated User object and return it
      PrincipalsUtil.getPrincipal(ctx, userId, callback);
    });
  } else {
    return callback({
      code: 401,
      msg: 'You are not authorized to accept the Terms and Conditions on behalf of this user'
    });
  }
};

/**
 * Checks if a users needs to accept or re-accept the Terms and Conditions
 *
 * @param  {Context}    ctx         Standard context object containing the current user and the current tenant
 * @return {Boolean}                Whether or not the current user needs to accept or re-accept the Terms and Conditions
 */
const needsToAcceptTermsAndConditions = function(ctx) {
  // Anonymous users can't accept anything
  if (!ctx.user()) {
    return false;
  }

  // If the Terms and Conditions have not been enabled, the user can't accept anything
  const isEnabled = PrincipalsConfig.getValue(ctx.tenant().alias, 'termsAndConditions', 'enabled');
  if (!isEnabled) {
    return false;
  }

  // Admins don't need to accept anything either
  if (ctx.user().isAdmin(ctx.tenant().alias)) {
    return false;
  }

  // This tenant has Terms and Conditions. We need to check the user has accepted the Terms and Conditions since the last time the Terms and Conditions were updated
  const lastUpdated = PrincipalsConfig.getLastUpdated(ctx.tenant().alias, 'termsAndConditions', 'text');
  return ctx.user().acceptedTC < lastUpdated.getTime();
};

export { getTermsAndConditions, acceptTermsAndConditions, needsToAcceptTermsAndConditions };
