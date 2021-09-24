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

import * as ActivityAPI from 'oae-activity/lib/api.js';
import * as ActivityModel from 'oae-activity/lib/model.js';
import * as ActivityUtil from 'oae-activity/lib/util.js';
import { emitter } from 'oae-principals';
import * as PrincipalsDAO from 'oae-principals/lib/internal/dao.js';
import * as PrincipalsUtil from 'oae-principals/lib/util.js';

import { ActivityConstants } from 'oae-activity/lib/constants.js';
import { PrincipalsConstants } from 'oae-principals/lib/constants.js';

/**
 * Group-create
 */

/*!
 * Fire the 'group-create' activity when a new group is created.
 */
emitter.on(
  PrincipalsConstants.events.CREATED_GROUP,
  // eslint-disable-next-line no-unused-vars
  (ctx, group, memberChangeInfo) => {
    const millis = Date.now();
    const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {
      user: ctx.user()
    });
    const objectResource = new ActivityModel.ActivitySeedResource('group', group.id, { group });
    const activitySeed = new ActivityModel.ActivitySeed(
      PrincipalsConstants.activity.ACTIVITY_GROUP_CREATE,
      millis,
      ActivityConstants.verbs.CREATE,
      actorResource,
      objectResource
    );
    ActivityAPI.postActivity(ctx, activitySeed);
  }
);

ActivityAPI.registerActivityType(PrincipalsConstants.activity.ACTIVITY_GROUP_CREATE, {
  groupBy: [{ actor: true }],
  streams: {
    activity: {
      router: {
        actor: ['self', 'followers'],
        object: ['self', 'members']
      }
    },
    notification: {
      router: {
        object: ['members']
      }
    },
    email: {
      router: {
        object: ['members']
      }
    }
  }
});

/// ///////////////////////////////////////////
// GROUP-UPDATE and GROUP-UPDATE-VISIBILITY //
/// ///////////////////////////////////////////

/*!
 * Fire the 'group-update' or 'group-update-visibility' activity when a group is updated.
 */
emitter.on(PrincipalsConstants.events.UPDATED_GROUP, (ctx, newGroup, oldGroup) => {
  const millis = Date.now();
  const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {
    user: ctx.user()
  });
  const objectResource = new ActivityModel.ActivitySeedResource('group', newGroup.id, {
    group: newGroup
  });

  // If just update the group's visibility, we want to fire off a special "changed visibility" activity instead of the normal "group update"
  let activityType = null;
  if (newGroup.visibility === oldGroup.visibility) {
    activityType = PrincipalsConstants.activity.ACTIVITY_GROUP_UPDATE;
  } else {
    activityType = PrincipalsConstants.activity.ACTIVITY_GROUP_UPDATE_VISIBILITY;
  }

  const activitySeed = new ActivityModel.ActivitySeed(
    activityType,
    millis,
    ActivityConstants.verbs.UPDATE,
    actorResource,
    objectResource
  );
  ActivityAPI.postActivity(ctx, activitySeed);
});

const _groupUpdateRouters = {
  streams: {
    activity: {
      router: {
        actor: ['self'],
        object: ['self', 'members']
      }
    },
    notification: {
      router: {
        object: ['managers']
      }
    },
    email: {
      router: {
        object: ['managers']
      }
    }
  }
};

ActivityAPI.registerActivityType(PrincipalsConstants.activity.ACTIVITY_GROUP_UPDATE, _groupUpdateRouters);
ActivityAPI.registerActivityType(PrincipalsConstants.activity.ACTIVITY_GROUP_UPDATE_VISIBILITY, _groupUpdateRouters);

/// ///////////////////////////////////////////////////////////
// GROUP-JOIN / GROUP-ADD-MEMBER / GROUP-UPDATE-MEMBER-ROLE //
/// ///////////////////////////////////////////////////////////

ActivityAPI.registerActivityType(PrincipalsConstants.activity.ACTIVITY_GROUP_JOIN, {
  // "5 users have joined GroupA"
  groupBy: [{ object: true }],
  streams: {
    activity: {
      router: {
        actor: ['self', 'followers'],
        object: ['self', 'managers']
      }
    },
    notification: {
      router: {
        object: ['managers']
      }
    },
    email: {
      router: {
        object: ['managers']
      }
    }
  }
});

