/*!
 * Copyright 2017 Apereo Foundation (AF) Licensed under the
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
var sha1 = require('sha1');

var Config = require('oae-config').config('oae-meetups');
var ContextAPI = require('oae-context/lib/api');
var log = require('oae-logger').logger('oae-api');
var PrincipalsUtil = require('oae-principals/lib/api.user');
var SafePath = require('oae-util/lib/server');
var TenantsUtil = require('oae-tenants/lib/util');

var BBBProxy = require('./internal/proxy');
var MeetupsDAO = require('./internal/dao');

/**
 * @function getMeetingInfoURL
 * @param  {Context} ctx           Oae-context object
 * @param  {Object} meetingProfile Object containing meeting settings
 * @param  {Function} callback     Standard callback function
 */
var getMeetingInfoURL = function(ctx, meetingProfile, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = getBBBConfig(ctx.tenant().alias);

    // Prepare parameters to be send based on parameters received
    var meetingId = _getMeetingId(meetingProfile, bbbConfig);

    // Make sure the meeting is running
    var params = {'meetingID': meetingId};
    var meetingInfoURL = _getBBBActionURL(bbbConfig.endpoint, 'getMeetingInfo', bbbConfig.secret, _getQueryStringParams(params));

    return callback(null, {'returncode':'success','url': meetingInfoURL});
};

/**
 * @function joinURL
 * @param  {Context} ctx           Oae-context object
 * @param  {Object} meetingProfile Object containing meeting settings
 * @param  {String} configXML     Bbb server XML configuration
 * @param  {Function} callback    Standard callback function
 */
var joinURL = function(ctx, meetingProfile, configXML, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = getBBBConfig(ctx.tenant().alias);

    // Prepare parameters to be send based on parameters received
    var fullName = encodeURIComponent(ctx.user().displayName);
    var meetingId = _getMeetingId(meetingProfile, bbbConfig);
    var meetingName = encodeURIComponent(meetingProfile.displayName);

    // Make sure the meeting is running
    var params = {'meetingID': meetingId};
    var meetingInfoURL = _getBBBActionURL(bbbConfig.endpoint, 'getMeetingInfo', bbbConfig.secret, _getQueryStringParams(params));
    BBBProxy.executeBBBCall(meetingInfoURL, function(err, meetingInfo) {
        if (err) {
            return callback(err);
        }

        if ( meetingInfo.returncode === 'FAILED' && meetingInfo.messageKey === 'notFound' ) {

            // Force parameter to false when recording is disabled
            var record = Config.getValue(ctx.tenant().alias, 'bbb', 'recording') ? _recordIsOn(meetingProfile, ctx) : false;

            var logoutURL = 'javascript:window.close();';
            // Create the meeting
            params = {
                'meetingID': meetingId,
                'name':meetingName,
                'logoutURL': logoutURL,
                'record': record
            };
            if (meetingProfile.resourceType === 'group') {
                SafePath.addSafePathPrefix('/api/meetups/'+meetingProfile.id+'/recording');
                var baseUrl = TenantsUtil.getBaseUrl(ctx.tenant());
                params['meta_bn-recording-ready-url'] = baseUrl+'/api/meetups/'+meetingProfile.id+'/recording';
            }
            var createMeetingURL = _getBBBActionURL(bbbConfig.endpoint, 'create', bbbConfig.secret, _getQueryStringParams(params));
            BBBProxy.executeBBBCall(createMeetingURL, function(err, meetingInfo) {
                if (err) {
                    return callback(err);
                }

                MeetupsDAO.createMeetup(meetingId, ctx.user().id, ctx.user().displayName, record, null);

                // Construct and sign the URL
                var password = _getJoiningPassword(meetingProfile, meetingInfo);
                var params = {
                  'meetingID': meetingId,
                  'fullName':fullName,
                  'password': password
                };

                return _signURL(configXML, params, bbbConfig, callback);
            });
        } else {
            // Construct and sign the URL
            var password = _getJoiningPassword(meetingProfile, meetingInfo);
            params = {
                'meetingID': meetingId,
                'fullName': fullName,
                'password': password
            };

            return _signURL(configXML, params, bbbConfig, callback);
        }
    });
};

