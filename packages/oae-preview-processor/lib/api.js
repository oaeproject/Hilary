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

import _ from 'underscore';

import * as AuthzUtil from 'oae-authz/lib/util';
import * as ContentDAO from 'oae-content/lib/internal/dao';
import * as EmitterAPI from 'oae-emitter';
import * as RestUtil from 'oae-rest/lib/util';
import * as MQ from 'oae-util/lib/mq';
import pipe from 'ramda/src/pipe';

import { telemetry } from 'oae-telemetry';

// OAE Processors
import * as ImagesProcessor from 'oae-preview-processor/lib/processors/file/images';
import * as OfficeProcessor from 'oae-preview-processor/lib/processors/file/office';
import * as PDFProcessor from 'oae-preview-processor/lib/processors/file/pdf';
import * as DefaultLinkProcessor from 'oae-preview-processor/lib/processors/link/default';
import * as FlickrLinkProcessor from 'oae-preview-processor/lib/processors/link/flickr';
import * as SlideShareLinkProcessor from 'oae-preview-processor/lib/processors/link/slideshare';
import * as VimeoLinkProcessor from 'oae-preview-processor/lib/processors/link/vimeo';
import * as YoutubeLinkProcessor from 'oae-preview-processor/lib/processors/link/youtube';
import * as CollabDocProcessor from 'oae-preview-processor/lib/processors/collabdoc/collabdoc';
import * as FolderProcessor from 'oae-preview-processor/lib/processors/folder';

import { logger } from 'oae-logger';
import { Validator as validator } from 'oae-util/lib/validator';
const {
  otherwise,
  isNotEmpty,
  isNull,
  isObject,
  isArrayNotEmpty,
  isResourceId,
  isGlobalAdministratorUser,
  isNotNull,
  isLoggedInUser
} = validator;
import PreviewConstants from './constants';
import { FilterGenerator } from './filters';
import { PreviewContext } from './model';

const log = logger('oae-preview-processor');
const Telemetry = telemetry('preview-processor');

let config = null;

// A hash of registered processors.
const _processors = {};

/**
 * ## PreviewProcessorAPI
 *
 * ### Events
 *
 *  * `processed(contentObj, revision, status)` - Indicates a revision for a piece of content has finished processing
 */
const PreviewProcessorAPI = new EmitterAPI.EventEmitter();

/**
 * Start listening for preview tasks.
 *
 * @param  {Function}    [callback]      Standard callback method
 * @param  {Object}      [callback.err]  Standard error object (if any)
 */
const enable = function(callback) {
  callback =
    callback ||
    // eslint-disable-next-line no-unused-vars
    function(err) {
      /* Error is logged within the implementation */
    };

  // Bind an error listener to the REST methods
  RestUtil.emitter.on('error', _restErrorLister);
  MQ.subscribe(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, _handleGeneratePreviewsTask, err => {
    if (err) {
      log().error({ err }, 'Could not bind to the generate previews queue');
      return callback(err);
    }

    log().info('Bound the preview processor to the generate previews task queue');

    MQ.subscribe(PreviewConstants.MQ.TASK_GENERATE_FOLDER_PREVIEWS, _handleGenerateFolderPreviewsTask, err => {
      if (err) {
        log().error({ err }, 'Could not bind to the generate folder previews queue');
        return callback(err);
      }

      log().info('Bound the preview processor to the generate folder previews task queue');

      MQ.subscribe(PreviewConstants.MQ.TASK_REGENERATE_PREVIEWS, _handleRegeneratePreviewsTask, err => {
        if (err) {
          log().error({ err }, 'Could not bind to the regenerate previews queue');
          return callback(err);
        }

        log().info('Bound the preview processor to the regenerate previews task queue');
        return callback();
      });
    });
  });
};

/**
 * Remove the listener for preview tasks
 *
 * @param  {Function}    [callback]      Standard callback method
 * @param  {Object}      [callback.err]  Standard error object (if any)
 */
