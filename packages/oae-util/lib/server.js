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

// import http from 'node:http';
import { fileURLToPath } from 'node:url';
import _ from 'underscore';
import {
  forEach,
  last,
  head,
  prop,
  nth,
  split,
  compose,
  pipe,
  is,
  not,
  indexOf,
  equals,
  either,
  ifElse,
  identity
} from 'ramda';

import fastifyPassport from 'fastify-passport';
import fastifySecureSession from 'fastify-secure-session';
import bodyParser from 'body-parser';
import Fastify from 'fastify';

import path from 'node:path';
import { readFileSync } from 'node:fs';

import fastifyMultipart from 'fastify-multipart';
import fastifyFormbody from 'fastify-formbody';
import CorsPlugin from 'fastify-cors';

import ExpressPlugin from 'fastify-express';

import { logger } from 'oae-logger';

import * as TelemetryAPI from 'oae-telemetry';
import { dirname } from 'node:path';
import OaeEmitter from './emitter.js';

import multipart from './middleware/multipart.js';
import * as Shutdown from './internal/shutdown.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const log = logger('oae-server');

const notExists = compose(not, Boolean);
const SLASH = '/';
const PROTOCOL_SEPARATOR = '://';
const isValidReferer = compose(not, equals(0), indexOf(SLASH));