/**
 * @function _recordIsOn
 * @param  {Object} meetingProfile Object containing meeting settings
 * @param  {Context} ctx Oae-context object
 * @return {boolean} Returns true if meeting has record on, false Otherwise
 */
var _recordIsOn = function(meetingProfile, ctx) {
    if (meetingProfile.hasOwnProperty('record')) {
        return meetingProfile.record;
    } else {
        return Config.getValue(ctx.tenant().alias, 'bbb', 'recordingDefault');
    }
};

/**
 * @function _signURL
 * @param  {String} config      Bbb server XML configuration
 * @param  {String} params      Parameters of meeting info
 * @param  {String} bbbConfig   Configuration settings of bbb server
 * @param  {Function} callback  Standard callback function
 */
 var _signURL = function(config, params, bbbConfig, callback) {
   var joinURL = _getBBBActionURL(bbbConfig.endpoint, 'join', bbbConfig.secret, _getQueryStringParams(params));;

   if(config) {
       var config_xml_params = _getSetConfigXMLParams(bbbConfig.secret, params['meetingID'], config);
       var setConfigXMLURL = bbbConfig.endpoint + 'api/setConfigXML';

       log().info("ConfigXML url: " + setConfigXMLURL);
       BBBProxy.executeBBBCallExtended(setConfigXMLURL, null, 'post', config_xml_params, 'application/x-www-form-urlencoded', function(err, response) {
           if (err || response.returncode === 'FAILED') {
               return callback(null, {'returncode':'success','url': joinURL});
           } else {
               params.configToken = response.configToken;
               joinURL = _getBBBActionURL(bbbConfig.endpoint, 'join', bbbConfig.secret, _getQueryStringParams(params));
               return callback(null, {'returncode':'success','url': joinURL});
           }});
   } else {
       return callback(null, {'returncode':'success','url': joinURL});
   }
 };

/**
 * @function getEndURL
 * @param  {Context} ctx       Oae-context object
 * @param  {Object} profile    Object containing group settings
 * @param  {Function} callback Standard callback function
 */
var getEndURL = function(ctx, profile, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = getBBBConfig(ctx.tenant().alias);

    // Prepare parameters to be sent based on parameters received
    var meetingId = _getMeetingId(profile, bbbConfig);

    // Make sure the meeting is running
    var params = { 'meetingID': meetingId };
    var meetingInfoURL = _getBBBActionURL(bbbConfig.endpoint, 'getMeetingInfo', bbbConfig.secret, _getQueryStringParams(params));

    BBBProxy.executeBBBCall(meetingInfoURL, function(err, meetingInfo) {
        if (err) {
            return callback(err);
        }

        if ( meetingInfo.returncode === 'FAILED' && meetingInfo.messageKey === 'notFound' ) {
            return callback(null, {'returncode': 'failed', 'response': meetingInfo } );

        } else {
            // Construct and sign the URL
            var params = {'meetingID': meetingId, 'password': meetingInfo.moderatorPW};
            var endURL = _getBBBActionURL(bbbConfig.endpoint, 'end', bbbConfig.secret, _getQueryStringParams(params));

            return callback(null, {'returncode': 'success','url': endURL});
        }
    });
};

/**
 * @function getRecordingsURL
 * @param  {Context} ctx       Oae-context object
 * @param  {Object} profile    Object containing group settings
 * @param  {Function} callback Standard callback function
 */
var getRecordingsURL = function(ctx, profile, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = getBBBConfig(ctx.tenant().alias);
    var meetingId = profile.meeting_id;
    var recordId = profile.record_id;

    MeetupsDAO.getMeetupById(meetingId, function (err, meeting){
        if (err) {
            return callback(err);
        } else if (!meeting) {
            return callback( {'code': 404, 'msg': 'Could not find meeting: ' + meetingId});
        } else {
            PrincipalsUtil.getUser(ctx, meeting.createdBy, function (err, user){
                if (err) {
                    return callback(err);
                } else {
                    ctx = ContextAPI.Context.fromUser(user);

                    // Construct and sign the URL
                    var getRecordingsURL = _getBBBActionURL(bbbConfig.endpoint, 'getRecordings', bbbConfig.secret, _getQueryStringParams({'recordID': recordId}));

                    return callback(null, {'returncode':'success','url': getRecordingsURL, 'ctx': ctx});
                }
            });
        }
    });
};