const disable = function(callback) {
  callback =
    callback ||
    // eslint-disable-next-line no-unused-vars
    function(err) {
      /* Error is logged within the implementation */
    };

  MQ.unsubscribe(PreviewConstants.MQ.TASK_GENERATE_PREVIEWS, err => {
    if (err) {
      log().error({ err }, 'Could not unbind from the previews queue');
      return callback(err);
    }

    log().info('Unbound the preview processor from the generate previews task queue');

    MQ.unsubscribe(PreviewConstants.MQ.TASK_GENERATE_FOLDER_PREVIEWS, err => {
      if (err) {
        log().error({ err }, 'Could not unbind from the folder previews queue');
        return callback(err);
      }

      log().info('Unbound the preview processor from the folder generate previews task queue');

      MQ.unsubscribe(PreviewConstants.MQ.TASK_REGENERATE_PREVIEWS, err => {
        if (err) {
          log().error({ err }, 'Could not unbind from the regenerate previews queue');
          return callback(err);
        }

        log().info('Unbound the preview processor from the regenerate previews task queue');

        // Remove our REST error listener
        RestUtil.emitter.removeListener('error', _restErrorLister);

        return callback();
      });
    });
  });
};

/**
 * Logs an error that originates from the REST Api.
 *
 * @param  {Object}     err     An error object.
 * @api private
 */
const _restErrorLister = function(err) {
  log().error({ err }, 'Got an unexpected error from the REST api');
};

/**
 * Refresh the preview processor configuration with the given options.
 *
 * @param  {Object}     config      The main configuration object as defined in `config.js`. The full config object should be passed in.
 * @param  {Function}   callback    Standard callback function
 */
const refreshPreviewConfiguration = function(_config, callback) {
  // Stop listening for tasks.
  disable(err => {
    if (err) {
      return callback(err);
    }

    // Store this configuration.
    config = _config;

    if (config.previews.enabled) {
      _initializeDefaultProcessors(err => {
        if (err) {
          return callback(err);
        }

        // Register the processors.
        _registerDefaultProcessors();

        // Start listening for messages by enabling it.
        enable(callback);
      });
    } else {
      // Nothing to do when the PP is disabled.
      callback();
    }
  });
};

/**
 * @return {Object}    The configuration object that is currently in use.
 */
const getConfiguration = function() {
  return config;
};

/**
 * Register a preview processor.
 * A preview processor is an object which exposes 2 methods:
 * 1/ `test`
 * Every time a new piece of content needs previews generated it will be passed to the `test` method of each known processor.
 * Each processor should pass back how suitable they are to generate previews for a particular piece of content.
 * The function will be called in the following way:
 *    `processor.test(previewCtx, contentObj, callback)`
 * The callback signature should be:
 *     `callback(error, score)`
 * where error is a standard OAE error object (or null) and score is an integer expressing how well suited this processor
 * is for handling this type of file. Any negative value means the processor should not be used.
 * Values between 0 and 10 are reserved for default OAE processors.
 * The processor who returns the highest score will be selected to perform the preview generation.
 *
 * 2/ `generatePreviews`
 * The method that will perform the actual preview generation.
 *
 *
 * @param  {String}     processorId                 A unique identifier for this processor. This identifier can be used to remove a processor.
 * @param  {Object}     processor                   The processor that can be used to handle a piece of content.
 * @param  {Function}   processor.test              The method that passes an integer back which expresses how suitable this processor is for a new piece of content.
 * @param  {Function}   processor.generatePreviews  The method that generates previews for a piece of content.
 */
const registerProcessor = function(processorId, processor) {
  pipe(isNotEmpty, otherwise(new Error('Missing processor ID')))(processorId);
  pipe(isNull, otherwise(new Error('This processor is already registerd')))(_processors[processorId]);
  pipe(isObject, otherwise(new Error('Missing processor')))(processor);
  pipe(isNotNull, otherwise(new Error('The processor has no test method')))(processor.test);
  pipe(isNotNull, otherwise(new Error('The processor has no generatePreviews method')))(processor.generatePreviews);

  _processors[processorId] = processor;
};

