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

const fs = require('fs');
const util = require('util');

const fsWriteFile = util.promisify(fs.writeFile);
const fsMakeDir = util.promisify(fs.mkdir);
const path = require('path');
const stream = require('stream');
const gm = require('gm');
const pdfjsLib = require('pdfjs-dist');
const _ = require('underscore');

const log = require('oae-logger').logger('oae-preview-processor');
const OaeUtil = require('oae-util/lib/util');

const PreviewConstants = require('oae-preview-processor/lib/constants');
const PreviewUtil = require('oae-preview-processor/lib/util');

const PAGES_SUBDIRECTORY = 'pages';
const TXT_CONTENT_FILENAME = 'plain.txt';
const RESOURCE_SUBTYPE = 'file';
let viewportScale = 1.5;
const pdfContents = [];

// Implements https://nodejs.org/api/stream.html#stream_readable_read_size_1
ReadableSVGStream.prototype._read = function() {
  let chunk;
  while ((chunk = this.serializer.getNext()) !== null) {
    if (!this.push(chunk)) {
      return;
    }
  }
  this.push(null);
};
util.inherits(ReadableSVGStream, stream.Readable);

/**
 * Initializes the PDF Processor. This method will check if the configuration has been set up correctly to deal with PDF files
 *
 * @param  {Object}     config          The config object containing the module configuration. See the `config.previews` object in the base `./config.js` for more information
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const init = function(config, callback) {
  if (!config || !config.pdfPreview || !config.pdfPreview.viewportScale) {
    return callback({
      code: 500,
      msg: 'Missing configuration for the pdf preview / processing'
    });
  }
  viewportScale = OaeUtil.getNumberParam(config.pdfPreview.viewportScale, viewportScale);
  return callback();
};

/**
 * @borrows Interface.test as PDF.test
 */
const test = function(ctx, contentObj, callback) {
  if (
    contentObj.resourceSubType === RESOURCE_SUBTYPE &&
    PreviewConstants.TYPES.PDF.indexOf(ctx.revision.mime) !== -1
  ) {
    callback(null, 10);
  } else {
    callback(null, -1);
  }
};

/**
 * @borrows Interface.generatePreviews as PDF.generatePreviews
 */
const generatePreviews = function(ctx, contentObj, callback) {
  // Download the file
  ctx.download((err, path) => {
    if (err) {
      return callback(err);
    }

    // Generate the previews for it
    previewPDF(ctx, path, callback);
  });
};

/**
 * Generates previews for a PDF file.
 * 1 html will be generated for each page.
 *
 * @param  {PreviewContext}      ctx             The preview context associated to this file
 * @param  {String}              pdfPath         The path where the PDF file is stored
 * @param  {Function}            callback        Standard callback function
 * @param  {Object}              callback.err    An error that occurred, if any
 */
const previewPDF = async function(ctx, pdfPath, callback) {
  require('./domstubs.js').setStubs(global);

  const pagesDir = path.join(ctx.baseDir, PAGES_SUBDIRECTORY);
  const output = path.join(pagesDir, TXT_CONTENT_FILENAME);
  const data = new Uint8Array(fs.readFileSync(pdfPath));

  try {
    // Create a directory where we can store the files
    await fsMakeDir(pagesDir);

    // Will be using promises to load document, pages and misc data instead of
    // callback.
    const loadedPDFDocument = pdfjsLib.getDocument({
      data,
      // Try to export JPEG images directly if they don't need any further
      // processing.
      nativeImageDecoderSupport: pdfjsLib.NativeImageDecoding.NONE
    });

    const doc = await loadedPDFDocument.promise;
    const { numPages } = doc;

    ctx.addPreview(output, 'txt');
    ctx.addPreviewMetadata('pageCount', numPages);

    await processAllPages(ctx, pagesDir, numPages, doc);
    await fsWriteFile(output, pdfContents.join(' '));

    _generateThumbnail(ctx, pdfPath, pagesDir, callback);
  } catch (e) {
    const errorMessage = 'Unable to process PDF';
    log().error({ e }, errorMessage);
    return callback({ code: 500, msg: errorMessage });
  }
};

/**
 * Generate a thumbnail for the PDF file. This works by converting the first page
 * of the PDF to an image and then cropping a thumbnail out of it
 *
 * @param  {PreviewContext}      ctx             The preview context associated to this file
 * @param  {String}              path            The path where the PDF file is stored
 * @param  {String}              pagesDir        The directory where the pages can be stored in
 * @param  {Function}            callback        Standard callback function
 * @param  {Object}              callback.err    An error that occurred, if any
 * @api private
 */
