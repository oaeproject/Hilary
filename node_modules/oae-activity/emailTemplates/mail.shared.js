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
var $ = require('cheerio');

/**
 * Ensure that a link is an absolute URL. If a relative link is
 * passed in, it will be prefixed with the base url.
 *
 * @param  {String}     link        The link to check
 * @param  {String}     baseUrl     The base url that can be used to prefix relative urls
 * @return {String}                 The absolute link prefixed with the base url
 */
var ensureAbsoluteLink = module.exports.ensureAbsoluteLink = function(link, baseUrl) {
    // If the link is empty or null, we return the empty string. This can happen when
    // we try to link a private user (private users are scrubbed and have no profile path)
    if (!link) {
        return '';

    // If the link already has `http` in it (e.g., twitter profile pics) we return as-is
    } else if (link.indexOf('http') === 0) {
        return link;

    // Otherwise we prefix it with the base url
    } else {
        return baseUrl + link;
    }
};

/**
 * Ensure that each link in an HTML fragment is an abolute url, If a relative link is
 * found, it will be prefixed with the base url.
 *
 * @param  {String}     str         The html string in which to check for absolute links
 * @param  {String}     baseUrl     The base url that can be used to prefix relative urls
 * @return {String}                 The html in which each link is absolute
 */
var ensureAbsoluteLinks = module.exports.ensureAbsoluteLinks = function(str, baseUrl) {
    var html = $('<div>' + str + '</div>');
    html.find('a').each(function(i, elem) {
        var link = $(this).attr('href');
        link = ensureAbsoluteLink(link, baseUrl);
        $(this).attr('href', link);
    });
    return html.html();
};

/**
 * Get an appropariate summary given a user's email preference and a set of activities
 * The options are:
 *     -   When an immediate email is sent with a single actor and a single activity: `<displayName> has been active recently`
 *     -   When an immediate email is sent with a single actor and multiple activities: `<displayName> has been very active recently`
 *     -   When an immediate email is sent with multiple actors: `New activity is waiting for you`
 *     -   When a daily email is sent: `Here's your summary of today's activity`
 *     -   When a weekly email is sent: `Here's your summary of last week's activity`
 *
 * @param  {Object}         util                The template utility that can be used to encode HTML, translate keys, etc
 * @param  {String}         emailPreference     The email preference for which to generate an email summary
 * @param  {Activity[]}     activitities        The activities for which to generate a summary
 * @param  {String}         baseUrl             The base url that each link should have as a prefix
 * @return {String}                             An appropriate summary given the user's email preference and given activities
 */
var getEmailSummary = module.exports.getEmailSummary = function(util, emailPreference, activities, baseUrl) {
    if (emailPreference === 'immediate') {
        // Determine if there was a single or multiple actors
        var isSingleActor = true;
        var actor = null;
        _.each(activities, function(activity) {
            if (actor !== null && actor['oae:id'] !== activity.originalActivity.actor['oae:id']) {
                isSingleActor = false;
            }
            actor = activity.originalActivity.actor;
        });

        if (isSingleActor && actor.objectType !== 'collection') {
            var key = '__MSG__ACTIVITY_EMAIL_SUMMARY_IMMEDIATE_SINGLE_ACTOR_SINGLE_ACTIVITY__';
            if (activities.length > 1) {
                key = '__MSG__ACTIVITY_EMAIL_SUMMARY_IMMEDIATE_SINGLE_ACTOR_MULTIPLE_ACTIVITIES__';
            }

            // If the profile path was set, it indicates that we have access to view the user, therefore
            // we should display a link. If not specified, we should show plain-text
            var url = ensureAbsoluteLink(actor['oae:profilePath'], baseUrl);
            var actorLink = '<span>' + util.html.encodeForHTML(actor.displayName) + '</span>';
            if (url) {
                actorLink = '<a href="' + url + '">' + util.html.encodeForHTML(actor.displayName) + '</a>';
            }

            var summary = util.i18n.translate(key, {'actorLink': actorLink});

            return ensureAbsoluteLinks(summary, baseUrl);
        } else {
            return '__MSG__ACTIVITY_EMAIL_SUMMARY_IMMEDIATE_MULTIPLE_ACTORS__';
        }
    } else if (emailPreference === 'daily') {
        return '__MSG__ACTIVITY_EMAIL_SUMMARY_DAILY__';
    } else if (emailPreference === 'weekly') {
        return '__MSG__ACTIVITY_EMAIL_SUMMARY_WEEKLY__';
    }
};
