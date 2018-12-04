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

/* eslint-disable security/detect-non-literal-fs-filename */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const log = require('oae-logger').logger('oae-preview-processor');

const launchOptions = {
  args: ['--disable-dev-shm-usage']
};

const setHTTPHeadersIfAny = async function(page, customHeaders) {
  if (customHeaders) {
    await page.setExtraHTTPHeaders(customHeaders);
  }
};

const setViewportIfAny = async function(page, viewport) {
  if (viewport) {
    await page.setViewport(viewport);
  }
};

const setContentIfFile = async function(page, url) {
  const isFile = url.startsWith('file://');
  if (isFile) {
    const htmlContent = fs.readFileSync(url.slice(7), { encoding: 'utf-8' });
    await page.setContent(htmlContent);
  }
};

const navigateToPageIfUrl = async function(page, url) {
  const isUrl = url.startsWith('http');
  if (isUrl) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }
};

const setChromiumPathIfAny = function(launchOptions, executablePath) {
  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }
};

/**
 * Takes a snapshot of the provided url by loading it in a headless browser. All javascript and CSS stylesheets will be applied.
 * The URL can be anything starting with http, including file://<..> URLs. This is to allow generating images for local files.
 * and generate preview images of those. It's up to the caller to sanitize their input!
 *
 * @param  {String}         url             The URL to generate images for. This method will not verify that the URL does not point to sensitive information on the filesystem, such as /etc/passwd, and thus could end up generating an image of the password file if not used properly.
 * @param  {String}         imgPath         The path where the generated image should be stored.
 * @param  {Object}         options         The options object that will be passed into the webshot module.
 * @param  {Function}       callback        Standard callback function
 * @param  {Object}         callback.err    An error that occurred, if any
 */
const getPuppeteerImage = function(url, imgPath, options, callback) {
  log().trace({ url, imgPath }, 'Generating image for an url.');

  setChromiumPathIfAny(launchOptions, options.executablePath);

  (async () => {
    const browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();

    let isAttachment = false;
    page.on('response', response => {
      const contentDispositionHeader = response._headers['content-disposition'];
      if (contentDispositionHeader && contentDispositionHeader.startsWith(`attachment;`)) {
        isAttachment = true;
      } else {
        isAttachment = false;
      }
    });

    try {
      await setHTTPHeadersIfAny(page, options.customHeaders);
      await setViewportIfAny(page, options.viewport);
      await setContentIfFile(page, url);
      await navigateToPageIfUrl(page, url);

      await page.screenshot({ path: imgPath });
    } catch (ex) {
      if (isAttachment) {
        // Set image path to be blank in the case of attachment
        // webshot would write that file before, but not puppeteer
        log().trace({ url, imgPath }, 'Generating image for an url that is in fact an attachment.');
        const blankPng = path.resolve(__dirname, '../../static/link/blank.png');
        fs.copyFile(blankPng, imgPath, err => {
          if (err) {
            log().error(
              { err },
              'Could not copy blank screenshot file after realising file url is an attachment.'
            );
            return callback({ code: 500, msg: err.message });
          }
        });
      } else {
        log().error({ err: ex }, 'Could not generate a screenshot.');
        return callback({ code: 500, msg: ex });
      }
    } finally {
      await browser.close();
      callback(null);
    }
  })();
};

module.exports = { getImage: getPuppeteerImage };