/**
 * Unregisters a preview processor.
 *
 * @param  {String}  processorId     The ID of the processor that should be unregistered.
 */
const unregisterProcessor = function(processorId) {
  if (!processorId) {
    throw new Error('The processor id must be specified');
  }

  delete _processors[processorId];
};

/**
 * Returns the processor that is best equiped to generate previews for a piece of content.
 *
 * @param  {Context}    ctx                 Standard context object containing the current user and the current tenant
 * @param  {Content}    contentObj          The content object for which we need to find a processor.
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @param  {Processor}  callback.processor  The processor who can generate previews for this piece of content. If no processor is equiped to deal with this piece of content, null will be returned.
 */
const getProcessor = function(ctx, contentObj, callback) {
  const scoredProcessors = [];
  const processors = _.values(_processors);

  _.each(processors, processor => {
    processor.test(ctx, contentObj, (err, score) => {
      if (err) {
        return callback(err);
      }

      // Add it to the list.
      scoredProcessors.push({ score, processor });

      // If we've tested all processors we can select the best one.
      if (scoredProcessors.length === processors.length) {
        // Sort them descending on the score.
        scoredProcessors.sort((a, b) => {
          if (a.score < b.score) {
            return 1;
          }

          if (a.score > b.score) {
            return -1;
          }

          return 0;
        });

        // If all processors return a negative number, then we need to return null.
        // This means that this type of content will have no preview images.
        if (scoredProcessors[0].score < 0) {
          return callback(null, null);
        }

        // In case there are 2 processors who return the same score we need to log a warning.
        // This isn't exactly optimal, but it's up to the developer implementing a 3rd party processor
        // to ensure it doesn't conflict with the OAE processors (or any other ones in the system.)
        if (scoredProcessors[0].score === scoredProcessors[1].score) {
          log().warn({ contentId: contentObj.contentId }, 'Has 2 processors with an equal score');
        }

        // Return the best one.
        callback(null, scoredProcessors[0].processor);
      }
    });
  });
};

/**
 * Submits a piece of content to the preview generation queue where it can then
 * be picked up by one of the preview processors.
 *
 * @param  {String}     contentId   The ID of the piece of the content that needs new preview items.
 * @param  {String}     revisionId  The ID of the revision for which we need to generate previews.
 */
const submitForProcessing = function(contentId, revisionId) {
  log().trace({ contentId, revisionId }, 'Submitting for preview processing');
  MQ.submit(
    PreviewConstants.MQ.TASK_GENERATE_PREVIEWS,
    JSON.stringify({
      contentId,
      revisionId
    })
  );
};

/**
 * Submits a folder to the preview generation queue where it can then
 * be picked up by one of the preview processors.
 *
 * @param  {String}     folderId    The ID of the folder that needs new preview items
 */
const submitFolderForProcessing = function(folderId) {
  log().trace({ folderId }, 'Submitting for folder preview processing');
  MQ.submit(PreviewConstants.MQ.TASK_GENERATE_FOLDER_PREVIEWS, JSON.stringify({ folderId }));
};

/**
 * Submits a task that triggers preview items matching specified filters to be regenerated.
 *
 * @param  {Context}    ctx                                 Standard context object containing the current user and the current tenant
 * @param  {Object}     filters                             An object that holds the filters that should be applied on the content items. See `FilterGenerator` for more information
 * @param  {Function}   [callback]                          Invoked when the task has been fired
 * @param  {Object}     [callback.err]                      An error that occurred, if any
 */
const reprocessPreviews = function(ctx, filters, callback) {
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error({ err }, 'Failed to invoke reprocess previews task');
      }
    };

  try {
    pipe(
      isGlobalAdministratorUser,
      otherwise({
        code: 401,
        msg: 'Must be global administrator to reprocess previews'
      })
    )(ctx);

    pipe(
      isObject,
      otherwise({
        code: 400,
        msg: 'At least one filter must be specified'
      })
    )(filters);
  } catch (error) {
    return callback(error);
  }

  if (_.isObject(filters)) {
    try {
      pipe(
        isArrayNotEmpty,
        otherwise({
          code: 400,
          msg: 'At least one filter must be specified'
        })
      )(_.keys(filters));
    } catch (error) {
      return callback(error);
    }
  }

  const filterGenerator = new FilterGenerator(filters);
  if (filterGenerator.hasErrors()) {
    return callback(filterGenerator.getFirstError());
  }

  MQ.submit(PreviewConstants.MQ.TASK_REGENERATE_PREVIEWS, JSON.stringify({ filters }), callback);
};

