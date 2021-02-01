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

import url from 'url';
import util from 'util';
import _ from 'underscore';
import cheerio from 'cheerio';

import { logger } from 'oae-logger';
import * as etherpad from 'etherpad-lite-client';

const log = logger('etherpad');

let etherpadServers = [];
let etherpadConfig = null;

/**
 * Refresh the runtime etherpad configuration (host list, api key, etc...) with the one provided. More
 * documentation about the etherpad configuration may be found in the `config.etherpad` key of the
 * default config.js file.
 *
 * @param  {Object}   etherpadConfig    The etherpad config from config.js
 */
const refreshConfiguration = function (_etherpadConfig) {
  // Remember this config.
  etherpadConfig = _etherpadConfig;

  // Rebuild the servers list and recreate from the configuration
  etherpadServers = [];
  _.each(etherpadConfig.hosts, (host, index) => {
    // Create the etherpad client with its sharding index
    etherpadServers.push({
      index,
      client: etherpad.connect({
        apikey: _etherpadConfig.apikey,
        host: host.host,
        port: host.port
      })
    });
  });
};

/**
 * Get the etherpad configuration.
 *
 * @return {Object} The etherpad configuration.
 */
const getConfig = function () {
  return etherpadConfig;
};

/**
 * Creates a pad via the etherpad API.
 *
 * @param  {String}     contentId                       The ID of the collaborative document for which an etherpad pad should be created
 * @param  {Function}   callback                        Standard callback function
 * @param  {Object}     callback.err                    An error that occurred, if any
 * @param  {Object}     callback.ids                    An object containing the etherpad IDs for this collaborative document
 * @param  {String}     callback.ids.etherpadGroupId    The etherpad identifier for the group that was created
 * @param  {String}     callback.ids.etherpadPadId      The etherpad identifier for the pad that was created
 */
const createPad = function (contentId, callback) {
  // Because etherpad has a slightly weird system of authenticating users
  // we need to create a group *PER* content item and then create a group pad in this group

  // Get the client that points to the correct etherpad instance
  const client = getClient(contentId);

  // Create the group.
  const args = {
    groupMapper: contentId
  };
  log().trace({ contentId }, 'Creating etherpad group');
  client.createGroupIfNotExistsFor(args, (error, groupData) => {
    if (error) {
      log().error({ err: error, contentId, etherpad: client.options.host }, 'Could not create an etherpad group');
      return callback({ code: 500, msg: error.message });
    }

    // Create the group pad.
    const groupPad = {
      groupID: groupData.groupID,
      padName: contentId
    };
    log().trace({ contentId, groupID: groupData.groupID }, 'Creating etherpad group pad');
    client.createGroupPad(groupPad, (error, padData) => {
      if (error) {
        log().error({ err: error, contentId, etherpad: client.options.host }, 'Could not create an etherpad group pad');
        return callback({ code: 500, msg: error.message });
      }

      // Store these IDs in the database.
      const ids = {
        etherpadGroupId: groupData.groupID,
        etherpadPadId: padData.padID
      };
      log().info({ contentId, groupID: groupData.groupID, padID: padData.padID }, 'Created an etherpad group and pad');
      callback(null, ids);
    });
  });
};

/**
 * Get the HTML for a pad
 *
 * @param  {String}     contentId       The content id for which the HTML should be retrieved from etherpad
 * @param  {String}     padId           The ID of the pad for which to retrieve the HTML
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {String}     callback.html   The HTML fragment for this pad
 */
const getHTML = function (contentId, padId, callback) {
  log().trace({ contentId }, 'Getting etherpad HTML');
  const client = getClient(contentId);
  client.getHTML({ padID: padId }, (error, data) => {
    if (error) {
      log().error(
        { err: error, padID: padId, contentId, etherpad: client.options.host },
        'Could not grab the HTML from etherpad'
      );
      return callback({ code: 500, msg: 'Could not grab the HTML from etherpad' });
    }

    return callback(null, data.html);
  });
};

/**
 * Set the html for a pad
 *
 * @param  {String}     contentId       The content id for which the HTML should be set in etherpad
 * @param  {String}     padId           The ID of the pad for which to set the HTML
 * @param  {String}     html            The HTML fragment to store in etherpad
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const setHTML = function (contentId, padId, html, callback) {
  log().trace({ contentId, html }, 'Setting etherpad html');

  // Although Etherpad exposes an API to set the HTML of a pad, it doesn't accept HTML fragments. We encapsulate the HTML fragment into a
  // simple page and submit that instead. We default null or undefined values to the empty string, so we can safely wrap them
  try {
    html = html || '';
    html = _ensureHtmlDocument(html);
  } catch (error) {
    log().error({ err: error, html, contentId }, 'Caught an error when trying to wrap an HTML fragment');
    return callback({ code: 500, msg: 'Unable to set the etherpad HTML' });
  }

  const client = getClient(contentId);
  // eslint-disable-next-line no-unused-vars
  client.setHTML({ padID: padId, html }, (error, data) => {
    if (error) {
      log().error(
        { err: error, padID: padId, contentId, html, etherpad: client.options.host },
        'Could not set the html on the etherpad instance'
      );
      return callback({ code: 500, msg: 'Could not set the html on the etherpad instance' });
    }

    return callback(null);
  });
};

/**
 * Joins the current user in an etherpad.
 * This assumes that the current user has access to the collaborative document.
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {Content}    contentObj              The content object for the pad that should be joined
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.data           The object containing the necessary information to join a document in the UI
 * @param  {String}     callback.data.url       The URL that can be used to embed the pad
 * @param  {Object}     callback.data.author    The author object that was retrieved/created from/in etherpad for the current user
 */
