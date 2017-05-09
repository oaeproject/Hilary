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

var Config = require('oae-config').config('oae-meetups');
var ContextAPI = require('oae-context/lib/api');
var log = require('oae-logger').logger('oae-api');
var PrincipalsUtil = require('oae-principals/lib/api.user');
var SafePath = require('oae-util/lib/server');
var TenantsUtil = require('oae-tenants/lib/util');

var BBBProxy = require('./internal/proxy');
var MeetupsDAO = require('./internal/dao');

var sha1 = require('sha1');

var getMeetingInfoURL = module.exports.getMeetingInfoURL = function(ctx, meetingProfile, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = getBBBConfig(ctx.tenant().alias);

    // Prepare parameters to be send based on parameters received
    var meetingID = sha1(meetingProfile.id + bbbConfig.secret);

    // Make sure the meeting is running
    var params = {'meetingID': meetingID};
    var meetingInfoURL = _getBBBActionURL(bbbConfig.endpoint, 'getMeetingInfo', bbbConfig.secret, _getQueryStringParams(params));

    return callback(null, {'returncode':'success','url': meetingInfoURL});
};

var joinURL = module.exports.joinURL = function(ctx, meetingProfile, configXML, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = getBBBConfig(ctx.tenant().alias);

    // Prepare parameters to be send based on parameters received
    var fullName = encodeURIComponent(ctx.user().displayName);
    var meetingID = sha1(meetingProfile.id + bbbConfig.secret);
    var meetingName = encodeURIComponent(meetingProfile.displayName);

    // Make sure the meeting is running
    var params = {'meetingID': meetingID};
    var meetingInfoURL = _getBBBActionURL(bbbConfig.endpoint, 'getMeetingInfo', bbbConfig.secret, _getQueryStringParams(params));
    BBBProxy.executeBBBCall(meetingInfoURL, function(err, meetingInfo) {
        if (err) {
            return callback(err);
        }

        if ( meetingInfo.returncode === 'FAILED' && meetingInfo.messageKey === 'notFound' ) {

            // Force parameter to false when recording is disabled
            var record;
            if (typeof meetingProfile.record !== 'undefined') {
                record = Config.getValue(ctx.tenant().alias, 'bbb', 'recording')? meetingProfile.record: false;
            } else {
                record = Config.getValue(ctx.tenant().alias, 'bbb', 'recording')? Config.getValue(ctx.tenant().alias, 'bbb', 'recordingDefault'): false;
            }

            var logoutURL = 'javascript:window.close();';
            // Create the meeting
            params = {
                'meetingID': meetingID,
                'name':meetingName,
                'logoutURL': logoutURL,
                'record': record
            };
            if (meetingProfile.resourceType === 'group') {
                SafePath.addSafePathPrefix('/api/meetup/'+meetingProfile.id+'/recording');
                var baseUrl = TenantsUtil.getBaseUrl(ctx.tenant());
                params['meta_bn-recording-ready-url'] = baseUrl+'/api/meetup/'+meetingProfile.id+'/recording';
            }
            var createMeetingURL = _getBBBActionURL(bbbConfig.endpoint, 'create', bbbConfig.secret, _getQueryStringParams(params));
            BBBProxy.executeBBBCall(createMeetingURL, function(err, meetingInfo) {
                if (err) {
                    return callback(err);
                }

                MeetupsDAO.createMeetup(meetingID, ctx.user().id, ctx.user().displayName, record, null);

                // Construct and sign the URL
                var password = _getJoiningPassword(meetingProfile, meetingInfo);
                var params = {
                  'meetingID': meetingID,
                  'fullName':fullName,
                  'password': password
                };

                return _signURL(configXML, params, bbbConfig, callback);
            });

            return undefined;
        } else {
            // Construct and sign the URL
            var password = _getJoiningPassword(meetingProfile, meetingInfo);
            params = {
                'meetingID': meetingID,
                'fullName': fullName,
                'password': password
            };

            return _signURL(configXML, params, bbbConfig, callback);
        }
    });
};

