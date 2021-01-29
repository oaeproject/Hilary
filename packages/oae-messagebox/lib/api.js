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

import { format } from 'util';
import _ from 'underscore';

import * as Cassandra from 'oae-util/lib/cassandra';
import * as EmitterAPI from 'oae-emitter';
import * as Locking from 'oae-util/lib/locking';
import * as OaeUtil from 'oae-util/lib/util';
import * as TenantsAPI from 'oae-tenants';
import { logger } from 'oae-logger';

import { Validator as validator } from 'oae-util/lib/validator';
const {
  validateInCase: bothCheck,
  isANumber,
  dateIsInThePast,
  isString,
  isUserId,
  unless,
  isNotNull,
  toInt
} = validator;
import { isPast } from 'date-fns';
import { compose, not, head } from 'ramda';
import isInt from 'validator/lib/isInt';
import isIn from 'validator/lib/isIn';
import * as MessageBoxModel from './model.js';
import { MessageBoxConstants } from './constants.js';

const log = logger('oae-messagebox-api');

// A contribution will be considered "recent" for 30 days after it occurs
const DURATION_RECENT_CONTRIBUTIONS_SECONDS = 30 * 24 * 60 * 60;

// A regex that will find links in the body. Note that we capture the characters just before and
// after the URL so we can determine whether the URL is already provided in markdown format
// eslint-disable-next-line prefer-regex-literals
const REGEXP_LINK = new RegExp(
  '(.?)https?://([^/\\r\\n\\s]+)(/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|])(.?)',
  'gi'
);

/**
 * ### Events
 *
 * The `MessageBoxAPI`, as enumerated in `MessageboxConstants.events`, emits the following events:
 *
 * * `createdMessage(message)`: A new message was created.
 * * `updatedMessage(messageId, newBody)`: The body of a message has been updated.
 * * `deletedMessage(messageId, deleteType)`: A message has been deleted, deleteType will indicate whether it was a hard or a soft delete.
 */
const MessageBoxAPI = new EmitterAPI.EventEmitter();

/**
 * Replace absolute URLs to OAE tenants in a message body with relative links to avoid
 * cross-tenant permissions issues.
 *
 * @param  {String}        body                Body of message to update
 * return  {String}                            Updated message with links replaced
 * @api private
 */
const replaceLinks = function (body = '') {
  // Replace any matched URLs with relative links in markdown format
  return body.replace(REGEXP_LINK, (fullMatch, preURLChar, host, path, postURLChar, offset) => {
    // If the host doesn't match an OAE tenant we disregard it as it is an external link
    if (!TenantsAPI.getTenantByHost(host)) {
      return fullMatch;
    }

    // If there are an odd number of backtics before the match it's inside a quote and should be
    // left as is
    const inQuote = body.slice(0, offset + 1).split('`').length % 2 === 0;

    // If the line the match is on starts with 4 spaces and all preceding lines since the last
    // blank line do too it's a block quote and should be left as is
    let inBlockQuote = false;
    const lineIndex = body.slice(0, offset + 1).lastIndexOf('\n');

    // If the matched line starts with 4 spaces
    if (body.slice(lineIndex + 1, lineIndex + 1 + 4) === '    ') {
      const preMatchBody = body.slice(0, lineIndex + 1);
      const lastParaIndex = preMatchBody.lastIndexOf('\n\n');
      if (lastParaIndex !== -1) {
        const lastParaLine = body.slice(0, lastParaIndex + 1).split('\n').length;
        // Get just the lines between the last double linebreak and our match
        let lines = preMatchBody.split('\n');
        lines = lines.slice(lastParaLine, -1);
        // Check that all lines in this block start with 4 spaces
        const allLinesStartWith4Spaces = _.every(lines, (line) => {
          return line.slice(0, 4) === '    ';
        });
        inBlockQuote = _.isEmpty(lines) || allLinesStartWith4Spaces;
      }
    }

    if (inQuote || inBlockQuote) {
      return fullMatch;
    }

    // Check for a match in the title of a markdown link. Note that the target link
    // will be replaced in the next if clause
    if (preURLChar === '[' && postURLChar === ']') {
      return '[' + path + ']';

      // Check for a match in the target of a markdown link
    }

    if (preURLChar === '(' && postURLChar === ')') {
      return '(' + path + ')';

      // If the URL wasn't wrapped in braces we can assume that it was not provided in
      // markdown format. If that's the case, we do the conversion ourselves
    }

    return preURLChar + '[' + path + '](' + path + ')' + postURLChar;
  });
};