const joinPad = function (ctx, contentObject, callback) {
  if (!ctx.user()) {
    return callback({
      code: 401,
      msg: 'Anonymous users are not allowed to join collaborative documents'
    });
  }

  // Get the etherpad client that will handle this content ID
  const client = getClient(contentObject.id);

  /*
   *   Joining a pad consists out of three things:
   *    1/ Mapping the OAE user to an etherpad author
   *    2/ Creating a session for the etherpad author
   *    3/ Returning a url to the UI. It should contain
   *       * The server etherpad is running on (ex: http://7.etherpad.oae.com/)
   *       * The pad URI (ex: /oae/c_cam_abc123)
   *       * The session ID (ex: ?sessionID=s.32b01f91d0e2c9a344)
   */
  const args = {
    authorMapper: ctx.user().id,
    name: ctx.user().displayName
  };
  client.createAuthorIfNotExistsFor(args, (error, author) => {
    if (error) {
      log().error(
        {
          err: error,
          contentId: contentObject.id,
          principalId: ctx.user().id,
          etherpad: client.options.host
        },
        'Could not create an etherpad author'
      );
      return callback({ code: 500, msg: 'Could not create an author in the etherpad system' });
    }

    const session = {
      groupID: contentObject.etherpadGroupId,
      authorID: author.authorID,
      validUntil: Math.round(Date.now() / 1000) + 60 * 60 * 24
    };
    log().trace(session, 'Creating a session');
    client.createSession(session, (error, data) => {
      if (error) {
        log().error(
          {
            err: error,
            contentId: contentObject.id,
            principalId: ctx.user().id,
            etherpad: client.options.host
          },
          'Could not create an etherpad session'
        );
        return callback({ code: 500, msg: 'Could not create an etherpad session for this user' });
      }

      // Get the language for the current user.
      let language = 'en';
      const { locale } = ctx.user();
      if (locale) {
        language = locale.split('_')[0];
      }

      // Construct the URL
      const url = getPadUrl(contentObject, ctx.user().id, data.sessionID, author.authorID, language);
      return callback(null, { url, author });
    });
  });
};

/**
 * Get the Etherpad author IDs of the users in the pad right now
 *
 * @param  {String}     contentId               The unique OAE identifier of the collaborative document
 * @param  {[String]}   padId                   The unique Etherpad identifier of the collaborative document
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {String[]}   callback.authorIds      A list of ids of authors that are online right now
 */
const getOnlineAuthors = function (contentId, padId, callback) {
  const client = getClient(contentId);
  client.padUsers({ padID: padId }, (error, data) => {
    if (error) {
      log().error({ err: error, contentId, padId }, 'Could not get the online users of a pad');
      return callback({ code: 500, msg: 'Could not get the online users of a pad' });
    }

    return callback(null, _.pluck(data.padUsers, 'id'));
  });
};

/**
 * Get the URL where users can view the etherpad pad.
 * This can be used to embed in the page via an iframe.
 * The URL will be of the form:
 *     /etherpad/0/oae/<pad ID>?sessionID=<session ID>&pathPrefix=/etherpad/0&contentId=<contentId>&userId=<userId>&authorId=<authorId>&language=en
 *
 * A couple of notes:
 *     *   The URL that will be embedded should be on the same domain as the current tenant.
 *         This is because Safari will not set cookies that are coming from another domain inside an iframe.
 *     *   We try to shard based on the content ID so that the load is spread across the etherpad cluster.
 *         Note that this is *NOT* balancing based on load, as some documents may be more popular than others.
 *     *   The `/etherpad/0` will have to be stripped off by nginx.
 *     *   We point to `/oae/<pad ID>` which is an endpoint exposed by the `ep_oae` plugin.
 *         That endpoint will take care of sending the session cookie.
 *     *   We need to send a pathPrefix so the `ep_oae` endpoint can construct the
 *         /etherpad/0/p/<pad ID> URL. Etherpad can take it from there.
 *     *   We pass the `contentId`, `userId` and `authorId` so Etherpad can send a message back to OAE
 *         when the user leaves the pad and triggers a "publish" event.
 *     *   We send the `displayName` of the content item to allow Etherpad to construct the file name of exported PDFs.
 *
 * @param  {Content}    contentObj                  The content object for the pad that should be joined
 * @param  {String}     userId                      The ID of the user in OAE
 * @param  {String}     sessionId                   The ID of the session that should be included in the query string
 * @param  {String}     authorId                    The ID of the user in etherpad
 * @param  {String}     [language]                  The 2 character string that identifies the user's prefered language
 * @return {String}                                 The URL to the pad that can be used to embed in a page
 */
