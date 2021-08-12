/*
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

import _ from 'underscore';

import * as discussionMessageBody from './search/schema/resourceMessagesSchema.js';
import * as SearchAPI from 'oae-search';
import * as SearchUtil from 'oae-search/lib/util.js';
import * as MessageBoxAPI from 'oae-messagebox';

/**
 * Register and create a message search document name and schema that is a child of resource documents. Registering
 * a message search document for a resource will provide the ability for the resource to have searchable messages.
 *
 * @param  {String}     name            The globally unique name (also document type) of this search document
 * @param  {String[]}   resourceTypes   The resource types for which the producer should produce children
 * @param  {Function}   producer        The producer function for the child document as described in `SearchAPI#registerChildSearchDocument`
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */

const registerMessageSearchDocument = function (name, resourceTypes, producer, callback) {
  const messagesChildSearchDocumentOptions = {
    resourceTypes,
    schema: {
      type: discussionMessageBody.type,
      store: discussionMessageBody.store,
      index: discussionMessageBody.index,
      analyzer: discussionMessageBody.analizer
    },
    producer
  };

  return SearchAPI.registerChildSearchDocument(name, messagesChildSearchDocumentOptions, callback);
};

/**
 * Create all message documents for all of a message box's messages.
 *
 * @param  {String}     name                The name of the message search document schema, as registered by `#registerMessageSearchDocument`
 * @param  {String}     resourceId          The id of the resource who is the parent to these documents
 * @param  {String}     messageBoxId        The id of the messagebox that holds the messages that will be produced into documents
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Object[]}   callback.documents  The message search documents based on the messages in the messagebox
 */
const createAllMessageSearchDocuments = function (name, resourceId, messageBoxId, callback) {
  _getAllMessages(messageBoxId, null, 100, (error, messages) => {
    if (error) {
      return callback(error);
    }

    return callback(null, createMessageSearchDocuments(name, resourceId, messages));
  });
};

/**
 * Create the message search documents based on the list of messages.
 *
 * @param  {String}     name            The name of the message search document schema, as registered by `#registerMessageSearchDocument`
 * @param  {String}     resourceId      The id of the resource who is the parent to these documents
 * @param  {Messages[]} messages        The messages from which to produce search documents
 * @return {Object[]}                   The message search documents based on the provided messages
 */
const createMessageSearchDocuments = function (name, resourceId, messages) {
  return _.chain(messages)
    .filter((message) => {
      // Do not convert deleted messages into search documents
      return !message.deleted;
    })
    .map((message) => {
      // Here we'll be looking for `discussion_message_body` because that's the default export in `resourceMessagesSchema.js`
      return SearchUtil.createChildSearchDocument(name, resourceId, {
        id: message.id,
        discussion_message_body: message.body // eslint-disable-line camelcase
      });
    })
    .value();
};

/**
 * Submit a task to delete the message search document that is represented by the given message.
 *
 * @param  {String}     name            The name of the message search document schema, as registered by `#registerMessageSearchDocument`
 * @param  {Message}    message         The message object that represents the message document to delete
 */
const deleteMessageSearchDocument = function (name, resourceId, message) {
  const children = {};
  children[name] = [SearchUtil.getChildSearchDocumentId(name, resourceId, message.id)];
  return SearchAPI.postDeleteTask(null, children);
};

/**
 * Get all the messages of a message box, up to a hard-coded limit of 10,000.
 *
 * @param  {String}     messageBoxId            The id of the messagebox whose messages to fetch
 * @param  {String}     start                   Where to start scanning messages
 * @param  {Number}     chunkSize               The maximum number of messages to fetch
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Message[]}  callback.messages       The messages in the message box
 * @api private
 */
const _getAllMessages = function (messageBoxId, start, chunkSize, callback, _messages) {
  _messages = _messages || [];
  MessageBoxAPI.getMessagesFromMessageBox(messageBoxId, start, chunkSize, null, (error, messages, nextToken) => {
    if (error) {
      return callback(error);
    }

    _messages = _.union(_messages, messages);
    if (!nextToken) {
      return callback(null, _messages);
    }

    return _getAllMessages(messageBoxId, nextToken, chunkSize, callback, _messages);
  });
};

export {
  registerMessageSearchDocument,
  createAllMessageSearchDocuments,
  createMessageSearchDocuments,
  deleteMessageSearchDocument
};
