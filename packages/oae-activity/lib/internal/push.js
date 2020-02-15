/*!
 * Copyright 2013 Apereo Foundation (AF) Licensed under the
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

import ActivityEmitter from 'oae-activity/lib/internal/emitter';

import _ from 'underscore';
import clone from 'clone';
import selectn from 'selectn';

import { Context } from 'oae-context';
import { logger } from 'oae-logger';
import * as Pubsub from 'oae-util/lib/pubsub';
import * as PrincipalsDAO from 'oae-principals/lib/internal/dao';
import * as Signature from 'oae-util/lib/signature';
import { telemetry } from 'oae-telemetry';
import * as TenantsAPI from 'oae-tenants';
import { Validator as validator } from 'oae-authz/lib/validator';
const { getNestedObject, makeSureThat, otherwise, isNotEmpty, isUserId, isObject, isNotNull, isANumber } = validator;
import pipe from 'ramda/src/pipe';

import { ActivityConstants } from 'oae-activity/lib/constants';

import * as ActivityRegistry from 'oae-activity/lib/internal/registry';
import * as ActivityTransformer from 'oae-activity/lib/internal/transformer';
import * as ActivityUtil from 'oae-activity/lib/util';

const log = logger('oae-activity-push');
const Telemetry = telemetry('push');

/// ///////////////////
// MODULE VARIABLES //
/// ///////////////////

// A hash of sockets per stream
const connectionInfosPerStream = {};

const QueueConstants = {};

QueueConstants.queue = {
  PREFIX: 'oae-activity-push-'
};
// be closed automatically
const AUTHENTICATION_TIMEOUT = 5000;

/**
 *
 * Push notifications logic
 *
 * Initializes the push logic. We will use Redis pubsub mechanism on which activities can be published.
 * All the app servers will start listening for new messages by subscribing to specific channels (see pubsub.js for details)
 * When a client connects to this app server we will add a subscription on Redis for that activityStreamId
 * This means that any activities that are relevant to the client will end up in our appserver and thus on this app server.
 *
 * Redis pubsub as it stands works as follows:
 * 1 There is a redis connection on each app server listening to every published message, on every channel (subscribed)
 * 2 Every time a message is received, an event with the same name as the channel is emitted
 * 3 This means that in order to handle messages from that channel, the app server needs to listen to the event with the same name
 * Check pubsub.js for details.
 *
 * The application servers generate the activity notices that will eventually be sent out as push notifications to all connected clients.
 * You can find an example below with 2 app servers:
 *
 * ```
 * 1 The servers are idle:
 *
 * ┌─────────────────┐                                                                                     ┌─────────────────┐
 * │  App server #1  │                                                                                     │  App server #1  │
 * └─────────────────┘                          ┌──────────────┐                                           └─────────────────┘
 *                                              │              │
 *                                              │ Redis pubsub │
 *                                              │              │
 * ┌─────────────────┐                          └──────────────┘                                           ┌─────────────────┐
 * │  App server #2  │                                                                                     │  App server #2  │
 * └─────────────────┘                                                                                     └─────────────────┘
 *
 *
 * 2. Client 1 comes in and opens a websocket to the "app1" app server.
 * He subscribes on push notifications for a piece of content: `c:cam:abc123#activity`.
 * This will cause the app server to add a subscription to the channel that is named after the activityStreamId.
 *
 * ┌─────────────────┐
 * │  App server #1  │
 * └─────────────────┘                          ┌──────────────┐
 *                                              │              │ publish  ┌───────────────────────┐  subscribe  ┌─────────────────┐       ┌──────────────────┐
 *                                              │ Redis pubsub │─────────▷│ c:cam:abc123#activity │◁────────────│  App server #1  │───────│  Browser tab #1  │
 *                                              │              │          └───────────────────────┘             └─────────────────┘       └──────────────────┘
 * ┌─────────────────┐                          └──────────────┘
 * │  App server #2  │
 * └─────────────────┘
 *
 *
 * 3. A new revision of that piece of content gets uploaded and triggers an activity.
 * An activity will be published on the pubsub channel `c:cam:abc123#activity`.
 * Because app server #1 is subscribed to that channel, the activity will end up on the app server
 * and will eventually be sent to the client
 *
 *
 * ┌─────────────────┐   c:cam:abc123#activity
 * │  App server #1  │────────────┐
 * └─────────────────┘            │             ┌──────────────┐                                                                          c:cam:abc123#activity
 *                                │             │              │ publish  ┌───────────────────────┐ subscribe   ┌─────────────────┐       ┌──────────────────┐
 *                                └────────────▶│ Redis pubsub │─────────▷│ c:cam:abc123#activity │◁────────────│  App server #1  │──────▶│  Browser tab #1  │
 *                                              │              │          └───────────────────────┘             └─────────────────┘       └──────────────────┘
 * ┌─────────────────┐                          └──────────────┘
 * │  App server #2  │
 * └─────────────────┘
 *
 *
 * 4. Another client comes in (or the same client in a different tab), opens a websocket to app server #2 and subscribes to the
 * same content items's activity stream. The app server #2 will subscribe to the channel as well, like this:
 *
 * ┌─────────────────┐                                                                               subscribe  ┌─────────────────┐       ┌──────────────────┐
 * │  App server #1  │                                                                                   ┌──────│  App server #1  │───────│  Browser tab #1  │
 * └─────────────────┘                          ┌──────────────┐                                         │      └─────────────────┘       └──────────────────┘
 *                                              │              │ publish  ┌───────────────────────┐      │
 *                                              │ Redis pubsub │─────────▷│ c:cam:abc123#activity │◁─────┤
 *                                              │              │          └───────────────────────┘      │
 * ┌─────────────────┐                          └──────────────┘                                         │      ┌─────────────────┐       ┌──────────────────┐
 * │  App server #2  │                                                                                   └──────│  App server #2  │───────│  Browser tab #2  │
 * └─────────────────┘                                                                               subscribe  └─────────────────┘       └──────────────────┘
 *
 *
 *
 * 5. When another activity is triggered on the piece of content it will be delivered on both sockets:
 *
 *                                                                                                                                        c:cam:abc123#activity
 * ┌─────────────────┐                                                                                subscribe ┌─────────────────┐       ┌──────────────────┐
 * │  App server #1  │                                                                                   ┌──────│  App server #1  │──────▶│  Browser tab #1  │
 * └─────────────────┘                          ┌──────────────┐                                         │      └─────────────────┘       └──────────────────┘
 *                                              │              │ publish  ┌───────────────────────┐      │
 *                                ┌────────────▶│ Redis pubsub │─────────▷│ c:cam:abc123#activity │◁─────┤
 *                                │             │              │          └───────────────────────┘      │
 * ┌─────────────────┐            │             └──────────────┘                                         │      ┌─────────────────┐       ┌──────────────────┐
 * │  App server #2  │────────────┘                                                                      └──────│  App server #2  │──────▶│  Browser tab #2  │
 * └─────────────────┘  c:cam:abc123#activity                                                         subscribe └─────────────────┘       └──────────────────┘
 *                                                                                                                                        c:cam:abc123#activity
 * ```
 *
 * @param  {Function} callback      Standard callback function
 * @param  {Object}   callback.err  An error that occurred, if any
 */