const isGET = equals('GET');
const isHEAD = equals('HEAD');
const isArray = is(Array);

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
const setupServer = async function (port, _config) {
  // Cache the config
  config = _config;

  // eslint-disable-next-line new-cap
  const app = Fastify({
    logger: true
  });

  await app.register(ExpressPlugin);
  await app.register(fastifyMultipart);
  await app.register(fastifyFormbody);
  app.register(CorsPlugin, { origin: true });

  // app.register(fastifySecureSession, { key: readFileSync(path.join(__dirname, 'bajouras')) });
  // initialize fastify-passport and connect it to the secure-session storage. Note: both of these plugins are mandatory.
  app.register(fastifyPassport.initialize());
  app.register(fastifyPassport.secureSession());

  // TODOdebug
  app.setErrorHandler(function (error, request, reply) {
    // Log error
    this.log.error(error);
    // Send error response
    reply.status(409).send({ ok: false });
  });

  // Expose the HTTP server on the express app server so other modules can hook into it
  // app.httpServer = http.createServer(app);

  // Start listening for requests
  // app.httpServer.listen(port);
  // await app.listen(port);

  // Don't output pretty JSON,
  // app.set('json spaces', 0);

  _applyAvailabilityHandling(app.httpServer, app, port);

  /*!
   * We support the following type of request encodings:
   *
   *  * urlencoded (regular POST requests)
   *  * application/json
   *  * multipart (file uploads)
   *
   * A maximum limit of 250kb is imposed for `urlencoded` and `application/json` requests.
   * This limit only applies to the *incoming request data*.
   * If the client needs to send more than 250kb, it should consider
   * using a proper multipart form request.
   */
  // TODO check these out with fastify: are they still needed?
  app.use(bodyParser.urlencoded({ limit: '250kb', extended: true }));
  app.use(bodyParser.json({ limit: '250kb' }));
  app.use(multipart(config.files));

  // Add telemetry before we do anything else
  app.use((request, response, next) => {
    TelemetryAPI.request(request, response);
    return next();
  });

  // Add CORS headers, cookies won't be passed in so all cross domain requests will be anonymous
  // app.use(cors({ origin: true }));
  // TODO make sure we can delete this!
  /*
  app.use((request, response, next) => {
    response.header('Access-Control-Allow-Origin', '*');
    response.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    return next();
  });
  */

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
const setupRouter = function (app) {
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
  that.on = function (method, route, handler, telemetryUrl) {
    const aintValidRoute = pipe(either(is(String), _.isRegExp), not)(route);
    const aintValidHandler = pipe(either(is(Function), is(Array)), not)(handler);
    const aintValidMethod = pipe(is(String), not)(method);

    switch (true) {
      case aintValidMethod:
        throw new TypeError(
          `Invalid type for request method ${method} when binding route ${route.toString()} to OAE Router`
        );
      case aintValidRoute:
        throw new Error(`Invalid route path ${route.toString()} while binding route to OAE Router`);
      case aintValidHandler:
        throw new Error(`Invalid method handler given for route ${route.toString()} while binding to OAE Router`);
      default:
        break;
    }

    that.routes.push({
      method,
      route,
      handler,
      telemetryUrl
    });
  };

  function setupHandlers(route) {
    const preHandler = [];
    const telemetryCount = function (request, _response, next) {
      request.telemetryUrl = route.telemetryUrl || route.route.replace(/:/, '');
      next();
    };

    preHandler.push(telemetryCount);

    const preValidation = [];
    let { handler } = route;

    if (isArray(handler)) {
      preHandler.push(head(handler));
      // preValidation.push(head(handler));
      handler = last(handler);
    }

    // preValidation = ifElse(is(Array), head, identity)(preValidation);

    return { preHandler, handler, preValidation };
  }

  function registerRoute(route) {
    const { preHandler, handler, preValidation } = setupHandlers(route);

    try {
      app.log.info(`Registering route ${route.method.toUpperCase()} ${route.route}...`);
      app.route({
        method: route.method.toUpperCase(),
        url: route.route,
        handler,
        preHandler,
        preValidation
      });
    } catch (error) {
      log().error(error);
      // TODO debug
      console.log({ error });
    }
  }

  /**
   * Bind all the routes, this should only be called once by the server initialization
   */
  that.registerRoutes = () => {
    forEach(registerRoute, that.routes);
  };

  return that;
};

/**
 * Add a path to the list of safe paths. Paths added here will not be protected against CSRF
 * attacks. This is common for endpoints that have other verification mechanisms such as Shibboleth.
 *
 * @param  {String}     pathPrefix  A path prefix that will not be validated against CSRF attacks
 */
const addSafePathPrefix = function (pathPrefix) {
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
const postInitializeServer = function (app, router) {
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
  app.use((request, response, next) => {
    const aintSafeMethod = pipe(prop('method'), _isSafeMethod, not)(request);
    const aintSafePath = pipe(_isSafePath, not)(request);
    const aintSafeOrigin = pipe(_isSameOrigin, not)(request);

    // If earlier middleware determined that CSRF is not required, we can skip the check
    if (not(request._checkCSRF)) return next();

    if (aintSafeMethod && aintSafePath && aintSafeOrigin) {
      log().warn(
        {
          method: request.method,
          host: request.headers.host,
          referer: request.headers.referer,
          targetPath: request.path
        },
        'CSRF validation failed: attempted to execute unsafe operation from untrusted origin'
      );
      return _abort(response, 500, 'CSRF validation failed: attempted to execute unsafe method from untrusted origin');
    }

    return next();
  });

  // Bind routes
  router.registerRoutes();

  // Catch-all error handler
  const appTelemetry = TelemetryAPI.telemetry('server');
  app.use((error, request, response, _next) => {
    appTelemetry.incr('error.count');
    log(request.ctx).error(
      {
        err: error,
        req: request,
        res: response
      },
      'Unhandled error in the request chain, caught at the default error handler'
    );
    response.status(500).send('An unexpected error occurred');
  });
};

/**
 * Whether or not the server is running behind HTTPs.
 *
 * @return {Boolean}   Whether or not the server is running behind https.
 */
const useHttps = function () {
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
const _applyAvailabilityHandling = function (server, app, port) {
  let isAvailable = false;

  OaeEmitter.on('ready', () => {
    // The container is initialized, start accepting web requests
    isAvailable = true;
  });

  /**
   * Register a pre-shutdown handler that will close this fastify server
   * to stop receiving requests
   */
  Shutdown.registerPreShutdownHandler('fastify-server-' + port, null, (callback) => {
    log().info('Beginning shutdown.');

    // Stop accepting web requests
    isAvailable = false;

    server.close(() => {
      log().info('Server is now shut down.');
      callback();
    });
  });

  // Notify the front-end proxy that we are unable to accept requests if isAvailable is false
  app.use((request, response, next) => {
    if (!isAvailable) {
      log().info({ path: request.path }, 'Rejecting request during shutdown with 502 error');
      response.setHeader('Connection', 'close');
      return response.status(502).send('Server is in the process of restarting');
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
const _abort = function (response, code, message) {
  response.setHeader('Connection', 'Close');
  return response.status(code).send(message);
};

/**
 * Determines if the target path for a request is considered "safe" from CSRF attacks.
 *
 * @param  {Request}    req     The express request object
 * @return {Boolean}            `true` if the path is safe from CSRF attacks, `false` otherwise
 * @api private
 */
const _isSafePath = function (request) {
  const { path } = request;
  const matchingPaths = _.filter(safePathPrefixes, (safePathPrefix) => path.indexOf(safePathPrefix) === 0);
  return matchingPaths.length > 0;
};

/**
 * Determine whether or not the given request method is considered "safe"
 *
 * @param  {String}     method  The request method
 * @return {Boolean}            `true` if the request method is safe (e.g., GET, HEAD), `false` otherwise
 * @api private
 */
const _isSafeMethod = (method) => either(isGET, isHEAD)(method);

/**
 * Determine whether or not the origin host of the given request is the same as the target host.
 *
 * @param  {Request}    req     The express request object to test
 * @return {Boolean}            `true` if the request is of the same origin as the target host, `false` otherwise
 * @api private
 */
const _isSameOrigin = function (request) {
  const { host, referer } = request.headers;

  const isSameAsHost = equals(host);
  const getHostPortion = compose(nth(1), split(PROTOCOL_SEPARATOR));
  const getHostFirstToken = compose(nth(0), split(SLASH));
  const isNotSameOrigin = compose(not, isSameAsHost, getHostFirstToken);

  if (notExists(referer)) return false;

  if (isValidReferer(referer)) {
    // Verify the host portion against the host header
    const hostPortionOfReferer = getHostPortion(referer);

    /**
     * If there is nothing after the protocol (e.g., "http://") or the host before
     * the first slash does not match we deem it not to be the same origin.
     */
    if (either(notExists, isNotSameOrigin)(hostPortionOfReferer)) return false;
  }

  return true;
};

export { setupServer, setupRouter, addSafePathPrefix, postInitializeServer, useHttps };