/**
 * Reprocess a single preview for a content revision.
 *
 * @param  {Context}    ctx         Standard context object containing the current user and the current tenant
 * @param  {String}     contentId   The id of the content item for which to reprocess the preview
 * @param  {String}     revisionId  The id of the revision to reprocess
 */
const reprocessPreview = function(ctx, contentId, revisionId, callback) {
  try {
    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'A content id must be provided'
      })
    )(contentId);

    pipe(
      isResourceId,
      otherwise({
        code: 400,
        msg: 'A revision id must be provided'
      })
    )(revisionId);

    pipe(
      isLoggedInUser,
      otherwise({
        code: 401,
        msg: 'Must be logged in to reprocess previews'
      })
    )(ctx);
  } catch (error) {
    return callback(error);
  }

  const contentTenantAlias = AuthzUtil.getResourceFromId(contentId).tenantAlias;
  if (!ctx.user().isAdmin(contentTenantAlias)) {
    return callback({
      code: 401,
      msg: "You must be admin of the content item's tenant to reprocess its previews"
    });
  }

  submitForProcessing(contentId, revisionId);
  return callback();
};

/**
 * When bound to an MQ generate preview task, this method will generate the appropriate
 * preview images for folders
 *
 * @param  {Object}     data                The task data
 * @param  {String}     data.folderId       The ID of the folder that needs new preview items
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @api private
 */
const _handleGenerateFolderPreviewsTask = function(data, callback) {
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error({ err, data }, 'Error handling folder preview generation');
      }
    };

  if (!data.folderId) {
    log().error(
      { data },
      'An invalid generate folder previews task was submitted to the generate folder previews task queue'
    );
    return callback({
      code: 400,
      msg: 'An invalid generate folder previews task was submitted to the generate folder previews task queue'
    });
  }

  log().info({ folderId: data.folderId }, 'Starting preview folder generation process');
  FolderProcessor.generatePreviews(data.folderId, err => {
    if (err) {
      log().error({ err, folderId: data.folderId }, 'Error when trying to process a folder');
      Telemetry.incr('error.count');
      return callback(err);
    }

    // We're done.
    log().info({ folderId: data.folderId }, 'Folder preview processing done');
    Telemetry.incr('ok.count');
    return callback();
  });
};

/**
 * When bound to am MQ generate preview task, this method will generate the appropriate
 * preview images
 *
 * @param  {Object}     data                The task data
 * @param  {String}     data.contentId      The ID for the piece of content that needs new preview items.
 * @param  {String}     data.revisionId     The ID of the revision of the piece of content that needs new preview items.
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 * @api private
 */
const _handleGeneratePreviewsTask = function(data, callback) {
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error({ err, data }, 'Error handling preview generation');
      }
    };

  if (!data.contentId) {
    log().error({ data }, 'An invalid generate previews task was submitted to the generate previews task queue');
    return callback({
      code: 400,
      msg: 'An invalid generate previews task was submitted to the generate previews task queue'
    });
  }

  const start = Date.now();
  log().info({ contentId: data.contentId, data }, 'Starting preview generation process');
  const ctx = new PreviewContext(config, data.contentId, data.revisionId);

  // Generate a context for this preview process and login to the tenant of this content item and start processing
  ctx.login(err => {
    if (err) {
      // If we can't login, we cannot call cleanCallback as we won't have a session cookie
      // to set a status
      ctx.cleanup();
      Telemetry.appendDuration('process.time', start);
      Telemetry.incr('error.count');
      return callback(err);
    }

    // Get the content and revision profile
    ctx.getContentData(err => {
      if (err) {
        return ctx.setStatus('error', callback);
      }

      // Generate the actual preview images
      _generatePreviews(ctx, err => {
        ctx.cleanup();
        Telemetry.appendDuration('process.time', start);
        PreviewProcessorAPI.emit(PreviewConstants.EVENTS.PREVIEWS_FINISHED, ctx.content, ctx.revision, ctx.getStatus());
        if (err) {
          log().error({ err, contentId: data.contentId }, 'Error when trying to process this file');
          Telemetry.incr('error.count');
          return callback(err);
        }

        // We're done.
        log().info({ contentId: data.contentId }, 'Preview processing done');
        Telemetry.incr('ok.count');
        return callback();
      });
    });
  });
};