const init = function(callback) {
  /**
   * Nothing to do here since we moved to Redis pubsub
   * We basically create a redis channel for every `activityStreamId`
   * and every time we push to it, the app servers that have subscribed
   * will receive the message and deliver the push notification.
   * Check pubsub.js for details
   */

  callback();
};

/**
 * Registers a websocket connection for push notifications
 *
 * @param  {Socket}     socket  A WebSocket connection
 */
const registerConnection = function(socket) {
  log().trace({ sid: socket.id }, 'Got a new websocket connection');

  // Hold state about the registered websocket connection
  const connectionInfo = {
    socket,
    streams: [],
    ctx: null,
    authenticationTimeout: null
  };

  const connectionStart = Date.now();
  Telemetry.incr('connection.count');

  /*!
   * The client has a 5 second window to authenticate itself, at which time this timeout will be
   * cleared and the close function will not get executed. If the client does not authenticate,
   * the connection is closed
   */
  connectionInfo.authenticationTimeout = setTimeout(() => {
    if (connectionInfo.ctx) {
      log().trace(
        { sid: socket.id, durationInMs: AUTHENTICATION_TIMEOUT },
        'Socket was authenticated within the acceptable duration'
      );
    } else {
      log().warn(
        { sid: socket.id, durationInMs: AUTHENTICATION_TIMEOUT },
        'Socket was not authenticated within an acceptable duration'
      );
      _writeResponse(connectionInfo, 0, {
        code: 400,
        msg: 'Authentication should happen within 5 seconds after opening the socket'
      });
      socket.close();
    }
  }, AUTHENTICATION_TIMEOUT);

  /*!
   * A new message is pushed to us by the client
   *
   * @param  {Object}     msg     The message the client sent us
   */
  socket.on('data', msg => {
    let message = null;
    try {
      // Deserialize the incoming message (Sock.JS only supports strings)
      message = JSON.parse(msg);
    } catch (error) {
      log().error({ msg, err: error }, 'Ignoring malformed message');
      _writeResponse(connectionInfo, 0, { code: 400, msg: 'Malformed message' });
      socket.close();

      // Do not attempt to do anything else with this frame and return
      return;
    }

    log().trace({ sid: socket.id, request: msg }, 'Received websocket request');

    // We require an id for all incoming messages
    if (!message.id) {
      log().error({ msg }, 'Missing id on the message');
      _writeResponse(connectionInfo, 0, { code: 400, msg: 'Missing id on the message' });
      return socket.close();
    }

    // The first message coming from the UI has to be an authentication frame
    // If it's something else, we ignore it and immediately close the socket
    if (!connectionInfo.ctx && message.name !== 'authentication') {
      log().error('First frame is not authentication');
      _writeResponse(connectionInfo, message.id, {
        code: 401,
        msg: 'The first frame should be an authentication frame'
      });
      return socket.close();
    }

    if (message.name === 'authentication') {
      _authenticate(connectionInfo, message);
    } else if (message.name === 'subscribe') {
      _subscribe(connectionInfo, message);
    }
  });

  /*!
   * A client disconnected. We need to do some clean-up.
   *
   * 1/ Unbind our Redis queue from the exchange for all the streams that user was interested in (but nobody else).
   *
   * 2/ Clear all local references to this socket, so we're not leaking memory.
   */
  socket.on('close', () => {
    log().trace({ sid: socket.id, streams: connectionInfo.streams }, 'Closing socket');
    // Measure how long the clients stay connected
    Telemetry.appendDuration('connected.time', connectionStart);

    let subscribedStreams = connectionInfo.streams.length;
    if (subscribedStreams === 0) {
      log().trace({ sid: socket.id }, 'Not registered for any streams, not doing anything');
      return;
    }

    const start = Date.now();
    _.each(connectionInfo.streams, stream => {
      if (!connectionInfosPerStream[stream]) {
        // Seems unlikely, but it's better to be safe
        log().warn(
          { stream },
          'A stream was associated with a socket, but the socket could not be found in the connectionInfosPerStream hash'
        );
      } else if (connectionInfosPerStream[stream].length === 1) {
        // We can also stop listening to messages from this stream as nobody is interested in it anymore
        subscribedStreams--;

        // If nobody else is interested in this stream, we can remove it
        delete connectionInfosPerStream[stream];

        // ...and we remove the pubsub listener as well
        Pubsub.emitter.removeAllListeners(stream);

        if (subscribedStreams === 0) {
          Telemetry.appendDuration('unbind.all.time', start);
        }

        // Otherwise we need to iterate through the list of sockets for this stream and splice this one out
      } else {
        subscribedStreams--;

        // Find the socket in the connectionInfosPerStream[stream] array and remove it
        // Unfortunately we can't use an underscore utility as all of the filter/find
        // functions return a copy of the array or the socket we're searching for
        log().trace(
          {
            sid: socket.id,
            stream,
            socketsInstream: connectionInfosPerStream[stream].length
          },
          'Searching through sockets'
        );
        for (let i = 0; i < connectionInfosPerStream[stream].length; i++) {
          if (connectionInfosPerStream[stream][i].socket.id === socket.id) {
            // If we have found the socket we're looking for, we can splice it out
            connectionInfosPerStream[stream].splice(i, 1);
            break;
          }
        }

        if (subscribedStreams === 0) {
          Telemetry.appendDuration('unbind.all.time', start);
        }
      }
    });
  });
};

