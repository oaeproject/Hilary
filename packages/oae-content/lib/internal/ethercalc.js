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

import url from 'node:url';
import EthercalcClient from 'ethercalc-client';
import cheerio from 'cheerio';
import { logger } from 'oae-logger';

import {
  curry,
  startsWith,
  endsWith,
  or,
  and,
  slice,
  map,
  head,
  split,
  test,
  trim,
  __,
  gt,
  equals,
  length,
  match,
  compose,
  not,
  ifElse
} from 'ramda';
import * as ContentDAO from './dao.js';

const log = logger('ethercalc');

let ethercalcConfig = null;
let ethercalcServers = null;

const ENGLISH = 'en';
const DEFAULT_SNAPSHOT = '';
const SOCIAL_CALC_FORMAT_BEGIN_LINE = 'socialcalc:version:1.0';
const SOCIAL_CALC_FORMAT_END_LINE = '--SocialCalcSpreadsheetControlSave--';
const TABLE_ELEMENT = 'table';

// Auxiliary functions
const isDefined = Boolean;
const isNotDefined = compose(not, isDefined);
const greaterThanZero = gt(__, 0);
const equalsOne = equals(1);
const returnTrue = () => true;
const returnFalse = () => false;

/**
 * Refresh the runtime ethercalc configuration (host, port, etc...) with the one provided. More
 * documentation about the ethercalc configuration may be found in the `config.ethercalc` key of the
 * default config.js file.
 *
 * @param  {Object}  _ethercalcConfig    The ethercalc config from config.js
 */
const refreshConfiguration = (_ethercalcConfig) => {
  ethercalcConfig = _ethercalcConfig;
  ethercalcServers = map(
    (eachConfig) => ({
      config: eachConfig,
      client: new EthercalcClient(eachConfig.host, eachConfig.port, eachConfig.protocol, eachConfig.timeout)
    }),
    _ethercalcConfig
  );
};

const _pickARandomServer = () => ethercalcServers[Math.floor(Math.random() * ethercalcServers.length)];

/**
 * Get the Ethercalc configuration.
 *
 * @return {Object} The Ethercalc configuration.
 */
const getConfig = () => ethercalcConfig;

/**
 * Creates a new spreadsheet via the Ethercalc API.
 *
 * @param  {Object}     content                         An object containing the data for an Ethercalc room
 * @param  {Function}   callback                        Standard callback function
 * @param  {Object}     callback.err                    An error that occurred, if any
 * @param  {Object}     callback.snapshot               A snapshot containing data for new Ethercalc room
 */
const createRoom = async (content, callback) => {
  const someEthercalcServer = _pickARandomServer();
  const { contentId } = content;
  let roomId = null;
  log().trace({ contentId }, 'Creating Ethercalc room');

  try {
    const data = await someEthercalcServer.client.createRoom();
    // Ethercalc returns the relative path so strip out starting /
    roomId = slice(1, Number.POSITIVE_INFINITY, data);
    log().info({ contentId, ethercalcRoomId: roomId }, 'Created Ethercalc room');
    return callback(null, roomId);
  } catch (error) {
    log().error(
      { err: error, contentId, ethercalcRoomId: roomId, ethercalc: someEthercalcServer.config.host },
      'Could not create Ethercalc room'
    );
    return callback(error);
  }
};

/**
 * Deletes an existing Ethercalc room via the Ethercalc API.
 *
 * @param  {String}     roomId          The id of the Ethercalc room that should be deleted
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const deleteRoom = async (roomId, callback) => {
  const someEthercalcServer = _pickARandomServer();
  log().trace({ roomId, ethercalc: someEthercalcServer.config.host }, 'Deleting Ethercalc room');

  try {
    const deleted = await someEthercalcServer.client.deleteRoom(roomId);
    if (deleted) {
      log().info('Deleted Ethercalc room');
      return callback(null);
    }

    log().error(
      { code: 500, msg: 'Encountered error while deleting Ethercalc room' },
      'Encountered error while deleting Ethercalc room'
    );
    return callback({ code: 500, msg: 'Could not delete Ethercalc room' });
  } catch (error) {
    log().error({ err: error, roomId, ethercalc: someEthercalcServer.config.host }, 'Could not delete Ethercalc room');
    return callback(error);
  }
};

/**
 * Get the HTML for a room
 *
 * @param  {String}     roomId          The id for which the HTML should be retrieved from ethercalc
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {String}     callback.html   The HTML for this room
 */
