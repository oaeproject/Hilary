/*
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

var bunyan = require('bunyan');

var config = module.exports.config = {};

// UI related config information. By default, we assume that the UI repostory
// can be found on the same level as the Hilary folder.

/**
 * `config.ui`
 *
 * Configuration namespace for the UI module.
 *
 * @param  {String}    path            The path to the UI static assets
 */
config.ui = {
    'path': '../3akai-ux'
};

// Cassandra related config information.
config.cassandra = {
    'hosts': ['127.0.0.1:9160'],
    'keyspace': 'oae',
    'user': '',
    'pass': '',
    'timeout': 3000,
    'replication': 1,
    'strategyClass': 'SimpleStrategy',
    'cqlVersion': '3.0.0'
};

// The redis related configuration information.
// The `dbIndex` key allows for seperation of actual and unit test data.
// By default redis starts up with 16 DB indexes so there should
// be no need to create one.
// We'll assume that:
//  0 = production
//  1 = unit tests
config.redis = {
    'host': '127.0.0.1',
    'port': 6379,
    'pass': '',
    'dbIndex': 0
};

/**
 * `config.servers`
 *
 * Configuration namespace for servers.
 *
 * @param  {String}     globalAdminAlias            The tenant alias that will be used for the global admins
 * @param  {String}     globalAdminHost             The hostname on which the global admin server can be reached by users
 * @param  {Number}     globalAdminPort             The network port on which the global admin express server can run
 * @param  {String}     [shibbolethSPHost]          The hostname on which the Shibboleth SP has been mounted
 * @param  {String}     [serverInternalAddress]     The internal hostname on which the server can be reached by OAE services such as the preview processor
 * @param  {Number}     tenantPort                  The network port on which the tenant express server can run
 * @param  {Boolean}    useHttps                    Whether or not the server is accessible via HTTPS. Hilary will *not* expose an HTTPS server, it's up to a frontend server such as Apache or Nginx to deal with the actual delivery of HTTPS traffic. This flag is mainly used to generate correct backlinks to the web application
 * @param  {Boolean}    [strictHttps]               Whether or not the server is using a valid SSL certificate. If `true`, any attempts to connect to the REST endpoints using an invalid certificate should result in an error and not be ignored. If `false`, a valid certificate will not be required
 */
config.servers = {
    'globalAdminAlias': 'admin',
    'globalAdminHost': 'admin.oae.com',
    'globalAdminPort': 2000,
    'shibbolethSPHost': 'shib-sp.oae.com',
    'serverInternalAddress': null,
    'tenantPort': 2001,
    'useHttps': false,
    'strictHttps': true
};

var tmpDir = process.env.TMP || process.env.TMPDIR || process.env.TEMP || '/tmp' || process.cwd();
tmpDir += '/oae';

/**
 * `config.files`
 *
 * Configuration namespace for files.
 *
 * @param  {String}    tmpDir                   The directory where temporary files can be created. (profile pictures when cropping, ...)
 * @param  {String}    uploadDir                The directory where upload files can be buffered before moving them over to the configured storage backend.
 * @param  {Object}    cleaner                  Holds configuration properties for the cleaning job that removes lingering files in the upload directory.
 * @param  {Boolean}   cleaner.enabled          Whether or not the cleaning job should run.
 * @param  {Number}    cleaner.interval         Files that haven't been accessed in this amount (of seconds) should be removed.
 * @param  {String}    localStorageDirectory    The directory where the local storage backend can store its files. By default, the files get stored on the same level as the Hilary directory. Note: the absolute path to this directory should also be configured in the Nginx config file. This directory will not be used when Amazon S3 file storage is used.
 * @param  {String}    limit                    The maximum file upload size, accepted formats look like "5mb", "200kb", "1gb". You should also adjust your front-end proxy (e.g., Nginx, Apache) to also handle files of this size
 */
config.files = {
    'tmpDir': tmpDir,
    'uploadDir': tmpDir + '/uploads',
    'cleaner': {
        'enabled': true,
        'interval': 2*60*60
    },
    'limit': '4096mb',
    'localStorageDirectory': '../files'
};

