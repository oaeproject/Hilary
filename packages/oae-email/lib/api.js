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

import crypto from 'crypto';
import fs from 'fs';
import util from 'util';
import path from 'path';
import juice from 'juice';
import _ from 'underscore';
import nodemailer from 'nodemailer';
import { logger } from 'oae-logger';
import { setUpConfig } from 'oae-config';
import { telemetry } from 'oae-telemetry';

import Counter from 'oae-util/lib/counter';
import * as EmitterAPI from 'oae-emitter';
import * as IO from 'oae-util/lib/io';
import * as Locking from 'oae-util/lib/locking';
import * as OaeModules from 'oae-util/lib/modules';
import * as Redis from 'oae-util/lib/redis';

import * as UIAPI from 'oae-ui';
import { htmlToText } from 'nodemailer-html-to-text';
import * as TenantsAPI from 'oae-tenants';
import { Validator as validator } from 'oae-util/lib/validator';
const { makeSureThatOnlyIf, getNestedObject, isDefined, otherwise, isNotEmpty, isObject, isEmail } = validator;
import pipe from 'ramda/src/pipe';

const EmailConfig = setUpConfig('oae-email');
const log = logger('oae-email');
const Telemetry = telemetry('oae-email');
const TenantsConfig = setUpConfig('oae-tenants');

// const EmailRateLimiter = null;
let rateLimit = null;

// A cache of email templates
let templates = {};

/*!
 * Whether or not the server is in debug mode. If true, no emails will ever be sent, instead the email
 * data will be logged. This is equivalent to "disabling" emails.
 */
let debug = true;
const debugEmailSendCounter = new Counter();

// The cached connection pool with the configured mail values. This can be smtp, sendmail, ..
let emailTransport = null;

// The interval in which the same email can't be sent out multiple times
let deduplicationInterval = null;

// The configuration for e-mail throttling
const throttleConfig = {
  timespan: null,
  count: null
};

/**
 * ## EmailAPI
 *
 * ### Events
 *
 * * `debugSent(message)` - If `debug` is enabled, this event is fired and indicates an email was sent from the
 * system. The `message` object, which used to be a https://www.npmjs.org/package/mailparser object but now it's a
 * JSON representation of the sent email, since the upgrade to nodemailer 6.x
 *
 * ### Templates
 *
 * All emails that are sent are based on an internationalizable template. To load a new template for the system, you must
 * create a directory in your OAE module called `emailTemplates`. The directory structure looks like this (using oae-content
 * as an example):
 *
 *  * oae-content/                              (module directory)
 *      ** emailTemplates/                      (directory that is scanned by oae-email)
 *          *** default/                        (the default templates, chosen if there is no locale)
 *              **** templateId.meta.json.jst   (the "meta" template for template with id "templateId")
 *              **** templateId.html.jst        (the "html" template for template with id "templateId")
 *              **** templateId.txt.jst         (the "text" template for template with id "templateId")
 *          *** en_CA/                          (the en_CA locale templates, used if the receiving user has locale en_CA)
 *              **** templateId.meta.json.jst
 *              **** templateId.html.jst
 *              **** templateId.txt.jst
 *
 * **The 'default' locale:** The default locale is chosen if the user's locale does not have a template provided for it.
 * **The 'meta.json' template:** This template should produce a JSON object that specifies email metadata. This template **must** exist, and should at least provide the "subject" of the email.
 * **The 'html' template:** This template provides an HTML-formatted version of the email content. One of HTML and TXT templates must be provided.
 * **The 'txt' template:** This template provides a plain-text version of the email content. If this is not provided, the HTML version will be converted to plain-text in replacement. One of HTML and TXT must be provided.
 *
 * ### JST Files
 *
 * All templates: meta.json.jst, html.jst and txt.jst are JavaScriptTemplates, and are compiled and rendered using UnderscoreJS:
 * http://underscorejs.org/#template
 */