const getPadUrl = function (contentObject, userId, sessionId, authorId, language) {
  const serverIndex = _getServer(contentObject.id).index;
  return url.format({
    pathname: '/etherpad/' + serverIndex + '/oae/' + contentObject.etherpadPadId,
    query: {
      authorId,
      contentId: contentObject.id,
      displayName: contentObject.displayName,
      language,
      pathPrefix: '/etherpad/' + serverIndex,
      sessionID: sessionId,
      userId
    }
  });
};

/**
 * Determine if one set of etherpad HTML content is equal to another. This function takes care of
 * normalizing the HTML to ensure no vestigial differences skew the results. It also takes care of
 * handling content that comes from a variety of versions of etherpad
 *
 * @param  {String}     one         Content of one etherpad document
 * @param  {String}     other       Content of another etherpad document
 * @return {Boolean}                Whether or not the content is equivalent to eachother
 */
const isContentEqual = function (one, other) {
  if (one === other) {
    return true;
  }

  if (!one || !other) {
    return false;
  }

  const $one = _createEtherpadContent$(one);
  const $other = _createEtherpadContent$(other);
  return $one('body').html() === $other('body').html();
};

/**
 * Determine if the given etherpad content is considered empty. This function takes care of
 * vestigial white-space in documents to determine if it is visually empty or not
 *
 * @param  {String}     content     The content of the etherpad document
 * @return {Boolean}                Wehther or not the content is considered empty
 */
const isContentEmpty = function (content) {
  if (!content) {
    return true;
  }

  const $ = _createEtherpadContent$(content);
  return _.isEmpty($('body').text().trim());
};

/**
 * Get an etherpad client that can talk to an etherpad API.
 *
 * @param  {String}     contentId   The ID of the piece of content for which we need to retrieve an etherpad client.
 * @return {Client}                 The request etherpad client.
 */
const getClient = function (contentId) {
  return _getServer(contentId).client;
};

/**
 * Create a `cheerio` object ($) that has an etherpad document parsed as an HTML document. This function
 * takes care of differences between etherpad versions to ensure a valid HTML document that contains
 * a `body` element is always parsed
 *
 * @param  {String}     content     The content for which to create a cheerio object
 * @return {Cheerio}                The cheerio object that can be used to inspect and manipulate the content DOM
 * @api private
 */
const _createEtherpadContent$ = function (content) {
  const $ = cheerio.load(content);

  // If this is content was saved using etherpad 1.3 or later, it will be wrapped in an HTML
  // document that has a body. So simply return the parsed document as-is
  if ($('body').length > 0) {
    return $;
  }

  // If this content was saved using etherpad 1.2 or earlier, there will not be an HTML document
  // around it. Create one and parse it
  return cheerio.load(_wrapInHtmlBody(content));
};

/**
 * Ensure the given set of content is a valid HTML document
 *
 * @param  {String}     content     The content that will be wrapped in a valid HTML document structure, if not already
 * @return {String}                 The given content document wrapped in a valid HTML document
 * @api private
 */
const _ensureHtmlDocument = function (content) {
  if (_isHtmlDocument(content)) {
    return content;
  }

  return _wrapInHtmlBody(content);
};

/**
 * Determine if the given content is a valid HTML document with a body
 *
 * @param  {String}     content     The content to check
 * @return {Boolean}                Whether or not the content is a valid HTML document
 * @api private
 */
const _isHtmlDocument = function (content) {
  if (!content) {
    return false;
  }

  const $ = cheerio.load(content);
  return $('body').length > 0;
};

/**
 * Wrap the given content in a valid HTML body
 *
 * @param  {String}     content     The content to wrap
 * @return {String}                 The content wrapped in a valid HTML body
 * @api private
 */
const _wrapInHtmlBody = function (content) {
  return util.format('<!DOCTYPE HTML><html><body>%s</body></html>', content);
};

/**
 * Get the server that is tied to a content ID.
 *
 * @param  {String}     contentId   The content ID for which the server should be retrieved.
 * @return {Object}                 The server tied to a collabration document.
 * @api private
 */
const _getServer = function (contentId) {
  const index = _hash(contentId, etherpadServers.length);
  return etherpadServers[index];
};

/**
 * Hashes a string and returns the index.
 *
 * @param  {String}     str     The string to hash.
 * @param  {String}     nr      The upper bound (exclusive) for the index.
 * @return {Number}             The index.
 * @api private
 */
const _hash = function (string, nr) {
  let code = 0;
  for (let i = 0; i < string.length; i++) {
    code += string.charCodeAt(i);
  }

  return code % nr;
};

export {
  refreshConfiguration,
  getConfig,
  createPad,
  getHTML,
  setHTML,
  joinPad,
  getOnlineAuthors,
  getPadUrl,
  isContentEqual,
  isContentEmpty,
  getClient
};
