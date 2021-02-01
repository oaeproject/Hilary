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
import request from 'request';

import { logger } from 'oae-logger';
import { setUpConfig } from 'oae-config';

import * as LinkProcessorUtil from 'oae-preview-processor/lib/processors/link/util';
import * as PreviewUtil from 'oae-preview-processor/lib/util';

const log = logger('oae-preview-processor');
const PreviewConfig = setUpConfig('oae-preview-processor');

// A regular expression that can be used to check if a URL points to a specific photo
const REGEX_PHOTO = /^http(s)?:\/\/(www\.)?flickr\.com\/photos\/([-\w@]+)\/(\d+)/;
// A regular expression that can be used to check if a (short) URL points to a specific photo
const REGEX_SHORT_PHOTO = /^http(s)?:\/\/flic.kr\/p\/(\w+)/;
// A regular expression that can be used to check if a URL points to a set of photos
const REGEX_SET = /^http(s)?:\/\/(www\.)?flickr\.com\/photos\/([-\w@]+)\/sets\/(\d+)/;

// The URL where the Flickr REST API can be reached
let apiUrl = 'https://api.flickr.com/services/rest/';

// The URL where the image can be downloaded
let imageUrl = 'https://farm%s.static.flickr.com/%s/%s_%s_b.jpg';

/**
 * Set the URL where the Flickr API can be reached
 *
 * @param  {String}     _apiUrl     Defines the URL (including protocol and path) where the flickr REST API can be reached
 */
const setApiUrl = function (_apiUrl) {
  apiUrl = _apiUrl;
};

/**
 * Set the URL where a Flickr image can be downloaded (including placeholders)
 *
 * @param  {String}     _imageUrl     Defines the URL (including protocol and path) where an image can be downloaded
 */
const setImageUrl = function (_imageUrl) {
  imageUrl = _imageUrl;
};

/**
 * @borrows Interface.test as FlickrProcessor.test
 */
const test = function (ctx, contentObject, callback) {
  // Don't bother with non-link content items
  if (contentObject.resourceSubType !== 'link') {
    return callback(null, -1);
  }

  // First check that this retriever has been configured in the Admin UI
  const config = _getConfig();
  if (!config.apiKey || !config.apiSecret) {
    return callback(null, -1);
  }

  // Only allow URLs that are on the Flickr domain
  if (
    REGEX_PHOTO.test(contentObject.link) ||
    REGEX_SHORT_PHOTO.test(contentObject.link) ||
    REGEX_SET.test(contentObject.link)
  ) {
    return callback(null, 10);
  }

  return callback(null, -1);
};

/**
 * @borrows Interface.generatePreviews as FlickrProcessor.generatePreviews
 */
const generatePreviews = function (ctx, contentObject, callback) {
  /*!
   * Downloads a thumbnail from flickr and processes it
   *
   * @param  {Object}     err     An error object coming from the metadata fetchers
   * @param  {Object}     opts    The object with metadata that we can use to fetch the image and/or a displayname and a description
   * @param  {Boolean}    ignore  If this value is set to `true` we'll ignore the picture
   * @api private
   */
  const handleDownload = function (error, options, ignore) {
    if (error) {
      return callback(error);
    }

    if (ignore) {
      return callback(null, true);
    }

    // Download it.
    const path = ctx.baseDir + '/flickr.jpg';
    PreviewUtil.downloadRemoteFile(options.imageUrl, path, (error, path) => {
      if (error) {
        return callback(error);
      }

      return LinkProcessorUtil.generatePreviewsFromImage(ctx, path, options, callback);
    });
  };

  // Determine what type it is.
  const flickr = _getType(contentObject.link);
  if (flickr.type === 'photo') {
    _getFlickrPhoto(ctx, flickr.id, handleDownload);
  } else if (flickr.type === 'set') {
    _getFlickrSet(ctx, flickr.id, handleDownload);
  } else {
    // Technically shouldn't happen.
    log().error('Could not identify the type of Flickr url.');
    return callback({ code: 500, msg: 'Could not identify the type of Flickr url.' });
  }
};

/**
 * Get the large image URL for a Flickr Photo ID
 *
 * @param  {PreviewContext}     ctx                 The preview context associated to this file
 * @param  {String}             id                  The Photo ID
 * @param  {Function}           callback            Standard callback function
 * @param  {Object}             callback.err        An error that occurred, if any
 * @param  {String}             callback.metadata   The metadata of the Flickr photo
 * @param  {Boolean}            callback.ignore     Whether or not this photo should be ignored
 * @api private
 */
const _getFlickrPhoto = function (ctx, id, callback) {
  const config = _getConfig();

  const url = format(
    '%s?method=flickr.photos.getInfo&api_key=%s&photo_id=%s&format=json&nojsoncallback=1',
    apiUrl,
    config.apiKey,
    id
  );
  request(url, (error, response, body) => {
    if (error) {
      log().error({ err: error, body }, 'An unexpected error occurred getting a Flickr photo');
      return callback(error);
    }

    if (response.statusCode !== 200) {
      error = { code: response.statusCode, msg: body };
      log().error({ err: error }, 'An unexpected error occurred getting a Flickr photo');
      return callback(error);
    }

    // Try and parse the Flickr response, returning with an error if it is not valid JSON
    let info = null;
    try {
      info = JSON.parse(body);
    } catch (error) {
      log().error({ err: error, contentId: error.contentId }, 'Could not parse flickr response');
      return callback({ code: 500, msg: error.message });
    }

    // Ignore this photo if it has no thumbnail
    if (!info.photo) {
      return callback(null, null, true);
    }

    // Return the important Flickr photo metadata
    return callback(null, {
      displayName: info.photo.title._content,
      description: info.photo.description._content,
      imageUrl: _getImageUrl(info.photo.farm, info.photo.server, info.photo.id, info.photo.secret)
    });
  });
};