const EmailAPI = new EmitterAPI.EventEmitter();

/**
 * Initialize the email module.
 *
 * @param  {Object}     emailSystemConfig   The `email` config object from the system `config.js`. Refer to that file for the configuration options
 * @param  {Function}   callback            Standard callback function
 * @param  {Object}     callback.err        An error that occurred, if any
 */
const init = function(emailSystemConfig, callback) {
  emailSystemConfig = emailSystemConfig || {};

  // Email configuration
  debug = emailSystemConfig.debug !== false;
  deduplicationInterval = emailSystemConfig.deduplicationInterval || 7 * 24 * 60 * 60;
  emailSystemConfig.throttling = emailSystemConfig.throttling || {};
  throttleConfig.count = emailSystemConfig.throttling.count || 10;
  throttleConfig.timespan = emailSystemConfig.throttling.timespan || 2 * 60;

  /*!
   * For robust unit tests, any provided timespan needs to cover at least 2 buckets so that when
   * we do a count on the rate, we don't risk rolling over to a new interval and miss the emails
   * we just sent, resetting the frequency to 0 and intermittently failing the test. Therefore
   * we set the bucket interval to be (timespan / 2).
   *
   * Additionally, when a bucket is incremented in redback, the following 2 buckets are cleared.
   * Therefore in order to ensure we don't roll over to a new bucket while incrementing and risking
   * our previous bucket getting cleared, we must ensure we have at least 5 buckets so that the
   * clearing of the "next 2" buckets does not impact the counting of the "previous 2". (e.g., if
   * the current time bucket is 2, redback will clear buckets 3 and 4 while we count back from 0,
   * 1 and 2).
   */
  const numDaysUntilExpire = 30;
  const bucketInterval = Math.ceil(throttleConfig.timespan / 2) * 1000;

  rateLimit = require('ioredis-ratelimit')({
    client: Redis.getClient(),
    key(emailTo) {
      return `oae-email:throttle:${String(emailTo)}`;
    },
    limit: throttleConfig.count,
    duration: bucketInterval,
    difference: 0, // allow no interval between requests
    ttl: 1000 * 24 * 60 * 60 * numDaysUntilExpire // Not sure about this
  });

  /*
  EmailRateLimiter = EmailRedback.createRateLimit('email', {
    // The rate limiter seems to need at least 5 buckets to work, so lets give it exactly 5 (there are exactly bucket_span / bucket_interval buckets)
    // eslint-disable-next-line camelcase
    bucket_span: bucketInterval * 5,
    // eslint-disable-next-line camelcase
    bucket_interval: bucketInterval,
    // eslint-disable-next-line camelcase
    subject_expiry: throttleConfig.timespan
  });
  */

  // If there was an existing email transport, we close it.
  if (emailTransport) {
    emailTransport.close();
    emailTransport = null;
  }

  // Open an email transport
  if (debug) {
    emailTransport = nodemailer.createTransport({
      jsonTransport: true
    });
  } else if (emailSystemConfig.transport === 'SMTP') {
    log().info({ data: emailSystemConfig.smtpTransport }, 'Configuring SMTP email transport.');
    emailTransport = nodemailer.createTransport(emailSystemConfig.smtpTransport);
  } else if (emailSystemConfig.transport === 'sendmail') {
    log().info({ data: emailSystemConfig.sendmailTransport }, 'Configuring Sendmail email transport.');
    emailTransport = nodemailer.createTransport(emailSystemConfig.sendmailTransport);
  } else {
    log().error(
      {
        err: new Error('Attempted to initialize Email API with invalid mail transport'),
        transport: emailTransport
      },
      'Attempted to initialize Email API with invalid mail transport'
    );
    return callback({ code: 400, msg: 'Misconfigured mail transport' });
  }

  // Add a plugin to include a text version on html only emails
  emailTransport.use('compile', htmlToText());
  return refreshTemplates(callback);
};

