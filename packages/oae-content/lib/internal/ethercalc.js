/*!
 * Copyright 2018 Apereo Foundation (AF) Licensed under the
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
import EthercalcClient from 'ethercalc-client';

import _ from 'underscore';
import cheerio from 'cheerio';

import { logger } from 'oae-logger';

import * as ContentDAO from './dao';

const log = logger('ethercalc');

let ethercalcConfig = null;
let ethercalcServers = null;

const SOCIAL_CALC_FORMAT_BEGIN_LINE = 'socialcalc:version:1.0';
const SOCIAL_CALC_FORMAT_END_LINE = '--SocialCalcSpreadsheetControlSave--';
const TABLE_ELEMENT = 'table';

/**
 * Refresh the runtime ethercalc configuration (host, port, etc...) with the one provided. More
 * documentation about the ethercalc configuration may be found in the `config.ethercalc` key of the
 * default config.js file.
 *
 * @param  {Object}  _ethercalcConfig    The ethercalc config from config.js
 */
const refreshConfiguration = function(_ethercalcConfig) {
  ethercalcConfig = _ethercalcConfig;
  ethercalcServers = _ethercalcConfig.map(eachConfig => {
    return {
      config: eachConfig,
      client: new EthercalcClient(eachConfig.host, eachConfig.port, eachConfig.protocol, eachConfig.timeout)
    };
  });
};

const _pickARandomServer = () => {
  return ethercalcServers[Math.floor(Math.random() * ethercalcServers.length)];
};

/**
 * Get the Ethercalc configuration.
 *
 * @return {Object} The Ethercalc configuration.
 */
const getConfig = function() {
  return ethercalcConfig;
};

/**
 * Creates a new spreadsheet via the Ethercalc API.
 *
 * @param  {Object}     content                         An object containing the data for an Ethercalc room
 * @param  {Function}   callback                        Standard callback function
 * @param  {Object}     callback.err                    An error that occurred, if any
 * @param  {Object}     callback.snapshot               A snapshot containing data for new Ethercalc room
 */
const createRoom = function(content, callback) {
  const someEthercalcServer = _pickARandomServer();
  const { contentId } = content;
  let roomId = null;
  log().trace({ contentId }, 'Creating Ethercalc room');
  someEthercalcServer.client
    .createRoom()
    .then(data => {
      // Ethercalc returns the relative path so strip out starting /
      roomId = data.slice(1);
      log().info({ contentId, ethercalcRoomId: roomId }, 'Created Ethercalc room');
      return callback(null, roomId);
    })
    .catch(error => {
      log().error(
        { err: error, contentId, ethercalcRoomId: roomId, ethercalc: someEthercalcServer.config.host },
        'Could not create Ethercalc room'
      );
      return callback(error);
    });
};

/**
 * Deletes an existing Ethercalc room via the Ethercalc API.
 *
 * @param  {String}     roomId          The id of the Ethercalc room that should be deleted
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const deleteRoom = function(roomId, callback) {
  const someEthercalcServer = _pickARandomServer();
  log().trace({ roomId, ethercalc: someEthercalcServer.config.host }, 'Deleting Ethercalc room');

  someEthercalcServer.client
    .deleteRoom(roomId)
    .then(deleted => {
      if (deleted) {
        log().info('Deleted Ethercalc room');
        return callback(null);
      }

      log().error(
        { code: 500, msg: 'Encountered error while deleting Ethercalc room' },
        'Encountered error while deleting Ethercalc room'
      );
      return callback({ code: 500, msg: 'Could not delete Ethercalc room' });
    })
    .catch(error => {
      log().error(
        { err: error, roomId, ethercalc: someEthercalcServer.config.host },
        'Could not delete Ethercalc room'
      );
      return callback(error);
    });
};

/**
 * Get the HTML for a room
 *
 * @param  {String}     roomId          The id for which the HTML should be retrieved from ethercalc
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {String}     callback.html   The HTML for this room
 */
