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

var _ = require('underscore');
var events = require('events');
var util = require('util');

var Cassandra = require('oae-util/lib/cassandra');
var Locking = require('oae-util/lib/locking');
var log = require('oae-logger').logger('oae-messagebox-api');
var OaeUtil = require('oae-util/lib/util');
var TenantsAPI = require('oae-tenants');
var Validator = require('oae-util/lib/validator').Validator;

var MessageBoxModel = require('./model');
var MessageBoxConstants = require('./constants').MessageBoxConstants;

// A contribution will be considered "recent" for 30 days after it occurs
var DURATION_RECENT_CONTRIBUTIONS_SECONDS = 30 * 24 * 60 * 60;

/**
 * ### Events
 *
 * The `MessageBoxAPI`, as enumerated in `MessageboxConstants.events`, emits the following events:
 *
 * * `createdMessage(message)`: A new message was created.
 * * `updatedMessage(messageId, newBody)`: The body of a message has been updated.
 * * `deletedMessage(messageId, deleteType)`: A message has been deleted, deleteType will indicate whether it was a hard or a soft delete.
 */
var MessageBoxAPI = module.exports = new events.EventEmitter();


/**
 * Replace absolute URLs to OAE tenants in a message body with relative links to avoid
 * cross-tenant permissions issues.
 *
 * @param  {String}        body                Body of message to update
 * return  {String}                            Updated message with links replaced
 * @api private
 */