/**
 * Refresh the email templates used for sending emails.
 *
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 */
const refreshTemplates = function(callback) {
  // Get all the registered OAE modules so we can scan each one for a mail template
  const modules = OaeModules.getAvailableModules();
  _getTemplatesForModules(path.join(__dirname, '/../..'), modules, (err, _templates) => {
    if (err) return callback(err);

    templates = _templates;
    return callback();
  });
};

const _abortIfRecipientErrors = (emailData, done) => {
  const { templateModule, templateId, recipient } = emailData;
  const ifThereIsRecipient = () => Boolean(recipient);

  try {
    pipe(
      isNotEmpty,
      otherwise({
        code: 400,
        msg: 'Must specify a template module'
      })
    )(templateModule);

    pipe(
      isNotEmpty,
      otherwise({
        code: 400,
        msg: 'Must specify a template id'
      })
    )(templateId);

    const getAttribute = getNestedObject(recipient);
    pipe(
      isObject,
      otherwise({
        code: 400,
        msg: 'Must specify a user when sending an email'
      })
    )(recipient);

    pipe(
      String,
      makeSureThatOnlyIf(ifThereIsRecipient, isEmail),
      otherwise({
        code: 400,
        msg: 'User must have a valid email address to receive email'
      })
    )(getAttribute(['email']));
  } catch (error) {
    return done(error);
  }

  done();
};

const _abortIfMetaTemplateErrors = (templateData, done) => {
  const { metaTemplate, recipient, templateModule, templateId } = templateData;

  if (!metaTemplate) {
    const noMetaTemplateErr = { code: 500, msg: 'No email metadata template existed for user' };
    log().error(
      {
        err: new Error(noMetaTemplateErr.msg),
        templateModule,
        templateId,
        recipient: {
          id: recipient.id,
          locale: recipient.locale
        }
      },
      noMetaTemplateErr.msg
    );
    return done(noMetaTemplateErr);
  }

  done();
};

const _abortIfTemplateErrors = (templateData, done) => {
  const { htmlTemplate, txtTemplate, recipient, templateModule, templateId } = templateData;
  if (!htmlTemplate && !txtTemplate) {
    const noContentTemplateErr = {
      code: 500,
      msg: 'No email content (text or html) template existed for user'
    };
    log().error(
      {
        err: new Error(noContentTemplateErr.msg),
        templateModule,
        templateId,
        recipient: {
          id: recipient.id,
          locale: recipient.locale
        }
      },
      noContentTemplateErr.msg
    );
    return done(noContentTemplateErr);
  }

  done();
};

const _parseJSON = (templateData, done) => {
  const { metaRendered, recipient, templateModule, templateId } = templateData;
  let metaContent = null;

  try {
    metaContent = JSON.parse(metaRendered);
  } catch (error) {
    log().error(
      {
        err: error,
        templateModule,
        templateId,
        rendered: metaRendered,
        recipient: {
          id: recipient.id,
          locale: recipient.locale
        }
      },
      'Error parsing email metadata template for recipient'
    );
    return done({ code: 500, msg: 'Error parsing email metadata template for recipient' });
  }

  done(null, metaContent);
};

const _renderHTMLTemplate = (htmlTemplate, templateData) => {
  const { recipient, templateCtx, templateModule, templateId } = templateData;

  if (htmlTemplate) {
    try {
      return UIAPI.renderTemplate(htmlTemplate, templateCtx, recipient.locale);
    } catch (error) {
      log().warn(
        {
          err: error,
          templateModule,
          templateId,
          recipient: {
            id: recipient.id,
            email: recipient.email,
            locale: recipient.locale
          }
        },
        'Failed to parse email html template for recipient'
      );
    }
  }
};

