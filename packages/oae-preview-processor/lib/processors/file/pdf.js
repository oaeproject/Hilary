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

import fs from 'node:fs';
import { inherits, callbackify, promisify, format } from 'node:util';
import path from 'node:path';
import stream from 'node:stream';
import PreviewConstants from 'oae-preview-processor/lib/constants.js';
import sharp from 'sharp';
import { logger } from 'oae-logger';
import * as OaeUtil from 'oae-util/lib/util.js';
import * as PreviewUtil from 'oae-preview-processor/lib/util.js';
import {
  curry,
  __,
  concat,
  head,
  split,
  join,
  pluck,
  includes,
  and,
  either,
  not,
  path as getPath,
  equals,
  compose
} from 'ramda';

import pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';
import * as domStubs from './domstubs.js';

domStubs.setStubs(global);

const fsWriteFile = promisify(fs.writeFile);
const fsMakeDir = promisify(fs.mkdir);

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
const appendSVG = curry(concat)(__, '.svg');

const CMAP_URL = 'pdfjs-dist/cmaps/';
const CMAP_PACKED = true;

/**
 * A readable stream which offers a stream representing the serialization of a
 * given DOM element (as defined by domstubs.js).
 *
 * @param {object} options
 * @param {DOMElement} options.svgElement The element to serialize
 */
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

inherits(ReadableSVGStream, stream.Readable);
// Implements https://nodejs.org/api/stream.html#stream_readable_read_size_1
ReadableSVGStream.prototype._read = function () {
  let chunk;
  while (differs((chunk = this.serializer.getNext()), null)) {
    if (isNotDefined(this.push(chunk))) return;
  }

  this.push(null);
};

/**
 * Initializes the PDF Processor. This method will check if the configuration has been set up correctly to deal with PDF files
 *
 * @param  {Object}     config          The config object containing the module configuration. See the `config.previews` object in the base `./config.js` for more information
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const init = function (config, callback) {
  const previewIsNotDefined = (config) => compose(not, getPath(['pdfPreview']))(config);
  const viewportIsNotDefined = (config) => compose(not, getPath(['pdfPreview', 'viewportScale']))(config);
  const configIsMissing = either(isNotDefined, either(previewIsNotDefined, viewportIsNotDefined))(config);

  if (configIsMissing) {
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
const test = function (ctx, contentObject, callback) {
  const resourceIsFile = equals(FILE_SUBTYPE);
  const mimeTypeIncludesPDF = (mime) => includes(mime, PreviewConstants.TYPES.PDF);

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
  ctx.download((error, path) => {
    if (error) return callback(error);

    callbackify(previewPDF)(ctx, path, () => callback());
  });
};

/**
 * @function loadPDFDocument
 * @param  {Object}   data    Object representing the pdf doc to load
 */
const loadPDFDocument = (data) =>
  pdfjsLib.getDocument({
    data,
    cMapUrl: CMAP_URL,
    cMapPacked: CMAP_PACKED,
    fontExtraProperties: true
  });

/**
 * Generates previews for a PDF file.
 * 1 html will be generated for each page.
 *
 * @param  {PreviewContext}      ctx             The preview context associated to this file
 * @param  {String}              pdfPath         The path where the PDF file is stored
 * @param  {Function}            callback        Standard callback function
 * @param  {Object}              callback.err    An error that occurred, if any
 */
async function previewPDF(ctx, pdfPath) {
  const pagesDir = path.join(ctx.baseDir, PAGES_SUBDIRECTORY);
  const output = path.join(pagesDir, TXT_CONTENT_FILENAME);
  const data = new Uint8Array(fs.readFileSync(pdfPath));

  try {
    // Create a directory where we can store the files
    await fsMakeDir(pagesDir, { recursive: true });

    const doc = await loadPDFDocument(data).promise;
    const { numPages } = doc;

    ctx.addPreview(output, TEXT_FORMAT);
    ctx.addPreviewMetadata('pageCount', numPages);

    await processAllPages(ctx, pagesDir, numPages, doc);
    await fsWriteFile(output, join(' ', pdfContents));

    return _generateThumbnail(ctx, pdfPath, pagesDir);
  } catch (error) {
    const errorMessage = 'Unable to process PDF';
    log().error({ error }, errorMessage);
    throw new Error(errorMessage);
  }
}

/**
 * @function convertToSVG
 * @param  {Object} page    Object representing a pdf page (loaded)
 * @param  {String} svgPath String representing the path to write svg to
 */