// The configuration that can be used to generate secure HTTP cookies.
// It's strongly recommended that you change this value.
// Make sure that this value is the same accross each app server.
config.cookie = {
    'secret': 'this secret will be used to sign your cookies, change me!'
};

config.log = {
    'streams': [
        {
            'level': 'info',
            'stream': process.stdout
        }
    ],
    'serializers': {
        'err': bunyan.stdSerializers.err,
        'req': bunyan.stdSerializers.req,
        'res': bunyan.stdSerializers.res
    }
};

/**
 * `config.telemetry`
 *
 * Configuration namespace for API telemetry
 *
 * @param  {Boolean}    [enabled]               Whether or not to enable telemetry. When `false`, no data will be published to the publishers. Default: `false`
 * @param  {Number}     [publishInterval]       How often (in seconds) to push data to the configured publisher. Default: 30 seconds
 * @param  {Number}     [resetInterval]         How often (in seconds) telemetry counters should be reset to 0. You want this to be fairly large as its reset can disrupt rate statistics for one publish interval on each reset. Set this to a value that controls insane numeric overflows such as 2^31-1. Default: 86400 seconds (once per day)
 * @param  {String}     [publisher]             The publisher implementation to use to publish data. Should be one of `console` or `circonus`. Default: `console`
 * @param  {Object}     [circonus]              Custom circonus configuration, only applicable if the selected publisher is `circonus` (required param if circonus is the publisher)
 * @param  {String}     [circonus.url]          The Circonus url to which data should be published (required param if circonus is the publisher)
 */
config.telemetry = {
    'enabled': false,
    'publishInterval': 30,
    'resetInterval': 86400,
    'publisher': 'console',
    'circonus': {
        'url': 'https://trap.noit.circonus.net/module/httptrap/check-uuid/secret-here'
    }
};

/**
 * `config.search`
 *
 * Configuration namespace for search.
 *
 * @param  {Object[]}  hosts                    The elastic search hosts/ports with which to communicate. Each element of this array is a hash that has 2 keys: 'host' and 'port'.
 * @param  {Object}    index                    Holds configuration properties for the OAE search index.
 * @param  {String}    index.name               The unique name of the index.
 * @param  {Object}    index.settings           Holds the elastic search index configuration settings, as per http://www.elasticsearch.org/guide/reference/api/admin-indices-create-index.html
 * @param  {Boolean}   [index.destroyOnStartup] Whether or not the index should be destroyed when the server starts up. Do not enable this on a production server. Defaults to `false`.
 * @param  {Boolean}   [processIndexJobs]       Whether or not this node should act as an indexer. Only disable this if you have another dedicated set of machines performing index processing. Defaults to `true`.
 */
config.search = {
    'hosts': [
        {
            'host': 'localhost',
            'port': 9200
        }
    ],
    'index': {
        'name': 'oae',
        'settings': {
            'number_of_shards': 5,
            'number_of_replicas': 1,
            'analysis': {
                'analyzer': {
                    'q': {
                        'type': 'custom',
                        'char_filter': ['html_strip'],
                        'tokenizer': 'letter',
                        'filter': ['lowercase', 'q_edgengram']
                    },
                    'message': {
                        'type': 'custom',
                        'tokenizer': 'letter',
                        'filter': ['lowercase', 'message_edgengram']
                    },
                    'text_content': {
                        'type': 'custom',
                        'tokenizer': 'letter',
                        'filter': ['lowercase', 'content_edgengram']
                    }
                },
                'filter': {
                    'q_edgengram': {
                        'type': 'edgeNGram',
                        'min_gram': 2,
                        'max_gram': 15
                    },
                    'message_edgengram': {
                        'type': 'edgeNGram',
                        'min_gram': 5,
                        'max_gram': 15
                    },
                    'content_edgengram': {
                        'type': 'edgeNGram',
                        'min_gram': 5,
                        'max_gram': 15
                    }
                }
            }
        },
        'destroyOnStartup': false
    },
    'processIndexJobs': true
};

