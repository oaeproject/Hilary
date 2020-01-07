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

import util from 'util';
import * as VersionAPI from 'oae-version';

import oauth from 'oauth-sign';
import ShortId from 'shortid';

import * as AuthzPermissions from 'oae-authz/lib/permissions';
import * as AuthzUtil from 'oae-authz/lib/util';
import { logger } from 'oae-logger';
import PrincipalsApi from 'oae-principals';
import { Validator as validator } from 'oae-authz/lib/validator';
import pipe from 'ramda/src/pipe';

import * as LtiDAO from './internal/dao';
import { LtiToolLaunchParams, LtiLaunchParams } from './model';

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
const getLtiTool = function(ctx, id, groupId, callback) {
  PrincipalsApi.getFullGroupProfile(ctx, groupId, (err, group) => {
    if (err) {
      return callback(err);
    }

    if (!group.isManager && !group.isMember) {
      return callback({ code: 401, msg: 'The current user does not have access to this LTI tool' });
    }

    PrincipalsApi.getMe(ctx, (err, principal) => {
      if (err) {
        return callback(err);
      }

      VersionAPI.getVersionCB((err, gitRepoInformation) => {
        if (err) {
          log().warn('Failed to fetch OAE version');
          version = '';
        }

        const hilaryRepoInfo = gitRepoInformation.get('Hilary');
        let version = hilaryRepoInfo.latestTag;

        LtiDAO.getLtiTool(id, groupId, (err, tool) => {
          if (err) {
            log().error(
              {
                err
              },
              'Failed to fetch existing LTI tool'
            );
            return callback(err);
          }

          // Const {  secret,  launchUrl } = tool; // The URL under which the LTI tool reside and the LTI oauth secret

          const launchParams = new LtiLaunchParams(
            tool,
            version,
            group.tenant.alias,
            group.displayName,
            group.isManager,
            groupId,
            principal
          );

          // eslint-disable-next-line camelcase
          launchParams.oauth_signature = oauth.hmacsign('POST', tool.launchUrl, launchParams, tool.secret, '');

          // Scrub out OAUTH parameters from tool
          delete tool.secret;
          delete tool.consumerKey;

          // Add isManager and owner
          tool.isManager = principal.isGlobalAdmin || principal.isTenantAdmin;
          tool.owner = group;
          return callback(null, new LtiToolLaunchParams(tool, launchParams));
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
const addLtiTool = function(ctx, groupId, launchUrl, secret, consumerKey, opts, callback) {
  // Ensure the target group exists and has not been deleted
  PrincipalsApi.getGroup(ctx, groupId, (err, group) => {
    if (err) {
      return callback(err);
    }

    if (group.deleted) {
      return callback({ code: 404, msg: util.format("Couldn't find group: %s", groupId) });
    }

    PrincipalsApi.getMe(ctx, (err, me) => {
      if (err) {
        return callback(err);
      }

      if (!me.isTenantAdmin && !me.isGlobalAdmin) {
        return callback({
          code: 401,
          msg: 'The current user is not authorized to create an LTI tool'
        });
      }

      // Check if we can add tools to this group
      AuthzPermissions.canManage(ctx, group, err => {
        if (err) {
          return callback(err);
        }

        // Parameter validation
        pipe(
          validator.isGroupId,
          validator.generateError({
            code: 400,
            msg: 'A valid group id must be provided'
          }),
          validator.finalize(callback)
        )(groupId);

        pipe(
          validator.isNotEmpty,
          validator.generateError({
            code: 400,
            msg: 'You need to provide a launch URL for this LTI tool'
          }),
          validator.finalize(callback)
        )(launchUrl);

        pipe(
          validator.isNotEmpty,
          validator.generateError({
            code: 400,
            msg: 'You need to provide an OAUTH secret for this LTI tool'
          }),
          validator.finalize(callback)
        )(secret);

        pipe(
          validator.isNotEmpty,
          validator.generateError({
            code: 400,
            msg: 'You need to provide an OAUTH consumer key for this LTI tool'
          }),
          validator.finalize(callback)
        )(consumerKey);

        const id = AuthzUtil.toId('lti', group.tenant.alias, ShortId.generate());

        LtiDAO.createLtiTool(
          id,
          groupId,
          launchUrl,
          secret,
          consumerKey,
          opts.displayName,
          opts.description,
          (err, tool) => {
            if (err) {
              log().error(
                {
                  err,
                  groupId,
                  id
                },
                'Error creating LTI tool'
              );
              return callback(err);
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
const getLtiTools = function(ctx, groupId, callback) {
  // Ensure the target group exists and has not been deleted
  PrincipalsApi.getGroup(ctx, groupId, (err, group) => {
    if (err) {
      return callback(err);
    }

    if (group.deleted) {
      return callback({ code: 404, msg: util.format("Couldn't find group: %s", groupId) });
    }

    LtiDAO.getLtiToolsByGroupId(groupId, (err, tools) => {
      if (err) {
        log().error(
          {
            err
          },
          'Failed to fetch existing LTI tools'
        );
        return callback(err);
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
const deleteLtiTool = function(ctx, id, groupId, callback) {
  // Ensure the target group exists and has not been deleted
  PrincipalsApi.getGroup(ctx, groupId, (err, group) => {
    if (err) {
      return callback(err);
    }

    if (group.deleted) {
      return callback({ code: 404, msg: util.format("Couldn't find group: %s", groupId) });
    }

    // Check if we can delete tools in this group
    AuthzPermissions.canManage(ctx, group, err => {
      if (err) {
        return callback(err);
      }

      LtiDAO.deleteLtiTool(id, groupId, err => {
        if (err) {
          log().error(
            {
              err
            },
            'Could not delete new LTI tool'
          );
          return callback(err);
        }

        return callback();
      });
    });
  });
};

export { getLtiTool, addLtiTool, getLtiTools, deleteLtiTool };
