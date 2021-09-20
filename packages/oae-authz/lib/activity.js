/*!
 * Copyright 2015 Apereo Foundation (AF) Licensed under the
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

import * as ActivityAPI from 'oae-activity/lib/api.js';
import { ActivityConstants } from 'oae-activity/lib/constants.js';
import * as ActivityModel from 'oae-activity/lib/model.js';
import { AuthzConstants } from 'oae-authz/lib/constants.js';
import * as ResourceActions from 'oae-resource/lib/actions.js';
import { ResourceConstants } from 'oae-resource/lib/constants.js';
import * as TenantsAPI from 'oae-tenants';

const init = (callback) => {
  /*!
   * Register an activity entity type of "email", which represents an external email rather than a
   * resource in the system
   */
  ActivityAPI.registerActivityEntityType('email', {
    transformer: {
      activitystreams(ctx, activityEntities, callback) {
        const currentUserId = ctx.user() && ctx.user().id;
        // eslint-disable-next-line no-unused-vars
        const transformedEntities = _.mapObject(activityEntities, (entities, activityId) => {
          return _.mapObject(entities, (entity) => {
            const { token, email } = entity.email;

            const tenant = TenantsAPI.getTenantByEmail(email);

            let globalId = null;
            const opts = { ext: {} };

            opts.ext[ActivityConstants.properties.OAE_TENANT] = tenant.compact();
            if (currentUserId === entity[ActivityConstants.properties.OAE_ID]) {
              // If the target user is the email address feed itself (i.e., the recipient
              // of an email), we can keep the email address on the transformed entity
              globalId = email;
              opts.ext[ActivityConstants.properties.OAE_ID] = email;
              opts.ext[ActivityConstants.properties.OAE_EMAIL] = email;
              opts.ext[ActivityConstants.properties.OAE_TOKEN] = token;
            }

            return new ActivityModel.ActivityEntity('email', globalId, null, opts);
          });
        });

        return callback(null, transformedEntities);
      },
      internal(ctx, activityEntities, callback) {
        const currentUserId = ctx.user() && ctx.user().id;
        // eslint-disable-next-line no-unused-vars
        const transformedEntities = _.mapObject(activityEntities, (entities, activityId) => {
          return _.mapObject(entities, (entity) => {
            const email = entity[ActivityConstants.properties.OAE_ID];

            const transformedEntity = {};
            if (currentUserId === entity[ActivityConstants.properties.OAE_ID]) {
              // If the target user is the email address feed itself (i.e., the recipient
              // of an email), we can keep the email address on the transformed entity
              _.extend(transformedEntity, {
                email
              });
            }

            return transformedEntity;
          });
        });

        return callback(null, transformedEntities);
      }
    },
    propagation(associationsCtx, entity, callback) {
      /*!
       * TODO: We say an email entity can only be propagated to itself, due to lack of obfuscation
       * on the email. This is OK currently because email resources are only delivered in "invite"
       * activities, and we do not deliver invite activities to anyone but the recipient of the
       * email. This is an aggressive approach to ensure we don't leak email address to, for
       * example, members of groups.
       *
       * If we want to expand this propagation to allow activities containing email recipients to
       * be routed to larger audiences, the following must happen:
       *
       *  1.  The "id" of the entity (e.g., the entity id and the route id) MUST be changed to
       *      something that is a unique obfuscation of the email. For example, a sha1 hash salted
       *      by the domain would likely work (i.e., "mrvisser@gmail.com" ->
       *      "sha1('mrvisser@gmail.com')@gmail.com" -> "abcdefabcdef1234567890@gmail.com")
       *  2.  The "oae:email" field must always exist on the entity however for any user in
       *      context that is not the recipient of the email itself (or someone who does not have
       *      a verified email that is the email address itself), we use only the first character
       *      of the email username, followed by an ellipses (i.e., "mrvisser@gmail.com" ->
       *      "m...@gmail.com")
       *
       * Once the above 2 obfuscation approaches are taken, we should be able to expand this
       * propagation rule to ALL.
       */
      return callback(null, [{ type: ActivityConstants.entityPropagation.SELF }]);
    }
  });

  /*!
   * Register the "self" association for the email, which specifies only the email resource itself as
   * a potentital recipient
   */
  ActivityAPI.registerActivityEntityAssociation(
    'email',
    'self',
    (associationsCtx, entity, callback) => {
      return callback(null, [entity[ActivityConstants.properties.OAE_ID]]);
    }
  );

  /// //////////////////
  // INVITE ACTIVITY //
  /// //////////////////

  /*!
   * Indicates that some user (the actor) has invited some email (the object) into some resource in
   * the system (the target)
   */
  ActivityAPI.registerActivityType(AuthzConstants.activity.ACTIVITY_INVITE, {
    groupBy: [{ actor: true, object: true, target: 'objectType' }],
    streams: {
      email: {
        router: {
          object: ['self']
        }
      }
    }
  });

  /*!
   * When an email has been invited, emit the "invited" activity for each resource to which the email
   * was invited into
   */
  ResourceActions.emitter.on(ResourceConstants.events.INVITED, (ctx, invitations, emailTokens) => {
    const millis = Date.now();
    const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {
      user: ctx.user()
    });
    _.chain(invitations)
      .map((invitation) => {
        const { email } = invitation;
        const objectResource = new ActivityModel.ActivitySeedResource('email', invitation.email, {
          email: {
            email,
            token: emailTokens[email]
          }
        });
        const targetResource = ActivityModel.ActivitySeedResource.fromResource(invitation.resource);
        return new ActivityModel.ActivitySeed(
          AuthzConstants.activity.ACTIVITY_INVITE,
          millis,
          ActivityConstants.verbs.INVITE,
          actorResource,
          objectResource,
          targetResource
        );
      })
      .each((activitySeed) => {
        ActivityAPI.postActivity(ctx, activitySeed);
      })
      .value();
  });

  /// /////////////////////////////
  // INVITATION ACCEPT ACTIVITY //
  /// /////////////////////////////

  /*!
   * Indicates some user (actor) accepted an invitation from another user (object) into some resource
   * (target). I think idealistically, we would have an "invitation" entity type to place in the
   * object of the activity which would encompass the inviter as well as the role, however the
   * inviter was chosen as the object as it is easier
   */
  ActivityAPI.registerActivityType(AuthzConstants.activity.ACTIVITY_INVITATION_ACCEPT, {
    groupBy: [{ actor: true, object: true, target: 'objectType' }],
    streams: {
      activity: {
        router: {
          actor: ['self'],
          object: ['self'],
          target: ['self', 'managers']
        }
      },
      notification: {
        router: {
          object: ['self']
        }
      },
      email: {
        router: {
          object: ['self']
        }
      }
    }
  });

  return callback();
};

export { init };