/**
 * `config.mq`
 *
 * Configuration namespace for the message queue (RabbitMQ).
 *
 * @param  {Object}     connection              The connection description
 * @param  {String}     connection.host         The host for the connection
 * @param  {Number}     connection.port         The port for the connection
 * @param  {Boolean}    [purgeQueuesOnStartup]  If `true`, the application will **delete** all messages in a queue when a worker is first bound. This setting only takes effect if the NODE_ENV environment variable is not set to `production` to indicate a production environment. Default: `false`
 */
config.mq = {
    'connection': {
        'host': 'localhost',
        'port': 5672
    },
    'purgeQueuesOnStartup': false
};

/**
 * `config.previews`
 *
 * Configuration namespace for the preview processor.
 *
 * @param  {Boolean}     enabled                        Whether or not the preview processor should be running
 * @param  {String}      tmpDir                         A directory that can be used to store temporary files in
 * @param  {Object}      office                         Holds the configuration for anything Office related
 * @param  {String}      office.binary                  The path to the 'soffice' binary that starts up Libre Office. ex: On OS X it is `/Applications/LibreOffice.app/Contents/MacOS/soffice` with a default install
 * @param  {Number}      office.timeout                 Defines the timeout (in ms) when the Office process should be killed
 * @param  {Object}      pdf                            Holds the configuration for anything related to PDF splitting
 * @param  {String}      pdf.binary                     The path to the `pdftk` binary that can be used to split a PDF file into a PDF-per-page
 * @param  {Number}      pdf.timeout                    Defines the timeout (in ms) when the pdftk process should be killed
 * @param  {Object}      pdf2htmlEX                     Holds the configuration for anything related to converting a PDF file into an HTML file
 * @param  {String}      pdf2htmlEX.binary              The path to the `pdf2htmlEX` binary that can be used to convert a PDF file into an HTML file
 * @param  {Number}      pdf2htmlEX.timeout             Defines the timeout (in ms) when the pdf2htmlEX process should be killed
 * @param  {Object}      pdftotext                      Holds the configuration for anything related to converting a PDF file into a text file
 * @param  {String}      pdftotext.binary               The path to the `pdftotext` binary that can be used to convert a PDF file into a text file
 * @param  {Number}      pdftotext.timeout              Defines the timeout (in ms) when the pdftotext process should be killed
 * @param  {Object}      link                           Holds the configuration for anything related to link processing
 * @param  {String}      link.renderDelay               Defines the timeout (in ms) that should be waited between loading the page and taking a screenshot
 * @param  {Number}      link.renderTimeout             Defines the timeout (in ms) when the screencapturing should be stopped. This should include the renderDelay
 * @param  {Number}      link.embeddableCheckTimeout    Defines the timeout (in ms) when the embeddable link check should be stopped
 * @param  {Object}      credentials                    Holds the credentials that can be used to log on the global admin server
 * @param  {String}      credentials.username           The username to login with on the global admin server
 * @param  {String}      credentials.password           The password to login with on the global admin server
 */
config.previews = {
    'enabled': false,
    'tmpDir': tmpDir + '/previews',
    'office': {
        'binary': 'soffice',
        'timeout': 120000
    },
    'pdftk': {
        'binary': 'pdftk',
        'timeout': 120000
    },
    'pdf2htmlEX': {
        'binary': 'pdf2htmlEX',
        'timeout': 120000
    },
    'pdftotext': {
        'binary': 'pdftotext',
        'timeout': 120000
    },
    'link': {
        'renderDelay': 7500,
        'renderTimeout': 30000,
        'embeddableCheckTimeout': 15000
    },
    'credentials': {
        'username': 'administrator',
        'password': 'administrator'
    }
};

/**
 * `config.signing`
 *
 * Configuration namespace for the signing logic
 *
 * @param  {String}    key     This key will be used to sign URLs like profile pictures, content previews, etc.. . It's vital to the security of the system that you change this in production.
 */
config.signing = {
    'key': 'The default signing key, please change me.'
};