const _renderTXTTemplate = (txtTemplate, templateData) => {
  const { recipient, templateModule, templateCtx, templateId } = templateData;

  if (txtTemplate) {
    try {
      return UIAPI.renderTemplate(txtTemplate, templateCtx, recipient.locale);
    } catch (error) {
      log().warn(
        {
          err: error,
          templateModule,
          templateId,
          recipient: {
            id: recipient.id,
            locale: recipient.locale
          }
        },
        'Failed to parse email html template for user'
      );
    }
  }
};

/**
 * Send a templated email to a user.
 *
 * # Hash identity
 *
 * A hash identity can be provided that is used for the message id. This ID will be used to determine
 * if the email has already been sent. This is to avoid situations where an application bug can result
 * in emails being sent out repeatedly.
 *
 * If no hash is provided in the `opts.hash` parameter, then one will be generated based on the contents
 * of the message. If the message body is not identical each time the same message is generated, it is
 * recommended to provide a hash string that more accurately describes the identity of the message.
 *
 * For more information on how to configure suppression of duplicate messages and email throttling, see
 * the appropriate configuration properties in `config.email` of `config.js`.
 *
 * @param  {String}     templateModule      The module that provides the template (e.g., 'oae-email')
 * @param  {String}     templateId          The id of the template
 * @param  {Resource}   recipient           The user that will be receiving the email. This is accessible in the email templates (e.g., `<%= user.displayName %>`)
 * @param  {String}     recipient.email     The email address of the user. If this is not available an error with code 400 is returned and no email is sent
 * @param  {Tenant}     recipient.tenant    The tenant to which the user belongs
 * @param  {Object}     [data]              An object that represents the data of the email. This will be accessible in the email templates (e.g., `<%= data.activity['displayName'] %>`)
 * @param  {Object}     [opts]              Additional options
 * @param  {String}     [opts.hash]         See method summary for more information
 * @param  {Function}   [callback]          Invoked when the email has been sent
 * @param  {Object}     [callback.err]      An error that occurred, if any
 */