ActivityAPI.registerActivityType(PrincipalsConstants.activity.ACTIVITY_GROUP_ADD_MEMBER, {
  groupBy: [{ actor: true, target: true }],
  streams: {
    activity: {
      router: {
        actor: ['self'],
        object: ['self', 'members', 'followers'],
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

ActivityAPI.registerActivityType(PrincipalsConstants.activity.ACTIVITY_GROUP_UPDATE_MEMBER_ROLE, {
  groupBy: [{ actor: true, target: true }],
  streams: {
    activity: {
      router: {
        actor: ['self'],
        object: ['self', 'members'],
        target: ['self', 'managers']
      }
    }
  }
});

ActivityAPI.registerActivityType(PrincipalsConstants.activity.ACTIVITY_REQUEST_TO_JOIN_GROUP, {
  groupBy: [{ object: true }],
  streams: {
    activity: {
      router: {
        actor: ['self'],
        object: ['self', 'managers']
      }
    },
    notification: {
      router: {
        object: ['managers']
      }
    }
  }
});

ActivityAPI.registerActivityType(PrincipalsConstants.activity.ACTIVITY_REQUEST_TO_JOIN_GROUP_REJECTED, {
  groupBy: [{ object: true, target: true }],
  streams: {
    activity: {
      router: {
        actor: ['self'],
        object: ['self']
      }
    },
    notification: {
      router: {
        object: ['self']
      }
    }
  }
});

/*!
 * Fire the group-add-member or group-update-member-role activity when someone adds members to a group or updates user roles
 */
emitter.on(PrincipalsConstants.events.UPDATED_GROUP_MEMBERS, (ctx, group, oldGroup, memberChangeInfo, opts) => {
  if (opts.invitation) {
    // If this member update came from an invitation, we bypass adding activity as there is a
    // dedicated activity for that
    return;
  }

  const addedMemberIds = _.pluck(memberChangeInfo.members.added, 'id');
  const updatedMemberIds = _.pluck(memberChangeInfo.members.updated, 'id');

  const millis = Date.now();
  const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {
    user: ctx.user()
  });
  const targetResource = new ActivityModel.ActivitySeedResource('group', group.id, { group });

  // Post "Add Member" activities for each new member
  _.each(addedMemberIds, (memberId) => {
    const objectResourceType = PrincipalsUtil.isGroup(memberId) ? 'group' : 'user';
    const objectResource = new ActivityModel.ActivitySeedResource(objectResourceType, memberId);
    const activitySeed = new ActivityModel.ActivitySeed(
      PrincipalsConstants.activity.ACTIVITY_GROUP_ADD_MEMBER,
      millis,
      ActivityConstants.verbs.ADD,
      actorResource,
      objectResource,
      targetResource
    );
    ActivityAPI.postActivity(ctx, activitySeed);
  });

  // Post "Update member role" activities for each membership update
  _.each(updatedMemberIds, (memberId) => {
    const objectResourceType = PrincipalsUtil.isGroup(memberId) ? 'group' : 'user';
    const objectResource = new ActivityModel.ActivitySeedResource(objectResourceType, memberId);
    const activitySeed = new ActivityModel.ActivitySeed(
      PrincipalsConstants.activity.ACTIVITY_GROUP_UPDATE_MEMBER_ROLE,
      millis,
      ActivityConstants.verbs.UPDATE,
      actorResource,
      objectResource,
      targetResource
    );
    ActivityAPI.postActivity(ctx, activitySeed);
  });
});

/*!
 * Fire the group-join activity when someone joins a group
 */
emitter.on(
  PrincipalsConstants.events.JOINED_GROUP,
  // eslint-disable-next-line no-unused-vars
  (ctx, group, oldGroup, memberChangeInfo) => {
    const millis = Date.now();
    const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {
      user: ctx.user()
    });
    const objectResource = new ActivityModel.ActivitySeedResource('group', group.id, { group });
    ActivityAPI.postActivity(
      ctx,
      new ActivityModel.ActivitySeed(
        PrincipalsConstants.activity.ACTIVITY_GROUP_JOIN,
        millis,
        ActivityConstants.verbs.JOIN,
        actorResource,
        objectResource
      )
    );
  }
);

/*!
 * Fire the request-group-join activity when someone wants to join a group
 */
// eslint-disable-next-line no-unused-vars
emitter.on(PrincipalsConstants.events.REQUEST_TO_JOIN_GROUP, function (ctx, group, oldGroup, memberChangeInfo) {
  const millis = Date.now();
  const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, { user: ctx.user() });
  const objectResource = new ActivityModel.ActivitySeedResource('group', group.id, { group });
  ActivityAPI.postActivity(
    ctx,
    new ActivityModel.ActivitySeed(
      PrincipalsConstants.activity.ACTIVITY_REQUEST_TO_JOIN_GROUP,
      millis,
      ActivityConstants.verbs.REQUEST,
      actorResource,
      objectResource
    )
  );
});

/*!
 * Fire the request-group-join activity when someone has been rejected to join a group
 */
emitter.on(PrincipalsConstants.events.REQUEST_TO_JOIN_GROUP_REJECTED, (ctx, group, requester) => {
  const now = Date.now();
  const actorResource = new ActivityModel.ActivitySeedResource('user', ctx.user().id, {
    user: ctx.user()
  });
  const objectResource = new ActivityModel.ActivitySeedResource('user', requester.id, {
    requester
  });
  const targetResource = new ActivityModel.ActivitySeedResource('group', group.id, { group });

  ActivityAPI.postActivity(
    ctx,
    new ActivityModel.ActivitySeed(
      PrincipalsConstants.activity.ACTIVITY_REQUEST_TO_JOIN_GROUP_REJECTED,
      now,
      ActivityConstants.verbs.REJECT,
      actorResource,
      objectResource,
      targetResource
    )
  );
});

/// ////////////////////////
// ACTIVITY ENTITY TYPES //
/// ////////////////////////

/*!
 * Create the 'user' activity entity
 * @see ActivityAPI#registerActivityEntityType
 */
const _userProducer = function (resource, callback) {
  const user = resource.resourceData ? resource.resourceData.user : null;

  // If the user was provided in the resource data, use it instead of fetching
  if (user) {
    return callback(null, PrincipalsUtil.createPersistentUserActivityEntity(user.id, user));
  }

  // We didn't have a user to work with, fetch it and produce the persistent entity
  PrincipalsDAO.getPrincipal(resource.resourceId, (err, user) => {
    if (err) {
      return callback(err);
    }

    return callback(null, PrincipalsUtil.createPersistentUserActivityEntity(user.id, user));
  });
};

/*!
 * Transform the user persistent activity entities into UI-friendly ones
 * @see ActivityAPI#registerActivityEntityType
 */
const _userTransformer = function (ctx, activityEntities, callback) {
  const transformedActivityEntities = {};
  _.keys(activityEntities).forEach((activityId) => {
    transformedActivityEntities[activityId] = transformedActivityEntities[activityId] || {};
    _.keys(activityEntities[activityId]).forEach((entityId) => {
      const entity = activityEntities[activityId][entityId];
      transformedActivityEntities[activityId][entityId] = PrincipalsUtil.transformPersistentUserActivityEntity(
        ctx,
        entityId,
        entity.user
      );
    });
  });
  return callback(null, transformedActivityEntities);
};

/*!
 * Transform the user persistent activity entities into their OAE profiles
 * @see ActivityAPI#registerActivityEntityType
 */
const _userInternalTransformer = function (ctx, activityEntities, callback) {
  const transformedActivityEntities = {};
  _.keys(activityEntities).forEach((activityId) => {
    transformedActivityEntities[activityId] = transformedActivityEntities[activityId] || {};
    _.keys(activityEntities[activityId]).forEach((entityId) => {
      const entity = activityEntities[activityId][entityId];
      transformedActivityEntities[activityId][entityId] =
        PrincipalsUtil.transformPersistentUserActivityEntityToInternal(ctx, entityId, entity.user);
    });
  });
  return callback(null, transformedActivityEntities);
};

/*!
 * Create the 'group' activity entity
 * @see ActivityAPI#registerActivityEntityType
 */
const _groupProducer = function (resource, callback) {
  const group = resource.resourceData ? resource.resourceData.group : null;

  // If the group was delivered with the resource, use it instead of fetching
  if (group) {
    return callback(null, PrincipalsUtil.createPersistentGroupActivityEntity(group.id, group));
  }

  // Only the group id was added to the resource, query the group
  PrincipalsDAO.getPrincipal(resource.resourceId, (err, group) => {
    if (err) {
      return callback(err);
    }

    return callback(null, PrincipalsUtil.createPersistentGroupActivityEntity(group.id, group));
  });
};

/*!
 * Transform the group persistent activity entities into UI-friendly ones
 * @see ActivityAPI#registerActivityEntityType
 */
const _groupTransformer = function (ctx, activityEntities, callback) {
  const transformedActivityEntities = {};
  _.keys(activityEntities).forEach((activityId) => {
    transformedActivityEntities[activityId] = transformedActivityEntities[activityId] || {};
    _.keys(activityEntities[activityId]).forEach((entityId) => {
      const entity = activityEntities[activityId][entityId];
      transformedActivityEntities[activityId][entityId] = PrincipalsUtil.transformPersistentGroupActivityEntity(
        ctx,
        entityId,
        entity.group
      );
    });
  });
  return callback(null, transformedActivityEntities);
};

/*!
 * Transform the group persistent activity entities into their OAE profiles
 * @see ActivityAPI#registerActivityEntityType
 */
const _groupInternalTransformer = function (ctx, activityEntities, callback) {
  const transformedActivityEntities = {};
  _.keys(activityEntities).forEach((activityId) => {
    transformedActivityEntities[activityId] = transformedActivityEntities[activityId] || {};
    _.keys(activityEntities[activityId]).forEach((entityId) => {
      const entity = activityEntities[activityId][entityId];
      transformedActivityEntities[activityId][entityId] =
        PrincipalsUtil.transformPersistentGroupActivityEntityToInternal(ctx, entityId, entity.group);
    });
  });
  return callback(null, transformedActivityEntities);
};

ActivityAPI.registerActivityEntityType('user', {
  producer: _userProducer,
  transformer: {
    activitystreams: _userTransformer,
    internal: _userInternalTransformer
  },
  propagation(associationsCtx, entity, callback) {
    // We propagate private users everywhere as the transformer will scrub sensitive information where necessary
    return callback(null, [{ type: ActivityConstants.entityPropagation.ALL }]);
  }
});

ActivityAPI.registerActivityEntityType('group', {
  producer: _groupProducer,
  transformer: {
    activitystreams: _groupTransformer,
    internal: _groupInternalTransformer
  },
  propagation(associationsCtx, entity, callback) {
    ActivityUtil.getStandardResourcePropagation(entity.group.visibility, entity.group.joinable, (err, propagation) => {
      if (err) {
        return callback(err);
      }

      // Groups also will allow managers of object and target entities of an activity know that they were interacted with
      propagation.push(
        {
          type: ActivityConstants.entityPropagation.EXTERNAL_ASSOCIATION,
          objectType: 'object',
          association: 'managers'
        },
        {
          type: ActivityConstants.entityPropagation.EXTERNAL_ASSOCIATION,
          objectType: 'target',
          association: 'managers'
        }
      );

      return callback(null, propagation);
    });
  }
});

/// ///////////////////////////////
// ACTIVITY ENTITY ASSOCIATIONS //
/// ///////////////////////////////

/*!
 * Register a user association that presents the user themself
 */
ActivityAPI.registerActivityEntityAssociation('user', 'self', (associationsCtx, entity, callback) => {
  return callback(null, [entity[ActivityConstants.properties.OAE_ID]]);
});

/*!
 * Register a group association that presents the group itself
 */
ActivityAPI.registerActivityEntityAssociation('group', 'self', (associationsCtx, entity, callback) => {
  return callback(null, [entity[ActivityConstants.properties.OAE_ID]]);
});

/*!
 * Register a group association that presents the indirect members of the group categorized by role
 */
ActivityAPI.registerActivityEntityAssociation('group', 'members-by-role', (associationsCtx, entity, callback) => {
  return ActivityUtil.getAllAuthzMembersByRole(entity[ActivityConstants.properties.OAE_ID], callback);
});

/*!
 * Register a group association that presents all the indirect members of a group
 */
ActivityAPI.registerActivityEntityAssociation('group', 'members', (associationsCtx, entity, callback) => {
  associationsCtx.get('members-by-role', (err, membersByRole) => {
    if (err) {
      return callback(err);
    }

    return callback(null, _.flatten(_.values(membersByRole)));
  });
});

/*!
 * Register a group association that presents all the managers of a group
 */
ActivityAPI.registerActivityEntityAssociation('group', 'managers', (associationsCtx, entity, callback) => {
  associationsCtx.get('members-by-role', (err, membersByRole) => {
    if (err) {
      return callback(err);
    }

    return callback(null, membersByRole.manager);
  });
});
