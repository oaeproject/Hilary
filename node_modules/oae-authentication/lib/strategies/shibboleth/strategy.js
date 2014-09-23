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

var passport = require('passport');
var util = require('util');

var AuthenticationUtil = require('oae-authentication/lib/util');

/**
 * A Shibboleth passport authentication strategy
 *
 * @param  {Object}     options                 A set of options that determine where a user will be redirected
 * @param  {String}     options.idpEntityID     The Shibboleth entity ID of the Identity Provider
 * @param  {Function}   verify                  A standard passport verify function that gets called so you can get or create the OAE user account
 * @param  {Object}     verify.profile          An object that contains the profile information. The amount of information in this object depends on the amount of attributes released by the IdP
 * @param  {Function}   verify.done             A function that should be executed once the OAE user account has been retrieved or created
 * @param  {Object}     verify.done.err         An error that occured, if any
 * @param  {User}       verify.done.user        The user object
 * @param  {Boolean}    verify.done.created     Whether or not a new user was created
 */
var Strategy = function(options, verify) {
    this.name = 'shibboleth';
    this.options = options;
    this.verify = verify;
    passport.Strategy.call(this);
};

/**
 * Inherit from `passport.Strategy`.
 */
util.inherits(Strategy, passport.Strategy);


/**
 * Authenticate request based on the contents of request headers
 *
 * @param  {Request}    req             The ExpressJS request object
 * @param  {Object}     options         The strategy specific options
 * @api protected
 */
Strategy.prototype.authenticate = function(req, options) {
    var self = this;

    /*
     * If the user has authenticated through Shibboleth and is returning from the Identity Provider (IdP),
     * there should be a `shib-session-id` header in the request. If the user is indicating that he
     * wants to log in with Shibboleth, no such header will be present.
     *
     * It's up to the front-end load-balancer (either Apache or Nginx) to *NOT* proxy these headers.
     */
    var sessionId = req.headers['shib-session-id'];
    if (sessionId) {
        /*
         * The user is coming back from the IdP. mod_shib will pass all the user his attributes as headers.
         *
         * The following is a subset of the possible headers that the Shibboleth SP software proxies:
         *  - remote_user                   :   Identifies the user with the application. Shibboleth needs to have been configured appropriately so that it knows on which attributes this value is based on
         *  - Shib-Application-ID           :   The applicationId property derived for the request.
         *  - Shib-Session-ID               :   The internal session key assigned to the session associated with the request.
         *  - Shib-Identity-Provider        :   The entityID of the IdP that authenticated the user associated with the request.
         *
         * Depending on what profile attributes the IdP releases, other headers might be in the request.
         * The Shibboleth SP can be configured to map certain attributes to request headers. Ideally, no mapping should happen
         * within OAE but in the shib software. See https://wiki.shibboleth.net/confluence/display/SHIB2/NativeSPAttributeAccess
         * for more information. As the headers are exposed as a simple JSON object on the request, we can pass them straight
         * into the verify function, which can then take care of getting/creating the OAE user object.
         */
        self.verify(req.headers, function(err, user) {
            if (err) {
                return self.error(new Error(err.msg));
            }

            // We pass it on to passport so it can be stored in the express session object
            return self.success(user);
        });
    } else {
        /*
         * There is no session yet. We redirect the user to Shibboleth.
         * In case we know which IdP we want to use, we can append its entityID in the redirectUrl.
         * For example, If we want to authentication with the Cambridge IdP
         *      /Shibboleth.sso/Login?target=/api/auth/shibboleth/sp/returned&entityId=https://shib.raven.cam.ac.uk/shibboleth
         *
         * The `target` parameter in the above example is where the IdP should send the user to
         * once he is succesfully logged in. Note that this does NOT correspond with any URL in
         * Hilary. That URL is protected by Apache and mod_shib and will eventually invoke a response
         * at /api/auth/shibboleth/sp/callback. That callback URL should NOT be accessible via nginx
         * as that could lead to user spoofing.
         */
        var redirectUrl = util.format('/Shibboleth.sso/Login?target=%s', encodeURIComponent('/api/auth/shibboleth/sp/returned'));
        if (self.options.idpEntityID) {
            redirectUrl += util.format('&entityID=%s', encodeURIComponent(self.options.idpEntityID));
        }
        return self.redirect(redirectUrl);
    }
};

/**
 * Expose `Strategy`
 */
module.exports = Strategy;