const getHTML = async (roomId, callback) => {
  const someEthercalcServer = _pickARandomServer();
  log().trace({ roomId, ethercalc: someEthercalcServer.config.host }, 'Getting Ethercalc room as HTML');

  try {
    const html = await someEthercalcServer.client.getHTML(roomId);
    if (not(_isHtmlDocument(html))) {
      log().error(
        { roomId, ethercalc: someEthercalcServer.config.host },
        'Ethercalc sheet contents are not valid HTML'
      );
      return callback({ code: 500, msg: 'Ethercalc sheet contents are not valid HTML' });
    }

    return callback(null, html);
  } catch (error) {
    log().error(
      { err: error, roomId, ethercalc: someEthercalcServer.config.host },
      'Could not grab the HTML from ethercalc'
    );
    return callback({ code: 500, msg: 'Could not grab the HTML from ethercalc' });
  }
};

/**
 * Get the JSON for a room
 *
 * @param  {String}     roomId          The id for which the JSON should be retrieved from ethercalc
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {String}     callback.html   The JSON for this room
 */
const getJSON = async (roomId, callback) => {
  const someEthercalcServer = _pickARandomServer();
  log().trace({ roomId, ethercalc: someEthercalcServer.config.host }, 'Getting Ethercalc room as JSON');

  try {
    const json = await someEthercalcServer.client.getJSON(roomId);
    if (isDefined(json)) return callback(null, json);

    log().error({ roomId, ethercalc: someEthercalcServer.config.host }, 'Ethercalc sheet contents are not valid JSON');
    return callback({ code: 500, msg: 'Ethercalc sheet contents are not valid JSON' });
  } catch (error) {
    log().error(
      { err: error, roomId, ethercalc: someEthercalcServer.config.host },
      'Could not grab the JSON from ethercalc'
    );
    return callback({ code: 500, msg: 'Could not grab the JSON from ethercalc' });
  }
};

/**
 * Fetch an ethercalc room
 *
 * @param  {String}     roomId          The content id for which the HTML should be retrieved from ethercalc
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @param  {String}     callback.data   This room in socialcalc format
 */
const getRoom = async (roomId, callback) => {
  const someEthercalcServer = _pickARandomServer();
  log().trace({ roomId, ethercalc: someEthercalcServer.config.host }, 'Getting Ethercalc room in socialcalc format');

  try {
    const data = await someEthercalcServer.client.getRoom(roomId);
    if (not(_isSCDocument(data))) {
      log().error(
        { roomId, ethercalc: someEthercalcServer.config.host },
        'Ethercalc sheet contents are not in correct socialcalc format'
      );
      return callback({ code: 500, msg: 'Ethercalc sheet contents are not in correct socialcalc format' });
    }

    log().trace({ roomId, ethercalc: someEthercalcServer.config.host }, 'Fetched ethercalc room');
    return callback(null, data);
  } catch (error) {
    log().error(
      { err: error, roomId, ethercalc: someEthercalcServer.config.host },
      'Could not fetch Ethercalc room in socialcalc format'
    );
    return callback({ code: 500, msg: 'Could not fetch Ethercalc room in socialcalc format' });
  }
};

/**
 * Set the contents for a room
 *
 * @param  {String}     roomId          The content id for which the HTML should be set in ethercalc
 * @param  {String}     snapshot        The data that should be used for the ethercalc room in CSV format
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const setSheetContents = async (roomId, snapshot, callback) => {
  const someEthercalcServer = _pickARandomServer();
  log().trace({ roomId, snapshot, ethercalc: someEthercalcServer.config.host }, 'Setting Ethercalc contents');

  try {
    const response = await someEthercalcServer.client.overwrite(roomId, snapshot, 'csv');
    return callback(null, response);
  } catch (error) {
    log().error(
      { err: error, roomId, ethercalc: someEthercalcServer.config.host },
      'Could not set sheet contents on the Ethercalc instance'
    );
    return callback({ code: 500, msg: 'Could not set sheet contents on the Ethercalc instance' });
  }
};

/**
 * Joins the current user in an ethercalc room.
 * This assumes that the current user has access to the collaborative spreadsheet.
 *
 * @param  {Context}    ctx                     Current execution context
 * @param  {Content}    contentObj              The content object for the room that should be joined
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {String}     callback.url            The URL that can be used to embed the room
 */
