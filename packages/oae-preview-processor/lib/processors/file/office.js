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

import { exec } from 'node:child_process';
import fs from 'node:fs';
import Path, { dirname } from 'node:path';
import { callbackify, format } from 'node:util';
import { fileURLToPath } from 'node:url';
import PreviewConstants from 'oae-preview-processor/lib/constants.js';
import * as PreviewUtil from 'oae-preview-processor/lib/util.js';

import { logger } from 'oae-logger';

import * as PDFProcessor from 'oae-preview-processor/lib/processors/file/pdf.js';
import * as TempFile from 'oae-util/lib/tempfile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const log = logger('oae-preview-processor');

let _sofficeBinary = null;
let _timeout = null;

/**
 * Inits the Office Processor.
 * This method will check if the Libre Office binary can be executed.
 *
 * @param  {Object}     config              The config object containing the path to the LibreOffice binary and the maximum duration for when the process should be killed
 * @param  {String}     config.binary       The path to the Libre Office executable. This should either be a direct path or the filename that's on the `PATH` environment
 * @param  {Number}     config.timeout      Specifies the time (in ms) when the process is considered to be hanging and should be killed. (Default: 120000ms)
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const init = function (config, callback) {
  if (!config || !config.binary || !config.timeout) {
    return callback({
      code: 400,
      msg: 'Missing configuration for the Office Preview Processor, required fields are `binary` and `timeout`.'
    });
  }

  // Usually we would execute `soffice.bin --headless --help` but this pops up a
  // confirmation dialog on Windows rather than showing the help on standard-out.
  // The only action that doesn't seem to trigger the dialog is to do a proper
  // document conversion.
  // We try to convert this file (office.js) to a pdf to verify Libre Office has been configured correctly.
  const currFile = Path.resolve(__dirname, 'office.js');
  const temporaryDir = TempFile.createTempFile();

  const cmd = format(
    '"%s" --headless --invisible --nologo --nolockcheck --convert-to pdf "%s" --outdir "%s"',
    config.binary,
    currFile,
    temporaryDir.path
  );
  log().info(
    'Executing %s to verify if the path to the office binary is correct. This might take a couple of seconds.',
    cmd
  );
  exec(cmd, { timeout: config.timeout }, (error, stdout, stderr) => {
    // LibreOffice doesn't always return an error exit code which results in `err` being null
    // so we need to do an additional check for the string 'Error' in the standard error output.
    if (error || (stderr && stderr.includes('Error'))) {
      let errorMessage = 'Could not properly convert a file to PDF.\n';
      errorMessage += 'Please run the command in your terminal of choice and ensure that:\n';
      errorMessage += '    1.  The path to the soffice binary is configured properly.\n';
      errorMessage +=
        '    2.  LibreOffice can write to `' +
        temporaryDir.path +
        '`. Try changing the `outdir` to your home directory to confirm the permissions are set correctly.\n\n';
      errorMessage += cmd;
      log().error({ err: error, stdout, stderr }, errorMessage);

      // We don't need to unlink the temp file as it hasn't been created if Libre Office errors out.
      return callback({
        code: 500,
        msg: 'The path for the office binary or temporary directory is misconfigured'
      });
    }

    _sofficeBinary = config.binary;
    _timeout = config.timeout;

    return callback();
  });
};

/**
 * @borrows Interface.test as Office.test
 */
const test = function (ctx, contentObject, callback) {
  const docTypeIsValid = PreviewConstants.TYPES.OFFICE.includes(ctx.revision.mime);
  callback(null, PreviewUtil.test(contentObject, docTypeIsValid));
};

/**
 * @borrows Interface.generatePreviews as Office.generatePreviews
 */
const generatePreviews = function (ctx, contentObject, callback) {
  log().trace({ contentId: ctx.contentId }, 'Processing as office file.');

  // Download the file.
  ctx.download((error, path) => {
    if (error) {
      return callback(error);
    }

    // Convert it to PDF.
    _convertToPdf(ctx, path, (error, path) => {
      if (error) {
        return callback(error);
      }

      // Let the PDF API handle the actual splitting.
      callbackify(PDFProcessor.previewPDF)(ctx, path, () => callback());
    });
  });
};

/**
 * Convert an Office document to PDF.
 *
 * @param  {PreviewContext}     ctx             The preview context associated to this file.
 * @param  {String}             path            The path to the file that needs to be converted to a PDF.
 * @param  {Function}           callback        Standard callback function
 * @param  {Object}             callback.err    An error that occurred, if any
 * @api private
 */
const _convertToPdf = function (ctx, path, callback) {
  const cmd = format(
    '"%s" --headless --invisible --nologo --nolockcheck --convert-to pdf "%s" --outdir "%s"',
    _sofficeBinary,
    path,
    ctx.baseDir
  );
  // Execute the command.
  log().trace({ contentId: ctx.contentId }, 'Executing %s', cmd);
  exec(cmd, { timeout: _timeout }, (error, stdout, stderr) => {
    if (error) {
      log().error({ err: error, contentId: ctx.contentId, stdout, stderr }, 'Could not convert the file to PDF.');
      return callback({ code: 500, msg: 'Could not convert the file to PDF.' });
    }

    const filename = Path.basename(path);
    const pdfFilename = filename.slice(0, filename.lastIndexOf('.')) + '.pdf';
    const pdfPath = ctx.baseDir + '/' + pdfFilename;

    // Sometimes office does not convert the file but returns no errorcode
    // or any other of indication that the process failed.
    // To ensure that the PDF was actually generated, we check if it exists.
    // ex: http://askubuntu.com/questions/226295/libreoffice-command-line-conversion-no-output-file
    fs.stat(pdfPath, (error_) => {
      if (error_) {
        log().error({ contentId: ctx.contentId }, 'Could not convert the file to PDF. Office failed silently');
        return callback({
          code: 500,
          msg: 'Unable to convert the office file to pdf. Office failed silently.'
        });
      }

      callback(null, pdfPath);
    });
  });
};

export { init, test, generatePreviews };