/**
 * Create a new message in a message box. The message can be either its own "top-level" message, or a reply to
 * another message in this message box. To specify a message is a reply of another, you must supply the
 * `opts.replyToCreated` parameter to indicate the timestamp of the parent message which establishes its
 * hierarchy and ordering in the message box.
 *
 * @param  {String}     messageBoxId            The id of the message box that holds the message, ex: d:cam:dfjOSdfij#discussion would be an example of the messagebox for a discussion thread with id d:cam:dfjOSdfij.
 * @param  {String}     createdBy               The id of the user who sent the message
 * @param  {String}     body                    The body of the message
 * @param  {Object}     [opts]                  Additional optional message attributes
 * @param  {String}     [opts.replyToCreated]   The timestamp (millis since the epoch) that the message to which this is a reply (if applicable) was created
 * @param  {Function}   [callback]              Invoked when the process completes
 * @param  {Object}     [callback.err]          An error that occurred, if any
 * @param  {Message}    [callback.message]      The message model object that was persisted
 */
const createMessage = function (messageBoxId, createdBy, body, options, callback) {
  options = options || {};

  try {
    unless(isNotNull, {
      code: 400,
      msg: 'A messageBoxId must be specified.'
    })(messageBoxId);

    unless(isUserId, {
      code: 400,
      msg: 'The createdBy parameter must be a valid user id.'
    })(createdBy);

    unless(isNotNull, {
      code: 400,
      msg: 'The body of the message must be specified.'
    })(body);

    const isReplyToDefined = Boolean(options.replyToCreated);
    unless(bothCheck(isReplyToDefined, isNotNull), {
      code: 400,
      msg: 'If the replyToCreated optional parameter is specified, it should not be null nor undefined.'
    })(options.replyToCreated);

    unless(bothCheck(isReplyToDefined, isString), {
      code: 400,
      msg: 'If the replyToCreated optional parameter is specified, it should not be a String.'
    })(options.replyToCreated);

    unless(bothCheck(isReplyToDefined, isInt), {
      code: 400,
      msg: 'If the replyToCreated optional parameter is specified, it should be an integer.'
    })(options.replyToCreated);

    unless(bothCheck(isReplyToDefined, isPast), {
      code: 400,
      msg: 'If the replyToCreated optional parameter is specified, it cannot be in the future.'
    })(new Date(Number.parseInt(options.replyToCreated, 10)));
  } catch (error) {
    return callback(error);
  }

  const replyToCreated = OaeUtil.getNumberParam(options.replyToCreated);
  const replyToMessageId = replyToCreated ? _createMessageId(messageBoxId, replyToCreated) : null;

  // Fetch the threadKey of the parent so we can nest under it
  _getMessageThreadKey(replyToMessageId, (error, replyToThreadKey) => {
    if (error) {
      return callback(error);
    }

    // Generate an ID that can be used for locking and is as specific as possible.
    // Locking is required to make sure we don't end up with 2 messages that were
    // created at exactly the same time
    const id = replyToThreadKey ? replyToThreadKey : messageBoxId;
    _lockUniqueTimestamp(id, Date.now(), (created, lock) => {
      // Data that will be output in diagnostic error messages
      const diagnosticData = {
        messageBoxId,
        createdBy,
        created,
        replyToMessageId
      };

      if (replyToMessageId && !replyToThreadKey) {
        // We specified a message that doesn't actually exist in our message box, don't let that happen
        log().error(diagnosticData, 'Reply-to message does not exist');
        return callback({ code: 400, msg: 'Reply-to message does not exist' });
      }

      // Derive this message's thread key by appending it to the parent, if applicable. Otherwise, it is a top-level key
      const threadKey = replyToThreadKey ? _appendToThreadKey(replyToThreadKey, created) : created + '|';

      // Replace absolute OAE links with relative ones to avoid cross-tenant
      // permission issues
      const bodyWithLinks = replaceLinks(body);

      // A low-level storage hash that represents this item stored in Cassandra or Redis
      const messageId = _createMessageId(messageBoxId, created);
      const messageStorageHash = {
        createdBy,
        body: bodyWithLinks,
        threadKey
      };

      // Create the query that creates the message object
      const createMessageQuery = Cassandra.constructUpsertCQL('Messages', 'id', messageId, messageStorageHash);
      if (!createMessageQuery) {
        log().error(diagnosticData, 'Failed to create a new message query.');
        return callback({ code: 500, msg: 'Failed to create a new message' });
      }

      // Create the query that adds the message object to the messagebox
      const indexMessageQuery = {
        query: 'INSERT INTO "MessageBoxMessages" ("messageBoxId", "threadKey", "value") VALUES (?, ?, ?)',
        parameters: [messageBoxId, threadKey, '1']
      };

      // Create the query that updates the "recent contributors" to a message box
      const recentContributionsQuery = {
        query:
          'INSERT INTO "MessageBoxRecentContributions" ("messageBoxId", "contributorId", "value") VALUES (?, ?, ?) USING TTL ' +
          DURATION_RECENT_CONTRIBUTIONS_SECONDS,
        parameters: [messageBoxId, createdBy, '1']
      };

      // First insert the new message object, if this fails we do not want to update the messagebox index
      Cassandra.runQuery(createMessageQuery.query, createMessageQuery.parameters, (error_) => {
        if (error_) {
          return callback(error_);
        }

        // Update the messagebox index, so this message will turn up in queries for all messages in the messagebox
        Cassandra.runQuery(indexMessageQuery.query, indexMessageQuery.parameters, (error_) => {
          if (error_) {
            return callback(error_);
          }

          // Asynchronously update the recent contributions
          Cassandra.runQuery(recentContributionsQuery.query, recentContributionsQuery.parameters);

          // Get the expanded Message object, emit it so it can be indexed, and return it to the caller.
          const message = _storageHashToMessage(messageId, messageStorageHash);
          MessageBoxAPI.emit(MessageBoxConstants.events.CREATED_MESSAGE, message);
          return callback(null, message);
        });
      });
      Locking.release(lock, () => {});
    });
  });
};