const joinRoom = (ctx, contentObject, callback) => {
  const user = ctx.user();
  if (isNotDefined(user)) {
    return callback({ code: 401, msg: 'Anonymous users are not allowed to join collaborative spreadsheets' });
  }

  log().trace(`Joining Ethercalc room ${contentObject.ethercalcRoomId} as user ${user}`);

  // Get the language for the current user.
  const language = isDefined(user.locale) ? head(split('_', user.locale)) : ENGLISH;
  const url = getRoomUrl(contentObject, user.id, language);

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
const getRoomUrl = (contentObject, userId, language) => {
  const randomServerIndex = Math.floor(Math.random() * ethercalcServers.length);
  return url.format({
    pathname: `/ethercalc/${randomServerIndex}/${contentObject.ethercalcRoomId}`,
    query: {
      author: userId,
      content: contentObject.id
    }
  });
};

/**
 * Determine if the given sheet is empty. Works with both socialcalc and HTML formats.
 *
 * @param  {String}     content             The content of the ethercalc spreadsheet
 * @return {Boolean}                        Whether or not the content is considered empty
 */
const isContentEmpty = (content) => {
  const FIRST_CELL = '#cell_A1';
  const findCells = match(/cell_\w\d/g);
  const lookForCellValues = test(/\bcell:\w\d/g);

  const loadFirstCellContents = (content) => cheerio.load(content)(FIRST_CELL).text();

  const equalsDefault = equals(DEFAULT_SNAPSHOT);
  const checkIfFirstCellIsEmpty = compose(equalsDefault, trim, loadFirstCellContents);
  const hasSingleCell = (content) => compose(equalsOne, length, findCells)(content);

  const isFirstCellEmpty = ifElse(hasSingleCell, checkIfFirstCellIsEmpty, returnFalse);
  const checkIfContentIsEmpty = ifElse(_isHtmlDocument, isFirstCellEmpty, lookForCellValues);

  return ifElse(isNotDefined, returnTrue, checkIfContentIsEmpty)(content);
};

/**
 * Determine if one set of ethercalc HTML content is equal to another.
 *
 * @param  {String}     one         Content of one ethercalc document
 * @param  {String}     other       Content of another ethercalc document
 * @return {Boolean}                Whether or not the content is equivalent to eachother
 */
const isContentEqual = (one, other) => {
  if (equals(one, other)) return true;
  if (or(isNotDefined(one), isNotDefined(other))) return false;

  const oneContent = cheerio.load(one);
  const otherContent = cheerio.load(other);
  return equals(oneContent(TABLE_ELEMENT).html(), otherContent(TABLE_ELEMENT).html());
};

/**
 * Record which user has edited an Ethercalc room
 *
 * @param  {Object}     data                    An object containing the OAE user ID and content ID
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @api private
 */
const setEditedBy = (data, callback) => {
  if (and(isDefined(data.contentId), isDefined(data.userId))) {
    ContentDAO.Ethercalc.setEditedBy(data.contentId, data.userId, (error) => {
      if (error) return callback(error);

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
const _isHtmlDocument = (content) => {
  if (isNotDefined(content)) return false;

  const $ = cheerio.load(content);
  return compose(greaterThanZero, length, $)(TABLE_ELEMENT);
};

/**
 * Determine if the given content is in valid socialcalc format
 *
 * @param  {String}     content     The content to check
 * @return {Boolean}                Whether or not the content is valid socialcalc
 * @api private
 */
const _isSCDocument = function (content) {
  if (isNotDefined(content)) return false;

  content = trim(content);

  // FIXME This isn't ideal, consider replacing with regexp which is also not ideal
  const contentStartsWith = curry(startsWith(__, content));
  const contentEndsWith = curry(endsWith(__, content));
  return and(contentStartsWith(SOCIAL_CALC_FORMAT_BEGIN_LINE), contentEndsWith(SOCIAL_CALC_FORMAT_END_LINE));
};

/**
 * @function getDefaultSnapshot
 * @return {String} Returns the constant that defines the initial spreadsheet content of the first cell
 */
const getDefaultSnapshot = () => DEFAULT_SNAPSHOT;

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
  setEditedBy,
  getDefaultSnapshot
};