const sendEmail = function(templateModule, templateId, recipient, data, opts, callback) {
  data = data || {};
  opts = opts || {};
  callback =
    callback ||
    function(err) {
      if (err && err.code === 400) {
        log().error({ err }, 'Failed to deliver due to validation error');
      }
    };

  try {
    pipe(isNotEmpty, otherwise({ code: 400, msg: 'Must specify a template module' }))(templateModule);
    pipe(isNotEmpty, otherwise({ code: 400, msg: 'Must specify a template id' }))(templateId);
    pipe(isObject, otherwise({ code: 400, msg: 'Must specify a user when sending an email' }))(recipient);

    // Only validate the user email if it was a valid object
    const recipientIsDefined = Boolean(recipient);
    pipe(
      makeSureThatOnlyIf(recipientIsDefined, isDefined),
      otherwise({
        code: 400,
        msg: 'User must have a valid email address to receive email'
      })
    )(recipient.email);
    pipe(
      makeSureThatOnlyIf(recipientIsDefined, isEmail),
      otherwise({
        code: 400,
        msg: 'User must have a valid email address to receive email'
      })
    )(recipient.email);
  } catch (error) {
    return callback(error);
  }

  _abortIfRecipientErrors({ templateModule, templateId, recipient }, err => {
    if (err) return callback(err);

    log().trace(
      {
        templateModule,
        templateId,
        recipient,
        data,
        opts
      },
      'Preparing template for mail to be sent.'
    );

    const metaTemplate = _getTemplate(templateModule, templateId, 'meta.json');
    const htmlTemplate = _getTemplate(templateModule, templateId, 'html');
    const txtTemplate = _getTemplate(templateModule, templateId, 'txt');
    const sharedLogic = _getTemplate(templateModule, templateId, 'shared');

    // Verify the user templates have enough data to send an email
    _abortIfMetaTemplateErrors({ metaTemplate, templateModule, templateId, recipient }, err => {
      if (err) return callback(err);

      _abortIfTemplateErrors({ htmlTemplate, txtTemplate, templateModule, templateId, recipient }, err => {
        if (err) return callback(err);

        const renderedTemplates = {};
        const templateCtx = _.extend({}, data, {
          recipient,
          shared: sharedLogic,
          instance: {
            name: TenantsConfig.getValue(recipient.tenant.alias, 'instance', 'instanceName'),
            URL: TenantsConfig.getValue(recipient.tenant.alias, 'instance', 'instanceURL')
          },
          hostingOrganization: {
            name: TenantsConfig.getValue(recipient.tenant.alias, 'instance', 'hostingOrganization'),
            URL: TenantsConfig.getValue(recipient.tenant.alias, 'instance', 'hostingOrganizationURL')
          }
        });

        // Try and parse the meta template into JSON
        const metaRendered = UIAPI.renderTemplate(metaTemplate, templateCtx, recipient.locale);

        _parseJSON({ metaRendered, templateModule, templateId, recipient }, (err, metaContent) => {
          if (err) return callback(err);

          const args = {
            recipient,
            templateCtx,
            templateModule,
            templateId
          };
          // Try and render the html template
          const htmlContent = _renderHTMLTemplate(htmlTemplate, args);

          // Try and render the text template
          const txtContent = _renderTXTTemplate(txtTemplate, args);

          // If one of HTML or TXT templates managed to render, we will send the email with the content we have
          if (htmlContent || txtContent) {
            renderedTemplates['meta.json'] = metaContent;
            renderedTemplates.html = htmlContent;
            renderedTemplates.txt = txtContent;
          } else {
            return callback({ code: 500, msg: 'Could not parse a suitable content template for user' });
          }

          // If the `from` headers aren't set, we generate an intelligent `from` header based on the tenant host
          const tenant = TenantsAPI.getTenant(recipient.tenant.alias);
          let fromName = EmailConfig.getValue(tenant.alias, 'general', 'fromName') || tenant.displayName;
          // eslint-disable-next-line no-template-curly-in-string
          fromName = fromName.replace('${tenant}', tenant.displayName);
          const fromAddr =
            EmailConfig.getValue(tenant.alias, 'general', 'fromAddress') || util.format('noreply@%s', tenant.host);
          const from = util.format('"%s" <%s>', fromName, fromAddr);

          // Build the email object that will be sent through nodemailer. The 'from' property can be overridden by
          // the meta.json, then we further override that with some hard values
          const emailInfo = _.extend({ from }, renderedTemplates['meta.json'], {
            to: recipient.email
          });

          if (renderedTemplates.txt) {
            emailInfo.text = renderedTemplates.txt;
          }

          if (renderedTemplates.html) {
            emailInfo.html = renderedTemplates.html;

            // We need to escape the &apos; entity because some e-mail clients
            // don't (yet) support html5 rendering, such as Outlook
            // Tip from http://stackoverflow.com/questions/419718/html-apostrophe
            emailInfo.html = emailInfo.html.replace(/&apos;/g, '&#39;');
          }

          // Ensure the hash is set and is a valid hex string
          opts.hash = _generateMessageHash(emailInfo, opts);

          // Set the Message-Id header based on the message hash. We apply the
          // tenant host as the FQDN as it improves the spam score by providing
          // a source location of the message. We also add the userid of the user
          // we sent the message to, so we can determine what user a message was
          // sent to in Sendgrid
          emailInfo.messageId = util.format('%s.%s@%s', opts.hash, recipient.id.replace(/:/g, '-'), tenant.host);

          // Increment our debug sent count. We have to do it here because we
          // optionally enter an asynchronous block below
          _incr();

          /*!
           * Wrapper callback that conveniently decrements the email sent count when
           * processing has completed
           */
          const _decrCallback = function(err, info) {
            _decr();
            if (err) return callback(err);
            return callback(null, info);
          };

          // If we're not sending out HTML, we can send out the email now
          if (!emailInfo.html) {
            return _sendEmail(emailInfo, opts, _decrCallback);
          }

          // If we're sending HTML, we should inline all the CSS
          _inlineCSS(emailInfo.html, (err, inlinedHtml) => {
            if (err) {
              log().error({ err, emailInfo }, 'Unable to inline CSS');
              return _decrCallback(err);
            }

            // Process the HTML such that we add line breaks before each html attribute to try and keep
            // line length below 998 characters
            emailInfo.html = _.chain(inlinedHtml.split('\n'))
              .map(line => {
                return line.replace(/<[^/][^>]+>/g, match => {
                  return match.replace(/\s+[a-zA-Z0-9_-]+="[^"]+"/g, match => {
                    return util.format('\n%s', match);
                  });
                });
              })
              .value()
              .join('\n');

            return _sendEmail(emailInfo, opts, _decrCallback);
          });
        });
      });
    });
  });
};