/**
 * Lock a timestamp within a message thread key to prevent 2 messages within that message thread
 * key to be created at exactly the same time
 *
 * @param  {String}        id                  Identifier that provides context for the lock
 * @param  {Number}        timestamp           Timestamp on which to lock (ms since unix epoch)
 * @param  {Function}      callback            Standard callback function
 * @param  {Object}        callback.timestamp  The timestamp on which the lock was eventually acquired
 * @param  {Object}        callback.key        The key used to acquire the lock
 * @param  {String}        callback.lockToken  The lockToken that can be used to release the acquired lock
 * @api private
 */
const _lockUniqueTimestamp = function (id, timestamp, callback) {
  const key = 'oae-messagebox:' + id + ':' + timestamp;
  Locking.acquire(key, 1, (error, lock) => {
    if (error) {
      // Migration from redback to redlock:
      // This should only occur if Redis is down, just return the requested ts
      // In that case, one should `return callback(timestamp, lockToken);`
      // Or
      // Someone else has the requested ts, try to lock one ms later
      return _lockUniqueTimestamp(id, timestamp + 1, callback);
    }

    // Successful lock, return the details
    return callback(timestamp, lock);
  });
};

/**
 * Update the content body of a message.
 *
 * @param  {String}         messageBoxId    The id message whose body we will update
 * @param  {String|Number}  created         The created timestamp (in millis since epoch) that we wish to update
 * @param  {String}         newBody         The new message content to push to the body
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 */
const updateMessageBody = function (messageBoxId, created, newBody, callback) {
  try {
    unless(isNotNull, {
      code: 400,
      msg: 'A messageBoxId must be specified.'
    })(messageBoxId);

    unless(isNotNull, {
      code: 400,
      msg: 'The created parameter must be specified.'
    })(created);

    unless(isString, {
      code: 400,
      msg: 'The created parameter must be a valid timestamp (string).'
    })(created);

    unless(isInt, {
      code: 400,
      msg: 'The created parameter must be a valid timestamp (numeric string).'
    })(created);

    unless(dateIsInThePast, {
      code: 400,
      msg: 'The created parameter must be a valid timestamp (integer) that is not in the future.'
    })(created);

    unless(isNotNull, {
      code: 400,
      msg: 'The new body of the message must be specified.'
    })(newBody);
  } catch (error) {
    return callback(error);
  }

  const messageId = _createMessageId(messageBoxId, created);

  // Replace absolute OAE links with relative ones to avoid cross-tenant
  // permission issues
  const body = replaceLinks(newBody);

  Cassandra.runQuery('UPDATE "Messages" SET "body" = ? WHERE "id" = ?', [body, messageId], (error) => {
    if (error) {
      return callback(error);
    }

    MessageBoxAPI.emit(MessageBoxConstants.events.UPDATED_MESSAGE, messageId, newBody);
    callback();
  });
};