/**
 * Handles authentication of the client. Authentication happens by passing a signature
 * along that can be retrieved from the /api/me endpoint. This signature is specific to the
 * user.
 *
 * Once the user is connected, a `Context` object will be made available on the socket
 * which can be used to pass into any of the standard API methods.
 *
 * @param  {Object}     connectionInfo  The state of the connection we wish to authenticate
 * @param  {Object}     message         The authentication frame
 * @return {Function}                   Returns a function which writes to a socket
 * @api private
 */
const _authenticate = function(connectionInfo, message) {
  const { socket } = connectionInfo;
  const data = message.payload;
  if (!data) {
    _writeResponse(connectionInfo, message.id, {
      code: 400,
      msg: 'Missing data payload containing the userId and signature'
    });
    return socket.close();
  }

  const handleError = error => {
    _writeResponse(connectionInfo, message.id, error);
    log().error({ err: error }, 'Invalid auth frame');
    return socket.close();
  };

  // Parameter validation
  try {
    pipe(
      isNotEmpty,
      otherwise({
        code: 400,
        msg: 'A tenant needs to be provided'
      })
    )(data.tenantAlias);

    pipe(
      isUserId,
      otherwise({
        code: 400,
        msg: 'A userId needs to be provided'
      })
    )(data.userId);

    // Do some preliminary signature validation before we access the user from the database
    const getAttribute = getNestedObject(data.signature);
    const expiryDate = getAttribute(['expires']);
    const signature = getAttribute(['signature']);

    const ifThereIsExpiryDate = () => Boolean(expiryDate);
    const ifThereIsSignature = () => Boolean(signature);

    pipe(
      isObject,
      otherwise({
        code: 400,
        msg: 'A signature object needs to be provided'
      }),
      ifThereIsExpiryDate,
      makeSureThat(expiryDate, isANumber),
      otherwise({
        code: 400,
        msg: 'Signature must contain an integer expires value'
      }),
      ifThereIsSignature,
      makeSureThat(signature, isNotNull),
      otherwise({
        code: 400,
        msg: 'Signature must contain a string signature value'
      })
    )(data.signature);
  } catch (error) {
    if (error) return handleError(error);
  }

  // Get the full user object so we can build a context with which to authenticate to the signing utility
  PrincipalsDAO.getPrincipal(data.userId, (err, user) => {
    if (err) {
      _writeResponse(connectionInfo, message.id, err);
      log().error({ err, userId: data.userId, sid: socket.id }, 'Error trying to get the principal object');
      return socket.close();
    }

    // Store a context with the tenant we're running on and the full user object
    const currentTenant = TenantsAPI.getTenant(data.tenantAlias);
    connectionInfo.ctx = new Context(currentTenant, user);

    if (
      !Signature.verifyExpiringResourceSignature(
        connectionInfo.ctx,
        data.userId,
        data.signature.expires,
        data.signature.signature
      )
    ) {
      _writeResponse(connectionInfo, message.id, { code: 401, msg: 'Invalid signature' });
      log().error({ userId: data.userId, sid: socket.id }, 'Incoming authentication signature was invalid');
      return socket.close();
    }

    // Clear the authentication timeout
    clearTimeout(connectionInfo.authenticationTimeout);

    log().trace(
      { sid: socket.id, userId: connectionInfo.ctx.user().id },
      'Successfully authenticated websocket connection'
    );

    // Send an OK response to the client
    return _writeResponse(connectionInfo, message.id);
  });
};

