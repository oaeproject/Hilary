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

import { format } from 'node:util';
import _ from 'underscore';
import Counter from 'oae-util/lib/counter.js';

import * as AuthzAPI from 'oae-authz';

import { logger } from 'oae-logger';
import { PrincipalsConstants } from './constants.js';
import PrincipalsEmitter from './internal/emitter.js';

const groupDeleteLog = logger('group-delete');
const groupRestoreLog = logger('group-restore');

/**
 * Manage all handlers that have been registered for performing operations when a principal has been
 *  deleted or restored in the system
 */
const _groupDeleteHandlers = {};
const _groupRestoreHandlers = {};

// Keep track of in-flight local deletes for test purposes
const deleteCounter = new Counter();

/**
 * API methods
 */

/**
 * Register a handler that will be invoked when a group is deleted. This provides the ability to
 * destroy caches and associations as necessary when a group has been marked as deleted in the
 * system.
 *
 * Note that it is important for the handler to be idempotent, so that in the case of historical
 * bugs or system failures during delete processing, the handlers may be re-executed without a
 * detrimental impact on application data.
 *
 * @param  {String}         name                        The name of the handler. This is relevant for logging and diagnostic purposes
 * @param  {Function}       handler                     The handler that will be invoked when a group is deleted
 * @param  {Group}          handler.group               The group basic profile that was deleted
 * @param  {AuthzGraph}     handler.membershipsGraph    The full graph of memberships, containing all the groups to which the deleted group belonged either directly or indirectly
 * @param  {AuthzGraph}     handler.membersGraph        The full graph of members, containing all the groups and users that belonged to the deleted group either directly or indirectly
 * @param  {Function}       handler.callback            Standard consumer callback. Your handler method should invoke this callback when processing has completed
 * @param  {Object[]}       handler.callback.errs       An array of errors that occurred while trying to perform the group delete processing. Your handler should provide this to the caller so centralized error logging can be performed
 */
const registerGroupDeleteHandler = function (name, handler) {
  if (_groupDeleteHandlers[name]) {
    throw new Error(format('Attempted to register multiple group delete handlers for name "%s"', name));
  } else if (!_.isFunction(handler)) {
    throw new TypeError(format('Attempted to register non-function group delete handler for name "%s"', name));
  }

  _groupDeleteHandlers[name] = handler;
};

/**
 * Register a handler that will be invoked when a group is restored. This provides the ability to
 * restore caches and associations as necessary when a group has been unmarked as deleted in the
 * system.
 *
 * Note that it is important for the handler to be idempotent, so that in the case of historical
 * bugs or system failures during restore processing, the handlers may be re-executed without a
 * detrimental impact on application data.
 *
 * @param  {String}         name                        The name of the handler. This is relevant for logging and diagnostic purposes
 * @param  {Function}       handler                     The handler that will be invoked when a group is restored
 * @param  {Group}          handler.group               The group basic profile that was restored
 * @param  {AuthzGraph}     handler.membershipsGraph    The full graph of memberships, containing all the groups to which the restored group belonged either directly or indirectly
 * @param  {AuthzGraph}     handler.membersGraph        The full graph of members, containing all the groups and users that belonged to the restored group either directly or indirectly
 * @param  {Function}       handler.callback            Standard consumer callback. Your handler method should invoke this callback when processing has completed
 * @param  {Object[]}       handler.callback.errs       An array of errors that occurred while trying to perform the group restore processing. Your handler should provide this to the caller so centralized error logging can be performed
 */
const registerGroupRestoreHandler = function (name, handler) {
  if (_groupRestoreHandlers[name]) {
    throw new Error(format('Attempted to register multiple group restore handlers for name "%s"', name));
  } else if (!_.isFunction(handler)) {
    throw new TypeError(format('Attempted to register non-function group restore handler for name "%s"', name));
  }

  _groupRestoreHandlers[name] = handler;
};

/**
 * Invoke the group delete handlers, suggesting that the given group has been deleted
 *
 * @param  {Group}  group   The group for which to invoke the delete handlers
 */
const invokeGroupDeleteHandlers = function (group) {
  _invokeGroupHandlers(groupDeleteLog, _groupDeleteHandlers, group);
};

/**
 * Invoke the group restore handlers, suggesting that the given group has been restored
 *
 * @param  {Group}  group   The group for which to invoke the delete handlers
 */