/**
 * Get a list of messages from a message box.
 *
 * @param  {String}     messageBoxId        The id of the message box from which to fetch messages
 * @param  {String}     [start]             The threadKey (exclusive) of the message from which to start fetching. If not specified, will start from the most recent message
 * @param  {Number}     [limit]             The maximum number of messages to fetch, starting from the start point
 * @param  {Object}     [opts]              Optional parameters for the method
 * @param  {Boolean}    [opts.scrubDeleted] Whether or not the deleted messages from this messagebox should be scrubbed
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Message[]}  callback.messages   An array of messages
 * @param  {String}     callback.nextToken  The value to provide in the `start` parameter to get the next set of results
 */
const getMessagesFromMessageBox = function (messageBoxId, start, limit, options, callback) {
  start = start || '';
  limit = OaeUtil.getNumberParam(limit, 10);
  options = options || {};
  options.scrubDeleted = options.scrubDeleted !== false;

  try {
    unless(isNotNull, {
      code: 400,
      msg: 'A messageBoxId must be specified.'
    })(messageBoxId);
  } catch (error) {
    return callback(error);
  }

  _getThreadKeysFromMessageBox(messageBoxId, start, limit, (error, threadKeys, nextToken) => {
    if (error) {
      return callback(error);
    }

    // Will maintain the output order of the messages according to their threadkey
    const createdTimestamps = _.map(threadKeys, _parseCreatedFromThreadKey);
    getMessages(messageBoxId, createdTimestamps, { scrubDeleted: options.scrubDeleted }, (error, messages) => {
      if (error) {
        return callback(error);
      }

      return callback(null, messages, nextToken);
    });
  });
};

/**
 * This is very similar to @see MessageBoxAPI#getMessagesById. The differences are:
 *
 *  * You can fetch by the `messageBoxId` and a list of `createdTimestamps` for convenience; and
 *  * The resulting object is keyed by `createdTimestamp` instead of by `messageId`
 *
 * The scrubbing logic is the same for deleted messages
 *
 * @param  {String}             messageBoxId        The id of the message box that contains the messages
 * @param  {String[]|Number[]}  createdTimestamps   The timestamps (millis since the epoch) that identify the messages to fetch within the message box
 * @param  {Object}             [opts]              @see MessageBoxAPI#getMessagesById
 * @param  {Function}           callback            Standard callback function
 * @param  {Object}             callback.err        An error that occurred, if any
 * @param  {Message[]}          callback.messages   An array of messages, ordered in the same way as the createdTimestamps array.
 */
const getMessages = function (messageBoxId, createdTimestamps, options, callback) {
  options = options || {};
  options.scrubDeleted = options.scrubDeleted !== false;

  try {
    unless(isNotNull, {
      code: 400,
      msg: 'A messageBoxId must be specified.'
    })(messageBoxId);

    createdTimestamps.forEach((timestamp) => {
      unless(isNotNull, {
        code: 400,
        msg: 'A timestamp cannot be null.'
      })(timestamp);

      unless(compose(isANumber, toInt, String), {
        code: 400,
        msg: 'A timestamp should be an integer.'
      })(timestamp);

      unless(isPast, {
        code: 400,
        msg: 'A timestamp cannot be in the future.'
      })(new Date(Number.parseInt(timestamp, 10)));
    });
  } catch (error) {
    return callback(error);
  }

  // Convert messagebox + createdTimestamps into the compound key containing the two
  const messageIds = _.map(createdTimestamps, (created) => {
    return _createMessageId(messageBoxId, created);
  });

  // Delegate to getMessagesById to fetch by the actual message ids
  getMessagesById(messageIds, { scrubDeleted: options.scrubDeleted }, callback);
};

/**
 * Get a set of messages from storage, based on its message box and the created timestamp. If the message has been deleted
 * and you have specified to scrub deleted messages (default), then only the following data of a message is returned:
 *
 *  * `id`
 *  * `messageBoxId`
 *  * `created`
 *  * `threadKey`
 *  * `deleted`
 *  * `level`
 *
 * @param  {String[]}           messageIds          An array of message IDs that should be retrieved.
 * @param  {Object}             [opts]              Optional parameters for the method
 * @param  {Boolean}            [opts.scrubDeleted] Whether or not to scrub the details of the deleted messages. If `false`, the full content of deleted messages will be returned. Otherwise, the message will be scrubbed as described in the summary.
 * @param  {Function}           callback            Standard callback function
 * @param  {Object}             callback.err        An error that occurred, if any
 * @param  {Object}             callback.messages   A hash mapping messageId -> Message for each requested message
 */
