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

import fs from 'fs';
import util from 'util';
import path from 'path';
import stream from 'stream';
import PreviewConstants from 'oae-preview-processor/lib/constants';
import sharp from 'sharp';
import pdfjsLib from 'pdfjs-dist';
import { logger } from 'oae-logger';
import * as OaeUtil from 'oae-util/lib/util';
import * as PreviewUtil from 'oae-preview-processor/lib/util';
import domStubs from './domstubs';
import { head, split, join, pluck, includes, and, either, not, path as getPath, equals, compose } from 'ramda';

const fsWriteFile = util.promisify(fs.writeFile);
const fsMakeDir = util.promisify(fs.mkdir);

const log = logger('oae-preview-processor');

const PAGES_SUBDIRECTORY = 'pages';
const TXT_CONTENT_FILENAME = 'plain.txt';
const FILE_SUBTYPE = 'file';
let viewportScale = 1.5;
const pdfContents = [];
const HTML_FORMAT = 'html';
const SVG_FORMAT = 'svg';
const TEXT_FORMAT = 'txt';

// Auxiliary functions
const differs = compose(not, equals);
const isDefined = Boolean;
const isNotDefined = compose(not, isDefined);

// Implements https://nodejs.org/api/stream.html#stream_readable_read_size_1
ReadableSVGStream.prototype._read = function() {
  let chunk;
  while (differs((chunk = this.serializer.getNext()), null)) {
    if (isNotDefined(this.push(chunk))) return;
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
  const previewIsNotDefined = config => compose(not, getPath(['pdfPreview']))(config);
  const viewportIsNotDefined = config => compose(not, getPath(['pdfPreview', 'viewportScale']))(config);
  if (isNotDefined(config) || either(previewIsNotDefined, viewportIsNotDefined)(config)) {
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
const test = function(ctx, contentObject, callback) {
  const resourceIsFile = equals(FILE_SUBTYPE);
  const mimeTypeIncludesPDF = mime => includes(mime, PreviewConstants.TYPES.PDF);

  if ((and(resourceIsFile(contentObject.resourceSubType)), mimeTypeIncludesPDF(ctx.revision.mime))) {
    callback(null, 10);
  } else {
    callback(null, -1);
  }
};

/**
 * @borrows Interface.generatePreviews as PDF.generatePreviews
 */
const generatePreviews = (ctx, contentObject, callback) => {
  ctx.download((err, path) => {
    if (err) return callback(err);

    previewPDF(ctx, path, callback);
  });
};

// TODO
const loadPDFDocument = async data => {
  // Will be using promises to load document, pages and misc data instead of
  // callback.
  const loadedPDFDocument = pdfjsLib.getDocument({
    data,
    // Try to export JPEG images directly if they don't need any further
    // processing.
    nativeImageDecoderSupport: pdfjsLib.NativeImageDecoding.NONE
  });

  return loadedPDFDocument.promise;
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
  domStubs.setStubs(global);

  const pagesDir = path.join(ctx.baseDir, PAGES_SUBDIRECTORY);
  const output = path.join(pagesDir, TXT_CONTENT_FILENAME);
  const data = new Uint8Array(fs.readFileSync(pdfPath));

  try {
    // Create a directory where we can store the files
    await fsMakeDir(pagesDir, { recursive: true });

    const doc = await loadPDFDocument(data);
    const { numPages } = doc;

    ctx.addPreview(output, TEXT_FORMAT);
    ctx.addPreviewMetadata('pageCount', numPages);

    await processAllPages(ctx, pagesDir, numPages, doc);
    await fsWriteFile(output, join(' ', pdfContents));

    _generateThumbnail(ctx, pdfPath, pagesDir, callback);
  } catch (error) {
    const errorMessage = 'Unable to process PDF';
    log().error({ error }, errorMessage);
    return callback({ code: 500, msg: errorMessage });
  }
};

// TODO
const convertToSVG = async (page, svgPath) => {
  const viewport = page.getViewport({ scale: 1 });
  const opList = await page.getOperatorList();
  const svgGfx = new pdfjsLib.SVGGraphics(page.commonObjs, page.objs);
  svgGfx.embedFonts = true;
  const svg = await svgGfx.getSVG(opList, viewport);

  return writeSvgToFile(svg, svgPath);
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
const _generateThumbnail = async function(ctx, path, pagesDir, callback) {
  const returnError = err => {
    log().error({ err, contentId: ctx.contentId }, 'Could not convert a PDF page to a PNG');
    return callback({ code: 500, msg: 'Could not convert a PDF page to a PNG' });
  };

  const width = PreviewConstants.SIZES.PDF.LARGE;
  const output = `${pagesDir}/page.1.png`;
  const data = new Uint8Array(fs.readFileSync(path));
  const svgPath = head(split('.', path)) + '.svg';

  try {
    const doc = await loadPDFDocument(data);
    const page = await doc.getPage(1);
    await convertToSVG(page, svgPath);
  } catch (error) {
    returnError(error);
  }

  sharp(svgPath, { density: 150 })
    .resize(width)
    .toFile(output, err => {
      if (err) returnError(err);

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
function getFilePathForPage(pagesDir, pageNumber, format) {
  return path.join(pagesDir, `page.${pageNumber}.${format}`);
}

/**
 * A readable stream which offers a stream representing the serialization of a
 * given DOM element (as defined by domstubs.js).
 *
 * @param {object} options
 * @param {DOMElement} options.svgElement The element to serialize
 */
function ReadableSVGStream(options) {
  if (not(this instanceof ReadableSVGStream)) return new ReadableSVGStream(options);

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
  }).catch(error => {
    readableSvgStream = null; // Explicitly null because of v8 bug 6512.
    writableStream.end();
    throw error;
  });
}

/**
 * @function previewAndIndexEachPage
 * @param  {PreviewContext} ctx  The preview context associated to this file
 * @param  {pagesDir} pagesDir   The directory holding the svg previews on disk
 * @param  {Number} pageNum      The page number we're dealing with
 * @param  {Object} doc          Object representing the PDF
 */
const previewAndIndexEachPage = async function(ctx, pagesDir, pageNumber, doc) {
  try {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: viewportScale });
    ctx.addPreview(getFilePathForPage(pagesDir, pageNumber, HTML_FORMAT), HTML_FORMAT);
    ctx.addPreview(getFilePathForPage(pagesDir, pageNumber, SVG_FORMAT), SVG_FORMAT);

    const opList = await page.getOperatorList();
    const svgGfx = new pdfjsLib.SVGGraphics(page.commonObjs, page.objs);
    svgGfx.embedFonts = true;

    const svg = await svgGfx.getSVG(opList, viewport);

    await writeSvgToFile(svg, getFilePathForPage(pagesDir, pageNumber, HTML_FORMAT));
    await writeSvgToFile(svg, getFilePathForPage(pagesDir, pageNumber, SVG_FORMAT));
    const content = await page.getTextContent();

    // Content contains lots of information about the text layout and
    // styles, but we need only strings at the moment
    const pageContents = compose(join(' '), pluck('str'))(content.items);
    const pageName = util.format('page.%s.txt', pageNumber);
    const pagePath = util.format('%s/%s', pagesDir, pageName);

    pdfContents.push(pageContents);
    ctx.addPreview(pagePath, pageName);

    return fsWriteFile(pagePath, pageContents);
  } catch (error) {
    const errorMessage = `Preview processing for pdf page ${pageNumber} file failed`;
    log().error({ error }, errorMessage);
    throw error;
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
const processAllPages = async function(ctx, pagesDir, numberPages, doc) {
  for (let i = 1; i <= numberPages; i++) {
    // eslint-disable-next-line no-await-in-loop
    await previewAndIndexEachPage(ctx, pagesDir, i, doc);
  }
};

export { init, test, generatePreviews, previewPDF };
