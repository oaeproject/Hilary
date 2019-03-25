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

/* eslint-disable no-unused-vars */

const assert = require('assert');
const util = require('util');
const $ = require('cheerio');
const _ = require('underscore');

const ConfigTestUtil = require('oae-config/lib/test/util');
const ContentTestUtil = require('oae-content/lib/test/util');
const EmailTestUtil = require('oae-email/lib/test/util');
const PrincipalsTestUtil = require('oae-principals/lib/test/util');
const RestAPI = require('oae-rest');
const Sanitization = require('oae-util/lib/sanitization');
const TenantsTestUtil = require('oae-tenants/lib/test/util');
const TestsUtil = require('oae-tests');
const TZ = require('oae-util/lib/tz');

const ActivityAPI = require('oae-activity');
const { ActivityConstants } = require('oae-activity/lib/constants');
const ActivityEmail = require('oae-activity/lib/internal/email');
const ActivitySystemConfig = require('oae-activity/lib/internal/config');
const ActivityTestUtil = require('oae-activity/lib/test/util');

describe('Activity Email', () => {
  // Rest contexts that can be used every time we need to make a request as an admin
  let camAdminRestContext = null;
  let globalAdminRestContext = null;
  let _originalDateNow = null;

  /**
   * Function that will fill up the REST contexts
   */
  beforeEach(callback => {
    _originalDateNow = Date.now;

    // Fill up admin rest contexts
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    globalAdminRestContext = TestsUtil.createGlobalAdminRestContext();

    // Flush the pending mails
    EmailTestUtil.clearEmailCollections(() => {
      refreshConfiguration(null, false, false, {}, () => {
        return callback();
      });
    });
  });

  /**
   * Reset the activity aggregator after each unit test and restore the Date.now function
   */
  afterEach(callback => {
    Date.now = _originalDateNow;

    refreshConfiguration(null, false, false, {}, () => {
      return callback();
    });
  });

  /**
   * Set the activity mail configuration so the next collection cycle
   * may or may not include the daily and/or weekly emails.
   *
   * @param  {String}     [timezoneString]    Set the polling day and hour frequency based on the given timezone (e.g., Etc/GMT+4). Default: Etc/UTC
   * @param  {Boolean}    expectDaily         Whether or not daily mails should be collected in the next cycle
   * @param  {Boolean}    expectWeekly        Whether or not weekly mails should be collected in the next cycle
   * @param  {Object}     extraConfig         Extra configuration that should be applied
   * @param  {Function}   callback            Standard callback function
   * @param  {Object}     callback.config     The configuration object that was used to refresh the activity API
   * @throws {AssertionError}                 An assertion error is thrown if the configuration could not be set
   * @api private
   */
  const refreshConfiguration = function(timezoneString, expectDaily, expectWeekly, extraConfig, callback) {
    const now = timezoneString ? new TZ.timezone.Date(timezoneString) : new TZ.timezone.Date('Etc/UTC');

    let dailyHour = null;
    if (expectDaily) {
      dailyHour = now.getHours() + 1;
    } else {
      dailyHour = now.getHours() + 5;
    }
    dailyHour %= 24;

    let weeklyHour = null;
    let weeklyDay = null;
    if (expectWeekly) {
      weeklyHour = now.getHours() + 1;
      weeklyDay = now.getDay();

      // If we're running the tests at 23:30, we need to ensure that we set the config to 0:30 the next day
      if (weeklyHour >= 24) {
        weeklyDay = (weeklyDay + 1) % 7;
        weeklyHour %= 24;
      }
    } else {
      weeklyHour = 0;
      weeklyDay = now.getDay() + 3;
    }

    let config = {
      mail: {
        pollingFrequency: 60 * 60, // Make it exactly an hour
        gracePeriod: 0,
        daily: {},
        weekly: {}
      }
    };

    // Allow for other configuration
    config = _.extend(config, extraConfig);

    // Configure the daily/weekly values
    config.mail.daily = { hour: dailyHour };
    config.mail.weekly = { hour: weeklyHour, day: weeklyDay };

    ActivityTestUtil.refreshConfiguration(config, err => {
      assert.ok(!err);
      return callback(config);
    });
  };

  describe('Templates', () => {
    /**
     * Test that verifies the state of the activity email footer template based on instance
     * configuration
     */
    it('verify footer template', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, simong, nico, mrvisser) => {
        assert.ok(!err);

        // Clear emails to start
        EmailTestUtil.collectAndFetchAllEmails(() => {
          const instanceName = TestsUtil.generateRandomText(1);
          const instanceURL = util.format('http://www.instance.oaeproject.org/%s', TestsUtil.generateRandomText(1));
          const hostingOrganization = TestsUtil.generateRandomText(1);
          const hostingOrganizationURL = util.format(
            'http://www.host.oaeproject.org/%s',
            TestsUtil.generateRandomText(1)
          );

          const instanceConfigFields = ['oae-tenants/instance/instanceName', 'oae-tenants/instance/instanceURL'];
          const hostingOrganizationConfigFields = [
            'oae-tenants/instance/hostingOrganization',
            'oae-tenants/instance/hostingOrganizationURL'
          ];

          const updateConfigInstance = {
            'oae-tenants/instance/instanceName': instanceName,
            'oae-tenants/instance/instanceURL': instanceURL
          };

          const updateConfigHostingOrganization = {
            'oae-tenants/instance/hostingOrganization': hostingOrganization,
            'oae-tenants/instance/hostingOrganizationURL': hostingOrganizationURL
          };

          /*!
           * Ensure the email footer contains / doesn't contain the specified tenant
           * configuration information for instance and host
           *
           * @param  {Object}         message                                     The email message to test
           * @param  {Object}         [assertions]                                The assertions to apply
           * @param  {Boolean}        [assertions.expectInstanceName]             Whether or not the instance information should be present. Default: `false`
           * @param  {Boolean}        [assertions.expectInstanceURL]              Whether or not the instance link should be present. Default: `false`
           * @param  {Boolean}        [assertions.expectHostingOrganizationName]  Whether or not the hosting organization name should be present. Default: `false`
           * @param  {Boolean}        [assertions.expectHostingOrganizationURL]   Whether or not the host organization link should be present. Default: `false`
           * @throws {AssertionError}                                             Thrown if any of the assertions fail
           */
          const _assertEmailFooter = function(message, assertions) {
            assertions = assertions || {};

            // Ensure the OAE information is always available
            assert.notStrictEqual(message.html.indexOf('Apereo <a\n href="http://www.oaeproject.org"\n '), -1);
            assert.notStrictEqual(message.html.indexOf('Open Academic Environment</a>'), -1);

            // Ensure the instance information is accurate
            if (assertions.expectInstanceName) {
              assert.notStrictEqual(message.html.indexOf(instanceName), -1);
              assert.notStrictEqual(message.text.indexOf(instanceName), -1);
            } else {
              assert.strictEqual(message.html.indexOf(instanceName), -1);
              assert.strictEqual(message.text.indexOf(instanceName), -1);
            }

            if (assertions.expectInstanceURL) {
              assert.notStrictEqual(
                message.html.indexOf(
                  util.format('<a\n href="%s"\n ', Sanitization.encodeForHTMLAttribute(instanceURL))
                ),
                -1
              );
              assert.notStrictEqual(message.html.indexOf(util.format('%s</a>', instanceName)), -1);
            } else {
              assert.strictEqual(message.html.indexOf(util.format('<a href="%s"\n ', instanceURL)), -1);
              assert.strictEqual(message.html.indexOf(util.format('%s</a>', instanceName)), -1);
            }

            // Ensure the hosting organization information is accurate
            if (assertions.expectHostingOrganizationName) {
              assert.notStrictEqual(message.html.indexOf(hostingOrganization), -1);
              assert.notStrictEqual(message.text.indexOf(hostingOrganization), -1);
            } else {
              assert.strictEqual(message.html.indexOf(hostingOrganization), -1);
              assert.strictEqual(message.text.indexOf(hostingOrganization), -1);
            }

            if (assertions.expectHostingOrganizationURL) {
              assert.notStrictEqual(
                message.html.indexOf(
                  util.format('<a\n href="%s"\n ', Sanitization.encodeForHTMLAttribute(hostingOrganizationURL))
                ),
                -1
              );
              assert.notStrictEqual(message.html.indexOf(util.format('%s</a>', hostingOrganization)), -1);
            } else {
              assert.strictEqual(message.html.indexOf(util.format('<a\n href="%s"\n ', hostingOrganizationURL)), -1);
              assert.strictEqual(message.html.indexOf(util.format('%s</a>', hostingOrganization)), -1);
            }
          };

          ConfigTestUtil.clearConfigAndWait(
            globalAdminRestContext,
            null,
            _.union(instanceConfigFields, hostingOrganizationConfigFields),
            err => {
              assert.ok(!err);

              // Create a link, let Nico manage it
              RestAPI.Content.createLink(
                mrvisser.restContext,
                'Google',
                'Google',
                'public',
                'http://www.google.ca',
                [nico.user.id],
                [],
                [],
                (err, link) => {
                  assert.ok(!err);

                  // Ensure the email is as expected
                  EmailTestUtil.collectAndFetchAllEmails(messages => {
                    _assertEmailFooter(messages[0]);

                    // Add a host instance information and generate another email
                    ConfigTestUtil.updateConfigAndWait(globalAdminRestContext, null, updateConfigInstance, err => {
                      assert.ok(!err);
                      RestAPI.Content.updateContent(
                        mrvisser.restContext,
                        link.id,
                        { displayName: 'Update 1' },
                        (err, link) => {
                          assert.ok(!err);
                          EmailTestUtil.collectAndFetchAllEmails(messages => {
                            _assertEmailFooter(messages[0], {
                              expectInstanceName: true,
                              expectInstanceURL: true
                            });

                            // Remove the instance and add a host organization
                            ConfigTestUtil.clearConfigAndWait(
                              globalAdminRestContext,
                              null,
                              instanceConfigFields,
                              err => {
                                assert.ok(!err);
                                ConfigTestUtil.updateConfigAndWait(
                                  globalAdminRestContext,
                                  null,
                                  updateConfigHostingOrganization,
                                  err => {
                                    assert.ok(!err);
                                    RestAPI.Content.updateContent(
                                      mrvisser.restContext,
                                      link.id,
                                      { displayName: 'Update 2' },
                                      (err, link) => {
                                        assert.ok(!err);
                                        EmailTestUtil.collectAndFetchAllEmails(messages => {
                                          _assertEmailFooter(messages[0], {
                                            expectHostingOrganizationName: true,
                                            expectHostingOrganizationURL: true
                                          });

                                          // Add the instance info back, ensure they're both present
                                          ConfigTestUtil.updateConfigAndWait(
                                            globalAdminRestContext,
                                            null,
                                            updateConfigInstance,
                                            err => {
                                              assert.ok(!err);
                                              RestAPI.Content.updateContent(
                                                mrvisser.restContext,
                                                link.id,
                                                { displayName: 'Update 3' },
                                                (err, link) => {
                                                  assert.ok(!err);
                                                  EmailTestUtil.collectAndFetchAllEmails(messages => {
                                                    _assertEmailFooter(messages[0], {
                                                      expectInstanceName: true,
                                                      expectInstanceURL: true,
                                                      expectHostingOrganizationName: true,
                                                      expectHostingOrganizationURL: true
                                                    });

                                                    // Add just the instance and hosting organization name info and ensure it renders properly
                                                    const urlFields = [
                                                      'oae-tenants/instance/instanceURL',
                                                      'oae-tenants/instance/hostingOrganizationURL'
                                                    ];
                                                    ConfigTestUtil.clearConfigAndWait(
                                                      globalAdminRestContext,
                                                      null,
                                                      urlFields,
                                                      err => {
                                                        assert.ok(!err);
                                                        RestAPI.Content.updateContent(
                                                          mrvisser.restContext,
                                                          link.id,
                                                          { displayName: 'Update 3' },
                                                          err => {
                                                            assert.ok(!err);
                                                            EmailTestUtil.collectAndFetchAllEmails(messages => {
                                                              _assertEmailFooter(messages[0], {
                                                                expectInstanceName: true,
                                                                expectHostingOrganizationName: true
                                                              });
                                                              return callback();
                                                            });
                                                          }
                                                        );
                                                      }
                                                    );
                                                  });
                                                }
                                              );
                                            }
                                          );
                                        });
                                      }
                                    );
                                  }
                                );
                              }
                            );
                          });
                        }
                      );
                    });
                  });
                }
              );
            }
          );
        });
      });
    });
  });

  /**
   * Test that verifies that emails aggregate
   */
  it('verify email aggregation', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, simong, nico, mrvisser) => {
      assert.ok(!err);

      RestAPI.Content.createLink(
        mrvisser.restContext,
        'Google',
        'Google',
        'public',
        'http://www.google.ca',
        [],
        [nico.user.id],
        [],
        (err, firstLink) => {
          assert.ok(!err);
          RestAPI.Content.createLink(
            mrvisser.restContext,
            'Google',
            'Google',
            'public',
            'http://www.google.ca',
            [],
            [nico.user.id],
            [],
            (err, secondLink) => {
              assert.ok(!err);
              RestAPI.Content.createLink(
                simong.restContext,
                'Google',
                'Google',
                'public',
                'http://www.google.ca',
                [],
                [nico.user.id],
                [],
                (err, thirdLink) => {
                  assert.ok(!err);
                  RestAPI.Content.createLink(
                    simong.restContext,
                    'Google',
                    'Google',
                    'public',
                    'http://www.google.ca',
                    [],
                    [nico.user.id],
                    [],
                    (err, fourthLink) => {
                      assert.ok(!err);
                      RestAPI.Discussions.createDiscussion(
                        simong.restContext,
                        'First discussion',
                        'descr',
                        'public',
                        null,
                        [nico.user.id],
                        (err, firstDiscussion) => {
                          assert.ok(!err);

                          // Nico should've received an email with 3 activities in it
                          //  - 1 content-create: Branden created 2 links
                          //  - 1 content-create: Simon created 2 links
                          //  - 1 discussion-create: Simon created a discussion

                          EmailTestUtil.collectAndFetchAllEmails(messages => {
                            assert.strictEqual(messages.length, 1);
                            assert.strictEqual(messages[0].to[0].address, nico.user.email);
                            assert.ok(messages[0].html);

                            // Assert there are 3 activities in there by asserting links to all the content and
                            // discussion profile pages are in the mail
                            assert.ok(messages[0].html.indexOf(firstLink.profilePath) > 0);
                            assert.ok(messages[0].html.indexOf(secondLink.profilePath) > 0);
                            assert.ok(messages[0].html.indexOf(thirdLink.profilePath) > 0);
                            assert.ok(messages[0].html.indexOf(fourthLink.profilePath) > 0);
                            assert.ok(messages[0].html.indexOf(firstDiscussion.profilePath) > 0);

                            // Assert the links to the actors their profile are present
                            assert.ok(messages[0].html.indexOf(mrvisser.user.profilePath) > 0);
                            assert.ok(messages[0].html.indexOf(simong.user.profilePath) > 0);

                            // Assert the order of activities is correct (oldest at the bottom)
                            const contentIndex = messages[0].html.indexOf(firstLink.profilePath);
                            const discussionIndex = messages[0].html.indexOf(firstDiscussion.profilePath);
                            assert.ok(discussionIndex < contentIndex);

                            RestAPI.Discussions.createDiscussion(
                              simong.restContext,
                              'Second discussion',
                              'descr',
                              'public',
                              null,
                              [nico.user.id, mrvisser.user.id],
                              (err, secondDiscussion) => {
                                assert.ok(!err);
                                EmailTestUtil.collectAndFetchAllEmails(messages => {
                                  assert.strictEqual(messages.length, 2);
                                  _.each(messages, message => {
                                    assert.ok(
                                      _.contains([nico.user.email, mrvisser.user.email], message.to[0].address)
                                    );

                                    // Assert that only the link to the discussion profile is present
                                    assert.ok(message.html.indexOf(secondDiscussion.profilePath) > 0);
                                    assert.strictEqual(messages[0].html.indexOf(firstLink.profilePath), -1);
                                    assert.strictEqual(messages[0].html.indexOf(secondLink.profilePath), -1);
                                    assert.strictEqual(messages[0].html.indexOf(thirdLink.profilePath), -1);
                                    assert.strictEqual(messages[0].html.indexOf(fourthLink.profilePath), -1);
                                    assert.strictEqual(messages[0].html.indexOf(firstDiscussion.profilePath), -1);

                                    // Assert the link to Simon's profile is present
                                    assert.ok(message.html.indexOf(simong.user.profilePath) > 0);
                                  });

                                  return callback();
                                });
                              }
                            );
                          });
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  });

  /**
   * Test that verifies that aggregation in a stream is stopped when an email is sent
   */
  it('verify aggregation in a stream is stopped when an email is sent', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, nico, branden, simong) => {
      assert.ok(!err);

      // Trigger an activity
      RestAPI.Content.createLink(
        simong.restContext,
        'Link #1',
        'Google',
        'public',
        'http://www.google.be',
        [],
        [branden.user.id],
        [],
        (err, firstContentObj) => {
          assert.ok(!err);

          // Collect the e-mails, Branden should've received an e-mail containing the content-create activity
          EmailTestUtil.collectAndFetchAllEmails(messages => {
            assert.strictEqual(messages.length, 1);
            assert.strictEqual(messages[0].to[0].address, branden.user.email);
            assert.ok(messages[0].html.indexOf(firstContentObj.displayName) > 0);
            assert.ok(messages[0].html.indexOf(firstContentObj.profilePath) > 0);

            // If Simon triggers another content-create activity, it should *NOT* aggregate with the initial one
            RestAPI.Content.createLink(
              simong.restContext,
              'Link #2',
              'Google',
              'public',
              'http://www.google.be',
              [],
              [branden.user.id],
              [],
              (err, secondContentObj) => {
                assert.ok(!err);

                // Collect the e-mails, Branden should've received an e-mail containing the content-create activity
                EmailTestUtil.collectAndFetchAllEmails(messages => {
                  assert.strictEqual(messages.length, 1);
                  assert.strictEqual(messages[0].to[0].address, branden.user.email);
                  assert.strictEqual(messages[0].html.indexOf(firstContentObj.displayName), -1);
                  assert.strictEqual(messages[0].html.indexOf(firstContentObj.profilePath), -1);
                  assert.ok(messages[0].html.indexOf(secondContentObj.displayName) > 0);

                  // Sanity check that unrelated activities don't include older activities either
                  RestAPI.Discussions.createDiscussion(
                    nico.restContext,
                    'Discussion',
                    'Discussion description',
                    'public',
                    [],
                    [branden.user.id],
                    (err, discussion) => {
                      assert.ok(!err);

                      // Collect the e-mails, Branden should've received an e-mail containing the content-create activity
                      EmailTestUtil.collectAndFetchAllEmails(messages => {
                        assert.strictEqual(messages.length, 1);
                        assert.strictEqual(messages[0].to[0].address, branden.user.email);
                        assert.strictEqual(messages[0].html.indexOf(firstContentObj.displayName), -1);
                        assert.strictEqual(messages[0].html.indexOf(secondContentObj.displayName), -1);
                        assert.ok(messages[0].html.indexOf(discussion.displayName) > 0);

                        return callback();
                      });
                    }
                  );
                });
              }
            );
          });
        }
      );
    });
  });

  /**
   * Test that verifies that the email aggregator respects each user their email preference
   */
  it('verify aggregation respects email preference', callback => {
    TestsUtil.generateTestUsers(
      camAdminRestContext,
      5,
      (err, users, neverMailUser, immediateMailUser, dailyMailUser, weeklyMailUser, simong) => {
        assert.ok(!err);
        RestAPI.User.updateUser(neverMailUser.restContext, neverMailUser.user.id, { emailPreference: 'never' }, err => {
          assert.ok(!err);
          RestAPI.User.updateUser(
            immediateMailUser.restContext,
            immediateMailUser.user.id,
            { emailPreference: 'immediate' },
            err => {
              assert.ok(!err);
              RestAPI.User.updateUser(
                dailyMailUser.restContext,
                dailyMailUser.user.id,
                { emailPreference: 'daily' },
                err => {
                  assert.ok(!err);
                  RestAPI.User.updateUser(
                    weeklyMailUser.restContext,
                    weeklyMailUser.user.id,
                    { emailPreference: 'weekly' },
                    err => {
                      assert.ok(!err);

                      // Configure the email collector, so that the email collection window doesn't include
                      // the daily and weekly collection point
                      refreshConfiguration(null, false, false, {}, () => {
                        // Trigger an activity
                        RestAPI.Content.createLink(
                          simong.restContext,
                          'Google1',
                          'Google1',
                          'public',
                          'http://www.google1.be',
                          [],
                          [
                            neverMailUser.user.id,
                            immediateMailUser.user.id,
                            dailyMailUser.user.id,
                            weeklyMailUser.user.id
                          ],
                          [],
                          err => {
                            assert.ok(!err);

                            // Collect the e-mails, only the immediate user should receive an e-mail
                            EmailTestUtil.collectAndFetchAllEmails(messages => {
                              assert.strictEqual(messages.length, 1);
                              assert.strictEqual(messages[0].to[0].address, immediateMailUser.user.email);

                              // Configure the email collector, so that the email collection window includes
                              // the daily but not the weekly collection point
                              refreshConfiguration(null, true, false, {}, () => {
                                // Trigger an activity
                                RestAPI.Content.createLink(
                                  simong.restContext,
                                  'Google2',
                                  'Google2',
                                  'public',
                                  'http://www.google2.be',
                                  [],
                                  [
                                    neverMailUser.user.id,
                                    immediateMailUser.user.id,
                                    dailyMailUser.user.id,
                                    weeklyMailUser.user.id
                                  ],
                                  [],
                                  err => {
                                    assert.ok(!err);

                                    // Collect the e-mails, only the immediate and daily users should've received an e-mail
                                    EmailTestUtil.collectAndFetchAllEmails(messages => {
                                      assert.strictEqual(messages.length, 2);
                                      assert.ok(
                                        _.contains(
                                          [immediateMailUser.user.email, dailyMailUser.user.email],
                                          messages[0].to[0].address
                                        )
                                      );
                                      assert.ok(
                                        _.contains(
                                          [immediateMailUser.user.email, dailyMailUser.user.email],
                                          messages[1].to[0].address
                                        )
                                      );
                                      // Assert that the "weekly" mail user's email contains 1 activity
                                      const dailyMail = _.find(messages, message => {
                                        return message.to[0].address === dailyMailUser.user.email;
                                      });
                                      assert.ok(dailyMail);

                                      // Configure the email collector, so that the email collection window includes
                                      // the weekly but not the daily collection point
                                      refreshConfiguration(null, false, true, {}, () => {
                                        // Trigger an activity
                                        RestAPI.Content.createLink(
                                          simong.restContext,
                                          'Google3',
                                          'Google3',
                                          'public',
                                          'http://www.google3.be',
                                          [],
                                          [
                                            neverMailUser.user.id,
                                            immediateMailUser.user.id,
                                            dailyMailUser.user.id,
                                            weeklyMailUser.user.id
                                          ],
                                          [],
                                          err => {
                                            assert.ok(!err);

                                            // Collect the e-mails, only the immediate and weekly users should've received an e-mail
                                            EmailTestUtil.collectAndFetchAllEmails(messages => {
                                              assert.strictEqual(messages.length, 2);
                                              const mailAddresses = [
                                                immediateMailUser.user.email,
                                                weeklyMailUser.user.email
                                              ];
                                              assert.ok(_.contains(mailAddresses, messages[0].to[0].address));
                                              assert.ok(_.contains(mailAddresses, messages[1].to[0].address));
                                              // Assert that the "weekly" mail user's email contains 1 activity
                                              const weeklyMail = _.find(messages, message => {
                                                return message.to[0].address === weeklyMailUser.user.email;
                                              });
                                              assert.ok(weeklyMail);

                                              // Configure the email collector, so that the email collection window includes
                                              // both the daily and the weekly collection point
                                              refreshConfiguration(null, true, true, {}, () => {
                                                // Trigger an activity
                                                RestAPI.Content.createLink(
                                                  simong.restContext,
                                                  'Google4',
                                                  'Google4',
                                                  'public',
                                                  'http://www.google4.be',
                                                  [],
                                                  [
                                                    neverMailUser.user.id,
                                                    immediateMailUser.user.id,
                                                    dailyMailUser.user.id,
                                                    weeklyMailUser.user.id
                                                  ],
                                                  [],
                                                  err => {
                                                    assert.ok(!err);

                                                    // Collect the e-mails, all users (except the neverMailUser) should've received an e-mail
                                                    EmailTestUtil.collectAndFetchAllEmails(messages => {
                                                      assert.strictEqual(messages.length, 3);
                                                      const mailAddresses = [
                                                        immediateMailUser.user.email,
                                                        dailyMailUser.user.email,
                                                        weeklyMailUser.user.email
                                                      ];
                                                      assert.ok(_.contains(mailAddresses, messages[0].to[0].address));
                                                      assert.ok(_.contains(mailAddresses, messages[1].to[0].address));
                                                      assert.ok(_.contains(mailAddresses, messages[2].to[0].address));

                                                      // Assert that the "weekly" mail user's email contains 1 activity (but is an aggregate of 3)
                                                      const weeklyMail = _.find(messages, message => {
                                                        return message.to[0].address === weeklyMailUser.user.email;
                                                      });
                                                      assert.ok(weeklyMail);
                                                      return callback();
                                                    });
                                                  }
                                                );
                                              });
                                            });
                                          }
                                        );
                                      });
                                    });
                                  }
                                );
                              });
                            });
                          }
                        );
                      });
                    }
                  );
                }
              );
            }
          );
        });
      }
    );
  });

  /**
   * Test that verifies that the default tenant timezone is used when sending emails. We test this
   * by creating 24 tenants, each with a different timezone (1 hour difference between two zones),
   * creating a user in each tenant, triggering an activity for all 24 users, collecting the emails and
   * asserting only one received an e-mail.
   */
  it('verify sending emails uses the configured tenant default timezone', callback => {
    // Enable daily mails
    refreshConfiguration(null, true, false, {}, () => {
      // Gets filled up below with users who are in different tenants each with a different default timezone
      const userIds = [];
      let receivingUser = null;

      // Will be incremented for each tenant we create
      let offset = -13;

      /**
       * Give each tenant a different default timezone, also create a user in each tenant
       */
      const createTenant = function() {
        if (userIds.length === 24) {
          return allTenantsCreated();
        }
        // Create a tenant
        const alias = TenantsTestUtil.generateTestTenantAlias();
        const host = TenantsTestUtil.generateTestTenantHost();
        TestsUtil.createTenantWithAdmin(alias, host, (err, tenant, restContext, user) => {
          assert.ok(!err);

          // Set each user's email preference to daily
          const profile = {
            emailPreference: 'daily'
          };
          RestAPI.User.updateUser(restContext, user.id, profile, err => {
            assert.ok(!err);

            // Set the default timezone for this tenant
            offset++;
            const timezone = 'Etc/GMT' + (offset < 0 ? offset : '+' + offset);
            ConfigTestUtil.updateConfigAndWait(
              restContext,
              null,
              { 'oae-tenants/timezone/timezone': timezone },
              err => {
                assert.ok(!err);
                userIds.push(user.id);
                if (timezone === 'Etc/GMT+0') {
                  receivingUser = user.email;
                }

                return createTenant();
              }
            );
          });
        });
      };

      /**
       * Once all tenants are setup trigger mail to all the users and assert that only one gets sent out
       */
      const allTenantsCreated = function() {
        EmailTestUtil.clearEmailCollections(() => {
          // Create a user who will create the link and add the users thus triggering an email for each one
          TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users, simong) => {
            assert.ok(!err);

            // Trigger a mail for all 24 users
            RestAPI.Content.createLink(
              simong.restContext,
              'Google',
              'Google',
              'public',
              'http://www.google.ca',
              [],
              userIds,
              [],
              err => {
                assert.ok(!err);

                // Only one user should've received an email
                EmailTestUtil.collectAndFetchAllEmails(messages => {
                  assert.strictEqual(messages.length, 1);
                  assert.strictEqual(messages[0].to[0].address, receivingUser);

                  return callback();
                });
              }
            );
          });
        });
      };

      // Start the test by creating the initial tenant
      createTenant();
    });
  });

  /**
   * Test that verifies that emails get delivered when scheduled for a different timezone
   */
  it('verify emails get delivered when scheduled for a different timezone', callback => {
    const alias = TenantsTestUtil.generateTestTenantAlias();
    const host = TenantsTestUtil.generateTestTenantHost();
    TestsUtil.createTenantWithAdmin(alias, host, (err, tenant, restContext) => {
      assert.ok(!err);

      // Configure the default timezone to something that's 5 hours behind
      ConfigTestUtil.updateConfigAndWait(restContext, null, { 'oae-tenants/timezone/timezone': 'Etc/GMT+5' }, err => {
        assert.ok(!err);

        // Generate some users that we can test with
        TestsUtil.generateTestUsers(restContext, 2, (err, users, simong, nico) => {
          assert.ok(!err);

          // Change Nico's email preference so he gets daily aggregates
          RestAPI.User.updateUser(nico.restContext, nico.user.id, { emailPreference: 'daily' }, err => {
            assert.ok(!err);

            // Configure the mail collector so daily mails are collected 5 hours later relative to Nico's timezone
            refreshConfiguration('Etc/GMT+5', false, false, {}, config => {
              // Trigger a mail for Nico
              RestAPI.Content.createLink(
                simong.restContext,
                'Google',
                'Google',
                'public',
                'http://www.google.ca',
                [],
                [nico.user.id],
                [],
                err => {
                  assert.ok(!err);

                  // As the hour was set to 5hrs after Nico's current time, he should not receive an email yet
                  EmailTestUtil.collectAndFetchAllEmails(messages => {
                    assert.strictEqual(messages.length, 0);

                    // If we manually collect the daily emails that are scheduled 5 hours ahead of the the UTC-5 timezone, Nico's mail should be sent out
                    const hours = (24 + config.mail.daily.hour - 5) % 24;
                    ActivityEmail.collectMails(0, 'daily', null, hours, (err, empty, users) => {
                      assert.ok(!err);
                      assert.strictEqual(users.length, 1);
                      assert.strictEqual(users[0].id, nico.user.id);
                      return callback();
                    });
                  });
                }
              );
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies the weekly emails can handle day rollovers due to timezones
   */
  it('verify weekly collections can handle day rollovers due to timezones', callback => {
    // Configure the email collector so emails arrive at a user their inbox at 1am on Tuesday
    let config = {
      mail: {
        pollingFrequency: 60 * 60,
        gracePeriod: 0,
        daily: { hour: 1 },
        weekly: { hour: 1, day: 3 }
      }
    };
    ActivityTestUtil.refreshConfiguration(config, err => {
      assert.ok(!err);

      // Create a test tenant
      const alias = TenantsTestUtil.generateTestTenantAlias();
      const host = TenantsTestUtil.generateTestTenantHost();
      TestsUtil.createTenantWithAdmin(alias, host, (err, tenant, restContext) => {
        assert.ok(!err);

        // Generate some users that we can test with
        TestsUtil.generateTestUsers(restContext, 2, (err, users, simong, nico) => {
          assert.ok(!err);

          // Change Nico's email preference so he gets weekly emails
          RestAPI.User.updateUser(nico.restContext, nico.user.id, { emailPreference: 'weekly' }, err => {
            assert.ok(!err);

            // Configure the default timezone to something that's 5 hours ahead
            ConfigTestUtil.updateConfigAndWait(
              restContext,
              null,
              { 'oae-tenants/timezone/timezone': 'Etc/GMT+5' },
              err => {
                assert.ok(!err);

                // Trigger a mail for Nico
                RestAPI.Content.createLink(
                  simong.restContext,
                  'Google',
                  'Google',
                  'public',
                  'http://www.google.ca',
                  [],
                  [nico.user.id],
                  [],
                  err => {
                    assert.ok(!err);

                    // Give some time to let the activity route to the correct streams
                    ActivityTestUtil.collectAndGetActivityStream(nico.restContext, nico.user.id, null, err => {
                      assert.ok(!err);

                      // As the collector is in the UTC timezone, Nico in UTC+5 and mails should be in the user their
                      // inbox at 1am on Tuesday, we should send out an email at 20h UTC on Monday
                      ActivityEmail.collectMails(0, 'weekly', 2, 20, (err, empty, users) => {
                        assert.ok(!err);
                        assert.strictEqual(users.length, 1);
                        assert.ok(
                          _.find(users, user => {
                            return nico.user.id === user.id;
                          })
                        );

                        // Assert that roll overs to the next day work too by configuring the collector so emails end up
                        // in users their email inbox at 23h on Tuesday
                        config = {
                          mail: {
                            pollingFrequency: 60 * 60,
                            gracePeriod: 0,
                            daily: { hour: 1 },
                            weekly: { hour: 23, day: 3 }
                          }
                        };
                        ActivityTestUtil.refreshConfiguration(config, err => {
                          assert.ok(!err);

                          // Configure the default timezone to something that's 5 hours behind
                          ConfigTestUtil.updateConfigAndWait(
                            restContext,
                            null,
                            { 'oae-tenants/timezone/timezone': 'Etc/GMT-5' },
                            err => {
                              assert.ok(!err);

                              // Trigger a mail for Nico
                              RestAPI.Content.createLink(
                                simong.restContext,
                                'Google',
                                'Google',
                                'public',
                                'http://www.google.ca',
                                [],
                                [nico.user.id],
                                [],
                                err => {
                                  assert.ok(!err);

                                  // Give some time to let the activity route to the correct streams
                                  ActivityTestUtil.collectAndGetActivityStream(
                                    nico.restContext,
                                    nico.user.id,
                                    null,
                                    err => {
                                      assert.ok(!err);

                                      // As the collector is in the UTC timezone, Nico in UTC-5 and mails should be in the user their
                                      // inbox at 23h on Wednesday, we should send out an email at 4am UTC on Thursday
                                      ActivityEmail.collectMails(0, 'weekly', 4, 4, (err, empty, users) => {
                                        assert.ok(!err);
                                        assert.strictEqual(users.length, 1);
                                        assert.ok(
                                          _.find(users, user => {
                                            return nico.user.id === user.id;
                                          })
                                        );
                                        return callback();
                                      });
                                    }
                                  );
                                }
                              );
                            }
                          );
                        });
                      });
                    });
                  }
                );
              }
            );
          });
        });
      });
    });
  });

  /**
   * Test that verifies that day rollovers due to timezones does not affect daily collections
   */
  it('verify that day rollovers due to timezones does not affect daily collections', callback => {
    // Configure the email collector so emails arrive at a user their inbox at 1am on Tueday
    let config = {
      mail: {
        pollingFrequency: 60 * 60,
        gracePeriod: 0,
        daily: { hour: 1 },
        weekly: { hour: 1, day: 3 }
      }
    };
    ActivityTestUtil.refreshConfiguration(config, err => {
      assert.ok(!err);

      // Create a test tenant
      const alias = TenantsTestUtil.generateTestTenantAlias();
      const host = TenantsTestUtil.generateTestTenantHost();
      TestsUtil.createTenantWithAdmin(alias, host, (err, tenant, restContext) => {
        assert.ok(!err);

        // Generate some users that we can test with
        TestsUtil.generateTestUsers(restContext, 2, (err, users, simong, nico) => {
          assert.ok(!err);

          // Change Nico's email preference so he gets daily emails
          RestAPI.User.updateUser(nico.restContext, nico.user.id, { emailPreference: 'daily' }, err => {
            assert.ok(!err);

            // Configure the default timezone to something that's 5 hours ahead
            ConfigTestUtil.updateConfigAndWait(
              restContext,
              null,
              { 'oae-tenants/timezone/timezone': 'Etc/GMT+5' },
              err => {
                assert.ok(!err);

                // Trigger a mail for Nico
                RestAPI.Content.createLink(
                  simong.restContext,
                  'Google',
                  'Google',
                  'public',
                  'http://www.google.ca',
                  [],
                  [nico.user.id],
                  [],
                  (err, link) => {
                    assert.ok(!err);

                    // Give some time to let the activity route to the correct streams
                    ActivityTestUtil.collectAndGetActivityStream(nico.restContext, nico.user.id, null, err => {
                      assert.ok(!err);

                      // As the collector is in the UTC timezone, Nico in UTC+5 and mails should be in the user their
                      // inbox at 1am, we should send out an email at 20h UTC
                      ActivityEmail.collectMails(0, 'daily', null, 20, (err, empty, users) => {
                        assert.ok(!err);
                        assert.strictEqual(users.length, 1);
                        assert.strictEqual(users[0].id, nico.user.id);

                        // Configure the email collector so emails arrive at a user their inbox at 1am on Tueday
                        config = {
                          mail: {
                            pollingFrequency: 60 * 60,
                            gracePeriod: 0,
                            daily: { hour: 23 },
                            weekly: { hour: 1, day: 3 }
                          }
                        };
                        ActivityTestUtil.refreshConfiguration(config, err => {
                          assert.ok(!err);

                          // Configure the default timezone to something that's 5 hours behind
                          ConfigTestUtil.updateConfigAndWait(
                            restContext,
                            null,
                            { 'oae-tenants/timezone/timezone': 'Etc/GMT-5' },
                            err => {
                              assert.ok(!err);

                              // Trigger a mail for Nico
                              RestAPI.Content.createLink(
                                simong.restContext,
                                'Google',
                                'Google',
                                'public',
                                'http://www.google.ca',
                                [],
                                [nico.user.id],
                                [],
                                (err, link) => {
                                  assert.ok(!err);

                                  // Give some time to let the activity route to the correct streams
                                  ActivityTestUtil.collectAndGetActivityStream(
                                    nico.restContext,
                                    nico.user.id,
                                    null,
                                    err => {
                                      assert.ok(!err);

                                      // As the collector is in the UTC timezone, Nico in UTC-5 and mails should be in the user their
                                      // inbox at 23h, we should send out an email at 4am UTC
                                      ActivityEmail.collectMails(0, 'daily', null, 4, (err, empty, users) => {
                                        assert.ok(!err);
                                        assert.strictEqual(users.length, 1);
                                        assert.strictEqual(users[0].id, nico.user.id);
                                        return callback();
                                      });
                                    }
                                  );
                                }
                              );
                            }
                          );
                        });
                      });
                    });
                  }
                );
              }
            );
          });
        });
      });
    });
  });

  /**
   * Test that verifies that activity emails are not delivered to users who have deleted their
   * profiles
   */
  it('verify email is not delivered to users who have since deleted their profile', callback => {
    // Create a user to perform actions (simong) and one to receive emails
    // (mrvisser) through a group
    TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, mrvisser, simong, nico) => {
      assert.ok(!err);
      PrincipalsTestUtil.assertCreateGroupSucceeds(
        mrvisser.restContext,
        'displayName',
        'description',
        'public',
        'yes',
        [nico.user.id],
        null,
        group => {
          const expectedRecipients = [mrvisser.user.email, nico.user.email].sort();

          // Ensure we have no emails queued to send
          EmailTestUtil.collectAndFetchAllEmails(() => {
            // Generate an email activity for the group, ensuring both mrvisser and nico receive it
            ContentTestUtil.assertCreateLinkSucceeds(
              simong.restContext,
              'displayName',
              'description',
              'public',
              'http://www.google.ca/firstlink',
              null,
              [group.id],
              null,
              link1 => {
                EmailTestUtil.collectAndFetchAllEmails(messages => {
                  assert.strictEqual(messages.length, 2);

                  // Ensure the 2 recipients are mrvisser and nico
                  const recipients = _.chain(messages)
                    .pluck('headers')
                    .pluck('to')
                    .value()
                    .sort();
                  assert.deepStrictEqual(recipients, expectedRecipients);

                  // Delete mrvisser and ensure the same action results in only nico receiving the email
                  PrincipalsTestUtil.assertDeleteUserSucceeds(
                    camAdminRestContext,
                    camAdminRestContext,
                    mrvisser.user.id,
                    () => {
                      ContentTestUtil.assertCreateLinkSucceeds(
                        simong.restContext,
                        'displayName',
                        'description',
                        'public',
                        'http://www.google.ca/firstlink',
                        null,
                        [group.id],
                        null,
                        link2 => {
                          EmailTestUtil.collectAndFetchAllEmails(messages => {
                            assert.strictEqual(messages.length, 1);
                            assert.strictEqual(messages[0].headers.to, nico.user.email);

                            // Restore mrvisser and ensure the same action once again results in an email to both
                            // mrvisser and nico
                            PrincipalsTestUtil.assertRestoreUserSucceeds(camAdminRestContext, mrvisser.user.id, () => {
                              ContentTestUtil.assertCreateLinkSucceeds(
                                simong.restContext,
                                'displayName',
                                'description',
                                'public',
                                'http://www.google.ca/firstlink',
                                null,
                                [group.id],
                                null,
                                link2 => {
                                  EmailTestUtil.collectAndFetchAllEmails(messages => {
                                    assert.strictEqual(messages.length, 2);

                                    // Ensure the 2 recipients are mrvisser and nico
                                    const recipients = _.chain(messages)
                                      .pluck('headers')
                                      .pluck('to')
                                      .value()
                                      .sort();
                                    assert.deepStrictEqual(recipients, expectedRecipients);

                                    return callback();
                                  });
                                }
                              );
                            });
                          });
                        }
                      );
                    }
                  );
                });
              }
            );
          });
        }
      );
    });
  });

  /**
   * Test that verifies that old activities are not included in an immediate email when they are not situated in the email interval
   */
  it('verify old activities in the email stream are not included for immediate emails', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 4, (err, users, mrvisser, simong) => {
      assert.ok(!err);

      // Set the appropriate email preference for mrvisser
      RestAPI.User.updateUser(mrvisser.restContext, mrvisser.user.id, { emailPreference: 'immediate' }, err => {
        assert.ok(!err);

        // Generate an email activity for mrvisser at the current time
        RestAPI.Content.createLink(
          simong.restContext,
          'Google',
          'Awesome Google',
          'public',
          'http://www.google.ca',
          [],
          [mrvisser.user.id],
          [],
          (err, linkNow) => {
            assert.ok(!err);

            // Deliver the activity
            ActivityTestUtil.collectAndGetActivityStream(mrvisser.restContext, null, null, err => {
              assert.ok(!err);

              // Generate an email activity for mrvisser 3 hours in the future by monkey-patching the `Date.now` function
              const now = Date.now();
              Date.now = function() {
                return now + 5 * 60 * 60 * 1000;
              };

              RestAPI.Content.createLink(
                simong.restContext,
                'Yahoo',
                'Awesome Yahoo',
                'public',
                'http://www.yahoo.ca',
                [],
                [mrvisser.user.id],
                [],
                (err, linkLater) => {
                  assert.ok(!err);

                  // Collect the email as though it is 3 hours ahead. Ensure only the later content item email gets sent to mrvisser
                  EmailTestUtil.collectAndFetchEmailsForBucket(0, 'immediate', null, null, messages => {
                    assert.ok(!err);
                    assert.strictEqual(messages.length, 1);
                    assert.strictEqual(messages[0].to[0].address, mrvisser.user.email);

                    // Ensure the email contains the more recent content item but not the one that is too far in the past
                    assert.notStrictEqual(messages[0].html.indexOf(linkLater.displayName), -1);
                    assert.strictEqual(messages[0].html.indexOf(linkNow.displayName), -1);

                    // Reset the Date.now function and then recollect to ensure we can still send the original email
                    Date.now = _originalDateNow;

                    // Schedule an email collection for mrvisser again
                    RestAPI.Content.createLink(
                      simong.restContext,
                      'AltaWhat?',
                      'AltaWhat?',
                      'public',
                      'http://www.altavista.ca',
                      [],
                      [mrvisser.user.id],
                      [],
                      (err, linkNow2) => {
                        assert.ok(!err);

                        // Collect the email for the current time and ensure we get the 2 "now" items
                        EmailTestUtil.collectAndFetchEmailsForBucket(0, 'immediate', null, null, messages => {
                          assert.ok(!err);
                          assert.strictEqual(messages.length, 1);
                          assert.strictEqual(messages[0].to[0].address, mrvisser.user.email);

                          // Ensure the email contains the more recent content item but not the one that is too far in the past
                          assert.strictEqual(messages[0].html.indexOf(linkLater.displayName), -1);
                          assert.notStrictEqual(messages[0].html.indexOf(linkNow.displayName), -1);
                          assert.notStrictEqual(messages[0].html.indexOf(linkNow2.displayName), -1);
                          return callback();
                        });
                      }
                    );
                  });
                }
              );
            });
          }
        );
      });
    });
  });

  /**
   * Test that verifies that old activities are not included in an daily email when they are not situated in the email interval
   */
  it('verify old activities in the email stream are not included for daily emails', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 4, (err, users, mrvisser, simong) => {
      assert.ok(!err);

      refreshConfiguration(null, true, false, null, config => {
        // Set the appropriate email preference for mrvisser
        RestAPI.User.updateUser(mrvisser.restContext, mrvisser.user.id, { emailPreference: 'daily' }, err => {
          assert.ok(!err);

          // Generate an email activity for mrvisser at the current time
          RestAPI.Content.createLink(
            simong.restContext,
            'Google',
            'Awesome Google',
            'public',
            'http://www.google.ca',
            [],
            [mrvisser.user.id],
            [],
            (err, linkNow) => {
              assert.ok(!err);

              // Deliver the activity
              ActivityTestUtil.collectAndGetActivityStream(mrvisser.restContext, null, null, err => {
                assert.ok(!err);

                // Generate an email activity for mrvisser 2 days in the future by monkey-patching the `Date.now` function
                const now = Date.now();
                Date.now = function() {
                  return now + 2 * 24 * 60 * 60 * 1000;
                };

                RestAPI.Content.createLink(
                  simong.restContext,
                  'Yahoo',
                  'Awesome Yahoo',
                  'public',
                  'http://www.yahoo.ca',
                  [],
                  [mrvisser.user.id],
                  [],
                  (err, linkLater) => {
                    assert.ok(!err);

                    // Collect the email as though it is 2 days ahead. Ensure only the later content item email gets sent to mrvisser
                    EmailTestUtil.collectAndFetchEmailsForBucket(0, 'daily', null, config.mail.daily.hour, messages => {
                      assert.ok(!err);
                      assert.strictEqual(messages.length, 1);
                      assert.strictEqual(messages[0].to[0].address, mrvisser.user.email);

                      // Ensure the email contains the more recent content item but not the one that is too far in the past
                      assert.notStrictEqual(messages[0].html.indexOf(linkLater.displayName), -1);
                      assert.strictEqual(messages[0].html.indexOf(linkNow.displayName), -1);

                      // Reset the Date.now function and then recollect to ensure we can still send the original email
                      Date.now = _originalDateNow;

                      // Schedule an email collection for mrvisser again
                      RestAPI.Content.createLink(
                        simong.restContext,
                        'AltaWhat?',
                        'AltaWhat?',
                        'public',
                        'http://www.altavista.ca',
                        [],
                        [mrvisser.user.id],
                        [],
                        (err, linkNow2) => {
                          assert.ok(!err);

                          // Collect the email for the current time and ensure we get the 2 "now" items
                          EmailTestUtil.collectAndFetchEmailsForBucket(
                            0,
                            'daily',
                            null,
                            config.mail.daily.hour,
                            messages => {
                              assert.ok(!err);
                              assert.strictEqual(messages.length, 1);
                              assert.strictEqual(messages[0].to[0].address, mrvisser.user.email);

                              // Ensure the email contains the more recent content item but not the one that is too far in the past
                              assert.strictEqual(messages[0].html.indexOf(linkLater.displayName), -1);
                              assert.notStrictEqual(messages[0].html.indexOf(linkNow.displayName), -1);
                              assert.notStrictEqual(messages[0].html.indexOf(linkNow2.displayName), -1);
                              return callback();
                            }
                          );
                        }
                      );
                    });
                  }
                );
              });
            }
          );
        });
      });
    });
  });

  /**
   * Test that verifies that old activities are not included in an weekly email when they are not situated in the email interval
   */
  it('verify old activities in the email stream are not included for weekly emails', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 4, (err, users, mrvisser, simong) => {
      assert.ok(!err);

      refreshConfiguration(null, false, true, null, config => {
        // Set the appropriate email preference for mrvisser
        RestAPI.User.updateUser(mrvisser.restContext, mrvisser.user.id, { emailPreference: 'weekly' }, err => {
          assert.ok(!err);

          // Generate an email activity for mrvisser at the current time
          RestAPI.Content.createLink(
            simong.restContext,
            'Google',
            'Awesome Google',
            'public',
            'http://www.google.ca',
            [],
            [mrvisser.user.id],
            [],
            (err, linkNow) => {
              assert.ok(!err);

              // Deliver the activity
              ActivityTestUtil.collectAndGetActivityStream(mrvisser.restContext, null, null, err => {
                assert.ok(!err);

                // Generate an email activity for mrvisser 2 weeks in the future by monkey-patching the `Date.now` function
                const now = Date.now();
                Date.now = function() {
                  return now + 2 * 7 * 24 * 60 * 60 * 1000;
                };

                RestAPI.Content.createLink(
                  simong.restContext,
                  'Yahoo',
                  'Awesome Yahoo',
                  'public',
                  'http://www.yahoo.ca',
                  [],
                  [mrvisser.user.id],
                  [],
                  (err, linkLater) => {
                    assert.ok(!err);

                    // Collect the email as though it is 2 weeks ahead. Ensure only the later content item email gets sent to mrvisser
                    EmailTestUtil.collectAndFetchEmailsForBucket(
                      0,
                      'weekly',
                      config.mail.weekly.day,
                      config.mail.weekly.hour,
                      messages => {
                        assert.ok(!err);
                        assert.strictEqual(messages.length, 1);
                        assert.strictEqual(messages[0].to[0].address, mrvisser.user.email);

                        // Ensure the email contains the more recent content item but not the one that is too far in the past
                        assert.notStrictEqual(messages[0].html.indexOf(linkLater.displayName), -1);
                        assert.strictEqual(messages[0].html.indexOf(linkNow.displayName), -1);

                        // Reset the Date.now function and then recollect to ensure we can still send the original email
                        Date.now = _originalDateNow;

                        // Schedule an email collection for mrvisser again
                        RestAPI.Content.createLink(
                          simong.restContext,
                          'AltaWhat?',
                          'AltaWhat?',
                          'public',
                          'http://www.altavista.ca',
                          [],
                          [mrvisser.user.id],
                          [],
                          (err, linkNow2) => {
                            assert.ok(!err);

                            // Collect the email for the current time and ensure we get the 2 "now" items
                            EmailTestUtil.collectAndFetchEmailsForBucket(
                              0,
                              'weekly',
                              config.mail.weekly.day,
                              config.mail.weekly.hour,
                              messages => {
                                assert.ok(!err);
                                assert.strictEqual(messages.length, 1);
                                assert.strictEqual(messages[0].to[0].address, mrvisser.user.email);

                                // Ensure the email contains the more recent content item but not the one that is too far in the past
                                assert.strictEqual(messages[0].html.indexOf(linkLater.displayName), -1);
                                assert.notStrictEqual(messages[0].html.indexOf(linkNow.displayName), -1);
                                assert.notStrictEqual(messages[0].html.indexOf(linkNow2.displayName), -1);
                                return callback();
                              }
                            );
                          }
                        );
                      }
                    );
                  }
                );
              });
            }
          );
        });
      });
    });
  });

  /**
   * Test that verifies that the email subject is translated and depends on the activities/email preference
   */
  it('verify email subject headers', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 4, (err, users, simong, nico, branden, bert) => {
      assert.ok(!err);

      RestAPI.User.updateUser(branden.restContext, branden.user.id, { emailPreference: 'daily' }, err => {
        assert.ok(!err);
        RestAPI.User.updateUser(bert.restContext, bert.user.id, { emailPreference: 'weekly' }, err => {
          assert.ok(!err);

          // Enable daily and weekly mails
          refreshConfiguration(null, true, true, {}, config => {
            // Trigger a mail for Nico
            RestAPI.Content.createLink(
              simong.restContext,
              'Google',
              'Google',
              'public',
              'http://www.google.ca',
              [],
              [nico.user.id],
              [],
              (err, link) => {
                assert.ok(!err);
                EmailTestUtil.collectAndFetchAllEmails(messages => {
                  assert.strictEqual(messages.length, 1);

                  // Assert that we're using a localized message for the subject header
                  const mail = messages[0];
                  assert.strictEqual(mail.subject.indexOf('__MSG__'), -1);

                  // The message can change, but the actor's and object's displayname will usually be in there
                  assert.ok(mail.subject.indexOf(simong.user.displayName) !== -1);
                  assert.ok(mail.subject.indexOf(link.displayName) !== -1);

                  // Trigger a mail that contains two different activities
                  RestAPI.Content.createLink(
                    simong.restContext,
                    'Google',
                    'Google',
                    'public',
                    'http://www.google.ca',
                    [],
                    [nico.user.id],
                    [],
                    (err, secondLink) => {
                      assert.ok(!err);
                      RestAPI.Discussions.createDiscussion(
                        simong.restContext,
                        'First discussion',
                        'descr',
                        'public',
                        null,
                        [nico.user.id],
                        (err, firstDiscussion) => {
                          assert.ok(!err);

                          // Collect the e-mail, there should only be one
                          EmailTestUtil.collectAndFetchAllEmails(messages => {
                            assert.strictEqual(messages.length, 1);

                            // Assert that we're using a localized message for the subject header
                            const secondMail = messages[0];
                            assert.strictEqual(secondMail.subject.indexOf('__MSG__'), -1);

                            // Assert that this mail's subject is different from the initial mail as it spans two activities
                            assert.notStrictEqual(mail.subject, secondMail.subject);

                            // Trigger a mail for Branden and Bert
                            RestAPI.Content.createLink(
                              simong.restContext,
                              'Google',
                              'Google',
                              'public',
                              'http://www.google.ca',
                              [],
                              [branden.user.id, bert.user.id],
                              [],
                              (err, thirdLink) => {
                                assert.ok(!err);
                                EmailTestUtil.collectAndFetchAllEmails(messages => {
                                  assert.strictEqual(messages.length, 2);

                                  // Assert that the two subject headers are different as they have different email preferences
                                  const brandenMessage = _.find(messages, message => {
                                    return message.to[0].address === branden.user.email;
                                  });
                                  const bertMessage = _.find(messages, message => {
                                    return message.to[0].address === bert.user.email;
                                  });
                                  assert.notStrictEqual(brandenMessage.subject, bertMessage.subject);
                                  return callback();
                                });
                              }
                            );
                          });
                        }
                      );
                    }
                  );
                });
              }
            );
          });
        });
      });
    });
  });

  /**
   * Test that verifies that the email content supports Markdown comments
   */
  it('verify email markdown parsing', callback => {
    // Create users for the test
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, user1, user2) => {
      assert.ok(!err);

      // Make sure that the first user receives email messages
      RestAPI.User.updateUser(user1.restContext, user1.user.id, { emailPreference: 'immediate' }, err => {
        assert.ok(!err);

        // Create a discussion on which to comment
        RestAPI.Discussions.createDiscussion(
          user1.restContext,
          'Test Discussion',
          'Test Description',
          'public',
          null,
          [user2.user.id],
          (err, discussion) => {
            assert.ok(!err);

            // Add a comment to the discussion
            const markdownBody = [
              'Link: [OAE](http://oaeproject.org)',
              '',
              'OAE Link: http://' + global.oaeTests.tenants.cam.host + '/content/cam/foo',
              '',
              'Image: ![Alternate Text](http://www.oaeproject.org/themes/oae/logo.png)',
              '',
              '- Bullet Item',
              '',
              '_Emphasized Text_',
              '',
              '**Strong Text**',
              '',
              '`Preformatted Text`',
              '',
              '# First Level Heading',
              '',
              'Paragraph with',
              'line break',
              '',
              '<script>alert("XSS attack")</script>'
            ].join('\n');

            const htmlBody = [
              '<p',
              /* Style inserted here */ '>Link: <a\n href="http://oaeproject.org"',
              /* Style inserted here */ '>OAE</a></p>',
              '<p',
              /* Style inserted here */ '>OAE Link: <a\n href="http://' +
                global.oaeTests.tenants.cam.host +
                '/content/cam/foo"',
              /* Style inserted here */ '>/content/cam/foo</a></p>',
              '<p',
              /* Style inserted here */ '>Image: <img\n src="http://www.oaeproject.org/themes/oae/logo.png"\n alt="Alternate Text"\n style="',
              '<ul',
              /* Style inserted here */ '>',
              '<li>Bullet Item</li>',
              '</ul>',
              '<p',
              /* Style inserted here */ '><em>Emphasized Text</em></p>',
              '<p',
              /* Style inserted here */ '><strong>Strong Text</strong></p>',
              '<p',
              /* Style inserted here */ '><code',
              /* Style inserted here */ '>Preformatted Text</code></p>',
              '<h1',
              /* Style inserted here */ '>First Level Heading</h1>',
              '<p',
              /* Style inserted here */ '>Paragraph with<br>line break</p>',
              '<p',
              /* Style inserted here */ '>&lt;script&gt;alert(&quot;XSS attack&quot;)&lt;/script&gt;</p>'
            ];

            RestAPI.Discussions.createMessage(user2.restContext, discussion.id, markdownBody, null, (err, comment) => {
              assert.ok(!err);

              // Get the resulting email notification
              EmailTestUtil.collectAndFetchAllEmails(messages => {
                // Find the email message for the first user
                const mail = _.find(messages, message => {
                  return message.to[0].address === user1.user.email;
                });
                assert.ok(mail);

                // Verify all the expected HTML content is present in the message
                _.each(htmlBody, htmlFragment => {
                  assert.notStrictEqual(mail.html.indexOf(htmlFragment), -1, htmlFragment);
                });

                return callback();
              });
            });
          }
        );
      });
    });
  });

  /**
   * Test that verifies that dates in email are in the tenant timezone
   */
  it('verify email date timezones', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, simong, nico) => {
      assert.ok(!err);

      const alias = TenantsTestUtil.generateTestTenantAlias();
      const host = TenantsTestUtil.generateTestTenantHost();
      TestsUtil.createTenantWithAdmin(alias, host, (err, tenant, restContext, admin) => {
        assert.ok(!err);

        TestsUtil.generateTestUsers(restContext, 1, (err, users, bert) => {
          assert.ok(!err);

          // Configure the default timezone to something that's 5 hours behind
          ConfigTestUtil.updateConfigAndWait(
            restContext,
            null,
            { 'oae-tenants/timezone/timezone': 'Etc/GMT+5' },
            err => {
              assert.ok(!err);

              // Trigger a mail for Nico and Bert
              RestAPI.Content.createLink(
                simong.restContext,
                'Google',
                'Google',
                'public',
                'http://www.google.ca',
                [],
                [nico.user.id, bert.user.id],
                [],
                (err, link) => {
                  assert.ok(!err);
                  EmailTestUtil.collectAndFetchAllEmails(messages => {
                    assert.strictEqual(messages.length, 2);

                    // Assert that the messages contain properly formatted dates
                    const utcMessage = _.find(messages, message => {
                      return message.to[0].address === nico.user.email;
                    });
                    const plus5Message = _.find(messages, message => {
                      return message.to[0].address === bert.user.email;
                    });

                    // Parse the dates out of the messages
                    const utcDate = utcMessage.html.match(/\d\d\d\d-\d\d-\d\d \d\d:\d\d:\d\d/g)[0];
                    const plus5Date = plus5Message.html.match(/\d\d\d\d-\d\d-\d\d \d\d:\d\d:\d\d/g)[0];

                    // Assert that the offsets are correct
                    const utcHour = parseInt(utcDate.substr(11, 2), 10);
                    const plus5Hour = parseInt(plus5Date.substr(11, 2), 10);
                    assert.strictEqual((utcHour + 5) % 24, plus5Hour);
                    return callback();
                  });
                }
              );
            }
          );
        });
      });
    });
  });

  /**
   * Test that verifies that marking notifications only clears the email stream when the user’s email preference is set to immediate.
   */
  it('verify marking the notifications only clears emails when the email preference is set to immediate', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 5, (err, users, simong, nico, branden, bert, stuart) => {
      assert.ok(!err);

      // Give our 4 recipients different email preferences
      RestAPI.User.updateUser(nico.restContext, nico.user.id, { emailPreference: 'immediate' }, err => {
        assert.ok(!err);
        RestAPI.User.updateUser(branden.restContext, branden.user.id, { emailPreference: 'daily' }, err => {
          assert.ok(!err);
          RestAPI.User.updateUser(bert.restContext, bert.user.id, { emailPreference: 'weekly' }, err => {
            assert.ok(!err);
            RestAPI.User.updateUser(stuart.restContext, stuart.user.id, { emailPreference: 'never' }, err => {
              assert.ok(!err);

              // The next email collection cycle should handle immediate, daily and weekly deliveries
              refreshConfiguration(null, true, true, {}, config => {
                // Trigger an email-worthy activity for our recipients
                RestAPI.Content.createLink(
                  simong.restContext,
                  'Google',
                  'Google',
                  'public',
                  'http://www.google.ca',
                  [],
                  [nico.user.id, branden.user.id, bert.user.id, stuart.user.id],
                  [],
                  err => {
                    assert.ok(!err);

                    // Deliver the activities
                    ActivityTestUtil.collectAndGetActivityStream(
                      nico.restContext,
                      null,
                      null,
                      (err, activityStream) => {
                        assert.ok(!err);

                        // Let each user mark his notifications as read
                        ActivityTestUtil.markNotificationsAsRead(nico.restContext, () => {
                          ActivityTestUtil.markNotificationsAsRead(branden.restContext, result => {
                            ActivityTestUtil.markNotificationsAsRead(bert.restContext, result => {
                              ActivityTestUtil.markNotificationsAsRead(stuart.restContext, result => {
                                // Deliver the e-mails, only Branden and Bert should get an e-mail as stuart has
                                // selected to never get emails and Nico his activity email stream should've been
                                // cleared when he marked his notifications as read
                                EmailTestUtil.collectAndFetchAllEmails(messages => {
                                  assert.strictEqual(messages.length, 2);
                                  _.each(messages, message => {
                                    assert.ok(_.contains([branden.user.email, bert.user.email], message.to[0].address));
                                  });

                                  return callback();
                                });
                              });
                            });
                          });
                        });
                      }
                    );
                  }
                );
              });
            });
          });
        });
      });
    });
  });

  /**
   * Test that verifies that when a user changing his email preference, he does not get double emails
   */
  it('verify changing the email preference does not result in double emails', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, simong, nico) => {
      assert.ok(!err);

      // The next email collection cycle should only handle `immediate` deliveries
      refreshConfiguration(null, false, false, {}, config => {
        // Trigger an email
        RestAPI.Content.createLink(
          simong.restContext,
          'Google',
          'Google',
          'public',
          'http://www.google.ca',
          [],
          [nico.user.id],
          [],
          (err, link) => {
            assert.ok(!err);

            // Run an activity collection, which will queue an immediate email for Nico
            ActivityTestUtil.collectAndGetActivityStream(nico.restContext, null, null, (err, activityStream) => {
              assert.ok(!err);

              // Change Nico's email preference to daily
              RestAPI.User.updateUser(nico.restContext, nico.user.id, { emailPreference: 'daily' }, err => {
                assert.ok(!err);
              });

              ActivityAPI.emitter.once(ActivityConstants.events.UPDATED_USER, () => {
                // When we collect the emails, Nico should not get an email
                EmailTestUtil.collectAndFetchAllEmails(messages => {
                  assert.strictEqual(messages.length, 0);

                  // Sanity check that Nico gets the email when the dailies are sent out
                  ActivityEmail.collectMails(0, 'daily', null, config.mail.daily.hour, (err, empty, users) => {
                    assert.ok(!err);
                    assert.strictEqual(users.length, 1);
                    assert.strictEqual(users[0].id, nico.user.id);
                    return callback();
                  });
                });
              });
            });
          }
        );
      });
    });
  });

  /**
   * Test that verifies that user who change their email preference to never don't get any emails
   */
  it('verify changing the email preference to never results in no mail', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, simong, nico) => {
      assert.ok(!err);

      // The next email collection cycle should only handle `immediate` deliveries
      refreshConfiguration(null, false, false, {}, config => {
        // Assert that the user was still receiving emails (by virtue of the default being `immediate`)
        RestAPI.Content.createLink(
          simong.restContext,
          'Google',
          'Google',
          'public',
          'http://www.google.ca',
          [],
          [nico.user.id],
          [],
          (err, link) => {
            assert.ok(!err);

            // When we collect the emails, Nico should get an email
            EmailTestUtil.collectAndFetchAllEmails(messages => {
              assert.strictEqual(messages.length, 1);

              // Now change Nico's preference to never
              RestAPI.User.updateUser(nico.restContext, nico.user.id, { emailPreference: 'never' }, err => {
                assert.ok(!err);

                // Try to trigger an email
                RestAPI.Content.createLink(
                  simong.restContext,
                  'Google',
                  'Google',
                  'public',
                  'http://www.google.ca',
                  [],
                  [nico.user.id],
                  [],
                  (err, link) => {
                    assert.ok(!err);

                    // When we collect the emails, Nico should get an email
                    EmailTestUtil.collectAndFetchAllEmails(messages => {
                      assert.strictEqual(messages.length, 0);
                      return callback();
                    });
                  }
                );
              });
            });
          }
        );
      });
    });
  });

  /**
   * Test that verifies when two activities that contain aggregates and who can aggregate
   * when sending mail, do actually aggregate. This can occur when a user has selected
   * the `weekly` mail preference in the following scenario:
   *  - Weekly mails are sent out on sunday
   *  - Activities can only aggregate when they happen within 24 hours of each other (aggregateIdleExpiry = 1 day)
   *  - The user receives two activities (A and B) that aggregate on Monday
   *  - The user receives two more activities (C and D) on Thursday that could aggregate with A and B but don't
   *    as there is more than 1 day in between them
   *
   * Expected behaviour:
   *  - When a user views his activity stream he should see 2 distinct activities, each containing 2 aggregates
   *      - Activity 1 contains A and B, activity 2 contains B and C
   *  - When a user receives his weekly email, he should see 1 activity containing all 4 aggregates
   */
  it('verify two distinct aggregated activities aggregate during email collection', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, simong, nico, branden) => {
      assert.ok(!err);

      // Set the aggregate expiry time to 1 second. This should give us enough time to aggregate 2 activities, wait for expiry, then create 2 more
      refreshConfiguration(null, false, false, { collectionPollingFrequency: -1, aggregateIdleExpiry: 1 }, config => {
        RestAPI.Content.createLink(
          simong.restContext,
          'Link A',
          'Link A',
          'public',
          'http://www.google.com',
          [],
          [],
          [],
          (err, contentObj) => {
            assert.ok(!err);
            RestAPI.Content.createComment(nico.restContext, contentObj.id, 'Comment A', null, (err, commentA) => {
              assert.ok(!err);
              RestAPI.Content.createComment(branden.restContext, contentObj.id, 'Comment B', null, (err, commentB) => {
                assert.ok(!err);

                // Collect the activity stream so A and B can aggregate
                ActivityTestUtil.collectAndGetActivityStream(simong.restContext, null, null, (err, activityStream) => {
                  assert.ok(!err);

                  // Let the aggregation timeout expire and generate 2 more activities, these should not aggregate with the previous two
                  // in the regular activity stream, they should however aggregate in the email
                  setTimeout(
                    RestAPI.Content.createComment,
                    1100,
                    nico.restContext,
                    contentObj.id,
                    'Comment C',
                    null,
                    (err, commentC) => {
                      assert.ok(!err);
                      RestAPI.Content.createComment(
                        branden.restContext,
                        contentObj.id,
                        'Comment D',
                        null,
                        (err, commentD) => {
                          assert.ok(!err);

                          // Collect the emails, there should only be one containing one activity which is an aggregate of 4 comments
                          EmailTestUtil.collectAndFetchAllEmails(messages => {
                            // 3 messages, 1 for Simon (manager) and 2 for Nico and Branden (recent commenters)
                            assert.strictEqual(messages.length, 3);

                            // The message for Simon should contain 1 content-comment activity on 1 content item with 4 comments
                            const simongMessage = _.find(messages, message => {
                              return message.to[0].address === simong.user.email;
                            });
                            // Assert that the correct content item is included in the email
                            assert.strictEqual(simongMessage.html.match(contentObj.profilePath).length, 1);

                            // Assert that all 4 comments are in the email
                            assert.strictEqual(simongMessage.html.match(/activity-comment-container/g).length, 4);
                            assert.ok(simongMessage.html.indexOf(commentA.body) > 0);
                            assert.ok(simongMessage.html.indexOf(commentB.body) > 0);
                            assert.ok(simongMessage.html.indexOf(commentC.body) > 0);
                            assert.ok(simongMessage.html.indexOf(commentD.body) > 0);
                            return callback();
                          });
                        }
                      );
                    }
                  );
                });
              });
            });
          }
        );
      });
    });
  });

  /**
   * Test that verifies that the email template does some basic checks such as asserting there are
   * no untranslated keys, untranslated dynamic variables, links to relative paths, etc.
   */
  it('verify basic checks in email template', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, simong, nico) => {
      assert.ok(!err);

      // The next email collection cycle should only handle `immediate` deliveries
      refreshConfiguration(null, false, false, {}, config => {
        // Trigger an email with a long display name
        const displayName = TestsUtil.generateRandomText(3);
        RestAPI.Content.createLink(
          simong.restContext,
          displayName,
          'Google',
          'public',
          'http://www.google.ca',
          [],
          [nico.user.id],
          [],
          (err, link) => {
            assert.ok(!err);

            // Run an activity collection, which will queue an immediate email for Nico
            ActivityTestUtil.collectAndGetActivityStream(nico.restContext, null, null, (err, activityStream) => {
              assert.ok(!err);

              // Collect the email and check for some basic pitfalls in the template
              EmailTestUtil.collectAndFetchAllEmails(messages => {
                assert.strictEqual(messages.length, 1);
                const { html } = messages[0];
                const { text } = messages[0];

                // Assert we have both html and text
                assert.ok(html);
                assert.ok(text);

                // Assert there are no untranslated keys in there
                assert.strictEqual(
                  html.indexOf('__MSG__'),
                  -1,
                  'An i18n key was not replaced in the html email template'
                );
                assert.strictEqual(
                  text.indexOf('__MSG__'),
                  -1,
                  'An i18n key was not replaced in the text email template'
                );

                // Assert all dynamic variables are replaced
                assert.strictEqual(
                  html.indexOf('${'),
                  -1,
                  'A dynamic variable was not replaced in the html email template'
                );
                assert.strictEqual(
                  text.indexOf('${'),
                  -1,
                  'A dynamic variable was not replaced in the text email template'
                );

                // Assert that there are no URLs in the template that don't include the tenant base url
                assert.strictEqual(html.indexOf('href="/'), -1, 'Links in emails should include the tenant base url');
                assert.strictEqual(html.indexOf('src="/'), -1, 'Links in emails should include the tenant base url');

                // Assert that html links have been converted to "plain text links"
                assert.strictEqual(text.indexOf('<a href='), -1);
                assert.notStrictEqual(text.indexOf(link.profilePath), -1);

                // Ensure the long display name gets truncated
                assert.notStrictEqual(html.indexOf(util.format('%s...', displayName.slice(0, 30))), -1);

                return callback();
              });
            });
          }
        );
      });
    });
  });

  /**
   * Test that verifies that the polling frequency is bounded
   */
  it('verify mail polling frequency is bounded', callback => {
    // Verify the upper bound
    refreshConfiguration(null, false, false, { mail: { pollingFrequency: 7200 } }, () => {
      assert.strictEqual(ActivitySystemConfig.getConfig().mail.pollingFrequency, 3600);

      // Verify the lower bound
      refreshConfiguration(null, false, false, { mail: { pollingFrequency: 1 } }, () => {
        assert.strictEqual(ActivitySystemConfig.getConfig().mail.pollingFrequency, 60);
        return callback();
      });
    });
  });

  /**
   * Test that verifies a private user does not appear in a link in an activity email
   */
  it('verify private users are not displayed with links', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, mrvisser, simong) => {
      assert.ok(!err);

      RestAPI.User.updateUser(
        mrvisser.restContext,
        mrvisser.user.id,
        { visibility: 'private' },
        (err, updatedMrvisser) => {
          assert.ok(!err);
          assert.strictEqual(updatedMrvisser.visibility, 'private');

          // Mrvisser follows simong now that he is private
          RestAPI.Following.follow(mrvisser.restContext, simong.user.id, err => {
            assert.ok(!err);

            // Collect the emails
            EmailTestUtil.collectAndFetchAllEmails(messages => {
              // Ensure we get one email, it is the following email, and that there are no
              // links to mrvisser's profile
              assert.strictEqual(messages.length, 1);

              const $html = $(messages[0].html);

              // Iterate all links in the HTML, make sure none of them represent the user
              $html.find('a').each(function() {
                assert.notStrictEqual($(this).html(), mrvisser.user.publicAlias);
              });

              // Get the thumbnail and ensure it does not have a link as a parent
              const $thumbnail = $html.find(util.format('img[alt="%s"]', mrvisser.user.publicAlias));
              assert.strictEqual($thumbnail.length, 1);
              assert.strictEqual($thumbnail.closest('a').length, 0);

              return callback();
            });
          });
        }
      );
    });
  });

  /**
   * Test that verifies that activities that happen just before an email collection do not trigger an email
   */
  it('verify activities that happen just before an email collection do not trigger an email', callback => {
    // Configure the email collector to not collect activity streams that contain activities
    // that happened a second ago
    const config = {
      mail: {
        pollingFrequency: 60 * 60,
        gracePeriod: 1
      }
    };
    refreshConfiguration(null, false, false, config, () => {
      // Generate some users that we can test with
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users, simong, nico) => {
        assert.ok(!err);

        // Trigger an email with 2 activities
        RestAPI.Content.createLink(
          simong.restContext,
          'Link #1',
          'Google',
          'public',
          'http://www.google.ca',
          [],
          [nico.user.id],
          (err, link) => {
            assert.ok(!err);
            RestAPI.Content.createLink(
              simong.restContext,
              'Link #2',
              'Google',
              'public',
              'http://www.google.ca',
              [],
              [nico.user.id],
              (err, link) => {
                assert.ok(!err);

                // Run an activity collection, which will queue an immediate email for Nico
                ActivityTestUtil.collectAndGetActivityStream(nico.restContext, null, null, (err, activityStream) => {
                  assert.ok(!err);

                  // Because of the grace period however, Nico should not get the email in this collection cycle
                  EmailTestUtil.collectAndFetchAllEmails(messages => {
                    assert.strictEqual(messages.length, 0);

                    // If we let the grace period pass, Nico should get his email
                    EmailTestUtil.waitForEmail(messages => {
                      assert.strictEqual(messages.length, 1);
                      assert.ok(messages[0].html.indexOf('Link #1') > 0);
                      assert.ok(messages[0].html.indexOf('Link #2') > 0);
                      return callback();
                    });
                  });
                });
              }
            );
          }
        );
      });
    });
  });

  /**
   * Regression test for one of our more verbose activities (2 or more items shared with a group).
   * Here we ensure that there is no line that surpasses a safe SMTP threshold
   */
  it('verify email for 2 items being created for a group do not result in lines that are too long', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users, simong, nico) => {
      assert.ok(!err);
      TestsUtil.generateTestGroups(simong.restContext, 1, group => {
        group = group.group;

        // Add the members to the group
        const members = {};
        members[nico.user.id] = 'manager';
        PrincipalsTestUtil.assertSetGroupMembersSucceeds(
          simong.restContext,
          simong.restContext,
          group.id,
          members,
          () => {
            // Collect any email notifications so we can focus on just the one we generate next
            EmailTestUtil.collectAndFetchAllEmails(() => {
              // Create 2 links for the group
              RestAPI.Content.createLink(
                simong.restContext,
                'Google',
                'Google',
                'public',
                'http://www.myawesomelinkthatilike.ca',
                [group.id],
                [],
                [],
                err => {
                  assert.ok(!err);
                  RestAPI.Content.createLink(
                    simong.restContext,
                    'Google',
                    'Google',
                    'public',
                    'http://www.anotherlinkthatilike.ca/this/is/reasonably/long?so=what&will=happen',
                    [group.id],
                    [],
                    [],
                    err => {
                      assert.ok(!err);

                      // Collect email, ensuring that no line surpasses an acceptable threshold
                      EmailTestUtil.collectAndFetchAllEmails(messages => {
                        assert.strictEqual(messages.length, 1);
                        assert.notStrictEqual(messages[0].html.indexOf('in the group'), -1);
                        return callback();
                      });
                    }
                  );
                }
              );
            });
          }
        );
      });
    });
  });
});
