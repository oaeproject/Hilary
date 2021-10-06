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

import fs from 'node:fs';
import Path from 'node:path';
import { format } from 'node:util';
import mime from 'mime';

import { S3 } from 'awssum-amazon-s3';

import { setUpConfig } from 'oae-config';
import * as IO from 'oae-util/lib/io.js';
import { logger } from 'oae-logger';
import * as TempFile from 'oae-util/lib/tempfile.js';

import { ContentConstants } from '../constants.js';
import { DownloadStrategy } from '../model.js';
import * as BackendUtil from './util.js';

const Config = setUpConfig('oae-content');
const log = logger('amazon-storage');

/**
 * Storage methods
 */

/**
 * @borrows Interface.store as Amazons3.store
 */
const store = function (tenantAlias, file, options, callback) {
  // Generate the uri for this file.
  // We can use this uri later to retrieve it.
  const uri = BackendUtil.generateUri(file, options);

  log().trace('Uploading %s to S3.', uri);

  const stream = fs.createReadStream(file.path);
  stream.once('error', (error) => {
    IO.destroyStream(stream);
    log().error({ err: error }, 'Could not upload %s to S3', uri);
    callback({ code: 500, msg: error });
  });

  options = {
    Body: stream,
    BucketName: _getBucketName(tenantAlias),
    ContentLength: file.size,
    ContentType: mime.getType(file.path),
    ObjectName: uri
  };

  // Uploads a file to S3.
  // See:
  //  * awssum: http://awssum.io/amazon/s3/put-object.html
  //  * Amazon S3 doc: http://docs.amazonwebservices.com/AmazonS3/latest/API/RESTObjectPUT.html
  // eslint-disable-next-line new-cap, no-unused-vars
  _getClient(tenantAlias).PutObject(options, (error, data) => {
    // Remove the file on disk.
    fs.unlink(file.path, (unlinkError) => {
      if (unlinkError) {
        log().warn({ err: unlinkError }, 'Could not remove the temporary file.');
        // We ignore the unlink error, as the file might've actually ended up on S3.
      }

      // Deal with the amazon response.
      if (error) {
        log().error({ err: error }, 'Could not upload to S3.');
        return callback(error);
      }

      callback(null, 'amazons3:' + uri);
    });
  });
};

/**
 * @borrows Interface.get as Amazons3.get
 */
const get = function (tenantAlias, uri, callback) {
  // Download it to a temp folder.
  const uriObject = BackendUtil.splitUri(uri);

  const filename = Path.basename(uriObject.location);
  const temporary = TempFile.createTempFile({ suffix: filename });
  const writeStream = fs.createWriteStream(temporary.path);

  writeStream.once('error', (error) => {
    IO.destroyStream(writeStream);
    log().error({ err: error }, 'Could not save %s to disk', uri);
    callback({ code: 500, msg: error });
  });

  log().trace('Downloading %s from S3.', uriObject.location);

  const options = {
    BucketName: _getBucketName(tenantAlias),
    ObjectName: uriObject.location
  };

  // Download an "object"(=file) to a temporary folder.
  // See:
  //  * Awssum doc: http://awssum.io/amazon/s3/get-object.html
  //  * Amazon S3 doc: http://docs.amazonwebservices.com/AmazonS3/latest/API/RESTObjectGET.html
  // TODO: Replace with upcoming streaming download
  // eslint-disable-next-line new-cap
  _getClient(tenantAlias).GetObject(options, (error, data) => {
    if (error) {
      IO.destroyStream(writeStream);
      log().error({ err: error }, 'Failed to download %s from S3.', data);
      return callback({ code: 500, msg: error });
    }

    writeStream.on('close', () => {
      temporary.size = data.Headers['content-length'];
      return callback(null, temporary);
    });

    // Pump the data to disk.
    writeStream.end(data.Body);
  });
};

/**
 * @borrows Interface.remove as Amazons3.remove
 */
const remove = function (tenantAlias, uri, callback) {
  const uriObject = BackendUtil.splitUri(uri);
  const options = {
    BucketName: _getBucketName(tenantAlias),
    ObjectName: uriObject.location
  };

  log().trace('Removing %s from S3.', uriObject.location);

  // Delete it from Amazon S3
  // eslint-disable-next-line new-cap, no-unused-vars
  _getClient(tenantAlias).DeleteObject(options, (error, data) => {
    if (error) {
      log().error({ err: error }, 'Error removing %s', uriObject.location);
      return callback({ code: 500, msg: 'Unable to remove the file: ' + error });
    }

    callback(null);
  });
};

/**
 * We create a signed URL that allows the user to retrieve a file directly from S3.
 * This URL is valid for 5 minutes and can only be used once.
 * This involves adding a Signature parameter that signs a string with:
 *  * the HTTP method (GET)
 *  * an Expires request parameter in seconds since epoch
 *  * our public key
 *
 * @borrows Interface.getDownloadStrategy as Amazons3.getDownloadStrategy
 */
const getDownloadStrategy = function (tenantAlias, uri) {
  // Date.now returns the milliseconds since epoch, so divide/round it by a thousand
  const expires = Math.round((Date.now() + 5 * 60_000) / 1000);

  // Construct a proper signature
  const s3 = _getClient(tenantAlias);
  const bucketName = _getBucketName(tenantAlias);
  const amazonUri = BackendUtil.splitUri(uri).location;
  const stringToSign = format('GET\n\n\n%d\n/%s/%s', expires, bucketName, amazonUri);
  const signature = encodeURIComponent(s3.signature(stringToSign));

  // Construct the signed URL
  const keyId = s3.accessKeyId();
  const url = format(
    'https://%s.s3.amazonaws.com/%s?AWSAccessKeyId=%s&Signature=%s&Expires=%s',
    bucketName,
    amazonUri,
    keyId,
    signature,
    expires
  );

  // The user can download the file with the REDIRECT strategy and the signed url
  return new DownloadStrategy(ContentConstants.backend.DOWNLOAD_STRATEGY_REDIRECT, url);
};

/**
 * Returns the bucket we'll be using for storing files in.
 * @param  {String}    tenantAlias      The tenant alias.
 * @return {String}                     The bucket name
 */
const _getBucketName = function (tenantAlias) {
  return Config.getValue(tenantAlias, 'storage', 'amazons3-bucket');
};

/**
 * Gets a client that can connect to S3 and is configured via the admin interface.
 * @param  {Context}    tenantAlias     The tenant alias.
 * @return {S3}                         An S3 client.
 */
const _getClient = function (tenantAlias) {
  const accessKey = Config.getValue(tenantAlias, 'storage', 'amazons3-access-key');
  const secretKey = Config.getValue(tenantAlias, 'storage', 'amazons3-secret-key');
  const region = Config.getValue(tenantAlias, 'storage', 'amazons3-region');

  return new S3({
    accessKeyId: accessKey,
    secretAccessKey: secretKey,
    region
  });
};

export { store, get, remove, getDownloadStrategy };
