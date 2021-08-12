/*!
 * Copyright 2017 Apereo Foundation (AF) Licensed under the
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

import * as Cassandra from 'oae-util/lib/cassandra.js';
import { LtiTool } from 'oae-lti/lib/model.js';

/**
 * Create an LTI tool
 *
 * @param  {String}         id                     The id for the LTI tool
 * @param  {String}         groupId                The globally unique id for the group that owns the tool
 * @param  {String}         launchUrl              The launchUrl for the LTI tool
 * @param  {String}         secret                 The OAUTH secret for the LTI tool
 * @param  {String}         consumerKey            The consumerKey for the LTI tool
 * @param  {String}         displayName            The displayName of the LTI tool
 * @param  {String}         description            A description of the LTI tool
 * @param  {Function}       callback               Standard callback function
 * @param  {Object}         callback.err           An error that occurred, if any
 * @param  {LtiTool}        callback.ltiTool       The LTI tool that was created
 */
const createLtiTool = function (id, groupId, launchUrl, secret, consumerKey, displayName, description, callback) {
  displayName = displayName || 'LTI tool';
  description = description || '';

  const query =
    'INSERT INTO "LtiTools" ("id", "groupId", "launchUrl", "secret", "oauthConsumerKey", "displayName", "description") VALUES (?, ?, ?, ?, ?, ?, ?)';
  const parameters = [id, groupId, launchUrl, secret, consumerKey, displayName, description];
  Cassandra.runQuery(query, parameters, (err) => {
    if (err) {
      return callback(err);
    }

    const ltiTool = new LtiTool(id, groupId, launchUrl, secret, consumerKey, {
      displayName,
      description
    });

    // Scrub out OAUTH parameters - they are only needed for tool launches
    delete ltiTool.secret;
    delete ltiTool.consumerKey;
    return callback(null, ltiTool);
  });
};

/**
 * Get an LTI tool by its id and group id
 *
 * @param  {String}     id                  The id of the LTI tool to retrieve
 * @param  {String}     groupId             The id of the group LTI tools are fetched for
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {LtiTool}    callback.ltiTool    The request LTI tool object
 */
const getLtiTool = function (id, groupId, callback) {
  Cassandra.runQuery('SELECT * FROM "LtiTools" WHERE "groupId" = ? AND "id" = ?', [groupId, id], (err, rows) => {
    if (err) {
      return callback(err);
    }

    if (_.isEmpty(rows)) {
      return callback({
        code: 404,
        msg: 'Could not find LTI tool ' + id + ' for group ' + groupId
      });
    }

    return callback(null, _rowToLtiTool(rows[0]));
  });
};

/**
 * Get a list of LTI tools by their group
 *
 * @param  {String}         groupId             The id of the group LTI tools are fetched for
 * @param  {Function}       callback            Standard callback function
 * @param  {Object}         callback.err        An error that occurred, if any
 * @param  {LtiTool[]}      callback.ltiTools   The LtiTools that are identified by the given group.
 */
const getLtiToolsByGroupId = function (groupId, callback) {
  Cassandra.runQuery('SELECT * FROM "LtiTools" WHERE "groupId" = ?', [groupId], (err, rows) => {
    if (err) {
      return callback(err);
    }

    const tools = _.map(rows, (row) => {
      const ltiTool = _rowToLtiTool(row);

      // Scrub out OAUTH parameters - they are only needed for tool launches
      delete ltiTool.secret;
      delete ltiTool.consumerKey;
      return ltiTool;
    });

    return callback(null, tools);
  });
};

/**
 * Delete an LTI tool
 *
 * @param  {String}     id              The id of the LTI tool to delete
 * @param  {String}     groupId             The id of the group for which LTI tool should be deleted
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const deleteLtiTool = function (id, groupId, callback) {
  Cassandra.runQuery('DELETE FROM "LtiTools" WHERE "groupId" = ? AND "id" = ?', [groupId, id], callback);
};

/**
 * Given a simple row, convert it into a LtiTool object
 *
 * @param  {Object}         row           The simple key-value pair representing the fields of the LTI tool
 * @return {LtiTool}                      The LTI tool represented by the provided data
 * @api private
 */
const _rowToLtiTool = function (row) {
  const hash = Cassandra.rowToHash(row);
  const tool = new LtiTool(hash.id, hash.groupId, hash.launchUrl, hash.secret, hash.oauthConsumerKey, {
    displayName: hash.displayName,
    description: hash.description
  });
  return tool;
};

export { createLtiTool, getLtiTool, getLtiToolsByGroupId, deleteLtiTool };