/**
 * A client wants to subscribe on a stream. We do some basic validation, pass the message
 * too the authorization handler for that stream and do the appropriate PubSub binding
 *
 * @param  {Object}     connectionInfo  The state of the connection we wish to authenticate
 * @param  {Object}     message         The message containing the subscription request
 * @return {Function}                   Returns a function which writes to a socket
 * @api private
 */
const _subscribe = function(connectionInfo, message) {
  const { socket } = connectionInfo;
  const data = message.payload;
  if (!data || !data.stream || !data.stream.resourceId || !data.stream.streamType) {
    return _writeResponse(connectionInfo, message.id, {
      code: 400,
      msg: 'Missing stream properties'
    });
  }

  // If a format is specified, ensure that it is one that we support
  const formatIsInvalid =
    data.format &&
    !_.chain(ActivityConstants.transformerTypes)
      .values()
      .contains(data.format)
      .value();
  if (formatIsInvalid) {
    return _writeResponse(connectionInfo, message.id, {
      code: 400,
      msg: 'The specified stream format is unknown'
    });
  }

  // Check if the client is authorized for this stream (and if the stream even exists)
  const authzHandler = _getAuthorizationHandler(data.stream.streamType);
  if (!authzHandler) {
    return _writeResponse(connectionInfo, message.id, { code: 400, msg: 'Unknown stream' });
  }

  // Perform authorization
  authzHandler(connectionInfo.ctx, data.stream.resourceId, data.token, err => {
    if (err) {
      return _writeResponse(connectionInfo, message.id, err);
    }

    const activityStreamId = ActivityUtil.createActivityStreamId(data.stream.resourceId, data.stream.streamType);
    log().trace({ sid: socket.id, activityStreamId }, 'Registering socket for stream');

    /*!
     * Finishes up the subscription process and  writes a response to the client
     */
    const finish = function() {
      // Remember the desired transformer for this stream on this socket
      const transformerType = data.format || ActivityConstants.transformerTypes.INTERNAL;
      connectionInfo.transformerTypes = connectionInfo.transformerTypes || {};
      connectionInfo.transformerTypes[activityStreamId] = connectionInfo.transformerTypes[activityStreamId] || [];
      connectionInfo.transformerTypes[activityStreamId].push(transformerType);

      // Acknowledge a succesful subscription
      log().trace({ sid: socket.id, activityStreamId, format: transformerType }, 'Registered a client for a stream');
      return _writeResponse(connectionInfo, message.id);
    };

    // We need to perform the following check as a socket can subscribe for the same activity stream twice, but with a different format
    if (connectionInfo.streams.includes(activityStreamId)) {
      // No need to bind, we're already bound
      return finish();
    }

    Pubsub.emitter.removeAllListeners(activityStreamId);
    Pubsub.emitter.on(activityStreamId, message => {
      message = JSON.parse(message);

      return _handlePushActivity(message, () => {
        const activity = message.activities[0]['oae:activityType'];
        log().info('Finished processing a ' + activity + ' push notification on channel ' + activityStreamId);
      });
    });

    // Remember this stream on the socket
    connectionInfo.streams.push(activityStreamId);

    // Remember this socket on the app server so we can push to it asynchronously
    connectionInfosPerStream[activityStreamId] = connectionInfosPerStream[activityStreamId] || [];
    connectionInfosPerStream[activityStreamId].push(connectionInfo);

    return finish();
  });
};

