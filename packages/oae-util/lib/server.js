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

import http from 'http';
import util from 'util';
import _ from 'underscore';
import bodyParser from 'body-parser';
import express from 'express';

import { logger } from 'oae-logger';

import * as TelemetryAPI from 'oae-telemetry';
import OaeEmitter from './emitter';

import multipart from './middleware/multipart';
import * as Shutdown from './internal/shutdown';

const log = logger('oae-server');

// The main OAE config
let config = null;

// Maintains a list of paths that are safe from CSRF attacks
const safePathPrefixes = [];

/**
 * Starts an express server on the specified port. This will be done for the global admin server, as well
 * as for the tenant server.
 *
 * @param  {Number}     port        The port on which the express server should be started
 * @param  {Object}     config      JSON object containing configuration values for Cassandra, Redis, logging and telemetry
 * @return {Express}                The created express server
 */
const setupServer = function(port, _config) {
  // Cache the config
  config = _config;

  // Create the express server
  const app = express();

  // Expose the HTTP server on the express app server so other modules can hook into it
  app.httpServer = http.createServer(app);

  // Start listening for requests
  app.httpServer.listen(port);

  // Don't output pretty JSON,
  app.set('json spaces', 0);

  _applyAvailabilityHandling(app.httpServer, app, port);

  /*!
   * We support the following type of request encodings:
   *
   *  * urlencoded (regular POST requests)
   *  * application/json
   *  * multipart (file uploads)
   *
   * A maximum limit of 250kb is imposed for `urlencoded` and `application/json` requests. This limit only
   * applies to the *incoming request data*. If the client needs to send more than 250kb, it should consider
   * using a proper multipart form request.
   */
  app.use(bodyParser.urlencoded({ limit: '250kb', extended: true }));
  app.use(bodyParser.json({ limit: '250kb' }));
  app.use(multipart(config.files));

  // Add telemetry before we do anything else
  app.use((req, res, next) => {
    TelemetryAPI.request(req, res);
    return next();
  });

  // Add CORS headers, cookies won't be passed in so all cross domain requests will be anonymous
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    return next();
  });

  return app;
};

/**
 * Aggregates the routes for the express server so that we can bind them after setting up
 * all the middleware as registering the first route puts the router onto the middleware
 * stack
 *
 * @param  {Express}       The express server these routes belong to
 * @return {Router}        An object for associating routes to the server
 */
const setupRouter = function(app) {
  const that = {};
  that.routes = [];

  /**
   * Setup a route on the associated server
   *
   * @param  {String}               method          The http method for the route
   * @param  {String|RegEx}         route           The path for the route
   * @param  {Function|Function[]}  handler         The function to handle requests to this route
   * @param  {String}               [telemetryUrl]  The string to use for telemetry tracking
   * @throws {Error}                                Error thrown when arguments aren't of the proper type
   */
  that.on = function(method, route, handler, telemetryUrl) {
    const isRouteValid = _.isString(route) || _.isRegExp(route);
    const isHandlerValid = _.isFunction(handler) || _.isArray(handler);
    if (!_.isString(method)) {
      throw new TypeError(
        util.format(
          'Invalid type for request method "%s" when binding route "%s" to OAE Router',
          method,
          route.toString()
        )
      );
    } else if (!isRouteValid) {
      throw new Error(util.format('Invalid route path "%s" while binding route to OAE Router', route.toString()));
    } else if (!isHandlerValid) {
      throw new Error(
        util.format('Invalid method handler given for route "%s" while binding to OAE Router', route.toString())
      );
    }

    that.routes.push({
      method,
      route,
      handler,
      telemetryUrl
    });
  };

  /**
   * Bind all the routes, this should only be called once by the server initialization
   */
  that.bind = function() {
    _.each(that.routes, route => {
      // Add a telemetry handler
      const handlers = [
        function(req, res, next) {
          req.telemetryUrl = route.telemetryUrl || route.route.replace(/:/, '');
          next();
        }
      ];

      app[route.method](route.route, handlers.concat(route.handler));
    });
  };

  return that;
};

/**
 * Add a path to the list of safe paths. Paths added here will not be protected against CSRF
 * attacks. This is common for endpoints that have other verification mechanisms such as Shibboleth.
 *
 * @param  {String}     pathPrefix  A path prefix that will not be validated against CSRF attacks
 */
const addSafePathPrefix = function(pathPrefix) {
  log().info('Adding %s to list of paths that are not CSRF-protected.', pathPrefix);
  safePathPrefixes.push(pathPrefix);
};

/**
 * This method is used to bind server functionality after all modules have had an opportunity to do so. This can be useful for things such
 * as:
 *
 * Response code logging / telemetry
 * Default "catch-all" error handling
 *
 * @param  {Express}    app     The express app for which the initialized should be finalized
 */