const _generateThumbnail = function(ctx, path, pagesDir, callback) {
  // Convert the first page to a png file by executing the equivalent of
  //    gm convert +adjoin -define pdf:use-cropbox=true -density 150 -resize 2000 -quality 100 input.pdf[0] output.png
  const width = PreviewConstants.SIZES.PDF.LARGE;
  const output = pagesDir + '/page.1.png';
  gm(path + '[0]')
    .adjoin()
    .define('pdf:use-cropbox=true')
    .density(150, 150)
    .resize(width, '')
    .quality(100)
    .write(output, err => {
      if (err) {
        log().error({ err, contentId: ctx.contentId }, 'Could not convert a PDF page to a PNG');
        return callback({ code: 500, msg: 'Could not convert a PDF page to a PNG' });
      }

      // Crop a thumbnail out of the png file
      PreviewUtil.generatePreviewsFromImage(ctx, output, { cropMode: 'TOP' }, callback);
    });
};

/**
 * Utility function
 *
 * @function getFilePathForPage
 * @param  {String} pagesDir  The directory where the pages can be stored in
 * @param  {Number} pageNum  The page number
 * @return {String} The file path for the svg file corresponding to the page
 */
function getFilePathForPage(pagesDir, pageNum) {
  return path.join(pagesDir, 'page.' + pageNum + '.svg');
}

/**
 * A readable stream which offers a stream representing the serialization of a
 * given DOM element (as defined by domstubs.js).
 *
 * @param {object} options
 * @param {DOMElement} options.svgElement The element to serialize
 */
function ReadableSVGStream(options) {
  if (!(this instanceof ReadableSVGStream)) {
    return new ReadableSVGStream(options);
  }
  stream.Readable.call(this, options);
  this.serializer = options.svgElement.getSerializer();
}

/**
 * @function writeSvgToFile
 * @param  {svgElement} svgElement the SVG representation of one pdf page
 * @param  {filePath} filePath     file path for writing the svg file to disk
 */
function writeSvgToFile(svgElement, filePath) {
  // Streams the SVG element to the given file path.
  let readableSvgStream = new ReadableSVGStream({
    svgElement
  });
  const writableStream = fs.createWriteStream(filePath);

  return new Promise((resolve, reject) => {
    readableSvgStream.once('error', reject);
    writableStream.once('error', reject);
    writableStream.once('finish', resolve);
    readableSvgStream.pipe(writableStream);
  }).catch(err => {
    readableSvgStream = null; // Explicitly null because of v8 bug 6512.
    writableStream.end();
    throw err;
  });
}

/**
 * @function previewAndIndexEachPage
 * @param  {PreviewContext} ctx  The preview context associated to this file
 * @param  {pagesDir} pagesDir   The direcotry holding the svg previews on disk
 * @param  {Number} pageNum     The page number we're dealing with
 * @param  {Object} doc          Object representing the PDF
 */
const previewAndIndexEachPage = async function(ctx, pagesDir, pageNum, doc) {
  try {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: viewportScale });
    ctx.addPreview(getFilePathForPage(pagesDir, pageNum), 'html');

    const opList = await page.getOperatorList();
    const svgGfx = new pdfjsLib.SVGGraphics(page.commonObjs, page.objs);
    svgGfx.embedFonts = true;

    const svg = await svgGfx.getSVG(opList, viewport);
    await writeSvgToFile(svg, getFilePathForPage(pagesDir, pageNum));
    const content = await page.getTextContent();

    // Content contains lots of information about the text layout and
    // styles, but we need only strings at the moment
    const pageContents = _.pluck(content.items, 'str').join(' ');
    const pageName = util.format('page.%s.txt', pageNum);
    const pagePath = util.format('%s/%s', pagesDir, pageName);

    pdfContents.push(pageContents);
    ctx.addPreview(pagePath, pageName);

    return fsWriteFile(pagePath, pageContents);
  } catch (e) {
    const errorMessage = `Preview processing for pdf page ${pageNum} file failed`;
    log().error({ e }, errorMessage);
    throw e;
  }
};

/**
 * Utility function
 *
 * @function processAllPages
 * @param  {PreviewContext} ctx  The preview context associated to this file
 * @param  {pagesDir} pagesDir   The direcotry holding the svg previews on disk
 * @param  {Number} pageNum     The page number we're dealing with
 * @param  {Object} doc          Object representing the PDF
 */
const processAllPages = async function(ctx, pagesDir, numPages, doc) {
  for (let i = 1; i <= numPages; i++) {
    // eslint-disable-next-line no-await-in-loop
    await previewAndIndexEachPage(ctx, pagesDir, i, doc);
  }
};

module.exports = {
  init,
  test,
  generatePreviews,
  previewPDF
};