const getMessagesById = function (messageIds, options, callback) {
  options = options || {};
  options.scrubDeleted = options.scrubDeleted !== false;

  if (_.isEmpty(messageIds)) {
    return callback(null, []);
  }

  Cassandra.runQuery('SELECT * FROM "Messages" WHERE "id" IN ?', [messageIds], (error, rows) => {
    if (error) {
      return callback(error);
    }

    const messages = [];
    _.each(rows, (row) => {
      row = Cassandra.rowToHash(row);
      let message = _storageHashToMessage(row.id, row);

      // The message will be null here if it didn't actually exist, or had recently been deleted
      if (message) {
        // Scrub the message if we have specified to do so
        if (options.scrubDeleted && message.deleted) {
          message = _scrubMessage(message);
        }

        // Add the message in the array on the same index as its ID in the messageIds array.
        messages[messageIds.indexOf(message.id)] = message;
      }
    });

    return callback(null, messages);
  });
};

/**
 * Delete a message from storage.
 *
 * ## Delete Type
 *
 *  It is possible to specify the type of delete to perform. These are:
 *
 *      * `hard`: Delete the record from the database. It will no longer appear in the message box index
 *      * `soft`: Simply mark that the message is deleted. When a soft delete occurs, the message still appears in the message box index, and counts as a message when paging
 *      * `leaf`: Performs a `hard` delete, **only** if this message doesn't have any children. Otherwise, performs a soft delete. The actual delete that took place will be evident with the `callback.deleteType` parameter
 *
 * It's up to the caller to perform the necessary permission checks.
 *
 * @param  {String}         messageBoxId        The id of the message box that holds the message to delete
 * @param  {String|Number}  createdTimestamp    The timestamp (millis since the epoch) of the message to delete
 * @param  {Object}         [opts]              Optional arguments for the method
 * @param  {String}         [opts.deleteType]   The type of delete to perform, as enumerated in the method summary. Default: "soft"
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {String}         callback.deleteType A value indicating what type of delete finally took place. If it was a hard delete, it will be `MessageBoxConstants.deleteTypes.HARD`, if soft-deleted it will be `MessageBoxConstants.deleteTypes.SOFT`
 * @param  {String}         [callback.message]  If a soft-delete took place, this parameter will be the new representation of the deleted message object
 */
const deleteMessage = function (messageBoxId, createdTimestamp, options, callback) {
  options = options || {};

  try {
    unless(isNotNull, {
      code: 400,
      msg: 'A messageBoxId must be specified.'
    })(messageBoxId);

    unless(isNotNull, {
      code: 400,
      msg: 'The createdTimestamp should not be null.'
    })(createdTimestamp);

    unless(compose(isANumber, toInt, String), {
      code: 400,
      msg: 'The createdTimestamp should be a string.'
    })(createdTimestamp);

    unless(dateIsInThePast, {
      code: 400,
      msg: 'The createdTimestamp cannot be in the future.'
    })(createdTimestamp);

    const isDeleteTypeDefined = Boolean(options.deleteType);
    const deleteValues = _.values(MessageBoxConstants.deleteTypes);
    unless(bothCheck(isDeleteTypeDefined, isIn), {
      code: 400,
      msg: 'If the deleteType is specified it should be one of: ' + deleteValues.join(', ')
    })(options.deleteType, deleteValues);
  } catch (error) {
    return callback(error);
  }

  getMessages(messageBoxId, [createdTimestamp], { scrubDeleted: false }, (error, messages) => {
    if (error) return callback(error);

    if (not(head(messages))) return callback({ code: 404, msg: 'Message not found.' });

    const message = messages[0];
    if (message) {
      if (options.deleteType === MessageBoxConstants.deleteTypes.HARD) {
        return _hardDelete(message, (error_) => {
          if (!error_) {
            MessageBoxAPI.emit(
              MessageBoxConstants.events.DELETED_MESSAGE,
              message.id,
              MessageBoxConstants.deleteTypes.HARD
            );
          }

          callback(error_, MessageBoxConstants.deleteTypes.HARD);
        });
      }

      if (options.deleteType === MessageBoxConstants.deleteTypes.SOFT) {
        return _softDelete(message, (error, message_) => {
          if (!error) {
            MessageBoxAPI.emit(
              MessageBoxConstants.events.DELETED_MESSAGE,
              message.id,
              MessageBoxConstants.deleteTypes.SOFT
            );
          }

          callback(error, MessageBoxConstants.deleteTypes.SOFT, message_);
        });
      }

      return _leafDelete(message, (error, deleteType, message_) => {
        if (!error) {
          MessageBoxAPI.emit(MessageBoxConstants.events.DELETED_MESSAGE, message.id, deleteType);
        }

        callback(error, deleteType, message_);
      });
    }

    return callback({ code: 404, msg: 'The specified message did not exist' });
  });
};