/**
 * Gets an authorization handler for a stream
 *
 * @param  {String}     activityStreamId    The id of the stream for which to retrieve the authorization handler. ex: `activity`
 * @return {Function}                       The authorization function or null if the activity stream has no authorization handler
 * @api private
 */
const _getAuthorizationHandler = function(activityStreamId) {
  const streamOptions = ActivityRegistry.getRegisteredActivityStreamType(activityStreamId);
  if (!streamOptions || !streamOptions.authorizationHandler) {
    return null;
  }

  return streamOptions.authorizationHandler;
};

/**
 * Writes a message over the socket. Only use this in response to an earlier request
 *
 * @param  {Object}     connectionInfo  The connection info containing the socket to write to
 * @param  {Number}     id              The id of the message that was sent by the client. This will be used by the client to identify what request this response is for
 * @param  {Object}     [error]         An optional error object
 * @param  {Number}     [error.code]    An HTTP error code
 * @param  {String}     error.msg       A message explaining the error
 * @api private
 */
const _writeResponse = function(connectionInfo, id, error) {
  const { socket } = connectionInfo;
  const msg = {};
  msg.replyTo = id;
  if (error) {
    msg.error = error;
  }

  log().trace(
    {
      sid: socket.id,
      messageId: id,
      response: msg
    },
    'Writing response to websocket connection'
  );

  socket.write(JSON.stringify(msg));
};

/// ///////////////////////////
// SEND/RECEIVE TO REDIS //
/// ///////////////////////////

/**
 * Push out an activity to the Redis queue
 * From there it can be routed to the appropriate app server based on the activityStreamId.
 *
 * @param  {String}         activityStreamId            The activity stream on which the activity was routed. ex: `u:cam:abc123#notification`
 * @param  {Object}         routedActivity              The routed activity structure
 * @param  {String}         routedActivity.resourceId   The ID of the resource to whom/what this activity was routed. ex: `u:cam:abc123`
 * @param  {String}         routedActivity.streamType   The name of the stream to which the activity was routed. ex: `notification`
 * @param  {Activity[]}     routedActivity.activities   The actual activity objects
 * @api private
 */