var _signURL = function(config, params, bbbConfig, callback) {
  var joinURL;

  if( config ) {
      var config_xml_params = _getSetConfigXMLParams(bbbConfig.secret, params['meetingID'], config);
      var setConfigXMLURL = bbbConfig.endpoint + 'api/setConfigXML';

      log().info(setConfigXMLURL);
      BBBProxy.executeBBBCallExtended(setConfigXMLURL, null, 'post', config_xml_params, 'application/x-www-form-urlencoded', function(err, response) {
          if (err || response.returncode === 'FAILED') {
              joinURL = _getBBBActionURL(bbbConfig.endpoint, 'join', bbbConfig.secret, _getQueryStringParams(params));
              return callback(null, {'returncode':'success','url': joinURL});
          } else {
              params.configToken = response.configToken;
              joinURL = _getBBBActionURL(bbbConfig.endpoint, 'join', bbbConfig.secret, _getQueryStringParams(params));
              return callback(null, {'returncode':'success','url': joinURL});
          }
      });
  } else {
      joinURL = _getBBBActionURL(bbbConfig.endpoint, 'join', bbbConfig.secret, _getQueryStringParams(params));
      return callback(null, {'returncode':'success','url': joinURL});
  }
};

/**
 * @function getEndURL
 * @param  {type} ctx      {description}
 * @param  {type} profile  {description}
 * @param  {type} callback {description}
 * @return {type} {description}
 */
var getEndURL = module.exports.getEndURL = function(ctx, profile, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = getBBBConfig(ctx.tenant().alias);

    // Prepare parameters to be sent based on parameters received
    var meetingID = sha1(profile.id + bbbConfig.secret);

    // Make sure the meeting is running
    var params = { 'meetingID': meetingID };
    var meetingInfoURL = _getBBBActionURL(bbbConfig.endpoint, 'getMeetingInfo', bbbConfig.secret, _getQueryStringParams(params));

    BBBProxy.executeBBBCall(meetingInfoURL, function(err, meetingInfo) {
        if (err) {
            return callback(err);
        }

        if ( meetingInfo.returncode === 'FAILED' && meetingInfo.messageKey === 'notFound' ) {
            return callback(null, {'returncode': 'failed', 'response': meetingInfo } );

        } else {
            var password = meetingInfo.moderatorPW;

            // Construct and sign the URL
            var params = {'meetingID': meetingID, 'password': password};
            var endURL = _getBBBActionURL(bbbConfig.endpoint, 'end', bbbConfig.secret, _getQueryStringParams(params));

            return callback(null, {'returncode': 'success','url': endURL});
        }
    });
};

/**
 * @function getRecordingsURL
 * @param  {type} ctx      {description}
 * @param  {type} profile  {description}
 * @param  {type} callback {description}
 * @return {type} {description}
 */
var getRecordingsURL = module.exports.getRecordingsURL = function(ctx, profile, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = getBBBConfig(ctx.tenant().alias);
    var meetingID = profile.meeting_id;
    var recordID = profile.record_id;

    MeetupsDAO.getMeetup(meetingID, function (err, meeting){
        if (err) {
            return callback(err);
        } else if (!meeting) {
            return callback({'code': 404, 'msg': 'Could not find meeting: ' + meetingID});
        } else {
            var meetup = meeting;
            PrincipalsUtil.getUser(ctx, meetup.createdBy, function (err, user){
                if (err) {
                    return callback(err);
                } else {
                    ctx = ContextAPI.Context.fromUser(user);

                    // Construct and sign the URL
                    var params = {'recordID': recordID};
                    var getRecordingsURL = _getBBBActionURL(bbbConfig.endpoint, 'getRecordings', bbbConfig.secret, _getQueryStringParams(params));

                    return callback(null, {'returncode':'success','url': getRecordingsURL, 'ctx': ctx});
                }
            });
        }
    });
};

/**
 * @function deleteRecordingsURL
 * @param  {type} ctx         {description}
 * @param  {type} recordingID {description}
 * @param  {type} callback    {description}
 * @return {type} {description}
 */
var getDeleteRecordingsURL = module.exports.deleteRecordingsURL = function(ctx, recordingID, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = getBBBConfig(ctx.tenant().alias);

    // Construct and sign the URL
    var params = {'recordID': recordingID};
    var deleteRecordingsURL = _getBBBActionURL(bbbConfig.endpoint, 'deleteRecordings', bbbConfig.secret, _getQueryStringParams(params));

    return callback(null, {'returncode':'success','url': deleteRecordingsURL});
};