/**
 * @function deleteRecordingsURL
 * @param  {Context} ctx           Oae-context object
 * @param  {string} recordingId  Id of recording to delete
 * @param  {Function} callback   Standard callback function
 */
var getDeleteRecordingsURL = module.exports.deleteRecordingsURL = function(ctx, recordingId, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = getBBBConfig(ctx.tenant().alias);

    // Construct and sign the URL
    var deleteRecordingsURL = _getBBBActionURL(bbbConfig.endpoint, 'deleteRecordings', bbbConfig.secret, _getQueryStringParams({'recordID': recordingId}));

    return callback(null, {'returncode':'success','url': deleteRecordingsURL});
};

/**
 * @function updateRecordingsURL
 * @param  {Context} ctx           Oae-context object
 * @param  {String} recordingId   Id of recording to update
 * @param  {String} body          Contains new data for recording
 * @param  {Function} callback    Standard callback function
 */
var updateRecordingsURL = function(ctx, recordingId, body, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = getBBBConfig(ctx.tenant().alias);

    // Construct and sign the URL
    body.recordID = recordingId;
    var updateRecordingsURL = _getBBBActionURL(bbbConfig.endpoint, 'publishRecordings', bbbConfig.secret, _getQueryStringParams(body));

    return callback(null, {'returncode':'success','url': updateRecordingsURL});
};

/**
 * @function _getBBBActionURL
 * @param  {String} endpoint Bbb server endpoint
 * @param  {String} action   Bbb api request action
 * @param  {String} secret   Bbb server shared secret
 * @param  {String} params   Action parameters
 * @return {String} Returns created action url
 */
var _getBBBActionURL = function(endpoint, action, secret, params) {
    var action_url = endpoint + 'api/' + action + '?' + params + '&checksum=' + _getChecksum(action, secret, params);
    log().info("Requested action url: " + action_url);
    return action_url;
};

/**
 * @function getDefaultConfigXMLURL
 * @param  {Context} ctx           Oae-context object
 * @param  {Function} callback  Standard callback function
 */
var getDefaultConfigXMLURL = function(ctx, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = getBBBConfig(ctx.tenant().alias);

    // Construct and sign the URL
    var getDefaultConfigXMLURL = _getBBBActionURL(bbbConfig.endpoint, 'getDefaultConfigXML', bbbConfig.secret, _getQueryStringParams({}));

    return callback(null, {'returncode':'success','url': getDefaultConfigXMLURL});
};

/**
 * @function getDefaultConfigXML
 * @param  {Context} ctx           Oae-context object
 * @param  {Function} callback  Standard callback function
 */
var getDefaultConfigXML = function(ctx, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = getBBBConfig(ctx.tenant().alias);

    var defaultConfigXMLURL = _getBBBActionURL(bbbConfig.endpoint, 'getDefaultConfigXML', bbbConfig.secret, _getQueryStringParams({}));
    BBBProxy.executeBBBCallExtended(defaultConfigXMLURL, 'raw', null, null, null, function(err, defaultConfigXML) {
        if (err) {
            return callback(err);
        }
        return callback(null, {'returncode':'success','defaultConfigXML': defaultConfigXML});
    });
};

/**
 * @function setConfigXML
 * @param  {Context} ctx           Oae-context object
 * @param  {Object} meetingProfile Object containing meeting settings
 * @param  {String} configXML      Bbb server XML configuration
 * @param  {Function} callback     Standard callback function
 */
var setConfigXML = function(ctx, meetingProfile, configXML, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = getBBBConfig(ctx.tenant().alias);
    var meetingId = _getMeetingId(meetingProfile, bbbConfig);

    var setConfigXMLURL = bbbConfig.endpoint + 'api/setConfigXML';
    log().info("ConfigXML url: " + setConfigXMLURL);
    var params = _getSetConfigXMLParams(bbbConfig.secret, meetingId, configXML);
    BBBProxy.executeBBBCallExtended(setConfigXMLURL, null, 'post', params, 'application/x-www-form-urlencoded', function(err, response) {
        if(err) {
          return callback(err);
        }
        var result;
        if ( response.returncode === 'FAILED' ) {
          result = {'returncode':'failed','messageKey': response.messageKey,'message': response.message};
        } else {
          result = {'returncode':'success','token': response};
        }
        return callback(null, result);
    });
};

