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

var _ = require('underscore');
var querystring = require('querystring');
var request = require('request');
var url = require('url');
var util = require('util');
var xml2js = require('xml2js');

var ConfigAPI = require('oae-config');
var log = require('oae-logger').logger('oae-orcid');
var Validator = require('oae-authz/lib/validator').Validator;

var OrcidConfig = ConfigAPI.config('oae-orcid');
var OrcidDAO = require('./internal/dao');
var OrcidRecord = require('./model');

// Object that stores the ORCID access tokens
var tokens = {};

/**
 * ORCID (Open Researcher and Contributor ID) is a nonproprietary alphanumeric code to uniquely identify scientific and other academic authors.
 * It would provide for humans a persistent identity, similar to that created for content-related entities on digital networks by digital object identifiers (DOIs).
 * @see http://orcid.org
 *
 * Public API: http://pub.orcid.org/
 * Public Sandbox API: http://pub.sandbox-1.orcid.org/
 *
 * Member API: https://api.orcid.org/
 * Member Sandbox API: http://api.sandbox-1.orcid.org/
 *
 * ORCID API docs:
 * @see http://support.orcid.org/knowledgebase/articles/116874-orcid-api-guide
 *
 * ORCID API users group:
 * @see https://groups.google.com/forum/#!forum/orcid-api-users
 *
 * ORCID GitHub repo:
 * @see https://github.com/ORCID/ORCID-Source
 */

/**
 * Generate an ORCID profile message body
 * @see http://support.orcid.org/knowledgebase/articles/147534-xml-for-orcid-bio
 *
 * Terminal:
 * curl -H 'Accept: application/xml' -H 'Content-Type: application/vdn.orcid+xml' -H 'Authorization: Bearer [access-token]' '[member-endpoint]/v1.1/orcid-profile' -X POST -d '@/path/to/file' -L -i
 *
 * @param  {Object}  user    The user ojbect
 * @return {String}          The generated XML message
 * @api private
 */
var _createOrcidProfileMessage = function(user) {

    // Create a new xml2js Builder
    var builder = new xml2js.Builder({
        'rootName': 'orcid-message'
    });

    // Construct the message body
    var message = {
        '$': {
            'xmlns:xsi': 'http://www.orcid.org/ns/orcid https://raw.github.com/ORCID/ORCID-Source/master/orcid-model/src/main/resources/orcid-message-1.1.xsd',
            'xmlns': 'http://www.orcid.org/ns/orcid'
        },
        'message-version': '1.1',
        'orcid-profile': {
            'orcid-bio': {
                'personal-details': {
                    'given-names': user.displayName,
                    'credit-name': user.displayName
                },
                'contact-details': {
                    'email': {
                        '$': {
                            'primary': 'true'
                        },
                        '_': user.email
                    }
                }
            }
        }
    };

    // Create the XML string
    return builder.buildObject(message);
};

/**
 * Check if a cached token has not expired since
 * @see http://support.orcid.org/knowledgebase/articles/120162-orcid-scopes
 *
 * @param  {String}  scope    The scope of the token (e.g. /orcid-profile/create)
 * @return {Boolean}          Whether or not the token has expired
 * @api private
 */
var _isTokenExpired = function(scope) {

    // Check if the token is not expired yet
    if (tokens[scope] && Date.now() < (tokens[scope].expiryDate) - 60000) {
        return false;
    }

    // If expired, remove the token
    delete tokens[scope];
    return true;
};

/**
 * Request an OAuth access token that allows the client to request/create all of the ORCID iDs/Records that are needed for the users.
 * @see http://support.orcid.org/knowledgebase/articles/119985
 *
 * Testing in terminal:
 * curl -i -L -H 'Accept: application/json' -d 'client_id=[client_id]' -d 'client_secret=[client_secret]' -d 'scope=/orcid-profile/create' -d 'grant_type=client_credentials' '[member-endpoint]/oauth/token'
 *
 * @param  {String}    scope                    The token scope (e.g /authenticate, /orcid-profile/create)
 * @param  {String}    tenantAlias              The tenant alias (e.g. cam)
 * @param  {Function}  callback                 Standard callback function
 * @param  {Error}     callback.err             The thrown error
 * @param  {String}    callback.access_token    The retrieved access token
 * @api private
 */