var _replaceLinks = function(body) {
    // Collect the host names (and ports) for active tenants
    var tenants = TenantsAPI.getTenants(true);
    var hosts = _.map(tenants, function(tenant) {
        return tenant.host;
    });

    // Construct a regex that will find absolute OAE links in the body.
    // Note that we capture the characters just before and after the URL so
    // we can determine whether the URL is already provided in markdown format
    var regex = new RegExp('(.?)https?://(' + hosts.join('|') + ')(/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])(.?)', 'gi');

    // Replace any matched URLs with relative links in markdown format
    return body.replace(regex, function(fullMatch, preURLChar, host, path, postURLChar, offset) {
        // If there are an odd number of backtics before the match it's inside a quote and should be left as is
        var inQuote = body.substring(0, offset + 1).split('`').length % 2 === 0;
        // If the line the match is on starts with 4 spaces and all preceding lines since the last blank line do too
        // it's a block quote and should be left as is
        var inBlockQuote = false;
        var lineIndex = body.substring(0, offset + 1).lastIndexOf('\n');
        // If the matched line starts with 4 spaces
        if (body.substr(lineIndex + 1, 4) === '    ') {
            var preMatchBody = body.substring(0, lineIndex + 1);
            var lastParaIndex = preMatchBody.lastIndexOf('\n\n');
            if (lastParaIndex !== -1) {
                var lastParaLine = body.substring(0, lastParaIndex + 1).split('\n').length;
                // Get just the lines between the last double linebreak and our match
                var lines = preMatchBody.split('\n');
                lines = lines.slice(lastParaLine, lines.length - 1);
                // Check that all lines in this block start with 4 spaces
                var allLinesStartWith4Spaces = _.every(lines, function(line) {
                    return line.substring(0, 4) === '    ';
                });
                inBlockQuote = (_.isEmpty(lines) || allLinesStartWith4Spaces);
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
        } else if (preURLChar === '(' && postURLChar === ')') {
            return '(' + path + ')';

        // If the URL wasn't wrapped in braces we can assume that it was not provided in
        // markdown format. If that's the case, we do the conversion ourselves
        } else {
            return preURLChar + '[' + path + '](' + path + ')' + postURLChar;
        }
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
var createMessage = module.exports.createMessage = function(messageBoxId, createdBy, body, opts, callback) {
    opts = opts || {};

    var validator = new Validator();
    validator.check(messageBoxId, {'code': 400, 'msg': 'A messageBoxId must be specified.'}).notNull();
    validator.check(createdBy, {'code': 400, 'msg': 'The createdBy parameter must be a valid user id.'}).isUserId();
    validator.check(body, {'code': 400, 'msg': 'The body of the message must be specified.'}).notNull();
    if (opts.replyToCreated) {
        validator.check(opts.replyToCreated, {'code': 400, 'msg': 'If the replyToCreated optional parameter is specified, it should not be null.'}).notNull();
        validator.check(opts.replyToCreated, {'code': 400, 'msg': 'If the replyToCreated optional parameter is specified, it should be an integer.'}).isInt();
        validator.check(opts.replyToCreated, {'code': 400, 'msg': 'If the replyToCreated optional parameter is specified, it cannot be in the future.'}).max(Date.now());
    }
    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    var replyToCreated = OaeUtil.getNumberParam(opts.replyToCreated);
    var replyToMessageId = (replyToCreated) ? _createMessageId(messageBoxId, replyToCreated) : null;

    // Fetch the threadKey of the parent so we can nest under it
    _getMessageThreadKey(replyToMessageId, function(err, replyToThreadKey) {
        if (err) {
            return callback(err);
        }

        // Generate an ID that can be used for locking and is as specific as possible.
        // Locking is required to make sure we don't end up with 2 messages that were
        // created at exactly the same time
        var id = (replyToThreadKey) ? replyToThreadKey : messageBoxId;
        _lockUniqueTimestamp(id, Date.now(), function(created, lockKey, lockToken) {

            // Data that will be output in diagnostic error messages
            var diagnosticData = {
                'messageBoxId': messageBoxId,
                'createdBy': createdBy,
                'created': created,
                'replyToMessageId': replyToMessageId
            };

            if (replyToMessageId && !replyToThreadKey) {
                // We specified a message that doesn't actually exist in our message box, don't let that happen
                log().error(diagnosticData, 'Reply-to message does not exist');
                return callback({'code': 400, 'msg': 'Reply-to message does not exist'});
            }

            // Derive this message's thread key by appending it to the parent, if applicable. Otherwise, it is a top-level key
            var threadKey = (replyToThreadKey) ? _appendToThreadKey(replyToThreadKey, created) : created + '|';

            // Replace absolute OAE links with relative ones to avoid cross-tenant
            // permission issues
            var bodyWithLinks = _replaceLinks(body);

            // A low-level storage hash that represents this item stored in Cassandra or Redis
            var messageId = _createMessageId(messageBoxId, created);
            var messageStorageHash = {
                'createdBy': createdBy,
                'body': bodyWithLinks,
                'threadKey': threadKey
            };

            // Create the query that creates the message object
            var createMessageQuery = Cassandra.constructUpsertCQL('Messages', 'id', messageId, messageStorageHash);
            if (!createMessageQuery) {
                log().error(diagnosticData, 'Failed to create a new message query.');
                return callback({'code': 500, 'msg': 'Failed to create a new message'});
            }

            // Create the query that adds the message object to the messagebox
            var indexMessageQuery = {
                'query': 'INSERT INTO "MessageBoxMessages" ("messageBoxId", "threadKey", "value") VALUES (?, ?, ?)',
                'parameters': [messageBoxId, threadKey, '1']
            };

            // Create the query that updates the "recent contributors" to a message box
            var recentContributionsQuery = {
                'query': 'INSERT INTO "MessageBoxRecentContributions" ("messageBoxId", "contributorId", "value") VALUES (?, ?, ?) USING TTL ' + DURATION_RECENT_CONTRIBUTIONS_SECONDS,
                'parameters': [messageBoxId, createdBy, '1']
            };

            // First insert the new message object, if this fails we do not want to update the messagebox index
            Cassandra.runQuery(createMessageQuery.query, createMessageQuery.parameters, function(err) {
                if (err) {
                    return callback(err);
                }

                // Update the messagebox index, so this message will turn up in queries for all messages in the messagebox
                Cassandra.runQuery(indexMessageQuery.query, indexMessageQuery.parameters, function(err) {
                    if (err) {
                        return callback(err);
                    }

                    // Asynchronously update the recent contributions
                    Cassandra.runQuery(recentContributionsQuery.query, recentContributionsQuery.parameters);

                    // Get the expanded Message object, emit it so it can be indexed, and return it to the caller.
                    var message = _storageHashToMessage(messageId, messageStorageHash);
                    MessageBoxAPI.emit(MessageBoxConstants.events.CREATED_MESSAGE, message);
                    return callback(null, message);
                });
            });
            Locking.release(lockKey, lockToken, function(){});
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
var _lockUniqueTimestamp = function(id, timestamp, callback) {
    var key = 'oae-messagebox:' + id + ':' + timestamp;
    Locking.acquire(key, 1, function(err, lockToken) {
        if (err) {
            // This should only occur if Redis is down, just return the requested ts
            return callback(timestamp, lockToken);
        } else if (!lockToken) {
            // Someone else has the requested ts, try to lock one ms later
            return _lockUniqueTimestamp(id, timestamp + 1, callback);
        }
        // Successful lock, return the details
        return callback(timestamp, key, lockToken);
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
var updateMessageBody = module.exports.updateMessageBody = function(messageBoxId, created, newBody, callback) {
    var validator = new Validator();
    validator.check(messageBoxId, {'code': 400, 'msg': 'A messageBoxId must be specified.'}).notNull();
    validator.check(created, {'code': 400, 'msg': 'The created parameter must be specified.'}).notNull();
    validator.check(created, {'code': 400, 'msg': 'The created parameter must be a valid timestamp (integer).'}).isInt();
    validator.check(created, {'code': 400, 'msg': 'The created parameter must be a valid timestamp (integer) that is not in the future.'}).max(Date.now());
    validator.check(newBody, {'code': 400, 'msg': 'The new body of the message must be specified.'}).notNull();
    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    var messageId = _createMessageId(messageBoxId, created);

    // Replace absolute OAE links with relative ones to avoid cross-tenant
    // permission issues
    var body = _replaceLinks(newBody);

    Cassandra.runQuery('UPDATE "Messages" SET "body" = ? WHERE "id" = ?', [body, messageId], function(err) {
        if (err) {
            return callback(err);
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
var getMessagesFromMessageBox = module.exports.getMessagesFromMessageBox = function(messageBoxId, start, limit, opts, callback) {
    start = start || '';
    limit = OaeUtil.getNumberParam(limit, 10);
    opts = opts || {};
    opts.scrubDeleted = (opts.scrubDeleted === false) ? false : true;

    var validator = new Validator();
    validator.check(messageBoxId, {'code': 400, 'msg': 'A messageBoxId must be specified.'}).notNull();
    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    _getThreadKeysFromMessageBox(messageBoxId, start, limit, function(err, threadKeys, nextToken) {
        if (err) {
            return callback(err);
        }

        // Will maintain the output order of the messages according to their threadkey
        var createdTimestamps = _.map(threadKeys, _parseCreatedFromThreadKey);
        getMessages(messageBoxId, createdTimestamps, {'scrubDeleted': opts.scrubDeleted}, function(err, messages) {
            if (err) {
                return callback(err);
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
var getMessages = module.exports.getMessages = function(messageBoxId, createdTimestamps, opts, callback) {
    opts = opts || {};
    opts.scrubDeleted = (opts.scrubDeleted === false) ? false : true;

    var validator = new Validator();
    validator.check(messageBoxId, {'code': 400, 'msg': 'A messageBoxId must be specified.'}).notNull();
    _.each(createdTimestamps, function(timestamp) {
        validator.check(timestamp, {'code': 400, 'msg': 'A timestamp cannot be null.'}).notNull();
        validator.check(timestamp, {'code': 400, 'msg': 'A timestamp should be an integer.'}).isInt();
        validator.check(timestamp, {'code': 400, 'msg': 'A timestamp cannot be in the future.'}).max(Date.now());
    });
    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    // Convert messagebox + createdTimestamps into the compound key containing the two
    var messageIds = _.map(createdTimestamps, function(created) {
        return _createMessageId(messageBoxId, created);
    });

    // Delegate to getMessagesById to fetch by the actual message ids
    getMessagesById(messageIds, {'scrubDeleted': opts.scrubDeleted}, callback);
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
var getMessagesById = module.exports.getMessagesById = function(messageIds, opts, callback) {
    opts = opts || {};
    opts.scrubDeleted = (opts.scrubDeleted === false) ? false : true;

    if (_.isEmpty(messageIds)) {
        return callback(null, []);
    }

    Cassandra.runQuery('SELECT * FROM "Messages" WHERE "id" IN (?)', [messageIds], function(err, rows) {
        if (err) {
            return callback(err);
        }

        var messages = [];
        _.each(rows, function(row) {
            row = Cassandra.rowToHash(row);
            var message = _storageHashToMessage(row.id, row);

            // The message will be null here if it didn't actually exist, or had recently been deleted
            if (message) {
                // Scrub the message if we have specified to do so
                if (opts.scrubDeleted && message.deleted) {
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
var deleteMessage = module.exports.deleteMessage = function(messageBoxId, createdTimestamp, opts, callback) {
    opts = opts || {};

    var validator = new Validator();
    validator.check(messageBoxId, {'code': 400, 'msg': 'A messageBoxId must be specified.'}).notNull();
    validator.check(createdTimestamp, {'code': 400, 'msg': 'The createdTimestamp should not be null.'}).notNull();
    validator.check(createdTimestamp, {'code': 400, 'msg': 'The createdTimestamp should be an integer.'}).isInt();
    validator.check(createdTimestamp, {'code': 400, 'msg': 'The createdTimestamp cannot be in the future.'}).max(Date.now());
    if (opts.deleteType) {
        var deleteValues = _.values(MessageBoxConstants.deleteTypes);
        validator.check(opts.deleteType, {'code': 400, 'msg': 'If the deleteType is specified it should be one of: ' + deleteValues.join(', ')}).isIn(deleteValues);
    }
    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    getMessages(messageBoxId, [createdTimestamp], {'scrubDeleted': false}, function(err, messages) {
        if (err) {
            return callback(err);
        } else if (!messages[0]) {
            return callback({'code': 404, 'msg': 'Message not found.'});
        }

        var message = messages[0];
        if (message) {
            if (opts.deleteType === MessageBoxConstants.deleteTypes.HARD) {
                return _hardDelete(message, function(err) {
                    if (!err) {
                        MessageBoxAPI.emit(MessageBoxConstants.events.DELETED_MESSAGE, message.id, MessageBoxConstants.deleteTypes.HARD);
                    }
                    callback(err, MessageBoxConstants.deleteTypes.HARD);
                });
            } else if (opts.deleteType === MessageBoxConstants.deleteTypes.SOFT) {
                return _softDelete(message, function(err, msg) {
                    if (!err) {
                        MessageBoxAPI.emit(MessageBoxConstants.events.DELETED_MESSAGE, message.id, MessageBoxConstants.deleteTypes.SOFT);
                    }
                    callback(err, MessageBoxConstants.deleteTypes.SOFT, msg);
                });
            } else {
                return _leafDelete(message, function(err, deleteType, msg) {
                    if (!err) {
                        MessageBoxAPI.emit(MessageBoxConstants.events.DELETED_MESSAGE, message.id, deleteType);
                    }
                    callback(err, deleteType, msg);
                });
            }
        } else {
            return callback({'code': 404, 'msg': 'The specified message did not exist'});
        }
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
var getRecentContributions = module.exports.getRecentContributions = function(messageBoxId, start, limit, callback) {
    // For this use-case, we want the limit to be quite large since it
    // will fuel things like activity routing. Maybe 100, or more?
    limit = OaeUtil.getNumberParam(limit, 5, 1, 100);
    start = (start) ? util.format('%s:%s', start.userId, start.created) : '';

    var validator = new Validator();
    validator.check(messageBoxId, {'code': 400, 'msg': 'A messageBoxId must be specified.'}).notNull();
    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    Cassandra.runPagedQuery('MessageBoxRecentContributions', 'messageBoxId', messageBoxId, 'contributorId', start, limit, {'reversed': true}, function(err, rows, nextToken) {
        if (err) {
            return callback(err);
        }

        // Extract the contributor ids as the results
        var recentContributions = _.map(rows, function(row) {
            return row.get('contributorId').value;
        });

        return callback(null, recentContributions);
    });
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
var _getMessageThreadKey = function(messageId, callback) {
    // The message id is not specified, simply return with nothing.
    if (!messageId) {
        return callback();
    }

    Cassandra.runQuery('SELECT "threadKey" FROM "Messages" WHERE "id" = ?', [messageId], function(err, rows) {
        if (err) {
            return callback(err);
        } else if (_.isEmpty(rows)) {
            // A message by that id may not have existed, simply return undefined
            return callback();
        }

        return callback(null, rows[0].get('threadKey').value);
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
var _leafDelete = function(message, callback) {
    var threadKeyWithoutPipe = message.threadKey.split('|')[0];

    //Check to see if this message has a reply. If so, we will soft delete, if not we hard delete
    _getThreadKeysFromMessageBox(message.messageBoxId, message.threadKey, 1, function(err, threadKeys) {
        if (err) {
            return callback(err);
        }

        var hasReply = false;
        var replyKey = threadKeys[0];
        if (replyKey) {
            // If the next message's threadKey is a descendant of the message being deleted, it is a reply.
            hasReply = (replyKey.indexOf(threadKeyWithoutPipe) === 0);
        }

        // Perform the appropriate delete operation based on whether or not there is a reply
        if (hasReply) {
            _softDelete(message, function(err, message) {
                if (err) {
                    return callback(err);
                }

                return callback(null, MessageBoxConstants.deleteTypes.SOFT, message);
            });
        } else {
            _hardDelete(message, function(err) {
                if (err) {
                    return callback(err);
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
var _hardDelete = function(message, callback) {
    var messageBoxId = message.messageBoxId;
    var createdTimestamp = message.created;
    var threadKey = message.threadKey;

    // First move the created timestamp of the message in a CF that can help us find and recover the message for a messagebox
    Cassandra.runQuery('INSERT INTO "MessageBoxMessagesDeleted" ("messageBoxId", "createdTimestamp", "value") VALUES (?, ?, ?)', [messageBoxId, createdTimestamp, '1'], function(err) {
        if (err) {
            return callback(err);
        }

        // Delete the index entry from the messagebox. This fixes things like paging so this comment does not get returned in feeds anymore
        Cassandra.runQuery('DELETE FROM "MessageBoxMessages" WHERE "messageBoxId" = ? AND "threadKey" = ?', [messageBoxId, threadKey], function(err) {
            if (err) {
                return callback(err);
            }

            // Proceed to flag the message as deleted, but we still don't hard-delete its contents
            _softDelete(message, function(err) {
                if (err) {
                    return callback(err);
                }

                return callback();
            });
        });
    });
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
var _softDelete = function(message, callback) {
    var messageId = message.id;
    var deletedTimestamp = Date.now().toString();

    // Set the deleted flag to the current timestamp
    Cassandra.runQuery('UPDATE "Messages" SET "deleted" = ? WHERE "id" = ?', [deletedTimestamp, messageId], function(err) {
        if (err) {
            return callback(err);
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
var _getThreadKeysFromMessageBox = function(messageBoxId, start, limit, callback) {
    // Fetch `limit` number of message ids from the message box
    Cassandra.runPagedQuery('MessageBoxMessages', 'messageBoxId', messageBoxId, 'threadKey', start, limit, {'reversed': true}, function(err, rows, nextToken) {
        if (err) {
            return callback(err);
        }

        var threadKeys = _.map(rows, function(row) {
            return row.get('threadKey').value;
        });

        return callback(null, threadKeys, nextToken);
    });
};

/**
 * Convert a simple storage hash model to a Message object.
 *
 * @param  {String}     messageId       The id of the message being converted
 * @param  {Object}     hash            The simple key-value storage model of the message
 * @return {Message}                    The message model object the storage hash represents
 * @api private
 */
var _storageHashToMessage = function(messageId, hash) {
    var message = null;

    // Use threadKey as a slug column to ensure that this hash was an existing message
    if (hash.threadKey) {
        var messageBoxId = _parseMessageBoxIdFromMessageId(messageId);
        var threadKey = hash.threadKey;
        var body = hash.body;
        var createdBy = hash.createdBy;
        var created = _parseCreatedFromThreadKey(threadKey);
        var level = _getLevelFromThreadKey(threadKey);
        var replyTo = _parseReplyToTimestampFromThreadKey(threadKey);
        var deleted = hash.deleted;
        message = new MessageBoxModel.Message(messageId, messageBoxId, threadKey, body, createdBy, created, level, replyTo, deleted);
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
var _createMessageId = function(messageBoxId, created) {
    return util.format('%s#%s', messageBoxId, created);
};

/**
 * Parse a messageBoxId out of the message id. In a sense the reverse of #_createMessageId.
 *
 * @param  {String}     messageId   The id of the message to parse
 * @return {String}                 The messagebox id in the message id
 * @api private
 */
var _parseMessageBoxIdFromMessageId = function(messageId) {
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
var _appendToThreadKey = function(parentThreadKey, childCreated) {
    var parentThreadKeyWithoutPipe = parentThreadKey.split('|')[0];
    return util.format('%s#%s|', parentThreadKeyWithoutPipe, childCreated);
};

/**
 * Get the created timestamp from the given message id
 *
 * @param  {String}     messageId   The messageId to parse
 * @return {String}                 The created timestamp (millis since the epoch) of the message
 * @api private
 */
var _parseCreatedFromMessageId = function(messageId) {
    return messageId.split('#').pop();
};

/**
 * Get the created date of the message given its threadKey
 *
 * @param  {String}     threadKey   The threadKey to parse
 * @return {String}                 The timestamp (millis since the epoch) of the message
 * @api private
 */
var _parseCreatedFromThreadKey = function(threadKey) {
    // The created timestamp is the timestamp of the deepest message in the threadKey hierarchy
    var timestampWithPipe = threadKey.split('#').pop();
    return timestampWithPipe.split('|')[0];
};

/**
 * Given a threadKey, determine the hierarchical "level" / depth of the message
 *
 * @param  {String}     threadKey   The threadKey from which to determine the level
 * @return {Number}                 The level of the message
 * @api private
 */
var _getLevelFromThreadKey = function(threadKey) {
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
var _scrubMessage = function(message) {
    return _.pick(message, 'id', 'messageBoxId', 'threadKey', 'created', 'replyTo', 'deleted', 'level');
};

/**
 * Given a threadKey, determine the message created timestamp to which it is a reply, if applicable
 *
 * @param  {String}     threadKey       The threadKey to parse
 * @return {String}                     The created timestamp of the message to which the specified threadKey is a reply. If not a reply, this will return null
 * @api private
 */
var _parseReplyToTimestampFromThreadKey = function(threadKey) {
    // Converts: "timestamp1#timestamp2#timestamp3|" -> [ "timestamp1", "timestamp2", "timestamp3" ]
    var hierarchy = threadKey.split('|')[0].split('#');
    if (hierarchy.length > 1) {
        // "timestamp3" is a reply to "timestamp2", so we pick out the second last one in the hierarchy
        return hierarchy[hierarchy.length - 2];
    } else {
        // If we only had 1 element, then this is not a reply at all
        return null;
    }
};