/**
 * @function getBBBConfig
 * @param  {String} tenantAlias Alias for a tenant
 * @return {Object} Return JSON object containing bbb endpoint and secret
 */
var getBBBConfig = function(tenantAlias) {
    return {
        'endpoint': _getVerifiedBBBEndpoint( Config.getValue(tenantAlias, 'bbb', 'endpoint') ),
        'secret': Config.getValue(tenantAlias, 'bbb', 'secret')
    };
};

/**
 * @function _getChecksum
 * @param  {String} action Bbb api action
 * @param  {String} secret Bbb server shared secret
 * @param  {String} params Action parameters
 * @return {String} Return a checksum for the given arguments
 */
var _getChecksum = function(action, secret, params) {
   return sha1(action + params + secret);
};

/**
 * @function _getVerifiedBBBEndpoint
 * @param  {String} endpoint Bbb server endpoint
 * @return {String} Returns a valid endpoint
 */
var _getVerifiedBBBEndpoint = function(endpoint) {
    //The last must be a '/' character
    if (endpoint.slice(-1) !== '/') {
        if (endpoint.slice(-4) !== '/api') {
            endpoint += '/';
        } else {
            endpoint = endpoint.substring(0, endpoint.length - 3);
        }
    }

    return endpoint;
};

/**
 * @function _getQueryStringParams
 * @param  {String} params Parameters for an action
 * @return {String} Returns params as url params
 */
var _getQueryStringParams = function(params) {
    var qsParams = '';

    _.map(params, function(value, param) {
        if (params.hasOwnProperty(param)) {
            qsParams += ( qsParams !== '') ? '&': '';
            qsParams += param + '=' + value;
        }
    });

    return qsParams;
};

/**
 * @function _getJoiningPassword
 * @param  {Object} profile     Object containing user settings
 * @param  {Object} meetingInfo Object containg meeting info
 * @return Returns the password required to access the meeting
 */
var _getJoiningPassword = function(profile, meetingInfo) {
    var password;

    if ( profile.isManager || profile.allModerators === 'true' ) {
        password = meetingInfo.moderatorPW;
    } else {
        password = meetingInfo.attendeePW;
    }

    return password;
};

/**
 * @function _getSetConfigXMLParams
 * @param  {String} secret    Bbb server shared secret
 * @param  {String} meetingId Id of meeting to apply XML config
 * @param  {String} configXML Bbb server XML configuration
 * @return {String} Returns configXML as url configXML params
 */
var _getSetConfigXMLParams = function(secret, meetingId, configXML) {
    var params = 'configXML=' + _urlencode(configXML) + '&meetingID=' + _urlencode(meetingId);
    return params + '&checksum=' + sha1('setConfigXML' + params + secret);
};

/**
 * @function _urlencode
 * @param  {String} str String
 * @return {String} Returns a url safe str
 */
var _urlencode = function(str) {
    return encodeURIComponent(str)
        .replace(/!/g, '%21')
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/\*/g, '%2A')
        .replace(/%20/g, '+');
};

/**
 * @function _getMeetingId
 * @param  {Object} profile Object containg meeting settings
 * @param  {Context} Oae-context object
 * @return {String} Returns an encoded meeting id
 */
var _getMeetingId = function(profile, bbbConfig) {
  var meetingId = sha1(profile.id + bbbConfig.secret);
  return meetingId;
}

module.exports = {
  'getMeetingInfoURL' : getMeetingInfoURL,
  'joinURL' : joinURL,
  'getEndURL' : getEndURL,
  'getRecordingsURL' : getRecordingsURL,
  'getDeleteRecordingsURL' : getDeleteRecordingsURL,
  'updateRecordingsURL' : updateRecordingsURL,
  'getDefaultConfigXMLURL' : getDefaultConfigXMLURL,
  'getDefaultConfigXML' : getDefaultConfigXML,
  'setConfigXML' : setConfigXML,
  'getBBBConfig' : getBBBConfig
}