/**
 * `config.activity`
 *
 * Configuration namespace for activities.
 *
 * @param  {Boolean}    [processActivityJobs]           Whether or not this server node should produce and route activities. Defaults to `true`
 * @param  {Number}     [activityTtl]                   The time-to-live (in seconds) for generated activities. After this period of time, an activity in an activity feed is lost permanently. Defaults to 2 months
 * @param  {Number}     [aggregateIdleExpiry]           The amount of time (in seconds) an aggregate can be idle until it expires. The "idle" time of an aggregate is reset when a new activity occurs that matches the aggregate. Defaults to 3 hours
 * @param  {Number}     [aggregateMaxExpiry]            An upper-bound on the amount of time (in seconds) for which an aggregate can live. Defaults to 1 day
 * @param  {Number}     [numberOfProcessingBuckets]     The number of buckets available for parallel processing of activities. Defaults to 3
 * @param  {Number}     [collectionExpiry]              The maximum amount of time (in seconds) a processing bucket can be locked for at one time. If this is not long enough for an activity processor to collect the number of activities as configured by `collectionBatchSize`, then it will be possible for multiple processors to collect the same bucket concurrently. This will result in duplicate activities, which is not desired. Defaults to 1 minute
 * @param  {Number}     [maxConcurrentCollections]      The maximum number of concurrent collection cycles that can be active on a process at once. Defaults to 3
 * @param  {Number}     [maxConcurrentRouters]          The maximum number of activities that will be routed by one node at one time. This should be used to ensure activities are not routed faster than they can be collected, to ensure the redis collection buckets do not grow in size uncontrollably under unanticipated load. Defaults to 5
 * @param  {Number}     [collectionPollingFrequency]    How often (in seconds) the processing buckets are polled for new activities. If -1, polling will be disabled. If polling is disabled, activities will not function, so do not set to -1 in production. Defaults to 5 seconds.
 * @param  {Number}     [collectionBatchSize]           The number of items to process at a time when collecting bucketed activities. After one batch has been collected, the activity processor will immediately continue to process the next batch from that bucket, and so on. Defaults to 1000
 * @param  {Object}     [mail]                          Configuration for aggregated emails
 * @param  {Number}     [mail.pollingFrequency]         How often (in seconds) the email processing buckets are polled for new activities. This frequency will roughly determine the delay between an activity and sending an email for a user who has selected `immediate` and is involved in the activity. It should always be less than an hour
 * @param  {Number}     [mail.gracePeriod]              The minimum amount of time (in seconds) that should pass before the email process can send out an e-mail for an activity. This is to allow further activities to aggregate with the activity that triggered the email. Defaults to 3 minutes
 * @param  {Object}     [mail.daily]                    Configuration for the daily email aggregate collection cycle
 * @param  {Number}     [mail.daily.hour]               At what hour during the day email should be collected for daily aggregates
 * @param  {Object}     [mail.weekly]                   Configuration for the weekly email aggregate collection cycle
 * @param  {Number}     [mail.weekly.day]               On which day emails should be sent for weekly aggregates. Zero-based where `0` is sunday. Default is `5`
 * @param  {Number}     [mail.weekly.hour]              On which hour emails should be sent for weekly aggregates. You should probably keep this different to the `mail.daily.hour` value in order to spread the load
 * @param  {Object}     [redis]                         Configuration for dedicated redis server. If not specified, will use the same pool as the rest of the container (i.e., as specified by `config.redis`)
 * @param  {String}     [redis.host]                    The host of the dedicated redis server
 * @param  {Number}     [redis.port]                    The port of the dedicated redis server
 * @param  {String}     [redis.pass]                    The password to the dedicated redis server
 * @param  {Number}     [redis.dbIndex]                 The index number of the dedicated redis server index
 */