/**
 * Get the recent contributions to a message box. The result of this method is an array of objects describing contributions that occurred
 * within a specified period of time. The objects are sorted in order of most recent to least recent. The contributions expire from this
 * listing after 30 days.
 *
 * @param  {String}     messageBoxId                    The id of the message from which to fetch the recent contributions
 * @param  {Object}     start                           An OBJECT with properties "userId" (specifying the id of the user at which to start) and "created" (specifying the timestamp in millis since epoch of the user's contribution)
 * @param  {Number}     [limit]                         The maximum number of user ids to fetch. Default: 100
 * @param  {Function}   callback                        Standard callback function
 * @param  {Object}     callback.err                    An error that occurred, if any
 * @param  {String[]}   callback.recentContributions    An array of principal IDs specifying the recent contributions.
 */
const getRecentContributions = function (messageBoxId, start, limit, callback) {
  // For this use-case, we want the limit to be quite large since it
  // will fuel things like activity routing. Maybe 100, or more?
  limit = OaeUtil.getNumberParam(limit, 5, 1, 100);
  start = start ? format('%s:%s', start.userId, start.created) : '';

  try {
    unless(isNotNull, {
      code: 400,
      msg: 'A messageBoxId must be specified.'
    })(messageBoxId);
  } catch (error) {
    return callback(error);
  }

  Cassandra.runPagedQuery(
    'MessageBoxRecentContributions',
    'messageBoxId',
    messageBoxId,
    'contributorId',
    start,
    limit,
    { reversed: true },
    // eslint-disable-next-line no-unused-vars
    (error, rows, nextToken) => {
      if (error) {
        return callback(error);
      }

      // Extract the contributor ids as the results
      const recentContributions = _.map(rows, (row) => {
        return row.get('contributorId');
      });

      return callback(null, recentContributions);
    }
  );
};

/**
 * Given a message id, fetch just its threadKey from storage.
 *
 * @param  {String}     messageId               The id of the message whose threadKey to fetch
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {String}     [callback.threadKey]    The threadKey of the message. If the message did not exist, will be undefined.
 * @api private
 */
const _getMessageThreadKey = function (messageId, callback) {
  // The message id is not specified, simply return with nothing.
  if (!messageId) {
    return callback();
  }

  Cassandra.runQuery('SELECT "threadKey" FROM "Messages" WHERE "id" = ?', [messageId], (error, rows) => {
    if (error) {
      return callback(error);
    }

    if (_.isEmpty(rows)) {
      // A message by that id may not have existed, simply return undefined
      return callback();
    }

    return callback(null, rows[0].get('threadKey'));
  });
};

/**
 * Perform a "leaf" delete. This delete method will perform a "hard" delete if the specified message has no replies (i.e., it
 * is a leaf node), or perform a "soft" delete if it has replies.
 *
 * @param  {Message}    message             The message to delete
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {String}     callback.deleteType The type of delete that eventually occurred. Either 'soft' or 'hard'
 * @param  {Message}    [callback.message]  If the delete was a "soft" delete, returns the scrubbed message model of the now-deleted message
 * @api private
 */
const _leafDelete = function (message, callback) {
  const threadKeyWithoutPipe = message.threadKey.split('|')[0];

  // Check to see if this message has a reply. If so, we will soft delete, if not we hard delete
  _getThreadKeysFromMessageBox(message.messageBoxId, message.threadKey, 1, (error, threadKeys) => {
    if (error) {
      return callback(error);
    }

    let hasReply = false;
    const replyKey = threadKeys[0];
    if (replyKey) {
      // If the next message's threadKey is a descendant of the message being deleted, it is a reply.
      hasReply = replyKey.indexOf(threadKeyWithoutPipe) === 0;
    }

    // Perform the appropriate delete operation based on whether or not there is a reply
    if (hasReply) {
      _softDelete(message, (error, message) => {
        if (error) {
          return callback(error);
        }

        return callback(null, MessageBoxConstants.deleteTypes.SOFT, message);
      });
    } else {
      _hardDelete(message, (error_) => {
        if (error_) {
          return callback(error_);
        }

        return callback(null, MessageBoxConstants.deleteTypes.HARD);
      });
    }
  });
};

