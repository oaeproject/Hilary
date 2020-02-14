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

import * as AuthzUtil from 'oae-authz/lib/util';
import { Validator } from 'oae-util/lib/validator';
import { compose, either, not, equals } from 'ramda';

/**
 * Checks whether or not the string in context is a valid principal id
 *
 * Usage:
 * ```
 * validator.isPrincipalId(principalId);
 * ```
 */
Validator.isPrincipalId = string => AuthzUtil.isPrincipalId(string);

/**
 * Checks whether or not the string in context is a valid group principal id
 *
 * Usage:
 * ```
 * validator.isGroupId(groupId);
 * ```
 */
Validator.isGroupId = string => AuthzUtil.isGroupId(string);

/**
 * Checks whether or not the string in context is a valid user principal id
 *
 * Usage:
 * ```
 * validator.isUserId(userId);
 * ```
 */
Validator.isUserId = string => AuthzUtil.isUserId(string);

/**
 * Checks whether or not the string in context is a resource id that is not a user id
 *
 * Usage:
 * ```
 * validator.isNonUserResourceId(resourceId);
 * ```
 */
Validator.isNonUserResourceId = string => {
  const isItNotResourceId = string => compose(not, AuthzUtil.isResourceId)(string);
  const isItUserId = string => AuthzUtil.isUserId(string);
  return compose(not, either(isItNotResourceId, isItUserId))(string);
};

/**
 * Checks whether or not the string in context is a valid resource id
 *
 * Usage:
 * ```
 * validator.isResourceId(resourceId);
 * ```
 */
Validator.isResourceId = string => AuthzUtil.isResourceId(string);

/**
 * Checks whether or not the specified object is a valid resource object
 *
 * Usage:
 * ```
 * validator.isResource(resource);
 * ```
 */
Validator.isResource = resource => AuthzUtil.isResource(resource);

/**
 * Checks whether or not the string in context is a valid role name
 *
 * Usage:
 * ```
 * validator.isValidRole(role);
 * ```
 */
Validator.isValidRole = string => AuthzUtil.isRole(string);

/**
 * Checks whether or not a set of principals and their new role is formatted correctly.
 * The difference with isValidRole is that this allows a false value as well, in case
 * of a role removal.
 *
 * Usage:
 * ```
 * validator.isValidRoleChange(newRole);
 * ```
 */
Validator.isValidRoleChange = string => {
  const isStringFalse = string => equals(string, false);
  return either(isStringFalse, AuthzUtil.isRole)(string);
};

/**
 * Checks whether or not a set of share targets are valid targets
 *
 * Usage:
 * ```
 * validator.isValidShareTarget(shareTargetStr);
 * ```
 *
 * @see AuthzUtil#parseShareTarget for specification
 */
Validator.isValidShareTarget = string => AuthzUtil.parseShareTarget(string);

export { Validator };