var updateRecordingsURL = module.exports.updateRecordingsURL = function(ctx, recordingID, body, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = getBBBConfig(ctx.tenant().alias);

    // Construct and sign the URL
    body.recordID = recordingID;
    var updateRecordingsURL = _getBBBActionURL(bbbConfig.endpoint, 'publishRecordings', bbbConfig.secret, _getQueryStringParams(body));

    return callback(null, {'returncode':'success','url': updateRecordingsURL});
};

var _getBBBActionURL = function(endpoint, action, secret, params) {
    var action_url = endpoint + 'api/' + action + '?' + params + '&checksum=' + _getChecksum(action, secret, params);
    log().info(action_url);
    return action_url;
};

var getDefaultConfigXMLURL = module.exports.getDefaultConfigXMLURL = function(ctx, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = getBBBConfig(ctx.tenant().alias);

    // Construct and sign the URL
    var params = {};
    var getDefaultConfigXMLURL = _getBBBActionURL(bbbConfig.endpoint, 'getDefaultConfigXML', bbbConfig.secret, _getQueryStringParams(params));

    return callback(null, {'returncode':'success','url': getDefaultConfigXMLURL});
};

var getDefaultConfigXML = module.exports.getDefaultConfigXML = function(ctx, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = getBBBConfig(ctx.tenant().alias);

    var params = {};
    var defaultConfigXMLURL = _getBBBActionURL(bbbConfig.endpoint, 'getDefaultConfigXML', bbbConfig.secret, _getQueryStringParams(params));
    BBBProxy.executeBBBCallExtended(defaultConfigXMLURL, 'raw', null, null, null, function(err, defaultConfigXML) {
        if (err) {
            return callback(err);
        }
        return callback(null, {'returncode':'success','defaultConfigXML': defaultConfigXML});
    });
};

var setConfigXML = module.exports.setConfigXML = function(ctx, meetingProfile, configXML, callback) {
    // Obtain the configuration parameters for the current tenant
    var bbbConfig = getBBBConfig(ctx.tenant().alias);
    var meetingID = sha1(meetingProfile.id + bbbConfig.secret);

    var setConfigXMLURL = bbbConfig.endpoint + 'api/setConfigXML';
    log().info(setConfigXMLURL);
    var params = _getSetConfigXMLParams(bbbConfig.secret, meetingID, configXML);
    BBBProxy.executeBBBCallExtended(setConfigXMLURL, null, 'post', params, 'application/x-www-form-urlencoded', function(err, response) {
        if (err) {
            return callback(err);
        } else if ( response.returncode === 'FAILED' ) {
            return callback(null, {'returncode':'failed','messageKey': response.messageKey,'message': response.message});
        } else {
            return callback(null, {'returncode':'success','token': response});
        }
    });
};

var getBBBConfig = module.exports.getBBBConfig = function(tenantAlias) {
    return {
        'endpoint': _getVerifiedBBBEndpoint( Config.getValue(tenantAlias, 'bbb', 'endpoint') ),
        'secret': Config.getValue(tenantAlias, 'bbb', 'secret')
    };
};

var _getChecksum = function(action, secret, params) {
   return sha1(action + params + secret);
};

var _getVerifiedBBBEndpoint = function(endpoint) {
    //The last must be a '/' character
    if ( endpoint.slice(-1) !== '/' ) {
        if ( endpoint.slice(-4) !== '/api' ) {
            endpoint += '/';
        } else {
            endpoint = endpoint.substring(0, endpoint.length - 3);
        }
    }

    return endpoint;
};

var _getQueryStringParams = function(params) {
    var qsParams = '';

    for (var param in params) {
        if (params.hasOwnProperty(param)) {
            qsParams += ( qsParams !== '')? '&': '';
            qsParams += param + '=' + params[param];
        }
    }

    return qsParams;
};

var _getJoiningPassword = function(profile, meetingInfo) {
    var password = '';

    if ( profile.isManager || profile.allModerators === 'true' ) {
        password = meetingInfo.moderatorPW;
    } else {
        password = meetingInfo.attendeePW;
    }

    return password;
};

var _getSetConfigXMLParams = function(secret, meetingID, configXML) {
    var params = 'configXML=' + _urlencode(configXML) + '&meetingID=' + _urlencode(meetingID);
    return params + '&checksum=' + sha1('setConfigXML' + params + secret);
};

var _urlencode = function (str) {
    return encodeURIComponent(str)
        .replace(/!/g, '%21')
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/\*/g, '%2A')
        .replace(/%20/g, '+');
};