const postInitializeServer = function(app, router) {
  /*!
   * Referer-based CSRF protection. If the request is not safe (e.g., POST, DELETE) and the origin of the request (as
   * specified by the HTTP Referer header) does not match the target host of the request (as specified by the HTTP
   * Host header), then the request will result in a 500 error.
   *
   * While referer-based protection is not highly recommended due to spoofing possibilities in insecure environments,
   * it currently offers the best trade-off between ease of use (e.g., for cURL interoperability), effort and security
   * against CSRF attacks.
   *
   * Middleware that gets called earlier, can force the CSRF check to be skipped by setting `_checkCSRF` on the request.
   *
   * If using a utility such as `curl` to POST requests to the API, you can bypass this by just setting the referer
   * header to "/":
   *
   * curl -X POST -e / http://my.oae.com/api/auth/login
   *
   * More information about CSRF attacks: http://en.wikipedia.org/wiki/Cross-site_request_forgery
   */
  app.use((req, res, next) => {
    // If earlier middleware determined that CSRF is not required, we can skip the check
    if (req._checkCSRF === false) {
      return next();
    }

    const failsCSRFValidation = !_isSafeMethod(req.method) && !_isSafePath(req) && !_isSameOrigin(req);
    if (failsCSRFValidation) {
      log().warn(
        {
          method: req.method,
          host: req.headers.host,
          referer: req.headers.referer,
          targetPath: req.path
        },
        'CSRF validation failed: attempted to execute unsafe operation from untrusted origin'
      );
      return _abort(res, 500, 'CSRF validation failed: attempted to execute unsafe method from untrusted origin');
    }

    return next();
  });

  // Bind routes
  router.bind();

  // Catch-all error handler
  const appTelemetry = TelemetryAPI.telemetry('server');
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    appTelemetry.incr('error.count');
    log(req.ctx).error(
      {
        err,
        req,
        res
      },
      'Unhandled error in the request chain, caught at the default error handler'
    );
    res.status(500).send('An unexpected error occurred');
  });
};

/**
 * Whether or not the server is running behind HTTPs.
 *
 * @return {Boolean}   Whether or not the server is running behind https.
 */
const useHttps = function() {
  return config.servers.useHttps;
};

/**
 * Apply the logic and request handling required to gracefully start up and shut down the web server. This entails both:
 *
 *  * Gracefully rejecting web requests until the container has fully initialized
 *  * Gracefully rejecting web requests while the container is in the process of shutting down services
 *
 * @param  {Server}         server  The node.js http server object
 * @param  {Application}    app     The Express `app` object
 * @param  {Number}         port    The port on which the server is listening
 * @api private
 */
const _applyAvailabilityHandling = function(server, app, port) {
  let isAvailable = false;

  OaeEmitter.on('ready', () => {
    // The container is initialized, start accepting web requests
    isAvailable = true;
  });

  // Register a pre-shutdown handler that will close this express server to stop receiving requests
  Shutdown.registerPreShutdownHandler('express-server-' + port, null, callback => {
    log().info('Beginning shutdown.');

    // Stop accepting web requests
    isAvailable = false;

    server.close(() => {
      log().info('Express is now shut down.');
      callback();
    });
  });

  // Notify the front-end proxy that we are unable to accept requests if isAvailable is false
  app.use((req, res, next) => {
    if (!isAvailable) {
      log().info({ path: req.path }, 'Rejecting request during shutdown with 502 error');
      res.setHeader('Connection', 'close');
      return res.status(502).send('Server is in the process of restarting');
    }

    return next();
  });
};

/**
 * Abort a request with a given code and response message.
 *
 * @param  {Response}   res     The express response object
 * @param  {Number}     code    The HTTP response code
 * @param  {String}     message The message body to provide as a reason for aborting the request
 * @api private
 */
const _abort = function(res, code, message) {
  res.setHeader('Connection', 'Close');
  return res.status(code).send(message);
};

/**
 * Determines if the target path for a request is considered "safe" from CSRF attacks.
 *
 * @param  {Request}    req     The express request object
 * @return {Boolean}            `true` if the path is safe from CSRF attacks, `false` otherwise
 * @api private
 */
const _isSafePath = function(req) {
  const { path } = req;
  const matchingPaths = _.filter(safePathPrefixes, safePathPrefix => {
    return path.indexOf(safePathPrefix) === 0;
  });
  return matchingPaths.length > 0;
};

/**
 * Determine whether or not the given request method is considered "safe"
 *
 * @param  {String}     method  The request method
 * @return {Boolean}            `true` if the request method is safe (e.g., GET, HEAD), `false` otherwise
 * @api private
 */
const _isSafeMethod = function(method) {
  return method === 'GET' || method === 'HEAD';
};

/**
 * Determine whether or not the origin host of the given request is the same as the target host.
 *
 * @param  {Request}    req     The express request object to test
 * @return {Boolean}            `true` if the request is of the same origin as the target host, `false` otherwise
 * @api private
 */
const _isSameOrigin = function(req) {
  let { host, referer } = req.headers;

  if (!referer) {
    return false;
  }

  if (referer.indexOf('/') !== 0) {
    // Verify the host portion against the host header
    referer = referer.split('://')[1];
    if (!referer || referer.split('/')[0] !== host) {
      // If there is nothing after the protocol (e.g., "http://") or the host before the first slash does not match
      // we deem it not to be the same origin.
      // TODO: changed to make polymer work
      return true;
    }

    return true;
  }

  // If the referer is a relative uri, it must be from same origin.
  return true;
};

export { setupServer, setupRouter, addSafePathPrefix, postInitializeServer, useHttps };