const getHTML = function(roomId, callback) {
  const someEthercalcServer = _pickARandomServer();
  log().trace({ roomId, ethercalc: someEthercalcServer.config.host }, 'Getting Ethercalc room as HTML');
  someEthercalcServer.client
    .getHTML(roomId)
    .then(html => {
      if (!_isHtmlDocument(html)) {
        log().error(
          { roomId, ethercalc: someEthercalcServer.config.host },
          'Ethercalc sheet contents are not valid HTML'
        );
        return callback({ code: 500, msg: 'Ethercalc sheet contents are not valid HTML' });
      }

      return callback(null, html);
    })
    .catch(error => {
      log().error(
        { err: error, roomId, ethercalc: someEthercalcServer.config.host },
        'Could not grab the HTML from ethercalc'
      );
      return callback({ code: 500, msg: 'Could not grab the HTML from ethercalc' });
    });
};

/**
 * Get the JSON for a room
 *
 * @param  {String}     roomId          The id for which the JSON should be retrieved from ethercalc
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {String}     callback.html   The JSON for this room
 */
const getJSON = function(roomId, callback) {
  const someEthercalcServer = _pickARandomServer();
  log().trace({ roomId, ethercalc: someEthercalcServer.config.host }, 'Getting Ethercalc room as JSON');
  someEthercalcServer.client
    .getJSON(roomId)
    .then(json => {
      if (json) {
        return callback(null, json);
      } else {
        log().error(
          { roomId, ethercalc: someEthercalcServer.config.host },
          'Ethercalc sheet contents are not valid JSON'
        );
        return callback({ code: 500, msg: 'Ethercalc sheet contents are not valid JSON' });
      }
    })
    .catch(error => {
      log().error(
        { err: error, roomId, ethercalc: someEthercalcServer.config.host },
        'Could not grab the JSON from ethercalc'
      );
      return callback({ code: 500, msg: 'Could not grab the JSON from ethercalc' });
    });
};

/**
 * Fetch an ethercalc room
 *
 * @param  {String}     roomId          The content id for which the HTML should be retrieved from ethercalc
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {String}     callback.data   This room in socialcalc format
 */
const getRoom = function(roomId, callback) {
  const someEthercalcServer = _pickARandomServer();
  log().trace({ roomId, ethercalc: someEthercalcServer.config.host }, 'Getting Ethercalc room in socialcalc format');
  someEthercalcServer.client
    .getRoom(roomId)
    .then(data => {
      if (!_isSCDocument(data)) {
        log().error(
          { roomId, ethercalc: someEthercalcServer.config.host },
          'Ethercalc sheet contents are not in correct socialcalc format'
        );
        return callback({ code: 500, msg: 'Ethercalc sheet contents are not in correct socialcalc format' });
      }

      log().trace({ roomId, ethercalc: someEthercalcServer.config.host }, 'Fetched ethercalc room');
      return callback(null, data);
    })
    .catch(error => {
      log().error(
        { err: error, roomId, ethercalc: someEthercalcServer.config.host },
        'Could not fetch Ethercalc room in socialcalc format'
      );
      return callback({ code: 500, msg: 'Could not fetch Ethercalc room in socialcalc format' });
    });
};

/**
 * Set the contents for a room
 *
 * @param  {String}     roomId          The content id for which the HTML should be set in ethercalc
 * @param  {String}     snapshot        The data that should be used for the ethercalc room in CSV format
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const setSheetContents = function(roomId, snapshot, callback) {
  const someEthercalcServer = _pickARandomServer();
  log().trace({ roomId, snapshot, ethercalc: someEthercalcServer.config.host }, 'Setting Ethercalc contents');

  someEthercalcServer.client
    .overwrite(roomId, snapshot, 'csv')
    // eslint-disable-next-line no-unused-vars
    .then(response => {
      return callback(null, response);
    })
    .catch(error => {
      log().error(
        { err: error, roomId, ethercalc: someEthercalcServer.config.host },
        'Could not set sheet contents on the Ethercalc instance'
      );
      return callback({ code: 500, msg: 'Could not set sheet contents on the Ethercalc instance' });
    });
};

/**
 * Joins the current user in an ethercalc room.
 * This assumes that the current user has access to the collaborative spreadsheet.
 *
 * @param  {Context}    ctx                     Standard context object containing the current user and the current tenant
 * @param  {Content}    contentObj              The content object for the room that should be joined
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {String}     callback.url            The URL that can be used to embed the room
 */