const invokeGroupRestoreHandlers = function (group) {
  _invokeGroupHandlers(groupRestoreLog, _groupRestoreHandlers, group);
};

/**
 * Attach a listener that will be fired when there are no pending delete jobs to finish
 *
 * @param  {Function}   callback    Invoked when all delete tasks have completed. If there are no pending delete tasks, it will be invoked immediately
 */
const whenDeletesComplete = function (callback) {
  deleteCounter.whenZero(callback);
};

/**
 * Generic group operation to gather the necessary group information and invoke the operation-
 * specific handlers
 *
 * @param  {Logger}     log         The logger ot use to report progress
 * @param  {Object}     handlers    The handlers to invoke
 * @param  {Group}      group       The group that is the target of the operation
 * @api private
 */
const _invokeGroupHandlers = function (log, handlers, group) {
  // Indicate we have an asynchronous task that needs to complete before deletes are finished
  // processing
  deleteCounter.incr();

  // Get both the members and memberships graph of the group so that the handlers can use that
  // information to determine if any associations need to be destroyed
  AuthzAPI.getPrincipalMembershipsGraph(group.id, (error, membershipsGraph) => {
    if (error) {
      return log().error(
        { err: error, groupId: group.id },
        'An unexpected error occurred while getting the authz memberships graph'
      );
    }

    AuthzAPI.getAuthzMembersGraph([group.id], (error, membersGraph) => {
      if (error) {
        return log().error(
          { err: error, groupId: group.id },
          'An unexpected error occurred while getting the authz members graph'
        );
      }

      // Get the potentially asynchronous handler operations running
      _invokeHandlers(log, handlers, group, membershipsGraph, membersGraph);

      // Indicate we have finished the asynchronous task of acquiring memerships and members
      // graphs
      deleteCounter.decr();
    });
  });
};

/**
 * Generic operation to invoke the given handlers, reporting errors or success with the given named
 * logger
 *
 * @param  {Logger}         log         The logger to use to report progress
 * @param  {Object}         handlers    The handler functions keyed by their handler name, indicating which handlers to invoke
 * @param  {User|Group}     principal   The user or group that was the target of the operation
 * @param  {...Object}      args        A variable number of arguments for the handler depending on its type
 * @api private
 */
const _invokeHandlers = function (...args) {
  const [log, handlers, principal] = args;
  // Const args = Array.prototype.slice.call(arguments);
  // The arguments for the handler (including the `principal`) start from the 2nd argument and
  // continue until the end of the arguments list
  const handlerArgs = args.slice(2);

  // Invoke each handler
  _.each(handlers, (handler, name) => {
    // Increment the delete counter, as all handlers need to complete before we can indicate
    // that we have 0 pending delete jobs
    deleteCounter.incr();

    // Add the callback function to the handlerArgs
    const thisHandlerArgs = [
      ...handlerArgs,
      (errs) => {
        if (!errs) {
          errs = [];
        } else if (!_.isArray(errs)) {
          errs = [errs];
        }

        // Decrement the delete counter to indicate we've finished processing this handler
        deleteCounter.decr();

        if (!_.isEmpty(errs)) {
          return log().error(
            { principalId: principal.id, handlerName: name, errs },
            'Error(s) occurred while trying to process a handler'
          );
        }

        return log().debug({ principalId: principal.id, handlerName: name }, 'Successfully processed handler');
      }
    ];

    // Invoke the handler with our arguments array
    handler.apply(handler, thisHandlerArgs);
  });
};

/// /////////
// EVENTS //
/// /////////
/*!
 * When a group is deleted, we must invoke the handlers that were registered to be triggered when
 * a group is deleted
 */
PrincipalsEmitter.on(PrincipalsConstants.events.DELETED_GROUP, (ctx, group) => {
  // Invoke all group delete handlers
  invokeGroupDeleteHandlers(group);
});

/*!
 * When a group is restored, we must invoke the handlers that were registered to be triggered when
 * a group is restored
 */
PrincipalsEmitter.on(PrincipalsConstants.events.RESTORED_GROUP, (ctx, group) => {
  // Invoke all group restore handlers
  invokeGroupRestoreHandlers(group);
});

export {
  registerGroupDeleteHandler,
  registerGroupRestoreHandler,
  invokeGroupDeleteHandlers,
  invokeGroupRestoreHandlers,
  whenDeletesComplete
};