async function convertToSVG(page, svgPath) {
  const viewport = page.getViewport({ scale: 1 });
  const opList = await page.getOperatorList();
  const svgGfx = new pdfjsLib.SVGGraphics(page.commonObjs, page.objs, true);
  svgGfx.embedFonts = true;
  const svg = await svgGfx.getSVG(opList, viewport);

  return writeSvgToFile(svg, svgPath);
}

/**
 * Generate a thumbnail for the PDF file. This works by converting the first page
 * of the PDF to an image and then cropping a thumbnail out of it
 *
 * @param  {PreviewContext}      ctx             The preview context associated to this file
 * @param  {String}              path            The path where the PDF file is stored
 * @param  {String}              pagesDir        The directory where the pages can be stored in
 * @api private
 */
async function _generateThumbnail(ctx, path, pagesDir) {
  const returnError = (error) => {
    log().error({ err: error, contentId: ctx.contentId }, 'Could not convert a PDF page to a PNG');
    throw new Error('Could not convert a PDF page to a PNG');
  };

  const width = PreviewConstants.SIZES.PDF.LARGE;
  const output = `${pagesDir}/page.1.png`;
  const data = new Uint8Array(fs.readFileSync(path));
  const svgPath = compose(appendSVG, head, split('.'))(path);

  try {
    const doc = await loadPDFDocument(data).promise;
    const page = await doc.getPage(1);
    await convertToSVG(page, svgPath);
  } catch (error) {
    returnError(error);
  }

  await sharp(svgPath, { density: 150 })
    .resize(width)
    .toFile(output)
    .then(() =>
      // Crop a thumbnail out of the png file
      promisify(PreviewUtil.generatePreviewsFromImage)(ctx, output, { cropMode: 'TOP' })
    )
    .catch((error) => {
      returnError(error);
    });
}

/**
 * Utility function
 *
 * @function getFilePathForPage
 * @param  {String} pagesDir  The directory where the pages can be stored in
 * @param  {Number} pageNum  The page number
 * @return {String} The file path for the svg file corresponding to the page
 */
const getFilePathForPage = (pagesDir, pageNumber, format) => path.join(pagesDir, `page.${pageNumber}.${format}`);

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
  }).catch((error) => {
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
async function previewAndIndexEachPage(ctx, pagesDir, pageNumber, doc) {
  try {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: viewportScale });
    ctx.addPreview(getFilePathForPage(pagesDir, pageNumber, HTML_FORMAT), HTML_FORMAT);
    ctx.addPreview(getFilePathForPage(pagesDir, pageNumber, SVG_FORMAT), SVG_FORMAT);

    const opList = await page.getOperatorList();
    const svgGfx = new pdfjsLib.SVGGraphics(page.commonObjs, page.objs, true);

    svgGfx.embedFonts = true;

    const svg = await svgGfx.getSVG(opList, viewport);

    await writeSvgToFile(svg, getFilePathForPage(pagesDir, pageNumber, HTML_FORMAT));
    await writeSvgToFile(svg, getFilePathForPage(pagesDir, pageNumber, SVG_FORMAT));
    const content = await page.getTextContent();

    /**
     * Content contains lots of information about the text layout and styles,
     * but we need only strings at the moment
     */
    const pageContents = compose(join(' '), pluck('str'))(content.items);
    const pageName = format('page.%s.txt', pageNumber);
    const pagePath = format('%s/%s', pagesDir, pageName);

    pdfContents.push(pageContents);
    ctx.addPreview(pagePath, pageName);

    return fsWriteFile(pagePath, pageContents);
  } catch (error) {
    const errorMessage = `Preview processing for pdf page ${pageNumber} file failed`;
    log().error({ error }, errorMessage);
    throw error;
  }
}

/**
 * Utility function
 *
 * @function processAllPages
 * @param  {PreviewContext} ctx  The preview context associated to this file
 * @param  {pagesDir} pagesDir   The direcotry holding the svg previews on disk
 * @param  {Number} pageNum     The page number we're dealing with
 * @param  {Object} doc          Object representing the PDF
 */
const processAllPages = async function (ctx, pagesDir, numberPages, doc) {
  const allPromises = [];
  const allPages = Array.from({ length: numberPages }).entries();

  for (const [eachPageIndex] of allPages) {
    allPromises.push(previewAndIndexEachPage(ctx, pagesDir, eachPageIndex + 1, doc));
  }

  await Promise.all(allPromises);
};

export { init, test, generatePreviews, previewPDF };