var _requestAccessToken = function(scope, tenantAlias, callback) {

    // Return the token if it has already been cached and not expired since
    if (!_isTokenExpired(scope)) {
        return callback(null, tokens[scope].accessToken);
    }

    // Object that contains the request options body
    var requestBody = querystring.stringify({
        'client_id': OrcidConfig.getValue(tenantAlias, 'api', 'client_id'),
        'client_secret': OrcidConfig.getValue(tenantAlias, 'api', 'client_secret'),
        'grant_type': 'client_credentials',
        'scope': scope
    });

    // Object hat contains all the request options
    var reqOpts = {
        'method': 'POST',
        'body': requestBody,
        'headers': {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        'url': OrcidConfig.getValue(tenantAlias, 'api', 'member') + '/oauth/token'
    };

    // Send a request to the ORCID API
    request(reqOpts, function(err, res, body) {
        if (err) {
            log().error({'err': err}, 'Unable to request an access token');
            return callback({'code': 500, 'msg': err});

        // If the credentials are incorrect
        } else if (res.statusCode !== 200) {
            log().error({'code': res.statusCode, 'msg': res.body}, 'Unable to request an access token');
            return callback({'code': 500, 'msg': 'Unable to request an access token'});

        } else {
            try {

                // Parse the response body
                body = JSON.parse(body);

                // Store the token
                var expiryDate = Date.now() + parseInt(body.expires_in, 10);
                tokens[scope] = new OrcidRecord.AccessToken(body.access_token, expiryDate);

                // Return the retrieved access token
                return callback(null, tokens[scope].accessToken);

            } catch(err) {
                return callback({'code': 500, 'msg': 'Unable to read the ORCID response'});
            }
        }
    });
};

/**
 * Create a new ORCID record
 *
 * @param  {Context}   ctx                 The context of the current session
 * @param  {Function}  callback            Standard callback function
 * @param  {Error}     callback.err        Error object containing error code and error message
 * @param  {String}    callback.orcidId    The ORCID id
 * @api private
 */
var _createOrcidRecord = function(ctx, callback) {

    // Store the tenant alias
    var tenantAlias = ctx.tenant().alias;

    // Store the user context
    var user = ctx.user();

    // Validate user
    var validator = new Validator();
    validator.check(user.email, {'code': 400, 'msg': 'Missing email'}).notEmpty();
    validator.check(user.displayName, {'code': 400, 'msg': 'Missing display name'}).notEmpty();
    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    // Retrieve an access token that allows us to create an ORCID profile
    _requestAccessToken('/orcid-profile/create', tenantAlias, function(err, access_token) {
        // When a new Orcid member could not be created because the token could not be retrieved
        if (err) {
            log().error({'err': err}, 'Couldn\'t request access token');
            return callback({'code': err.code, 'msg': err.msg});
        }

        // Object hat contains all the request options
        var reqOpts = {
            'body': _createOrcidProfileMessage(user),
            'headers': {
                'Accept': 'application/xml',
                'Authorization': 'Bearer ' + access_token,
                'Content-Type': 'application/vnd.orcid+xml'
            },
            'method': 'POST',
            'url': OrcidConfig.getValue(tenantAlias, 'api', 'member') + '/v1.1/orcid-profile'
        };

        // Send a request to the member ORCID API
        request(reqOpts, function(err, res) {
            if (err) {
                log().error({'err': err}, 'Error while creating new ORCID record');
                return callback({'code': 400, 'msg': 'Error while creating new ORCID record'});
            }

            // If the request doesn't contain a 201 (created) statusCode, return an error
            if (res.statusCode !== 201) {
                log().error({'code': res.statusCode, 'msg': res.body}, 'Unable to create an ORCID profile');
                return callback({'code': 500, 'msg': 'User with this email already exists'});
            }

            // Fetch the orcidId from the response headers
            var orcidId = url.parse(res.headers['location']).path.split('/')[1];

            // Return the created record
            return callback(null, orcidId);
        });
    });
};

/**
 * Create a new ORCID Member ID
 * @see http://support.orcid.org/knowledgebase/articles/168980-tutorial-create-a-new-record-with-google-s-oauth-
 *
 * Testing in Terminal:
 * curl -X POST -H "Content-Type: application/json" -d '{"givenNames":"John","familyName":"Doe","email":"john.doe@mail.com"}' [tenant-url]/api/orcid/new -e "/"
 *
 * @param  {Context}   ctx                 The context of the current session
 * @param  {Function}  callback            Standard callback function
 * @param  {Error}     callback.err        Error object containing error code and error message
 * @param  {String}    callback.orcidId    The ORCID id
 */
var createOrcidMemberRecord = module.exports.createOrcidMemberRecord = function(ctx, callback) {
    if (!ctx.user()) {
        return callback({'code': 401, 'msg': 'Creating ORCID records is only allowed for registered users'});
    }

    // Store the tenant alias
    var tenantAlias = ctx.tenant().alias;

    // Check if the ORCID integration is enabled for tenant
    if (OrcidConfig.getValue(tenantAlias, 'api', 'enabled')) {

        // Store the user context
        var user = ctx.user();

        // Check if a user is already associated with an ORCID id
        OrcidDAO.getOrcidIdFromUser(user.id, function(err, orcidId) {
            if (err) {
                log().error({'err': err, 'user': user.id, 'orcidId': orcidId}, 'Couldn\'t fetch ORCID id from user');
                return callback({'code': err.code, 'msg': err.msg});
            }

            // Return an error if the ORCID has already been created and associated with the user's profile
            if (orcidId) {
                return callback({'code': 400, 'msg': 'User already associated an ORCID id with his profile (' + orcidId + ')'});
            }

            // Create a new record if the user hasn't been associated with an ORCID id yet
            _createOrcidRecord(ctx, function(err, orcidId) {
                if (err) {
                    log().error({'err': err, 'user': user.id, 'orcidId': orcidId}, 'Couldn\'t create an ORCID id for user');
                    return callback({'code': err.code, 'msg': err.msg});
                }

                // Update the user's ORCID id
                OrcidDAO.updateOrcidId(user.id, orcidId, function(err) {
                    if (err) {
                        log().error({'err': err, 'user': user.id, 'orcidId': orcidId}, 'Couldn\'t persistent ORCID id for user');
                        return callback({'code': err.code, 'msg': err.msg});
                    }

                    // Return the ORCID id
                    return callback(null, orcidId);
                });
            });
        });

    } else {
        return callback({'code': 401, 'msg': 'ORCID integration is not enabled for tenant'});
    }
};

/**
 * Get an ORCID Member record by email or ORCID Member id from the ORCID API
 * @see http://support.orcid.org/knowledgebase/articles/132354-tutorial-searching-with-the-api
 *
 * @param  {Context}   ctx                The context of the current session
 * @param  {Object}    query              The request query object
 * @param  {String}    [query.id]         The ORCID member id
 * @param  {String}    [query.email]      The ORCID member string
 * @param  {Function}  callback           Standard callback function
 * @param  {Error}     callback.err       Error object containing error code and error message
 * @param  {Object}    callback.record    The ORCID member record
 */
var getOrcidRecord = module.exports.getOrcidRecord = function(ctx, query, callback) {
    if (!ctx.user()) {
        return callback({'code': 401, 'msg': 'Requesting ORCID records is only allowed for registered users'});
    }

    // Store the tenant alias
    var tenantAlias = ctx.tenant().alias;

    // Check if the ORCID integration is enabled for tenant
    if (OrcidConfig.getValue(tenantAlias, 'api', 'enabled')) {

        // Check the query parameters
        if (!query.email && !query.id) {
            return callback({'code': 400, 'msg': 'Invalid or no email address specified'});
        }

        // Create a new validator instance to check the parameters
        var validator = new Validator();

        // If the search uses the `id` parameter
        var url = null;
        if (query.id) {
            validator.check(query.id, {'code': 400, 'msg': 'Invalid ID format'}).isShortString();
            url = OrcidConfig.getValue(tenantAlias, 'api', 'public') + util.format('/%s', query.id);

        // If the search uses the `email` parameter
        } else if (query.email) {
            validator.check(query.email, {'code': 400, 'msg': 'Invalid email format'}).isShortString();
            url = OrcidConfig.getValue(tenantAlias, 'api', 'member') + util.format('/search/orcid-bio/?q=email:%s', query.email);
        }

        // Return errors (if any occurred)
        if (validator.hasErrors()) {
            return callback(validator.getFirstError());
        }

        // Retrieve an access token that allows us to query for ORCID profiles
        _requestAccessToken('/read-public', tenantAlias, function(err, access_token) {
            if (err) {
                log().error({'err': err}, 'Couldn\'t request access token');
                return callback({'code': err.code, 'msg': err.msg});
            }

            // Object that contains all the request options
            var reqOpts = {
                'headers': {
                    'Accept': 'application/json',
                    'Authorization': 'Bearer ' + access_token,
                    'Content-Type': 'application/orcid+json',
                },
                'method': 'GET',
                'url': url
            };

            // Send a request to the public ORCID API
            request(reqOpts, function(err, res, record) {

                // If the request throws an error
                if (err) {
                    log().error({'err': err}, 'Couldn\'t fetch ORCID record from API');
                    return callback({'code': 400, 'msg': err});

                // If the API throws an error
                } else if (record.error_desc) {
                    log().error(record.error_desc.value);
                    return callback({'code': res.statusCode, 'msg': record.error_desc.value});
                }

                // Return the ORCID record
                return callback(null, record);
            });
        });

    } else {
        return callback({'code': 401, 'msg': 'ORCID integration is not enabled for tenant'});
    }
};