/**
 * Invoke a callback when all the emails that have been sent have actually been
 * sent after all asynchronous processing. If the `debug` mode is on, this
 * effectively calls back right away.
 *
 * @param  {Function}   callback    Invoked when all messages have been sent
 */
const whenAllEmailsSent = function(callback) {
  debugEmailSendCounter.whenZero(callback);
};

/**
 * Sends an email if it hasn't been sent before
 *
 * @param  {Object}     emailInfo       A NodeMailer email info object containing the header and body information for an email
 * @param  {Object}     opts            Additional options
 * @param  {String}     [opts.hash]     If specified, it will be used to identify this email
 * @param  {String}     [opts.locale]   The locale in which this email is being sent
 * @param  {Function}   callback        Standard callback function
 * @param  {Object}     callback.err    An error that occurred, if any
 * @api private
 */
const _sendEmail = function(emailInfo, opts, callback) {
  if (emailInfo.subject) {
    emailInfo.subject = UIAPI.translate(emailInfo.subject, opts.locale);
  }

  // We lock the mail for a sufficiently long time
  const lockKey = util.format('oae-email-locking:%s', emailInfo.messageId);
  Locking.acquire(lockKey, deduplicationInterval, (err /* lock */) => {
    if (err) {
      Telemetry.incr('lock.fail');
      log().error(
        { emailInfo },
        'A lock was already in place for this message id. A duplicate email is being delivered'
      );
      return callback({ code: 403, msg: 'This email has already been sent out' });
    }

    // Ensure we're not sending out too many emails to a single user within the last timespan
    // debug
    return rateLimit(emailInfo.to)
      .then(() => {
        // We will proceed to send an email, so add it to the rate-limit counts
        // We got a lock and aren't throttled, send our mail
        return emailTransport.sendMail(emailInfo).catch(error => {
          log().error({ err: error, to: emailInfo.to, subject: emailInfo.subject }, 'Error sending email to recipient');
          return callback(err);
        });
      })
      .then(info => {
        if (debug) {
          log().info(
            {
              to: emailInfo.to,
              subject: emailInfo.subject,
              html: emailInfo.html,
              text: emailInfo.text
            },
            'Sending email'
          );
          // Preview only available when sending through an Ethereal account
          const previewURL = nodemailer.getTestMessageUrl(info);
          if (previewURL) log().info(`Preview URL: ${previewURL}`);
        }

        EmailAPI.emit('debugSent', info);
        return callback(null, info);
      })
      .catch(error => {
        Telemetry.incr('throttled');
        log().warn({ to: emailInfo.to, err: error }, 'Throttling in effect');
        return callback({ code: 403, msg: 'Throttling in effect' });
      });
  });
};

/**
 * If there is an html body present in the `emailInfo`, inline the CSS properties into the style attribute of each element.
 *
 * @param  {Object}     html                    The HTML that contains the CSS that should be inlined
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.inlinedHtml    The resulting inlined HTML
 * @api private
 */
