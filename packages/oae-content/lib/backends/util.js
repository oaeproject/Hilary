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
import ShortId from 'shortid';
import * as AuthzUtil from 'oae-authz/lib/util.js';

const VALID_CHARACTERS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
const COLLABDOC = 'collabdoc';
const COLLABSHEET = 'collabsheet';
const FILE = 'file';
const LINK = 'link';

/**
 * Split a content uri into its 2 parts: The storage implementation identifier and the location string. With a
 * uri like:
 *
 *  local:/path/to/resource
 *
 * The result would be:
 *
 * {
 *      'storageType': 'local',
 *      'location': '/path/to/resource'
 * }
 *
 * @param  {String}     uri     The uri for the resource, in format: 'local:/path/to/resource'
 * @return {Object}             An object describing the parts of the uri, as described in the description
 */
const splitUri = function (uri) {
  const parts = uri.split(':');
  const storageType = parts.shift();
  const location = parts.join(':');
  return { storageType, location };
};

/**
 * Generates a URI for a file.
 * ex:
 * options.filename = 'large.png'
 * options.prefix = 'profilepictures'
 * options.resourceId = u:cam:AF1e2c_3
 * The resulting URI would be u/cam/AF/1e/2c/_3/AF1e2c_3/profilepictures/large.png
 * If no resourceId is specified a random hash will be generated.
 *
 * @param  {File}   file                    A file object.
 * @param  {Object} [options]               Holds extra optional options.
 * @param  {String} [options.filename]      Will be stuck at the end of the URI. Some backends will use this filename as the actual filename on disk. If omitted, the actual filename will be used.
 * @param  {String} [options.resourceId]    Will be hashed up and be made part of the URI. By specifying this property and the filename one, you can overwrite an older file. If left blank a random one will be generated.
 * @param  {String} [options.prefix]        An optional prefix that gets tacked on *AFTER* the hashing of the resource id but *BEFORE* the filename
 * @return {String}                         A URI
 */
const generateUri = function (file, options) {
  options = options || {};
  const filename = options.filename || file.name;
  let hash = null;

  // If we specified a resource ID, hash it up.
  // Pad the ID if it's not long enough.
  if (options.resourceId) {
    const r = AuthzUtil.getResourceFromId(options.resourceId);
    if (r.resourceId.length < 8) {
      r.resourceId = _padRight(r.resourceId, 8);
    }

    hash = _hash(r.resourceType, r.tenantAlias, r.resourceId);

    // In all other cases we generate a random hash.
  } else {
    const type = 'unspecified';
    const tenantAlias = 'unspecified';
    const resourceId = ShortId.generate();
    hash = _hash(type, tenantAlias, resourceId);
  }

  // Construct the full URI.
  let uri = hash;
  if (options.prefix) {
    uri += '/' + options.prefix;
  }

  uri += '/' + filename;

  // Because the URI gets used in file paths sometimes
  // we make sure that it doesn't contain any "wrong" characters.
  // Rather than blacklisting every illegal character for every file system
  // we simply whitelist a set of known characters.
  uri = uri.replace(/[^-\w/.]/g, '-');

  return uri;
};

/**
 * Hashes a resource id (ex: u:cam:AF1e2c_3) to a partial file URI (ex: u/cam/AF/1e/2c/_3/AF1e2c_3)
 *
 * @param  {String} resourceId The resource ID to hash
 * @return {String}            The partial file URI
 */
const _hash = function (resourceType, tenantAlias, resourceId) {
  return format(
    '%s/%s/%s/%s/%s/%s/%s',
    resourceType,
    tenantAlias,
    resourceId.slice(0, 2),
    resourceId.slice(2, 4),
    resourceId.slice(4, 6),
    resourceId.slice(6, 8),
    resourceId
  );
};

/**
 * Pads a string to a specified length.
 *
 * @param  {String} str       The string to pad.
 * @param  {Number} minLength The minimum length of the returned string.
 * @return {String}           The padded string. If the input string is longer than the `minLength` it will be returned as-is.
 */
const _padRight = function (string, minLength) {
  while (string.length < minLength) {
    string += VALID_CHARACTERS[Math.floor(Math.random() * VALID_CHARACTERS.length)];
  }

  return string;
};

const isResourceACollabSheet = function (resourceType) {
  return resourceType === COLLABSHEET;
};

const isResourceACollabDoc = function (resourceType) {
  return resourceType === COLLABDOC;
};

const isResourceALink = function (resourceType) {
  return resourceType === LINK;
};

const isResourceAFile = function (resourceType) {
  return resourceType === FILE;
};

export { splitUri, generateUri, isResourceACollabDoc, isResourceACollabSheet, isResourceAFile, isResourceALink };
