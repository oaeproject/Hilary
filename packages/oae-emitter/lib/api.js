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

import events from 'events';
import { inherits, format } from 'util';
import _ from 'underscore';
import * as Log from 'oae-logger';

/**
 * The OAE EventEmitter extends the core Node.js event emitter to allow chained event handling
 * so that processing may proceed only after some "plugged in" functionality has completed.
 *
 * It is 100% API-compatible with the node event emitter, however, it is now possible to provide a
 * function as the final argument of `emit`, which will be invoked when all events have been
 * processed.
 *
 * In addition to new `emit` functionality, there is a new `when` function which is similar to `on`,
 * except that it will provide a callback argument in the event arguments that will indicate that
 * event processing is complete. It is assumed that `on` events have completed processing when they
 * finish their synchronous `tick` of code.
 */
const EventEmitter = function () {
  events.EventEmitter.call(this);
  this._when = {};
};

inherits(EventEmitter, events.EventEmitter);

/**
 * Emit an event, handing the event data to both the listeners bound with `on` as well as the
 * chained handlers bound with `when`
 *
 * @param  {String}     name            The name of the event to emit
 * @param  {Args}       [args...]       A variable number of arguments for the event handler, if any
 * @param  {Function}   [callback]      Standard callback function. Invoked when all `when` handlers have completed their task
 */
EventEmitter.prototype.emit = function (...args) {
  const log = Log.logger('oae-emitter');

  const self = this;

  // The name is required and must be the first argument
  const name = args.shift();
  if (!_.isString(name)) {
    throw new TypeError(format('Expected a string for event "name", but got: %s', JSON.stringify(name, null, 2)));
  }

  // First invoke the core event listeners
  events.EventEmitter.prototype.emit.apply(self, [name, ...args]);

  // The consumer callback is optional, and is always the last parameter if the last parameter is
  // a function
  const consumerCallback = _.chain(args).last().isFunction().value()
    ? args.pop()
    : function (errs) {
        if (errs) {
          log().error({ errs, name }, 'Unhandled error(s) occurred processing `when` handlers');
        }
      };

  // If there are no _when handlers, invoke the consumer callback immediately
  const handlers = self._when[name];
  if (_.isEmpty(handlers)) {
    return consumerCallback();
  }

  // We will aggregate all errors returned by each handler into an array for the consumer callback
  let handlerErrs = null;
  let handlerResults = null;

  // The final callback is invoked when all handlers have returned, which basically just passes
  // the errors we have aggregated into the consumer callback
  const finalCallback = _.after(handlers.length, () => {
    return consumerCallback(handlerErrs, handlerResults);
  });

  // The handler callback is invoked when each handler finishes its job. It simply builds the
  // array of handler errors if applicable
  const _handlerCallback = function (error, result) {
    if (error) {
      handlerErrs = handlerErrs || [];
      handlerErrs.push(error);
    } else if (result) {
      handlerResults = handlerResults || [];
      handlerResults.push(result);
    }

    return finalCallback();
  };

  // Finally invoke each handler, shielding each one from exceptions by other handlers
  _.each(handlers, (handler) => {
    process.nextTick(() => {
      return handler.apply(self, args.concat(_handlerCallback));
    });
  });
};

/**
 * Bind a handler that is invoked when an event is triggered with the specified name. This is
 * different than `on` in that the `when` handler must invoked a designated callback as the final
 * parameter of the handler function when processing is complete
 *
 * @param  {String}     name                The name of the event on which to listen
 * @param  {Function}   handler             The function that will be invoked when the event is emitted
 * @param  {Args}       handler.args...     The arguments provided by the event
 * @param  {Function}   handler.done        The handler must invoke this `done` callback when complete
 * @param  {Object}     handler.err         An error that should be provided by the handler, if any
 */
EventEmitter.prototype.when = function (name, handler) {
  if (!_.isString(name)) {
    throw new TypeError('Can only bind "when" handler for event whose name is a string');
  } else if (!_.isFunction(handler)) {
    throw new TypeError('Can only bind a function as the "when" handler for an event');
  }

  this._when[name] = this._when[name] || [];
  this._when[name].push(handler);
};

export { EventEmitter };