/**
 * Generates previews for a piece of content.
 *
 * @param  {PreviewContext}      ctx             The preview context associated to this file. This context should have an authenticated global administrator against it.
 * @param  {Function}            callback        Standard callback function
 * @param  {Object}              callback.err    An error that occurred, if any
 * @api private
 */
const _generatePreviews = function(ctx, callback) {
  // Get the best processor and start processing.
  getProcessor(ctx, ctx.content, (err, processor) => {
    if (err) {
      return callback(err);
    }

    if (processor) {
      processor.generatePreviews(ctx, ctx.content, (err, ignored) => {
        if (err) {
          ctx.setStatus('error', callback);
        } else if (ignored) {
          ctx.setStatus('ignored', callback);
        } else {
          ctx.savePreviews(callback);
        }
      });
    } else {
      log().info(
        { contentId: ctx.contentId, content: ctx.content, revision: ctx.revision },
        'Ignoring as this type of content is not supported for now'
      );
      ctx.setStatus('ignored', callback);
    }
  });
};

/**
 * Reprocesses the previews of all content items who match the `data.filters`.
 *
 * @param  {Object}     data            The task data
 * @param  {Object}     data.filters    An object containing the filters that should be processed
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _handleRegeneratePreviewsTask = function(data, callback) {
  callback =
    callback ||
    function(err) {
      if (err) {
        log().error({ err }, 'Error reprocessing all previews');
      }
    };

  if (!data.filters) {
    log().error({ data }, 'An invalid regenerate previews task was submitted to the regenerate previews task queue');
    return callback({
      code: 400,
      msg: 'An invalid regenerate previews task was submitted to the regenerate previews task queue'
    });
  }

  const filterGenerator = new FilterGenerator(data.filters);

  // This can strictly not happen as we shouldn't be submitting invalid filters on the queue
  // but we should check it in case something happened in-transport
  if (filterGenerator.hasErrors()) {
    log().error(
      { data, errors: filterGenerator.getErrors() },
      'An invalid regenerate previews task was submitted to the regenerate previews task queue'
    );
    return callback({
      code: 400,
      msg: 'An invalid regenerate previews task was submitted to the regenerate previews task queue'
    });
  }

  log().info({ filters: data.filters }, 'Starting reprocessing task');

  // Track status of processing
  const start = Date.now();
  let totalScanned = 0;
  let totalReprocessed = 0;

  /*!
   * Handles each batch from the ContentDAO.Content.iterateAll method.
   *
   * @see ContentDAO.Content#iterateAll
   * @api private
   */
  const _onEach = function(contentRows, done) {
    log().info('Scanning %d content items to see if previews need to be reprocessed', contentRows.length);
    totalScanned += contentRows.length;

    // Get those rows we can use to filter upon
    const contentToFilter = _.filter(contentRows, contentRow => {
      if (contentRow.previews) {
        try {
          contentRow.previews = JSON.parse(contentRow.previews);
          return true;
        } catch {
          // If the preview is invalid JSON, something bad happened. Lets try and reprocess it so the processor can better set the preview data
          log().warn({ contentRow }, 'Found invalid JSON for content item. Forcing regeneration of previews');
        }
      } else {
        // If there is no previews object, something is wrong. Try and reprocess it and reset it
        log().warn(
          { contentId: contentRow.contentId },
          'Found no previews object for content item. Forcing regeneration of previews'
        );
      }

      // If we reach this point, it means the previews object was in an incorrect state
      // so we can't use it for filtering. We should reprocess this piece of content immediately
      totalReprocessed++;
      submitForProcessing(contentRow.contentId, contentRow.latestRevisionId);
      return false;
    });

    // 1st phase: filter based on content types
    let filteredContent = filterGenerator.filterContent(contentToFilter);

    // If we don't need to filter by revisions we can simply reprocess the latest revisions
    // of the content items that are left
    if (!filterGenerator.needsRevisions() || _.isEmpty(filteredContent)) {
      _.each(filteredContent, content => {
        totalReprocessed++;
        submitForProcessing(content.contentId, content.latestRevisionId);
      });
      return done();
    }

    // We need to filter by revisions
    const contentIds = _.map(filteredContent, contentObj => {
      return contentObj.contentId;
    });
    ContentDAO.Revisions.getAllRevisionsForContent(contentIds, (err, revisionsByContent) => {
      if (err) {
        log().error({ err }, 'Error trying to retrieve revisions for content');
      }

      // Stick the revisions on their content item
      const filteredContentById = _.indexBy(filteredContent, 'contentId');
      _.each(revisionsByContent, (revisions, contentId) => {
        filteredContentById[contentId].revisions = revisions;
      });
      filteredContent = _.values(filteredContentById);

      // Run the second filtering phase
      filteredContent = filterGenerator.filterRevisions(filteredContent);

      // Submit all those are left
      _.each(filteredContent, content => {
        _.each(content.revisions, revision => {
          totalReprocessed++;
          submitForProcessing(content.contentId, revision.revisionId);
        });
      });

      return done();
    });
  };

  ContentDAO.Content.iterateAll(filterGenerator.getContentColumnNames(), 1000, _onEach, err => {
    if (err) {
      log().error({ err }, 'Error scanning content items for preview reprocessing');
      return callback(err);
    }

    log().info(
      {
        timeElapsed: Date.now() - start,
        totalScanned,
        totalReprocessed
      },
      'Finished scanning content items for reprocessing'
    );
    return callback();
  });
};

