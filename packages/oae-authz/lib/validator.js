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

// import util from 'util';

// import { AuthzConstants } from 'oae-authz/lib/constants';
import * as AuthzUtil from 'oae-authz/lib/util';
import { Validator } from 'oae-util/lib/validator';

/**
 * Checks whether or not the string in context is a valid principal id
 *
 * Usage:
 * ```
 * var validator = new Validator();
 * validator.check(principalId, error).isPrincipalId();
 * ```
 */
Validator.isPrincipalId = function(string) {
  /*
  if (!AuthzUtil.isPrincipalId(this.str)) {
    this.error(this.msg || 'An invalid principal id was provided');
  }
  */
  return AuthzUtil.isPrincipalId(string);
};

/**
 * Checks whether or not the string in context is a valid group principal id
 *
 * Usage:
 * ```
 * var validator = new Validator();
 * validator.check(groupId, error).isGroupId();
 * ```
 */
Validator.isGroupId = function(string) {
  if (!AuthzUtil.isGroupId(string)) {
    // this.error(this.msg || 'An invalid group id was provided');
    return false;
  }

  return true;
};

/**
 * Checks whether or not the string in context is a valid user principal id
 *
 * Usage:
 * ```
 * var validator = new Validator();
 * validator.check(userId, error).isUserId();
 * ```
 */
Validator.isUserId = string => {
  /*
  if (!AuthzUtil.isUserId(string)) {
    this.error(this.msg || 'An invalid user id was provided');
  }
  */

  return AuthzUtil.isUserId(string);
};

/**
 * Checks whether or not the string in context is a resource id that is not a user id
 *
 * Usage:
 * ```
 * var validator = new Validator();
 * validator.check(resourceId, error).isNonUserResourceId();
 * ```
 */
Validator.isNonUserResourceId = function(string) {
  if (AuthzUtil.isUserId(string) || !AuthzUtil.isResourceId(string)) {
    // this.error(this.msg || 'An invalid non-user resource id was provided');
    return false;
  }

  return true;
};

/**
 * Checks whether or not the string in context is a valid resource id
 *
 * Usage:
 * ```
 * var validator = new Validator();
 * validator.check(resourceId, error).isResourceId();
 * ```
 */
Validator.isResourceId = function(string) {
  if (!AuthzUtil.isResourceId(string)) {
    // this.error(this.msg || 'An invalid resource id was provided');
    return false;
  }

  return true;
};

/**
 * Checks whether or not the specified object is a valid resource object
 *
 * Usage:
 * ```
 * var validator = new Validator();
 * validator.check(null, error).isResource(resource);
 * ```
 */
Validator.isResource = function(resource) {
  if (!AuthzUtil.isResource(resource)) {
    // this.error(this.msg || 'An invalid resource was provided');
    return false;
  }

  return true;
};

/**
 * Checks whether or not the string in context is a valid role name
 *
 * Usage:
 * ```
 * var validator = new Validator();
 * validator.check(role, error).isValidRole();
 * ```
 */
Validator.isValidRole = function(string) {
  if (!AuthzUtil.isRole(string)) {
    // this.error(this.msg || util.format('A role must be one of: %s', AuthzConstants.role.ALL_PRIORITY.join(', ')));
    return false;
  }

  return true;
};

/**
 * Checks whether or not a set of principals and their new role is formatted correctly.
 * The difference with isValidRole is that this allows a false value as well, in case
 * of a role removal.
 *
 * Usage:
 * ```
 * var validator = new Validator();
 * validator.check(newRole, error).isValidRoleChange();
 * ```
 */
Validator.isValidRoleChange = function(string) {
  if (string !== false && !AuthzUtil.isRole(string)) {
    /*
    this.error(
      this.msg ||
        util.format('A role change must either be false, or one of: %s', AuthzConstants.role.ALL_PRIORITY.join(', '))
    );
    */
    return false;
  }

  return true;
};

/**
 * Checks whether or not a set of share targets are valid targets
 *
 * Usage:
 * ```
 * var validator = new Validator();
 * validator.check(shareTargetStr, error).isValidShareTarget();
 * ```
 *
 * @see AuthzUtil#parseShareTarget for specification
 */
Validator.isValidShareTarget = function(string) {
  if (!AuthzUtil.parseShareTarget(string)) {
    /*
    this.error(
      this.msg ||
        'Members must be either an email, a principal id, or an email combined with a user id separated by a ":" (e.g., me@myemail.com:u:oae:abc123)'
    );
    */
    return false;
  }

  return true;
};

export { Validator };