const _inlineCSS = function(html, callback) {
  juice.juiceResources(html, { webResources: { images: false } }, callback);
};

/**
 * Get the templates for a list of modules.
 *
 * @param  {String}     basedir                 The base directory where the module folders are located
 * @param  {String[]}   modules                 The list of modules for which to retrieve templates
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Object}     callback.templates      An object keyed by module whose value are the templates
 * @api private
 */
const _getTemplatesForModules = function(basedir, modules, callback, _templates) {
  _templates = _templates || {};
  if (_.isEmpty(modules)) {
    return callback(null, _templates);
  }

  // Get the email templates for the next module
  const module = modules.pop();
  _getTemplatesForModule(basedir, module, (err, templatesForModule) => {
    if (err) {
      return callback(err);
    }

    _templates[module] = templatesForModule;

    return _getTemplatesForModules(basedir, modules, callback, _templates);
  });
};

/**
 * Get the templates for a module
 *
 * @param  {String}     basedir                     The base directory where the module folders are located
 * @param  {String}     module                      The module for which to retrieve the templates
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {Object}     callback.templates          The retrieved templates keyed by their id
 * @api private
 */
const _getTemplatesForModule = function(basedir, module, callback) {
  // Get all the email templates for this module
  const emailTemplatesPath = _templatesPath(basedir, module);
  IO.getFileListForFolder(emailTemplatesPath, (err, files) => {
    if (err) {
      return callback(err);
    }

    if (_.isEmpty(files)) {
      return callback();
    }

    // Identify a valid template by the existence of a *.meta.json.jst file
    let templateIds = {};
    _.each(files, file => {
      const re = /^(.*)\.meta\.json\.jst$/;
      if (re.test(file)) {
        templateIds[file.replace(re, '$1')] = true;
      }
    });
    templateIds = _.keys(templateIds);

    if (_.isEmpty(templateIds)) {
      return callback();
    }

    return _getTemplatesForTemplateIds(basedir, module, templateIds, callback);
  });
};

/**
 * Get the templates for a list of template ids. The templates that need to be retrieved are the meta.json, txt
 * and html templates for each email template id.
 *
 * @param  {String}     basedir                     The base directory where the locale folders are located
 * @param  {String}     module                      The module for which to retrieve the templates
 * @param  {String[]}   templateIds                 The ids of the templates to retrieve
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {Object}     callback.templates          The retrieved templates keyed by their id
 * @api private
 */
const _getTemplatesForTemplateIds = function(basedir, module, templateIds, callback, _templates) {
  _templates = _templates || {};

  if (_.isEmpty(templateIds)) {
    return callback(null, _templates);
  }

  const templateId = templateIds.pop();
  const templateMetaPath = _templatesPath(basedir, module, templateId + '.meta.json.jst');
  const templateHtmlPath = _templatesPath(basedir, module, templateId + '.html.jst');
  const templateTxtPath = _templatesPath(basedir, module, templateId + '.txt.jst');

  // Get each template individually
  _getCompiledTemplate(templateMetaPath, (err, metaTemplate) => {
    if (err) {
      return callback(err);
    }

    _getCompiledTemplate(templateHtmlPath, (err, htmlTemplate) => {
      if (err) {
        return callback(err);
      }

      _getCompiledTemplate(templateTxtPath, (err, txtTemplate) => {
        if (err) {
          return callback(err);
        }

        let sharedLogic = {};
        try {
          const templateSharedPath = _templatesPath(basedir, module, templateId + '.shared');
          sharedLogic = require(templateSharedPath);
        } catch {}

        // Attach the templates to the given object of templates
        _templates[templateId] = {
          'meta.json': metaTemplate,
          html: htmlTemplate,
          txt: txtTemplate,
          shared: sharedLogic
        };

        return _getTemplatesForTemplateIds(basedir, module, templateIds, callback, _templates);
      });
    });
  });
};