/**
 * Initializes those default processors who need initialization.
 *
 * @param  {Function} callback      Standard callback function
 * @param  {Object}   callback.err  An error that occurred, if any
 * @api private
 */
const _initializeDefaultProcessors = function(callback) {
  // Initialize those processors that need it.
  OfficeProcessor.init(config.previews.office, err => {
    if (err) {
      return callback(err);
    }

    PDFProcessor.init(config.previews, err => {
      if (err) {
        return callback(err);
      }

      DefaultLinkProcessor.init(config.previews, err => {
        if (err) {
          return callback(err);
        }

        CollabDocProcessor.init(config.previews, err => {
          if (err) {
            return callback(err);
          }

          return callback();
        });
      });
    });
  });
};

/**
 * Registers the default OAE processors.
 *
 * @api private
 */
const _registerDefaultProcessors = function() {
  registerProcessor('oae-file-images', ImagesProcessor);
  registerProcessor('oae-file-office', OfficeProcessor);
  registerProcessor('oae-file-pdf', PDFProcessor);

  registerProcessor('oae-link-default', DefaultLinkProcessor);
  registerProcessor('oae-link-flickr', FlickrLinkProcessor);
  registerProcessor('oae-link-slideshare', SlideShareLinkProcessor);
  registerProcessor('oae-link-vimeo', VimeoLinkProcessor);
  registerProcessor('oae-link-youtube', YoutubeLinkProcessor);

  registerProcessor('oae-collabdoc', CollabDocProcessor);
};

export {
  PreviewProcessorAPI as emitter,
  enable,
  disable,
  refreshPreviewConfiguration,
  getConfiguration,
  registerProcessor,
  unregisterProcessor,
  getProcessor,
  submitForProcessing,
  submitFolderForProcessing,
  reprocessPreviews,
  reprocessPreview
};
