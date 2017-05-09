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

var log = require('oae-logger').logger('meetups-api');
var PrincipalsAPI = require('oae-principals/lib/api');
var Validator = require('oae-authz/lib/validator').Validator;

var MeetupsAPI = require('oae-meetups');
var MeetupsConfig = require('oae-config').config('oae-meetups');
var MeetupsConstants = require('./constants').MeetupsConstants;
var MeetupsDAO = require('./internal/dao');

var Config = require('oae-config').config('oae-meetups');
var BBBProxy = require('./internal/proxy');
var ContentAPI = require('oae-content/lib/api');
var DOMParser = require('xmldom').DOMParser;
var XMLSerializer = require('xmldom').XMLSerializer;
var xpath = require('xpath');
var jwt = require('jsonwebtoken');

// TODO jsdoc
var joinMeetup = function(ctx, groupId, callback) {
    var validator = new Validator();
    validator.check(null, {'code': 401, 'msg': 'Only authenticated users can join meetups'}).isLoggedInUser(ctx);
    validator.check(groupId, {'code': 400, 'msg': 'Invalid groupId id provided'}).isResourceId();

    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    PrincipalsAPI.getFullGroupProfile(ctx, groupId, function(err, groupProfile) {
        if (err) {
            return callback(err);
        }

        var profile = (JSON.parse(JSON.stringify(groupProfile)));

        MeetupsAPI.Bbb.getDefaultConfigXML(ctx, function(err, result) {
            if(err || result.returncode !== 'success') {
                return callback({'code': 503, 'msg': 'Fatal error'});
            }

            var defaultConfigXML = result.defaultConfigXML;
            var serializer = new XMLSerializer();
            var doc = new DOMParser().parseFromString(defaultConfigXML);

            _setMeetupLayout(doc);

            var xml = serializer.serializeToString(doc);
            MeetupsAPI.Bbb.joinURL(ctx, profile, xml, function(err, joinInfo) {
                if(err) {
                    //res.send(503, 'Fatal error'); *res is not defined here...*
                    log().info('Fatal error');
                }

                MeetupsAPI.emit(MeetupsConstants.events.JOIN_MEETUP, ctx, groupProfile, function() {
                    //handle errs
                });

                return callback(null, joinInfo);
            });

            return undefined;
        });

        return undefined;
    });

    return undefined;
};

var _setMeetupLayout = function(doc) {
    var select = xpath.useNamespaces();
    var node;

    // set layout bbb.layout.name.videochat and others
    node = select('//layout ', doc, true);
    node.setAttribute('defaultLayout', 'bbb.layout.name.videochat');
    node.setAttribute('showLayoutTools', 'false');
    node.setAttribute('confirmLogout', 'false');
    node.setAttribute('showRecordingNotification', 'false');
    // process modules
    // remove desktop sharing
    node = xpath.select1("//modules/module[@name=\'ScreenshareModule\']", doc);
    node.setAttribute('showButton', 'false');
    // remove PhoneModule button
    node = xpath.select1("//modules/module[@name=\'PhoneModule\']", doc);
    node.setAttribute('showButton', 'true');
    node.setAttribute('skipCheck', 'true');
    node.setAttribute('listenOnlyMode', 'false');
    // remove VideoconfModule button
    node = xpath.select1("//modules/module[@name=\'VideoconfModule\']", doc);
    node.setAttribute('showButton', 'true');
    node.setAttribute('autoStart', 'true');
    node.setAttribute('skipCamSettingsCheck', 'true');
    // remove layout menu
    node = xpath.select1("//modules/module[@name=\'LayoutModule\']", doc);
    node.setAttribute('enableEdit', 'false');
}

/**
 *
 * Checks if a meeting is running
 *
 * @function isMeetingRunning
 * @param  {type} ctx      {description}
 * @param  {type} groupId  {description}
 * @param  {type} callback {description}
 * @return {type} {description}
 */