/**
 * Perform a hard delete of a message in storage. This delete operation does the following:
 *
 *  * Soft delete the message in the Messages CF; and
 *  * Log an entry in the MessageBoxMessagesDeleted CF to indicate that this message was unlinked from the message box; and
 *  * Unlink the message from the messagebox, by removing it from the MessageBoxMessages index
 *
 * After this is performed, the message will no longer return when paging through messages of a message box, and so will appear
 * permanently deleted.
 *
 * @param  {Message}    message             The message to hard-delete
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @api private
 */
const _hardDelete = function (message, callback) {
  const { threadKey, messageBoxId } = message;
  const createdTimestamp = message.created;

  // First move the created timestamp of the message in a CF that can help us find and recover the message for a messagebox
  Cassandra.runQuery(
    'INSERT INTO "MessageBoxMessagesDeleted" ("messageBoxId", "createdTimestamp", "value") VALUES (?, ?, ?)',
    [messageBoxId, createdTimestamp, '1'],
    (error) => {
      if (error) {
        return callback(error);
      }

      // Delete the index entry from the messagebox. This fixes things like paging so this comment does not get returned in feeds anymore
      Cassandra.runQuery(
        'DELETE FROM "MessageBoxMessages" WHERE "messageBoxId" = ? AND "threadKey" = ?',
        [messageBoxId, threadKey],
        (error) => {
          if (error) {
            return callback(error);
          }

          // Proceed to flag the message as deleted, but we still don't hard-delete its contents
          _softDelete(message, (error) => {
            if (error) {
              return callback(error);
            }

            return callback();
          });
        }
      );
    }
  );
};

/**
 * Perform a soft delete of a message. The basically marks a `deleted` flag to the current time (millis since the epoch) so
 * that the consumer may determine how to handle soft-deleted messages in the message box. The message will still appear
 * when listing messages in the message box.
 *
 * @param  {Message}    message             The message to hard-delete
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @api private
 */
const _softDelete = function (message, callback) {
  const messageId = message.id;
  const deletedTimestamp = Date.now().toString();

  // Set the deleted flag to the current timestamp
  Cassandra.runQuery('UPDATE "Messages" SET "deleted" = ? WHERE "id" = ?', [deletedTimestamp, messageId], (error) => {
    if (error) {
      return callback(error);
    }

    message.deleted = deletedTimestamp;
    message = _scrubMessage(message);

    return callback(null, message);
  });
};

/**
 * List the threadKeys from the messagebox index.
 * It's assumed that validation has happened prior to calling this function.
 *
 * @param  {String}         messageBoxId        The id of the message box whose message threadKeys to fetch
 * @param  {String}         start               The first threadKey from which to start fetching threadKeys (exclusive)
 * @param  {String|Number}  limit               The maximum number of threadKeys to fetch
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {String[]}       callback.threadKeys The threadKeys requested
 * @param  {String}         callback.nextToken  The value to provide in the `start` parameter to get the next set of results
 * @api private
 */
const _getThreadKeysFromMessageBox = function (messageBoxId, start, limit, callback) {
  // Fetch `limit` number of message ids from the message box
  Cassandra.runPagedQuery(
    'MessageBoxMessages',
    'messageBoxId',
    messageBoxId,
    'threadKey',
    start,
    limit,
    { reversed: true },
    (error, rows, nextToken) => {
      if (error) {
        return callback(error);
      }

      const threadKeys = _.map(rows, (row) => {
        return row.get('threadKey');
      });

      return callback(null, threadKeys, nextToken);
    }
  );
};

/**
 * Convert a simple storage hash model to a Message object.
 *
 * @param  {String}     messageId       The id of the message being converted
 * @param  {Object}     hash            The simple key-value storage model of the message
 * @return {Message}                    The message model object the storage hash represents
 * @api private
 */