const _push = function(activityStreamId, routedActivity) {
  routedActivity = JSON.stringify(routedActivity);

  /**
   * Since this is not RabbitMQ anymore (thank god) instead of pushing
   * to an exchange, we use redis pubsub and publish at will
   * If a browser tab is supposed to send push notifications, then it will
   * have subscribed to the redis channel. Otherwise, the message is lost.
   */
  Pubsub.publish(activityStreamId, routedActivity);
};

/**
 * A message arrived on redis queue which we need to distribute
 * to the connected clients who are interested in this stream.
 *
 * @param  {Object}        data        The data that was published to the queue. @see _push
 * @param  {Function}      callback    Standard callback function
 * @api private
 */
const _handlePushActivity = function(data, callback) {
  const activityStreamId = ActivityUtil.createActivityStreamId(data.resourceId, data.streamType);

  let todo = 0;

  // Iterate over the sockets that are interested in this stream, transform the activity and send it down the socket
  _.each(connectionInfosPerStream[activityStreamId], connectionInfo => {
    const { socket } = connectionInfo;
    _.each(connectionInfo.transformerTypes[activityStreamId], transformerType => {
      todo++;
      // Because we're sending these activities to possible multiple sockets/users we'll need to clone and transform it for each socket
      const activities = clone(data.activities);
      ActivityTransformer.transformActivities(connectionInfo.ctx, activities, transformerType, err => {
        if (err) {
          return log().error({ err }, 'Could not transform event');
        }

        const msgData = {
          resourceId: data.resourceId,
          streamType: data.streamType,
          activities,
          format: transformerType,
          numNewActivities: data.numNewActivities
        };
        log().trace({ data: msgData, sid: socket.id }, 'Pushing message to socket');
        const msg = JSON.stringify(msgData);
        socket.write(msg);

        todo--;
        if (todo === 0) {
          callback();
        }
      });
    });
  });
};

/// //////////////////
// EVENT LISTENERS //
/// //////////////////

/*!
 * Send routed activities to the push queue
 */
ActivityEmitter.on(ActivityConstants.events.ROUTED_ACTIVITIES, routedActivities => {
  // Iterate over each target resource
  _.each(routedActivities, (streamTypeActivities, resourceId) => {
    // For each resource, there could be a number of stream types to which it was routed (e.g., activity and notification)
    _.each(streamTypeActivities, (activity, streamType) => {
      // Get the activity stream configuration for this stream type and determine if we should send a push notification
      // in the routing phase
      const streamOptions = ActivityRegistry.getRegisteredActivityStreamType(streamType);
      if (selectn('push.delivery.phase', streamOptions) !== 'aggregation') {
        // We are configured to emit in the routing phase, so we push the activity back to the client
        const data = {
          activities: [activity],
          resourceId,
          streamType
        };
        _push(ActivityUtil.createActivityStreamId(resourceId, streamType), data);
      }
    });
  });
});

/*!
 * Send aggregated activities to the push queue
 */
ActivityEmitter.on(ActivityConstants.events.DELIVERED_ACTIVITIES, deliveredActivities => {
  // Iterate over each target resource
  _.each(deliveredActivities, (streamTypeActivities, resourceId) => {
    // For each resource, there could be a number of stream types to which it was routed (e.g., activity and notification)
    _.each(streamTypeActivities, (activityInfo, streamType) => {
      // Get the activity stream configuration for this stream type and determine if we should send a push notification
      // in the aggregation phase
      const streamOptions = ActivityRegistry.getRegisteredActivityStreamType(streamType);
      if (selectn('push.delivery.phase', streamOptions) === 'aggregation') {
        // We are configured to emit in the aggregation phase, so we push the activity back to the client
        const data = {
          activities: activityInfo.activities,
          resourceId,
          streamType,
          numNewActivities: activityInfo.numNewActivities
        };
        _push(ActivityUtil.createActivityStreamId(resourceId, streamType), data);
      }
    });
  });
});

export { init, registerConnection };