const joinRoom = function(ctx, contentObj, callback) {
  const user = ctx.user();
  if (!user) {
    return callback({ code: 401, msg: 'Anonymous users are not allowed to join collaborative spreadsheets' });
  }

  log().trace(`Joining Ethercalc room ${contentObj.ethercalcRoomId} as user ${user}`);

  // Get the language for the current user.
  const language = user.locale ? _.first(user.locale.split('_')) : 'en';
  const url = getRoomUrl(contentObj, user.id, language);

  return callback(null, { url });
};

/**
 * Get the URL where users can view the ethercalc room.
 * This can be used to embed in the page via an iframe.
 * The URL will be of the form:
 *     http://<ethercalc host>:<ethercalc port>/<room ID>?contentId=<contentId>&displayName=<content.displayName>&authorId=<authorId>&language=en
 *
 * @param  {Content}    contentObj                  The content object for the room that should be joined
 * @param  {String}     userId                      The ID of the user in OAE
 * @param  {String}     [language]                  The 2 character string that identifies the user's prefered language
 * @return {String}                                 The URL to the room that can be used to embed in a page
 */
// eslint-disable-next-line no-unused-vars
const getRoomUrl = function(contentObj, userId, language) {
  const randomServerIndex = Math.floor(Math.random() * ethercalcServers.length);
  return url.format({
    pathname: `/ethercalc/${randomServerIndex}/${contentObj.ethercalcRoomId}`,
    query: {
      author: userId,
      content: contentObj.id
    }
  });
};

/**
 * Determine if the given sheet is empty. Works with both socialcalc and HTML formats.
 *
 * @param  {String}     content             The content of the ethercalc spreadsheet
 * @return {Boolean}                        Whether or not the content is considered empty
 */
const isContentEmpty = function(content) {
  if (!content) {
    return true;
  }

  if (_isHtmlDocument(content)) {
    // Empty sheets only have a single cell
    if (content.match(/cell_[\w][\d]/g).length === 1) {
      // Make sure that cell is empty
      const $ = cheerio.load(content);
      return $('#cell_A1').text();
    }

    return false;
  }

  // Check for existing cell values in social calc format. Cells are in format: `cell:A1:t:test`
  return content.test(/\bcell\:\w\d/g);
};

/**
 * Determine if one set of ethercalc HTML content is equal to another.
 *
 * @param  {String}     one         Content of one ethercalc document
 * @param  {String}     other       Content of another ethercalc document
 * @return {Boolean}                Whether or not the content is equivalent to eachother
 */
const isContentEqual = function(one, other) {
  if (one === other) {
    return true;
  }

  if (!one || !other) {
    return false;
  }

  const $one = cheerio.load(one);
  const $other = cheerio.load(other);
  return $one(TABLE_ELEMENT).html() === $other(TABLE_ELEMENT).html();
};

/**
 * Record which user has edited an Ethercalc room
 *
 * @param  {Object}     data                    An object containing the OAE user ID and content ID
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @api private
 */
const setEditedBy = function(data, callback) {
  if (data.contentId && data.userId) {
    ContentDAO.Ethercalc.setEditedBy(data.contentId, data.userId, function(err) {
      if (err) {
        return callback(err);
      }

      return callback(null);
    });
  }
};

/**
 * Determine if the given content is a valid HTML table
 *
 * @param  {String}     content     The content to check
 * @return {Boolean}                Whether or not the content is a valid HTML spreadsheet
 * @api private
 */
const _isHtmlDocument = function(content) {
  if (!content) {
    return false;
  }

  const $ = cheerio.load(content);
  return $(TABLE_ELEMENT).length > 0;
};

/**
 * Determine if the given content is in valid socialcalc format
 *
 * @param  {String}     content     The content to check
 * @return {Boolean}                Whether or not the content is valid socialcalc
 * @api private
 */
const _isSCDocument = function(content) {
  if (!content) {
    return false;
  }

  content = content.trim();

  // FIXME This isn't ideal, consider replacing with regexp which is also not ideal
  return content.startsWith(SOCIAL_CALC_FORMAT_BEGIN_LINE) && content.endsWith(SOCIAL_CALC_FORMAT_END_LINE);
};

export {
  refreshConfiguration,
  getConfig,
  createRoom,
  deleteRoom,
  getHTML,
  getJSON,
  getRoom,
  setSheetContents,
  joinRoom,
  getRoomUrl,
  isContentEmpty,
  isContentEqual,
  setEditedBy
};