const _storageHashToMessage = function (messageId, hash) {
  let message = null;

  // Use threadKey as a slug column to ensure that this hash was an existing message
  if (hash.threadKey) {
    const messageBoxId = _parseMessageBoxIdFromMessageId(messageId);
    const { threadKey, deleted, body, createdBy } = hash;
    const created = _parseCreatedFromThreadKey(threadKey);
    const level = _getLevelFromThreadKey(threadKey);
    const replyTo = _parseReplyToTimestampFromThreadKey(threadKey);
    message = new MessageBoxModel.Message(
      messageId,
      messageBoxId,
      threadKey,
      body,
      createdBy,
      created,
      level,
      replyTo,
      deleted
    );
  }

  return message;
};

/**
 * Create a unique message id from a messagebox id and a timestamp.
 *
 * @param  {String}         messageBoxId    The messagebox id
 * @param  {String|Number}  created         The timestamp (millis since the epoch)
 * @return {String}                         A unique messagebox id
 * @api private
 */
const _createMessageId = function (messageBoxId, created) {
  return format('%s#%s', messageBoxId, created);
};

/**
 * Parse a messageBoxId out of the message id. In a sense the reverse of #_createMessageId.
 *
 * @param  {String}     messageId   The id of the message to parse
 * @return {String}                 The messagebox id in the message id
 * @api private
 */
const _parseMessageBoxIdFromMessageId = function (messageId) {
  // The id of the messagebox is everything up to the last '#' of the message id
  return messageId.split('#').slice(0, -1).join('#');
};

/**
 * Given a parent thread key and a child timestamp, create the threadkey of the message
 *
 * @param  {String}         parentThreadKey     The parent threadKey
 * @param  {String|Number}  childCreated        The timestamp (millis since the epoch) of the child message
 * @return {String}                             The threadKey for the child message
 * @api private
 */
const _appendToThreadKey = function (parentThreadKey, childCreated) {
  const parentThreadKeyWithoutPipe = parentThreadKey.split('|')[0];
  return format('%s#%s|', parentThreadKeyWithoutPipe, childCreated);
};

/**
 * Get the created timestamp from the given message id
 *
 * @param  {String}     messageId   The messageId to parse
 * @return {String}                 The created timestamp (millis since the epoch) of the message
 * @api private
 */
// eslint-disable-next-line no-unused-vars
const _parseCreatedFromMessageId = function (messageId) {
  return messageId.split('#').pop();
};

/**
 * Get the created date of the message given its threadKey
 *
 * @param  {String}     threadKey   The threadKey to parse
 * @return {String}                 The timestamp (millis since the epoch) of the message
 * @api private
 */
const _parseCreatedFromThreadKey = function (threadKey) {
  // The created timestamp is the timestamp of the deepest message in the threadKey hierarchy
  const timestampWithPipe = threadKey.split('#').pop();
  return timestampWithPipe.split('|')[0];
};

/**
 * Given a threadKey, determine the hierarchical "level" / depth of the message
 *
 * @param  {String}     threadKey   The threadKey from which to determine the level
 * @return {Number}                 The level of the message
 * @api private
 */
const _getLevelFromThreadKey = function (threadKey) {
  // Extract the depth of this message from the threadKey hierarchy. Top-level messages are depth 0
  return threadKey.split('#').length - 1;
};

/**
 * Given a Message object (**not** a storage hash), scrub its data so only the data needed for a deleted
 * message is left.
 *
 * @param  {Message}    message     The message object to scrub
 * @return {Message}                The message object with its data scrubbed as though it were deleted
 * @api private
 */
const _scrubMessage = function (message) {
  return _.pick(message, 'id', 'messageBoxId', 'threadKey', 'created', 'replyTo', 'deleted', 'level');
};

/**
 * Given a threadKey, determine the message created timestamp to which it is a reply, if applicable
 *
 * @param  {String}     threadKey       The threadKey to parse
 * @return {String}                     The created timestamp of the message to which the specified threadKey is a reply. If not a reply, this will return null
 * @api private
 */
const _parseReplyToTimestampFromThreadKey = function (threadKey) {
  // Converts: "timestamp1#timestamp2#timestamp3|" -> [ "timestamp1", "timestamp2", "timestamp3" ]
  const hierarchy = threadKey.split('|')[0].split('#');
  if (hierarchy.length > 1) {
    // "timestamp3" is a reply to "timestamp2", so we pick out the second last one in the hierarchy
    return hierarchy[hierarchy.length - 2];
  }

  // If we only had 1 element, then this is not a reply at all
  return null;
};

export {
  MessageBoxAPI as emitter,
  replaceLinks,
  createMessage,
  updateMessageBody,
  getMessagesFromMessageBox,
  getMessages,
  getMessagesById,
  deleteMessage,
  getRecentContributions
};