/**
 * Get the large image URL for a Flickr set
 *
 * @param  {PreviewContext}     ctx                 The preview context associated to this file
 * @param  {String}             id                  The set ID
 * @param  {Function}           callback            Standard callback function
 * @param  {Object}             callback.err        An error that occurred, if any
 * @param  {String}             callback.metadata   The metadata of the Flickr photo
 * @param  {Boolean}            callback.ignore     Whether or not this photo should be ignored
 * @api private
 */
const _getFlickrSet = function (ctx, id, callback) {
  const config = _getConfig();
  const url = format(
    '%s?method=flickr.photosets.getInfo&api_key=%s&photoset_id=%s&format=json&nojsoncallback=1',
    apiUrl,
    config.apiKey,
    id
  );
  request(url, (error, response, body) => {
    if (error) {
      log().error({ err: error, body }, 'An unexpected error occurred getting a Flickr photo set');
      return callback(error);
    }

    if (response.statusCode !== 200) {
      error = { code: response.statusCode, msg: body };
      log().error({ err: error }, 'An unexpected error occurred getting a Flickr photo set');
      return callback(error);
    }

    // Try and parse the Flickr response, returning with an error if it is not valid JSON
    let info = null;
    try {
      info = JSON.parse(body);
    } catch (error) {
      log().error({ err: error, contentId: ctx.contentId }, 'Could not parse flickr response.');
      return callback({ code: 500, msg: error.message });
    }

    // Ignore this set if it has no thumbnail
    if (!info.photoset) {
      return callback(null, null, true);
    }

    return callback(null, {
      displayName: info.photoset.title._content,
      description: info.photoset.description._content,
      imageUrl: _getImageUrl(info.photoset.farm, info.photoset.server, info.photoset.primary, info.photoset.secret)
    });
  });
};

/**
 * Get the Flickr API values that have been configured in the Admin UI
 *
 * @return {Object}     The apiKey and apiSecret from the Admin UI.
 * @api private
 */
const _getConfig = function () {
  return {
    apiKey: PreviewConfig.getValue('admin', 'flickr', 'apikey'),
    apiSecret: PreviewConfig.getValue('admin', 'flickr', 'apisecret')
  };
};

/**
 * Get the URL where a JPG image can be downloaded from
 *
 * @param  {Number}     farm        The flickr farm the image is located on
 * @param  {String}     server      The flickr server the image is licated on
 * @param  {String}     id          The id for the flickr photo
 * @param  {String}     secret      The secret identifier for the flickr photo
 * @return {String}                 The URL where the image can be downloaded
 * @api private
 */
const _getImageUrl = function (farm, server, id, secret) {
  return format(imageUrl, farm, server, id, secret);
};

/**
 * Get the type for this url.
 *
 * @param  {String}     url     The Flickr URL
 * @return {Object}             An object that has a key `type` that is either set to `photo` or `set` and a key `id` which is set to either the photo-id or the set-id
 * @api private
 */
const _getType = function (url) {
  // Check if it's a URL to a photo
  let match = url.match(REGEX_PHOTO);
  if (match) {
    return { type: 'photo', id: match[4] };
  }

  match = url.match(REGEX_SHORT_PHOTO);
  if (match) {
    return { type: 'photo', id: _base58Decode(match[2]) };
  }

  // Check if it's a set
  match = url.match(REGEX_SET);
  if (match) {
    return { type: 'set', id: match[4] };
  }

  // This shouldn't really happen
  return null;
};

/**
 * Decode a base 58 encoded string into a number.
 *
 * For example:
 *   `_base58Decode('a9uKUe')` will result in `6003353697`
 *
 * @param  {String}     s   The string to decode
 * @return {Number}         The number that was encoded in the string
 * @see {@link https://www.flickr.com/services/api/misc.urls.html#short}
 * @see {@link https://www.flickr.com/groups/api/discuss/72157616713786392/}
 * @api private
 */
const _base58Decode = function (s) {
  const alphabet = '123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';

  // Reverse the string
  const reversed = s.split('').reverse().join('');

  // The following is an iterative process where for each character in the
  // reversed string we:
  //  - Raise the alphabet-length to the power of i (current step)    (=exp)
  //  - Get the index of the character in the alphabet                (=position)
  //  - Multiply the position with the exponentation
  //  - Add it up                                                     (=val)
  let value = 0;
  let exp = 1;
  for (const element of reversed) {
    const position = alphabet.indexOf(element);
    value += exp * position;
    exp *= alphabet.length;
  }

  return value;
};

export { setApiUrl, setImageUrl, test, generatePreviews };