var isMeetingRunning = function (ctx, groupId, callback) {
    var validator = new Validator();
    validator.check(null, {'code': 401, 'msg': 'Only authenticated users can end meetups'}).isLoggedInUser(ctx);
    validator.check(groupId, {'code': 400, 'msg': 'Invalid groupId id provided'}).isResourceId();

    PrincipalsAPI.getFullGroupProfile(ctx, groupId, function(err, groupProfile) {
        if(err) {
            callback(err);
        }

        // TODO this is not quite right, this could come from the activity stream
        // outside of a group, in which case this ajax call shouldn't be happening
        var profile;
        try {
            profile = (JSON.parse(JSON.stringify(groupProfile)));
        } catch (error) {
            log().info('Unable to fetch info about group profile');
            callback(null);
        }

        // Obtain the configuration parameters for the current tenant
        var bbbConfig = getBBBConfig(ctx.tenant().alias);

        // Prepare parameters to be sent based on parameters received
        var meetingID = sha1(profile.id + bbbConfig.secret);

        // Make sure the meeting is running
        var params = {'meetingID': meetingID};
        var isMeetingRunningURL = _getBBBActionURL(bbbConfig.endpoint, 'isMeetingRunning', bbbConfig.secret, _getQueryStringParams(params));

        BBBProxy.executeBBBCall(isMeetingRunningURL, function(err, meetingInfo) {
            if (err) {
                return callback(err);
            }

            if ( meetingInfo.returncode === 'SUCCESS' ) {
                return callback(null, {'returncode': 'success', 'running': meetingInfo.running});
            } else {
                return callback(new Error("Unable to fetch information on the meeting"));
            }
        });
    });
};

/**
 * @function endMeetup
 * @param  {type} ctx {description}
 * @param  {type} groupId {description}
 * @return {type} {description}
 */
var endMeetup = function(ctx, groupId, callback) {
    var validator = new Validator();
    validator.check(null, {'code': 401, 'msg': 'Only authenticated users can end meetups'}).isLoggedInUser(ctx);
    validator.check(groupId, {'code': 400, 'msg': 'Invalid groupId id provided'}).isResourceId();

    PrincipalsAPI.getFullGroupProfile(ctx, groupId, function(err, groupProfile) {
        var profile = (JSON.parse(JSON.stringify(groupProfile)));
        MeetupsAPI.Bbb.getEndURL(ctx, profile, function(err, meetingInfo) {
            if(err) {
                callback(err);
            }

            if(meetingInfo) {
                // end meetup on BBB server
                BBBProxy.executeBBBCall(meetingInfo.url, function(err, endInfo) {
                    if(endInfo && endInfo.returncode === 'SUCCESS') {

                        // TODO delete the meetup from Cassandra ???

                        // MeetupsDAO.end(groupId, function(err) {
                        //     if (err) {
                        //         return callback(err);
                        //     }
                        // });

                        return callback(null);
                    } else if(err) {
                        // log().info(endInfo.message);
                        log().info(endInfo.returncode);
                        return callback(err);
                    }

                    return undefined;
                });

                return undefined;
            } else {
                return callback(new Error('Meeting not found on BBB server'));
            }
        });
    });
};

/**
 * @function createRecordingLink
 * @param  {type} ctx                  {description}
 * @param  {type} groupId              {description}
 * @param  {type} signed_parameters    {description}
 * @param  {type} callback             {description}
 * @return {type} {description}
 */
var createRecordingLink = function(ctx, groupId, signed_parameters, callback) {
    var validator = new Validator();
    validator.check(groupId, {'code': 400, 'msg': 'Invalid groupId id provided'}).isResourceId();

    if (validator.hasErrors()) {
        return callback(validator.getFirstError());
    }

    var secret = Config.getValue(ctx.tenant().alias, 'bbb', 'secret');

    jwt.verify(signed_parameters, secret, {algorithms: ["HS256"]},function(err, decoded) {
        if (err) {
            return callback({'code': 401, 'msg': ''});
        }

        PrincipalsAPI.getFullGroupProfile(ctx, groupId, function(err, groupProfile) {
            if (err) {
                return callback(err);
            }

            MeetupsAPI.Bbb.getRecordingsURL(ctx, decoded, function(err, getRecordings) {
                ctx = getRecordings.ctx;

                MeetupsAPI.Recording.createRecording(ctx, decoded, groupProfile, getRecordings, function(err) {
                    if(err) {
                        return callback(err);
                    }

                    return callback(null);
                });
            });
            return undefined;
        });

        return undefined;
    });

    return undefined;
};

/**
 * @function deleteRecordingLink
 * @param  {type} ctx {description}
 * @param  {type} recordingID {description}
 * @param  {type} callback {description}
 * @return {type} {description}
 */
var deleteRecordingLink = function(ctx, recordingID, callback) {

    MeetupsAPI.Bbb.getDeleteRecordingsURL(ctx, recordingID, function(err, deleteRecordings) {
        if(err) {
            callback(err);
        }

        MeetupsAPI.Recording.deleteRecording(deleteRecordings, recordingID, function(err) {
            if(err) {
                return callback(err);
            }

            return callback(null);
        });
    });
};

module.exports = {
    'createRecordingLink': createRecordingLink,
    'deleteRecordingLink': deleteRecordingLink,
    'joinMeetup': joinMeetup,
    'endMeetup': endMeetup,
    'isMeetingRunning': isMeetingRunning
};
