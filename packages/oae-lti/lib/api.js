/*!
 * Copyright 2017 Apereo Foundation (AF) Licensed under the
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
import * as VersionAPI from 'oae-version';

import oauth from 'oauth-sign';
import ShortId from 'shortid';

import * as AuthzPermissions from 'oae-authz/lib/permissions.js';
import * as AuthzUtil from 'oae-authz/lib/util.js';
import { logger } from 'oae-logger';
import PrincipalsApi from 'oae-principals';
import { Validator as validator } from 'oae-authz/lib/validator.js';

import * as LtiDAO from './internal/dao.js';
import { LtiToolLaunchParams, LtiLaunchParams } from './model.js';

const { isGroupId, unless, isNotEmpty } = validator;

const log = logger('oae-lti');

/**
 * Get the parameters required to launch an LTI tool
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     id                  The id of the LTI tool to be launched
 * @param  {String}     groupId             The group linked to the LTI tool to be launched
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {User[]}     callback.params     The parameters for an LTI tool launch
 */
const getLtiTool = function (ctx, id, groupId, callback) {
  PrincipalsApi.getFullGroupProfile(ctx, groupId, (error, group) => {
    if (error) {
      return callback(error);
    }

    if (!group.isManager && !group.isMember) {
      return callback({ code: 401, msg: 'The current user does not have access to this LTI tool' });
    }

    PrincipalsApi.getMe(ctx, (error, principal) => {
      if (error) {
        return callback(error);
      }

      VersionAPI.getVersionCB((error, gitRepoInformation) => {
        if (error) {
          log().warn('Failed to fetch OAE version');
          version = '';
        }

        const hilaryRepoInfo = gitRepoInformation.get('Hilary');
        let version = hilaryRepoInfo.latestTag;

        LtiDAO.getLtiTool(id, groupId, (error, tool) => {
          if (error) {
            log().error(
              {
                err: error
              },
              'Failed to fetch existing LTI tool'
            );
            return callback(error);
          }

          // Const {  secret,  launchUrl } = tool; // The URL under which the LTI tool reside and the LTI oauth secret

          const launchParameters = new LtiLaunchParams(
            tool,
            version,
            group.tenant.alias,
            group.displayName,
            group.isManager,
            groupId,
            principal
          );

          // eslint-disable-next-line camelcase
          launchParameters.oauth_signature = oauth.hmacsign('POST', tool.launchUrl, launchParameters, tool.secret, '');

          // Scrub out OAUTH parameters from tool
          delete tool.secret;
          delete tool.consumerKey;

          // Add isManager and owner
          tool.isManager = principal.isGlobalAdmin || principal.isTenantAdmin;
          tool.owner = group;
          return callback(null, new LtiToolLaunchParams(tool, launchParameters));
        });
      });
    });
  });
};

/**
 * Create a new LTI tool linked to a group
 *
 * @param  {Context}    ctx                  Standard context object containing the current user and the current tenant
 * @param  {String}     groupId              The id of the group the LTI tool will be linked to
 * @param  {String}     launchUrl            The URL from which the LTI tool will launch
 * @param  {String}     secret               The OAUTH secret for the LTI tool
 * @param  {String}     consumerKey          The OAUTH consumer key for the LTI tool
 * @param  {Object}     [opts]               Additional optional LTI tool attributes
 * @param  {String}     [opts.displayName]   The name of the new LTI tool
 * @param  {String}     [opts.description]   A description of the new LTI tool
 * @param  {Function}   [callback]           Standard callback function
 * @param  {Object}     [callback.err]       An error that occurred, if any
 * @param  {Message}    [callback.tool]      The LTI tool model object that was persisted
 */
const addLtiTool = function (ctx, groupId, launchUrl, secret, consumerKey, options, callback) {
  // Ensure the target group exists and has not been deleted
  PrincipalsApi.getGroup(ctx, groupId, (error, group) => {
    if (error) {
      return callback(error);
    }

    if (group.deleted) {
      return callback({ code: 404, msg: format("Couldn't find group: %s", groupId) });
    }

    PrincipalsApi.getMe(ctx, (error, me) => {
      if (error) {
        return callback(error);
      }

      if (!me.isTenantAdmin && !me.isGlobalAdmin) {
        return callback({
          code: 401,
          msg: 'The current user is not authorized to create an LTI tool'
        });
      }

      // Check if we can add tools to this group
      AuthzPermissions.canManage(ctx, group, (error_) => {
        if (error_) {
          return callback(error_);
        }

        // Parameter validation
        try {
          unless(isGroupId, {
            code: 400,
            msg: 'A valid group id must be provided'
          })(groupId);

          unless(isNotEmpty, {
            code: 400,
            msg: 'You need to provide a launch URL for this LTI tool'
          })(launchUrl);

          unless(isNotEmpty, {
            code: 400,
            msg: 'You need to provide an OAUTH secret for this LTI tool'
          })(secret);

          unless(isNotEmpty, {
            code: 400,
            msg: 'You need to provide an OAUTH consumer key for this LTI tool'
          })(consumerKey);
        } catch (error) {
          return callback(error);
        }

        const id = AuthzUtil.toId('lti', group.tenant.alias, ShortId.generate());

        LtiDAO.createLtiTool(
          id,
          groupId,
          launchUrl,
          secret,
          consumerKey,
          options.displayName,
          options.description,
          (error, tool) => {
            if (error) {
              log().error(
                {
                  err: error,
                  groupId,
                  id
                },
                'Error creating LTI tool'
              );
              return callback(error);
            }

            return callback(null, tool);
          }
        );
      });
    });
  });
};

/**
 * Get a list of LTI tools belonging to a group.
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}     groupId             The id of the group the LTI tool will be linked to
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Message[]}  callback.tools      An array of LTI tools
 */
const getLtiTools = function (ctx, groupId, callback) {
  // Ensure the target group exists and has not been deleted
  PrincipalsApi.getGroup(ctx, groupId, (error, group) => {
    if (error) {
      return callback(error);
    }

    if (group.deleted) {
      return callback({ code: 404, msg: format("Couldn't find group: %s", groupId) });
    }

    LtiDAO.getLtiToolsByGroupId(groupId, (error, tools) => {
      if (error) {
        log().error(
          {
            err: error
          },
          'Failed to fetch existing LTI tools'
        );
        return callback(error);
      }

      return callback(null, tools);
    });
  });
};

/**
 * Delete an LTI tool from storage.
 *
 * @param  {Context}     ctx                 Standard context object containing the current user and the current tenant
 * @param  {String}      id                  The id of the LTI tool to be deleted
 * @param  {String}      groupId             The id of the group the LTI tool will be linked to
 * @param  {Function}    callback            Standard callback function
 * @param  {Object}      callback.err        An error that occurred, if any
 */
const deleteLtiTool = function (ctx, id, groupId, callback) {
  // Ensure the target group exists and has not been deleted
  PrincipalsApi.getGroup(ctx, groupId, (error, group) => {
    if (error) {
      return callback(error);
    }

    if (group.deleted) {
      return callback({ code: 404, msg: format("Couldn't find group: %s", groupId) });
    }

    // Check if we can delete tools in this group
    AuthzPermissions.canManage(ctx, group, (error_) => {
      if (error_) {
        return callback(error_);
      }

      LtiDAO.deleteLtiTool(id, groupId, (error_) => {
        if (error_) {
          log().error(
            {
              err: error_
            },
            'Could not delete new LTI tool'
          );
          return callback(error_);
        }

        return callback();
      });
    });
  });
};

export { getLtiTool, addLtiTool, getLtiTools, deleteLtiTool };