config.activity = {
    'processActivityJobs': true,
    'activityTtl': 2 * 30 * 24 * 60 * 60,   // 2 months (in seconds)
    'numberOfProcessingBuckets': 3,
    'aggregateIdleExpiry': 3 * 60 * 60,     // 3 hours (in seconds)
    'aggregateMaxExpiry': 24 * 60 * 60,     // 1 day (in seconds)
    'collectionExpiry': 60,                 // 1 minute (in seconds)
    'maxConcurrentCollections': 3,
    'maxConcurrentRouters': 5,
    'collectionPollingFrequency': 5,        // 5 seconds
    'collectionBatchSize': 1000,
    'mail': {
        'pollingFrequency': 15 * 60,        // 15 minutes
        'gracePeriod':  3 * 60,             // 3 minutes
        'daily': {
            'hour': 8                       // 8AM
        },
        'weekly': {
            'day': 3,                       // Wednesday, 0-based where 0 = Sunday
            'hour': 12                      // Noon
        }
    },
    'redis': null
};

/**
 * `config.email`
 *
 * Configuration namespace for emails.
 *
 * @param  {Boolean}    [debug]                     Determines whether or not email is in debug mode. If in debug mode, email messages are logged, not actually sent through any service.
 * @param  {String}     transport                   Which method of e-mail transport should be used. Either `SMTP` or `sendmail`.
 * @param  {String}     deduplicationInterval       Specifies the interval in seconds in which the same email can't be sent out again
 * @param  {Object}     throttling                  The throttling configuration
 * @param  {Number}     throttling.count            Specifies the number of emails a user can receive in `throttling.timespan` seconds before throttling takes effect
 * @param  {Number}     throttling.timespan         Specifies the throttling timespan in seconds
 * @param  {String}     [customEmailTemplatesDir]   Specifies a directory that holds the tenant-specific email template overrides
 * @param  {Object}     [sendmailTransport]         The sendmail information for sending emails.
 * @param  {String}     [sendmailTransport.path]    The path that points to the sendmail binary.
 * @param  {Object}     [smtpTransport]             The SMTP connection information for sending emails. This is the settings object that will be used by nodemailer to form an smtp connection: https://github.com/andris9/Nodemailer
 */
config.email = {
    'debug': true,
    'customEmailTemplatesDir': null,
    'deduplicationInterval': 7 * 24 * 60 * 60,   //  7 days
    'throttling': {
        'count': 10,
        'timespan': 2 * 60                       //  2 minutes
    },
    'transport': 'SMTP',
    'sendmailTransport': {
        'path': '/usr/sbin/sendmail'
    },
    'smtpTransport': {
        'service': 'Gmail',
        'auth': {
            'user': 'my.email@gmail.com',
            'pass': 'myemailpassword'
        }
    }
};

/**
 * `config.etherpad`
 *
 * Configuration namespace for the etherpad logic. If you are deploying a cluster of etherpad instances, note that the order of the hosts
 * in the array is sensitive to the indexes assigned in the accompanying front-end reverse proxy configuration (e.g., Nginx). More
 * information on deploying etherpad clusters can be found here:
 *
 *  https://github.com/oaeproject/Hilary/wiki/Deployment-Documentation
 *
 * @param  {String}     apikey          The key that can be used to communicate with the etherpad API.
 * @param  {Object[]}   hosts           The internal hosts or IP addresses where etherpad instances can be found. It's important that you add *all* your etherpad instances in this array, as the number of configured servers will be used to do (some very rudimentary) sharding.
 * @param  {String}     hosts[i].host   The hostname or IP address on which Hilary will be accessing the Etherpad API.
 * @param  {Number}     hosts[i].port   The port number on which Hilary will be accessing the etherpad API.
 */
config.etherpad = {
    'apikey': '13SirapH8t3kxUh5T5aqWXhXahMzoZRA',
    'hosts': [
        {
            'host': '127.0.0.1',
            'port': 9001
        }
    ]
};

/**
* `config.tincanapi`
*
* Configuration namespace for the TinCan API logic
*
* @param  {Number}  timeout             Defines the timeout (in ms) when the request to the LRS should be killed
*/
config.tincanapi = {
    'timeout': 4000
};

/**
 * `config.mixpanel`
 *
 * Configuration namespace for the mixpanel event tracking logic
 *
 * @param  {Boolean}    enabled         Whether or not mixpanel event tracking should be enabled
 * @param  {String}     token           The mixpanel api token
 */
config.mixpanel = {
    'enabled': false,
    'token': 'f3e9fce119d357b745a8dfa36248d632'
};