/**
 * Get the template at the given path.
 *
 * @param  {String}     templatePath            The path to the template file to be retrieved
 * @param  {Function}   callback                Standard callback function
 * @param  {Object}     callback.err            An error that occurred, if any
 * @param  {Function}   callback.template       The compiled template
 * @api private
 */
const _getCompiledTemplate = function(templatePath, callback) {
  fs.stat(templatePath, err => {
    if (err) {
      return callback();
    }

    fs.readFile(templatePath, 'utf8', (err, templateContent) => {
      if (err) {
        return callback(err);
      }

      if (templateContent) {
        const compiledTemplate = UIAPI.compileTemplate(templateContent);
        return callback(null, compiledTemplate);
      }

      return callback({ code: 500, msg: 'Template file ' + templatePath + ' had no content' });
    });
  });
};

/**
 * Get the path for a template file or directory.
 *
 * @param  {String}     basedir     The base directory for the templates
 * @param  {String}     module      The module for the templates
 * @param  {String}     [locale]    The locale for the templates
 * @param  {String}     [template]  The full filename for the template (e.g., meta.json.jst)
 * @return {String}                 Returns the path where the locales, template files or specific template file should be found
 * @api private
 */
const _templatesPath = function(basedir, module, template) {
  let templatePath = util.format('%s/%s/emailTemplates', basedir, module);
  if (template) {
    templatePath += '/' + template;
  }

  return templatePath;
};

/**
 * Fetch the appropriate template file (either override or base) for the given module, template id and
 * template type from the `templates` object. If no template can be found, `null` will be returned.
 *
 * @param  {String}     templateModule      The module to which the template belongs
 * @param  {String}     templateId          The id of the template
 * @param  {String}     templateType        The type of template to fetch (i.e., one of 'html', 'txt' or 'meta.json')
 * @return {String}                         The template content that can be used to render the template. If `null`, there was no suitable template for the given criteria.
 * @api private
 */
const _getTemplate = function(templateModule, templateId, templateType) {
  const template =
    templates &&
    templates[templateModule] &&
    templates[templateModule][templateId] &&
    templates[templateModule][templateId][templateType];

  return template;
};

/**
 * Given email headers and `sendEmail` options, generate a message hash for the message
 * that is a valid hexadecimal string
 *
 * @param  {Object}     emailInfo               The NodeMailer email info object that contains the message headers
 * @param  {String}     [emailInfo.to]          The "To" header of the message
 * @param  {String}     [emailInfo.subject]     The subject of the message
 * @param  {String}     [emailInfo.txt]         The plain text body of the message
 * @param  {String}     [emailInfo.html]        The rich HTML body of the message
 * @param  {Object}     opts                    The options used when invoking `EmailAPI.sendEmail`
 * @param  {String}     [opts.hash]             The hash that was specified as an identity of the message, if any
 * @return {String}                             A unique hexidecimal string based either on the specified hash or message content
 * @api private
 */
const _generateMessageHash = function(emailInfo, opts) {
  const md5sum = crypto.createHash('md5');

  if (opts.hash) {
    md5sum.update(opts.hash.toString());

    // If no unique hash was specified by the user, we will generate one based on the mail data that is available
  } else {
    md5sum.update(emailInfo.to || '');
    md5sum.update(emailInfo.subject || '');
    md5sum.update(emailInfo.txt || '');
    md5sum.update(emailInfo.html || '');
  }

  return md5sum.digest('hex');
};

/**
 * Increment the debug email count
 *
 * @api private
 */
const _incr = function() {
  if (debug) {
    debugEmailSendCounter.incr();
  }
};

/**
 * Decrement the debug email count
 *
 * @api private
 */
const _decr = function() {
  if (debug) {
    debugEmailSendCounter.decr();
  }
};

export { init, refreshTemplates, sendEmail, whenAllEmailsSent, EmailAPI as emitter };
