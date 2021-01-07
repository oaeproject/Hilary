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

import { assert } from 'chai';
import util from 'util';
import $ from 'cheerio';
import * as ConfigTestUtil from 'oae-config/lib/test/util';
import * as ContentTestUtil from 'oae-content/lib/test/util';
import * as EmailTestUtil from 'oae-email/lib/test/util';
import * as PrincipalsTestUtil from 'oae-principals/lib/test/util';
import * as RestAPI from 'oae-rest';
import * as Sanitization from 'oae-util/lib/sanitization';
import * as TenantsTestUtil from 'oae-tenants/lib/test/util';
import * as TestsUtil from 'oae-tests';
import * as TZ from 'oae-util/lib/tz';
import * as ActivityAPI from 'oae-activity';
import { ActivityConstants } from 'oae-activity/lib/constants';
import * as ActivityEmail from 'oae-activity/lib/internal/email';
import * as ActivitySystemConfig from 'oae-activity/lib/internal/config';
import * as ActivityTestUtil from 'oae-activity/lib/test/util';

import {
  forEach,
  equals,
  find,
  head,
  compose,
  mergeRight,
  map,
  prop,
  union,
  contains,
  sortBy,
  propSatisfies
} from 'ramda';
const NO_MANAGERS = [];
const NO_VIEWERS = [];
const NO_FOLDERS = [];
const PUBLIC = 'public';

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
  const refreshConfiguration = function(
    timezoneString,
    expectDaily,
    expectWeekly,
    extraConfig,
    callback
  ) {
    const now = timezoneString
      ? new TZ.timezone.Date(timezoneString)
      : new TZ.timezone.Date('Etc/UTC');

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
    // config = _.extend(config, extraConfig);
    config = mergeRight(config, extraConfig);

    // Configure the daily/weekly values
    config.mail.daily = { hour: dailyHour };
    config.mail.weekly = { hour: weeklyHour, day: weeklyDay };

    ActivityTestUtil.refreshConfiguration(config, err => {
      assert.notExists(err);
      return callback(config);
    });
  };

  describe('Templates', () => {
    /**
     * Test that verifies the state of the activity email footer template based on instance
     * configuration
     */
    it('verify footer template', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users) => {
        assert.notExists(err);
        const { 1: nico, 2: mrvisser } = users;

        // Clear emails to start
        EmailTestUtil.collectAndFetchAllEmails(() => {
          const instanceName = TestsUtil.generateRandomText(1);
          const instanceURL = util.format(
            'http://www.instance.oaeproject.org/%s',
            TestsUtil.generateRandomText(1)
          );
          const hostingOrganization = TestsUtil.generateRandomText(1);
          const hostingOrganizationURL = util.format(
            'http://www.host.oaeproject.org/%s',
            TestsUtil.generateRandomText(1)
          );

          const instanceConfigFields = [
            'oae-tenants/instance/instanceName',
            'oae-tenants/instance/instanceURL'
          ];
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
            assert.notStrictEqual(
              message.html.indexOf('Apereo <a\n href="http://www.oaeproject.org"\n '),
              -1
            );
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
              assert.strictEqual(
                message.html.indexOf(util.format('<a href="%s"\n ', instanceURL)),
                -1
              );
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
                  util.format(
                    '<a\n href="%s"\n ',
                    Sanitization.encodeForHTMLAttribute(hostingOrganizationURL)
                  )
                ),
                -1
              );
              assert.notStrictEqual(
                message.html.indexOf(util.format('%s</a>', hostingOrganization)),
                -1
              );
            } else {
              assert.strictEqual(
                message.html.indexOf(util.format('<a\n href="%s"\n ', hostingOrganizationURL)),
                -1
              );
              assert.strictEqual(
                message.html.indexOf(util.format('%s</a>', hostingOrganization)),
                -1
              );
            }
          };

          ConfigTestUtil.clearConfigAndWait(
            globalAdminRestContext,
            null,
            union(instanceConfigFields, hostingOrganizationConfigFields),
            err => {
              assert.notExists(err);

              // Create a link, let Nico manage it
              RestAPI.Content.createLink(
                mrvisser.restContext,
                {
                  displayName: 'Google',
                  description: 'Google',
                  visibility: PUBLIC,
                  link: 'http://www.google.ca',
                  managers: [nico.user.id],
                  viewers: NO_VIEWERS,
                  folders: NO_FOLDERS
                },
                (err, link) => {
                  assert.notExists(err);

                  // Ensure the email is as expected
                  EmailTestUtil.collectAndFetchAllEmails(messages => {
                    _assertEmailFooter(messages[0]);

                    // Add a host instance information and generate another email
                    ConfigTestUtil.updateConfigAndWait(
                      globalAdminRestContext,
                      null,
                      updateConfigInstance,
                      err => {
                        assert.notExists(err);
                        RestAPI.Content.updateContent(
                          mrvisser.restContext,
                          link.id,
                          { displayName: 'Update 1' },
                          (err, link) => {
                            assert.notExists(err);
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
                                  assert.notExists(err);
                                  ConfigTestUtil.updateConfigAndWait(
                                    globalAdminRestContext,
                                    null,
                                    updateConfigHostingOrganization,
                                    err => {
                                      assert.notExists(err);
                                      RestAPI.Content.updateContent(
                                        mrvisser.restContext,
                                        link.id,
                                        { displayName: 'Update 2' },
                                        (err, link) => {
                                          assert.notExists(err);
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
                                                assert.notExists(err);
                                                RestAPI.Content.updateContent(
                                                  mrvisser.restContext,
                                                  link.id,
                                                  { displayName: 'Update 3' },
                                                  (err, link) => {
                                                    assert.notExists(err);
                                                    EmailTestUtil.collectAndFetchAllEmails(
                                                      messages => {
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
                                                            assert.notExists(err);
                                                            RestAPI.Content.updateContent(
                                                              mrvisser.restContext,
                                                              link.id,
                                                              { displayName: 'Update 3' },
                                                              err => {
                                                                assert.notExists(err);
                                                                EmailTestUtil.collectAndFetchAllEmails(
                                                                  messages => {
                                                                    _assertEmailFooter(
                                                                      messages[0],
                                                                      {
                                                                        expectInstanceName: true,
                                                                        expectHostingOrganizationName: true
                                                                      }
                                                                    );
                                                                    return callback();
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
                      }
                    );
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
    TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users) => {
      assert.notExists(err);

      const { 0: simong, 1: nico, 2: mrvisser } = users;

      RestAPI.Content.createLink(
        mrvisser.restContext,
        {
          displayName: 'Google',
          description: 'Google',
          visibility: PUBLIC,
          link: 'http://www.google.ca',
          managers: NO_MANAGERS,
          viewers: [nico.user.id],
          folders: NO_FOLDERS
        },
        (err, firstLink) => {
          assert.notExists(err);
          RestAPI.Content.createLink(
            mrvisser.restContext,
            {
              displayName: 'Google',
              description: 'Google',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: [nico.user.id],
              folders: NO_FOLDERS
            },
            (err, secondLink) => {
              assert.notExists(err);
              RestAPI.Content.createLink(
                simong.restContext,
                {
                  displayName: 'Google',
                  description: 'Google',
                  visibility: PUBLIC,
                  link: 'http://www.google.ca',
                  managers: NO_MANAGERS,
                  viewers: [nico.user.id],
                  folders: NO_FOLDERS
                },
                (err, thirdLink) => {
                  assert.notExists(err);
                  RestAPI.Content.createLink(
                    simong.restContext,
                    {
                      displayName: 'Google',
                      description: 'Google',
                      visibility: PUBLIC,
                      link: 'http://www.google.ca',
                      managers: NO_MANAGERS,
                      viewers: [nico.user.id],
                      folders: NO_FOLDERS
                    },
                    (err, fourthLink) => {
                      assert.notExists(err);
                      RestAPI.Discussions.createDiscussion(
                        simong.restContext,
                        'First discussion',
                        'descr',
                        'public',
                        null,
                        [nico.user.id],
                        (err, firstDiscussion) => {
                          assert.notExists(err);

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
                            const discussionIndex = messages[0].html.indexOf(
                              firstDiscussion.profilePath
                            );
                            assert.ok(discussionIndex < contentIndex);

                            RestAPI.Discussions.createDiscussion(
                              simong.restContext,
                              'Second discussion',
                              'descr',
                              'public',
                              null,
                              [nico.user.id, mrvisser.user.id],
                              (err, secondDiscussion) => {
                                assert.notExists(err);
                                EmailTestUtil.collectAndFetchAllEmails(messages => {
                                  assert.strictEqual(messages.length, 2);
                                  forEach(message => {
                                    assert.ok(
                                      contains(message.to[0].address, [
                                        nico.user.email,
                                        mrvisser.user.email
                                      ])
                                    );

                                    // Assert that only the link to the discussion profile is present
                                    assert.ok(
                                      message.html.indexOf(secondDiscussion.profilePath) > 0
                                    );
                                    assert.strictEqual(
                                      messages[0].html.indexOf(firstLink.profilePath),
                                      -1
                                    );
                                    assert.strictEqual(
                                      messages[0].html.indexOf(secondLink.profilePath),
                                      -1
                                    );
                                    assert.strictEqual(
                                      messages[0].html.indexOf(thirdLink.profilePath),
                                      -1
                                    );
                                    assert.strictEqual(
                                      messages[0].html.indexOf(fourthLink.profilePath),
                                      -1
                                    );
                                    assert.strictEqual(
                                      messages[0].html.indexOf(firstDiscussion.profilePath),
                                      -1
                                    );

                                    // Assert the link to Simon's profile is present
                                    assert.ok(message.html.indexOf(simong.user.profilePath) > 0);
                                  }, messages);

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
    TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users) => {
      assert.notExists(err);
      const { 0: nico, 1: branden, 2: simong } = users;

      // Trigger an activity
      RestAPI.Content.createLink(
        simong.restContext,
        {
          displayName: 'Link #1',
          description: 'Google',
          visibility: PUBLIC,
          link: 'http://www.google.be',
          managers: NO_MANAGERS,
          viewers: [branden.user.id],
          folders: NO_FOLDERS
        },
        (err, firstContentObj) => {
          assert.notExists(err);

          // Collect the e-mails, Branden should've received an e-mail containing the content-create activity
          EmailTestUtil.collectAndFetchAllEmails(messages => {
            assert.strictEqual(messages.length, 1);
            assert.strictEqual(messages[0].to[0].address, branden.user.email);
            assert.ok(messages[0].html.indexOf(firstContentObj.displayName) > 0);
            assert.ok(messages[0].html.indexOf(firstContentObj.profilePath) > 0);

            // If Simon triggers another content-create activity, it should *NOT* aggregate with the initial one
            RestAPI.Content.createLink(
              simong.restContext,
              {
                displayName: 'Link #2',
                description: 'Google',
                visibility: PUBLIC,
                link: 'http://www.google.be',
                managers: NO_MANAGERS,
                viewers: [branden.user.id],
                folders: NO_FOLDERS
              },
              (err, secondContentObj) => {
                assert.notExists(err);

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
                      assert.notExists(err);

                      // Collect the e-mails, Branden should've received an e-mail containing the content-create activity
                      EmailTestUtil.collectAndFetchAllEmails(messages => {
                        assert.strictEqual(messages.length, 1);
                        assert.strictEqual(messages[0].to[0].address, branden.user.email);
                        assert.strictEqual(
                          messages[0].html.indexOf(firstContentObj.displayName),
                          -1
                        );
                        assert.strictEqual(
                          messages[0].html.indexOf(secondContentObj.displayName),
                          -1
                        );
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
    TestsUtil.generateTestUsers(camAdminRestContext, 5, (err, users) => {
      const {
        0: neverMailUser,
        1: immediateMailUser,
        2: dailyMailUser,
        3: weeklyMailUser,
        4: simong
      } = users;
      assert.notExists(err);
      RestAPI.User.updateUser(
        neverMailUser.restContext,
        neverMailUser.user.id,
        { emailPreference: 'never' },
        err => {
          assert.notExists(err);
          RestAPI.User.updateUser(
            immediateMailUser.restContext,
            immediateMailUser.user.id,
            { emailPreference: 'immediate' },
            err => {
              assert.notExists(err);
              RestAPI.User.updateUser(
                dailyMailUser.restContext,
                dailyMailUser.user.id,
                { emailPreference: 'daily' },
                err => {
                  assert.notExists(err);
                  RestAPI.User.updateUser(
                    weeklyMailUser.restContext,
                    weeklyMailUser.user.id,
                    { emailPreference: 'weekly' },
                    err => {
                      assert.notExists(err);

                      // Configure the email collector, so that the email collection window doesn't include
                      // the daily and weekly collection point
                      refreshConfiguration(null, false, false, {}, () => {
                        // Trigger an activity
                        RestAPI.Content.createLink(
                          simong.restContext,
                          {
                            displayName: 'Google1',
                            description: 'Google1',
                            visibility: PUBLIC,
                            link: 'http://www.google1.be',
                            managers: NO_MANAGERS,
                            viewers: [
                              neverMailUser.user.id,
                              immediateMailUser.user.id,
                              dailyMailUser.user.id,
                              weeklyMailUser.user.id
                            ],
                            folders: NO_FOLDERS
                          },
                          err => {
                            assert.notExists(err);

                            // Collect the e-mails, only the immediate user should receive an e-mail
                            EmailTestUtil.collectAndFetchAllEmails(messages => {
                              assert.strictEqual(messages.length, 1);
                              assert.strictEqual(
                                messages[0].to[0].address,
                                immediateMailUser.user.email
                              );

                              // Configure the email collector, so that the email collection window includes
                              // the daily but not the weekly collection point
                              refreshConfiguration(null, true, false, {}, () => {
                                // Trigger an activity
                                RestAPI.Content.createLink(
                                  simong.restContext,
                                  {
                                    displayName: 'Google2',
                                    description: 'Google2',
                                    visibility: PUBLIC,
                                    link: 'http://www.google2.be',
                                    managers: NO_MANAGERS,
                                    viewers: [
                                      neverMailUser.user.id,
                                      immediateMailUser.user.id,
                                      dailyMailUser.user.id,
                                      weeklyMailUser.user.id
                                    ],
                                    folders: NO_FOLDERS
                                  },
                                  err => {
                                    assert.notExists(err);

                                    // Collect the e-mails, only the immediate and daily users should've received an e-mail
                                    EmailTestUtil.collectAndFetchAllEmails(messages => {
                                      assert.strictEqual(messages.length, 2);
                                      assert.include(
                                        [immediateMailUser.user.email, dailyMailUser.user.email],
                                        messages[0].to[0].address
                                      );
                                      assert.include(
                                        [immediateMailUser.user.email, dailyMailUser.user.email],
                                        messages[1].to[0].address
                                      );
                                      // Assert that the "weekly" mail user's email contains 1 activity
                                      const dailyMail = find(
                                        compose(
                                          equals(dailyMailUser.user.email),
                                          prop('address'),
                                          head,
                                          prop('to')
                                        ),

                                        messages
                                      );
                                      assert.ok(dailyMail);

                                      // Configure the email collector, so that the email collection window includes
                                      // the weekly but not the daily collection point
                                      refreshConfiguration(null, false, true, {}, () => {
                                        // Trigger an activity
                                        RestAPI.Content.createLink(
                                          simong.restContext,
                                          {
                                            displayName: 'Google3',
                                            description: 'Google3',
                                            visibility: PUBLIC,
                                            link: 'http://www.google3.be',
                                            managers: NO_MANAGERS,
                                            viewers: [
                                              neverMailUser.user.id,
                                              immediateMailUser.user.id,
                                              dailyMailUser.user.id,
                                              weeklyMailUser.user.id
                                            ],
                                            folders: NO_FOLDERS
                                          },
                                          err => {
                                            assert.notExists(err);

                                            // Collect the e-mails, only the immediate and weekly users should've received an e-mail
                                            EmailTestUtil.collectAndFetchAllEmails(messages => {
                                              assert.strictEqual(messages.length, 2);
                                              const mailAddresses = [
                                                immediateMailUser.user.email,
                                                weeklyMailUser.user.email
                                              ];
                                              assert.include(
                                                mailAddresses,
                                                messages[0].to[0].address
                                              );

                                              assert.include(
                                                mailAddresses,
                                                messages[1].to[0].address
                                              );

                                              // Assert that the "weekly" mail user's email contains 1 activity
                                              const weeklyMail = find(
                                                compose(
                                                  equals(weeklyMailUser.user.email),
                                                  prop('address'),
                                                  head,
                                                  prop('to')
                                                ),
                                                messages
                                              );
                                              assert.ok(weeklyMail);

                                              // Configure the email collector, so that the email collection window includes
                                              // both the daily and the weekly collection point
                                              refreshConfiguration(null, true, true, {}, () => {
                                                // Trigger an activity
                                                RestAPI.Content.createLink(
                                                  simong.restContext,
                                                  {
                                                    displayName: 'Google4',
                                                    description: 'Google4',
                                                    visibility: PUBLIC,
                                                    link: 'http://www.google4.be',
                                                    managers: NO_MANAGERS,
                                                    viewers: [
                                                      neverMailUser.user.id,
                                                      immediateMailUser.user.id,
                                                      dailyMailUser.user.id,
                                                      weeklyMailUser.user.id
                                                    ],
                                                    folders: NO_FOLDERS
                                                  },
                                                  err => {
                                                    assert.notExists(err);

                                                    // Collect the e-mails, all users (except the neverMailUser) should've received an e-mail
                                                    EmailTestUtil.collectAndFetchAllEmails(
                                                      messages => {
                                                        assert.strictEqual(messages.length, 3);
                                                        const mailAddresses = [
                                                          immediateMailUser.user.email,
                                                          dailyMailUser.user.email,
                                                          weeklyMailUser.user.email
                                                        ];
                                                        assert.include(
                                                          mailAddresses,
                                                          messages[0].to[0].address
                                                        );
                                                        assert.include(
                                                          mailAddresses,
                                                          messages[1].to[0].address
                                                        );
                                                        assert.include(
                                                          mailAddresses,
                                                          messages[2].to[0].address
                                                        );

                                                        // Assert that the "weekly" mail user's email contains 1 activity (but is an aggregate of 3)
                                                        const weeklyMail = find(
                                                          compose(
                                                            equals(weeklyMailUser.user.email),
                                                            prop('address'),
                                                            head,
                                                            prop('to')
                                                          ),
                                                          messages
                                                        );

                                                        assert.ok(weeklyMail);
                                                        return callback();
                                                      }
                                                    );
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
        }
      );
    });
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
          assert.notExists(err);

          // Set each user's email preference to daily
          const profile = {
            emailPreference: 'daily'
          };
          RestAPI.User.updateUser(restContext, user.id, profile, err => {
            assert.notExists(err);

            // Set the default timezone for this tenant
            offset++;
            const timezone = 'Etc/GMT' + (offset < 0 ? offset : '+' + offset);
            ConfigTestUtil.updateConfigAndWait(
              restContext,
              null,
              { 'oae-tenants/timezone/timezone': timezone },
              err => {
                assert.notExists(err);
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
          TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, users) => {
            assert.notExists(err);
            const { 0: simong } = users;

            // Trigger a mail for all 24 users
            RestAPI.Content.createLink(
              simong.restContext,
              {
                displayName: 'Google',
                description: 'Google',
                visibility: PUBLIC,
                link: 'http://www.google.ca',
                managers: NO_MANAGERS,
                viewers: userIds,
                folders: NO_FOLDERS
              },
              err => {
                assert.notExists(err);

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
      assert.notExists(err);

      // Configure the default timezone to something that's 5 hours behind
      ConfigTestUtil.updateConfigAndWait(
        restContext,
        null,
        { 'oae-tenants/timezone/timezone': 'Etc/GMT+5' },
        err => {
          assert.notExists(err);

          // Generate some users that we can test with
          TestsUtil.generateTestUsers(restContext, 2, (err, users) => {
            assert.notExists(err);
            const { 0: simong, 1: nico } = users;

            // Change Nico's email preference so he gets daily aggregates
            RestAPI.User.updateUser(
              nico.restContext,
              nico.user.id,
              { emailPreference: 'daily' },
              err => {
                assert.notExists(err);

                // Configure the mail collector so daily mails are collected 5 hours later relative to Nico's timezone
                refreshConfiguration('Etc/GMT+5', false, false, {}, config => {
                  // Trigger a mail for Nico
                  RestAPI.Content.createLink(
                    simong.restContext,
                    {
                      displayName: 'Google',
                      description: 'Google',
                      visibility: PUBLIC,
                      link: 'http://www.google.ca',
                      managers: NO_MANAGERS,
                      viewers: [nico.user.id],
                      folders: NO_FOLDERS
                    },
                    err => {
                      assert.notExists(err);

                      // As the hour was set to 5hrs after Nico's current time, he should not receive an email yet
                      EmailTestUtil.collectAndFetchAllEmails(messages => {
                        assert.strictEqual(messages.length, 0);

                        // If we manually collect the daily emails that are scheduled 5 hours ahead of the the UTC-5 timezone, Nico's mail should be sent out
                        const hours = (24 + config.mail.daily.hour - 5) % 24;
                        ActivityEmail.collectMails(0, 'daily', null, hours, (err, empty, users) => {
                          assert.notExists(err);
                          assert.lengthOf(users, 1);
                          assert.strictEqual(users[0].id, nico.user.id);
                          return callback();
                        });
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
      assert.notExists(err);

      // Create a test tenant
      const alias = TenantsTestUtil.generateTestTenantAlias();
      const host = TenantsTestUtil.generateTestTenantHost();
      TestsUtil.createTenantWithAdmin(alias, host, (err, tenant, restContext) => {
        assert.notExists(err);

        // Generate some users that we can test with
        TestsUtil.generateTestUsers(restContext, 2, (err, users) => {
          assert.notExists(err);

          const { 0: simong, 1: nico } = users;

          // Change Nico's email preference so he gets weekly emails
          RestAPI.User.updateUser(
            nico.restContext,
            nico.user.id,
            { emailPreference: 'weekly' },
            err => {
              assert.notExists(err);

              // Configure the default timezone to something that's 5 hours ahead
              ConfigTestUtil.updateConfigAndWait(
                restContext,
                null,
                { 'oae-tenants/timezone/timezone': 'Etc/GMT+5' },
                err => {
                  assert.notExists(err);

                  // Trigger a mail for Nico
                  RestAPI.Content.createLink(
                    simong.restContext,
                    {
                      displayName: 'Google',
                      description: 'Google',
                      visibility: PUBLIC,
                      link: 'http://www.google.ca',
                      managers: NO_MANAGERS,
                      viewers: [nico.user.id],
                      folders: NO_FOLDERS
                    },
                    err => {
                      assert.notExists(err);

                      // Give some time to let the activity route to the correct streams
                      ActivityTestUtil.collectAndGetActivityStream(
                        nico.restContext,
                        nico.user.id,
                        null,
                        err => {
                          assert.notExists(err);

                          /**
                           * As the collector is in the UTC timezone, Nico in UTC+5 and
                           * mails should be in the user their inbox at 1am on Tuesday,
                           *  we should send out an email at 20h UTC on Monday
                           */
                          ActivityEmail.collectMails(0, 'weekly', 2, 20, (err, empty, users) => {
                            assert.notExists(err);
                            assert.lengthOf(users, 1);
                            assert.ok(find(propSatisfies(equals(nico.user.id), 'id'), users));

                            /**
                             * Assert that roll overs to the next day work too by configuring
                             * the collector so emails end up in users their email inbox
                             * at 23h on Tuesday
                             */
                            config = {
                              mail: {
                                pollingFrequency: 60 * 60,
                                gracePeriod: 0,
                                daily: { hour: 1 },
                                weekly: { hour: 23, day: 3 }
                              }
                            };
                            ActivityTestUtil.refreshConfiguration(config, err => {
                              assert.notExists(err);

                              // Configure the default timezone to something that's 5 hours behind
                              ConfigTestUtil.updateConfigAndWait(
                                restContext,
                                null,
                                { 'oae-tenants/timezone/timezone': 'Etc/GMT-5' },
                                err => {
                                  assert.notExists(err);

                                  // Trigger a mail for Nico
                                  RestAPI.Content.createLink(
                                    simong.restContext,
                                    {
                                      displayName: 'Google',
                                      description: 'Google',
                                      visibility: PUBLIC,
                                      link: 'http://www.google.ca',
                                      managers: NO_MANAGERS,
                                      viewers: [nico.user.id],
                                      folders: NO_FOLDERS
                                    },
                                    err => {
                                      assert.notExists(err);

                                      // Give some time to let the activity route to the correct streams
                                      ActivityTestUtil.collectAndGetActivityStream(
                                        nico.restContext,
                                        nico.user.id,
                                        null,
                                        err => {
                                          assert.notExists(err);

                                          // As the collector is in the UTC timezone, Nico in UTC-5 and mails should be in the user their
                                          // inbox at 23h on Wednesday, we should send out an email at 4am UTC on Thursday
                                          ActivityEmail.collectMails(
                                            0,
                                            'weekly',
                                            4,
                                            4,
                                            (err, empty, users) => {
                                              assert.notExists(err);
                                              assert.strictEqual(users.length, 1);
                                              assert.ok(
                                                find(
                                                  propSatisfies(equals(nico.user.id), 'id'),
                                                  users
                                                )
                                              );
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
                          });
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
      assert.notExists(err);

      // Create a test tenant
      const alias = TenantsTestUtil.generateTestTenantAlias();
      const host = TenantsTestUtil.generateTestTenantHost();
      TestsUtil.createTenantWithAdmin(alias, host, (err, tenant, restContext) => {
        assert.notExists(err);

        // Generate some users that we can test with
        TestsUtil.generateTestUsers(restContext, 2, (err, users) => {
          assert.notExists(err);

          const { 0: simong, 1: nico } = users;

          // Change Nico's email preference so he gets daily emails
          RestAPI.User.updateUser(
            nico.restContext,
            nico.user.id,
            { emailPreference: 'daily' },
            err => {
              assert.notExists(err);

              // Configure the default timezone to something that's 5 hours ahead
              ConfigTestUtil.updateConfigAndWait(
                restContext,
                null,
                { 'oae-tenants/timezone/timezone': 'Etc/GMT+5' },
                err => {
                  assert.notExists(err);

                  // Trigger a mail for Nico
                  RestAPI.Content.createLink(
                    simong.restContext,
                    {
                      displayName: 'Google',
                      description: 'Google',
                      visibility: PUBLIC,
                      link: 'http://www.google.ca',
                      managers: NO_MANAGERS,
                      viewers: [nico.user.id],
                      folders: NO_FOLDERS
                    },
                    (err /* , link */) => {
                      assert.notExists(err);

                      // Give some time to let the activity route to the correct streams
                      ActivityTestUtil.collectAndGetActivityStream(
                        nico.restContext,
                        nico.user.id,
                        null,
                        err => {
                          assert.notExists(err);

                          // As the collector is in the UTC timezone, Nico in UTC+5 and mails should be in the user their
                          // inbox at 1am, we should send out an email at 20h UTC
                          ActivityEmail.collectMails(0, 'daily', null, 20, (err, empty, users) => {
                            assert.notExists(err);
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
                              assert.notExists(err);

                              // Configure the default timezone to something that's 5 hours behind
                              ConfigTestUtil.updateConfigAndWait(
                                restContext,
                                null,
                                { 'oae-tenants/timezone/timezone': 'Etc/GMT-5' },
                                err => {
                                  assert.notExists(err);

                                  // Trigger a mail for Nico
                                  RestAPI.Content.createLink(
                                    simong.restContext,
                                    {
                                      displayName: 'Google',
                                      description: 'Google',
                                      visibility: PUBLIC,
                                      link: 'http://www.google.ca',
                                      managers: NO_MANAGERS,
                                      viewers: [nico.user.id],
                                      folders: NO_FOLDERS
                                    },
                                    (err /* , link */) => {
                                      assert.notExists(err);

                                      // Give some time to let the activity route to the correct streams
                                      ActivityTestUtil.collectAndGetActivityStream(
                                        nico.restContext,
                                        nico.user.id,
                                        null,
                                        err => {
                                          assert.notExists(err);

                                          // As the collector is in the UTC timezone, Nico in UTC-5 and mails should be in the user their
                                          // inbox at 23h, we should send out an email at 4am UTC
                                          ActivityEmail.collectMails(
                                            0,
                                            'daily',
                                            null,
                                            4,
                                            (err, empty, users) => {
                                              assert.notExists(err);
                                              assert.strictEqual(users.length, 1);
                                              assert.strictEqual(users[0].id, nico.user.id);
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
                          });
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
    });
  });

  /**
   * Test that verifies that activity emails are not delivered to users who have deleted/restored their
   * profiles
   */
  it('verify email is not delivered to users who have since deleted/restored their profile', callback => {
    // Create a user to perform actions (simong) and one to receive emails
    // (mrvisser) through a group
    TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users) => {
      assert.notExists(err);
      const { 0: mrvisser, 1: simong, 2: nico } = users;
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
              (/* link1 */) => {
                EmailTestUtil.collectAndFetchAllEmails(messages => {
                  assert.strictEqual(messages.length, 2);

                  // Ensure the 2 recipients are mrvisser and nico
                  const recipients = sortBy(
                    x => x,
                    map(compose(prop('address'), head, prop('to')), messages)
                  );
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
                        (/* link2 */) => {
                          EmailTestUtil.collectAndFetchAllEmails(messages => {
                            assert.strictEqual(messages.length, 1);
                            assert.strictEqual(head(messages[0].to).address, nico.user.email);

                            /**
                             * Restore mrvisser and ensure email is not sent to mrvisser
                             * even if he has been restoredbecause he lost all those
                             * rights when his profile was deleted
                             */
                            PrincipalsTestUtil.assertRestoreUserSucceeds(
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
                                  (/* link2 */) => {
                                    EmailTestUtil.collectAndFetchAllEmails(messages => {
                                      assert.strictEqual(messages.length, 1);

                                      // Ensure only nico gets it this time
                                      const recipients = sortBy(
                                        x => x,
                                        map(compose(prop('address'), head, prop('to')), messages)
                                      );
                                      assert.deepStrictEqual(recipients, [nico.user.email]);

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
          });
        }
      );
    });
  });

  /**
   * Test that verifies that old activities are not included in an immediate email when they are not situated in the email interval
   */
  it('verify old activities in the email stream are not included for immediate emails', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 4, (err, users) => {
      assert.notExists(err);
      const { 0: mrvisser, 1: simong } = users;

      // Set the appropriate email preference for mrvisser
      RestAPI.User.updateUser(
        mrvisser.restContext,
        mrvisser.user.id,
        { emailPreference: 'immediate' },
        err => {
          assert.notExists(err);

          // Generate an email activity for mrvisser at the current time
          RestAPI.Content.createLink(
            simong.restContext,
            {
              displayName: 'Google',
              description: 'Awesome Google',
              visibility: PUBLIC,
              link: 'http://www.google.ca',
              managers: NO_MANAGERS,
              viewers: [mrvisser.user.id],
              folders: NO_FOLDERS
            },
            (err, linkNow) => {
              assert.notExists(err);

              // Deliver the activity
              ActivityTestUtil.collectAndGetActivityStream(
                mrvisser.restContext,
                null,
                null,
                err => {
                  assert.notExists(err);

                  // Generate an email activity for mrvisser 3 hours in the future by monkey-patching the `Date.now` function
                  const now = Date.now();
                  Date.now = function() {
                    return now + 5 * 60 * 60 * 1000;
                  };

                  RestAPI.Content.createLink(
                    simong.restContext,
                    {
                      displayName: 'Yahoo',
                      description: 'Awesome Yahoo',
                      visibility: PUBLIC,
                      link: 'http://www.yahoo.ca',
                      managers: NO_MANAGERS,
                      viewers: [mrvisser.user.id],
                      folders: NO_FOLDERS
                    },
                    (err, linkLater) => {
                      assert.notExists(err);

                      // Collect the email as though it is 3 hours ahead. Ensure only the later content item email gets sent to mrvisser
                      EmailTestUtil.collectAndFetchEmailsForBucket(
                        0,
                        'immediate',
                        null,
                        null,
                        messages => {
                          assert.notExists(err);
                          assert.strictEqual(messages.length, 1);
                          assert.strictEqual(messages[0].to[0].address, mrvisser.user.email);

                          // Ensure the email contains the more recent content item but not the one that is too far in the past
                          assert.notStrictEqual(
                            messages[0].html.indexOf(linkLater.displayName),
                            -1
                          );
                          assert.strictEqual(messages[0].html.indexOf(linkNow.displayName), -1);

                          // Reset the Date.now function and then recollect to ensure we can still send the original email
                          Date.now = _originalDateNow;

                          // Schedule an email collection for mrvisser again
                          RestAPI.Content.createLink(
                            simong.restContext,
                            {
                              displayName: 'AltaWhat?',
                              description: 'AltaWhat?',
                              visibility: PUBLIC,
                              link: 'http://www.altavista.ca',
                              managers: NO_MANAGERS,
                              viewers: [mrvisser.user.id],
                              folders: NO_FOLDERS
                            },
                            (err, linkNow2) => {
                              assert.notExists(err);

                              // Collect the email for the current time and ensure we get the 2 "now" items
                              EmailTestUtil.collectAndFetchEmailsForBucket(
                                0,
                                'immediate',
                                null,
                                null,
                                messages => {
                                  assert.notExists(err);
                                  assert.strictEqual(messages.length, 1);
                                  assert.strictEqual(
                                    messages[0].to[0].address,
                                    mrvisser.user.email
                                  );

                                  // Ensure the email contains the more recent content item but not the one that is too far in the past
                                  assert.strictEqual(
                                    messages[0].html.indexOf(linkLater.displayName),
                                    -1
                                  );
                                  assert.notStrictEqual(
                                    messages[0].html.indexOf(linkNow.displayName),
                                    -1
                                  );
                                  assert.notStrictEqual(
                                    messages[0].html.indexOf(linkNow2.displayName),
                                    -1
                                  );
                                  return callback();
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
            }
          );
        }
      );
    });
  });

  /**
   * Test that verifies that old activities are not included in an daily email when they are not situated in the email interval
   */
  it('verify old activities in the email stream are not included for daily emails', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 4, (err, users) => {
      assert.notExists(err);
      const { 0: mrvisser, 1: simong } = users;

      refreshConfiguration(null, true, false, null, config => {
        // Set the appropriate email preference for mrvisser
        RestAPI.User.updateUser(
          mrvisser.restContext,
          mrvisser.user.id,
          { emailPreference: 'daily' },
          err => {
            assert.notExists(err);

            // Generate an email activity for mrvisser at the current time
            RestAPI.Content.createLink(
              simong.restContext,
              {
                displayName: 'Google',
                description: 'Awesome Google',
                visibility: PUBLIC,
                link: 'http://www.google.ca',
                managers: NO_MANAGERS,
                viewers: [mrvisser.user.id],
                folders: NO_FOLDERS
              },
              (err, linkNow) => {
                assert.notExists(err);

                // Deliver the activity
                ActivityTestUtil.collectAndGetActivityStream(
                  mrvisser.restContext,
                  null,
                  null,
                  err => {
                    assert.notExists(err);

                    // Generate an email activity for mrvisser 2 days in the future by monkey-patching the `Date.now` function
                    const now = Date.now();
                    Date.now = function() {
                      return now + 2 * 24 * 60 * 60 * 1000;
                    };

                    RestAPI.Content.createLink(
                      simong.restContext,
                      {
                        displayName: 'Yahoo',
                        description: 'Awesome Yahoo',
                        visibility: PUBLIC,
                        link: 'http://www.yahoo.ca',
                        managers: NO_MANAGERS,
                        viewers: [mrvisser.user.id],
                        folders: NO_FOLDERS
                      },
                      (err, linkLater) => {
                        assert.notExists(err);

                        // Collect the email as though it is 2 days ahead. Ensure only the later content item email gets sent to mrvisser
                        EmailTestUtil.collectAndFetchEmailsForBucket(
                          0,
                          'daily',
                          null,
                          config.mail.daily.hour,
                          messages => {
                            assert.notExists(err);
                            assert.strictEqual(messages.length, 1);
                            assert.strictEqual(messages[0].to[0].address, mrvisser.user.email);

                            // Ensure the email contains the more recent content item but not the one that is too far in the past
                            assert.notStrictEqual(
                              messages[0].html.indexOf(linkLater.displayName),
                              -1
                            );
                            assert.strictEqual(messages[0].html.indexOf(linkNow.displayName), -1);

                            // Reset the Date.now function and then recollect to ensure we can still send the original email
                            Date.now = _originalDateNow;

                            // Schedule an email collection for mrvisser again
                            RestAPI.Content.createLink(
                              simong.restContext,
                              {
                                displayName: 'AltaWhat?',
                                description: 'AltaWhat?',
                                visibility: PUBLIC,
                                link: 'http://www.altavista.ca',
                                managers: NO_MANAGERS,
                                viewers: [mrvisser.user.id],
                                folders: NO_FOLDERS
                              },
                              (err, linkNow2) => {
                                assert.notExists(err);

                                // Collect the email for the current time and ensure we get the 2 "now" items
                                EmailTestUtil.collectAndFetchEmailsForBucket(
                                  0,
                                  'daily',
                                  null,
                                  config.mail.daily.hour,
                                  messages => {
                                    assert.notExists(err);
                                    assert.strictEqual(messages.length, 1);
                                    assert.strictEqual(
                                      messages[0].to[0].address,
                                      mrvisser.user.email
                                    );

                                    // Ensure the email contains the more recent content item but not the one that is too far in the past
                                    assert.strictEqual(
                                      messages[0].html.indexOf(linkLater.displayName),
                                      -1
                                    );
                                    assert.notStrictEqual(
                                      messages[0].html.indexOf(linkNow.displayName),
                                      -1
                                    );
                                    assert.notStrictEqual(
                                      messages[0].html.indexOf(linkNow2.displayName),
                                      -1
                                    );
                                    return callback();
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
              }
            );
          }
        );
      });
    });
  });

  /**
   * Test that verifies that old activities are not included in an weekly email when they are not situated in the email interval
   */
  it('verify old activities in the email stream are not included for weekly emails', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 4, (err, users) => {
      assert.notExists(err);
      const { 0: mrvisser, 1: simong } = users;

      refreshConfiguration(null, false, true, null, config => {
        // Set the appropriate email preference for mrvisser
        RestAPI.User.updateUser(
          mrvisser.restContext,
          mrvisser.user.id,
          { emailPreference: 'weekly' },
          err => {
            assert.notExists(err);

            // Generate an email activity for mrvisser at the current time
            RestAPI.Content.createLink(
              simong.restContext,
              {
                displayName: 'Google',
                description: 'Awesome Google',
                visibility: PUBLIC,
                link: 'http://www.google.ca',
                managers: NO_MANAGERS,
                viewers: [mrvisser.user.id],
                folders: NO_FOLDERS
              },
              (err, linkNow) => {
                assert.notExists(err);

                // Deliver the activity
                ActivityTestUtil.collectAndGetActivityStream(
                  mrvisser.restContext,
                  null,
                  null,
                  err => {
                    assert.notExists(err);

                    // Generate an email activity for mrvisser 2 weeks in the future by monkey-patching the `Date.now` function
                    const now = Date.now();
                    Date.now = function() {
                      return now + 2 * 7 * 24 * 60 * 60 * 1000;
                    };

                    RestAPI.Content.createLink(
                      simong.restContext,
                      {
                        displayName: 'Yahoo',
                        description: 'Awesome Yahoo',
                        visibility: PUBLIC,
                        link: 'http://www.yahoo.ca',
                        managers: NO_MANAGERS,
                        viewers: [mrvisser.user.id],
                        folders: NO_FOLDERS
                      },
                      (err, linkLater) => {
                        assert.notExists(err);

                        // Collect the email as though it is 2 weeks ahead. Ensure only the later content item email gets sent to mrvisser
                        EmailTestUtil.collectAndFetchEmailsForBucket(
                          0,
                          'weekly',
                          config.mail.weekly.day,
                          config.mail.weekly.hour,
                          messages => {
                            assert.notExists(err);
                            assert.strictEqual(messages.length, 1);
                            assert.strictEqual(messages[0].to[0].address, mrvisser.user.email);

                            // Ensure the email contains the more recent content item but not the one that is too far in the past
                            assert.notStrictEqual(
                              messages[0].html.indexOf(linkLater.displayName),
                              -1
                            );
                            assert.strictEqual(messages[0].html.indexOf(linkNow.displayName), -1);

                            // Reset the Date.now function and then recollect to ensure we can still send the original email
                            Date.now = _originalDateNow;

                            // Schedule an email collection for mrvisser again
                            RestAPI.Content.createLink(
                              simong.restContext,
                              {
                                displayName: 'AltaWhat?',
                                description: 'AltaWhat?',
                                visibility: PUBLIC,
                                link: 'http://www.altavista.ca',
                                managers: NO_MANAGERS,
                                viewers: [mrvisser.user.id],
                                folders: NO_FOLDERS
                              },
                              (err, linkNow2) => {
                                assert.notExists(err);

                                // Collect the email for the current time and ensure we get the 2 "now" items
                                EmailTestUtil.collectAndFetchEmailsForBucket(
                                  0,
                                  'weekly',
                                  config.mail.weekly.day,
                                  config.mail.weekly.hour,
                                  messages => {
                                    assert.notExists(err);
                                    assert.strictEqual(messages.length, 1);
                                    assert.strictEqual(
                                      messages[0].to[0].address,
                                      mrvisser.user.email
                                    );

                                    // Ensure the email contains the more recent content item but not the one that is too far in the past
                                    assert.strictEqual(
                                      messages[0].html.indexOf(linkLater.displayName),
                                      -1
                                    );
                                    assert.notStrictEqual(
                                      messages[0].html.indexOf(linkNow.displayName),
                                      -1
                                    );
                                    assert.notStrictEqual(
                                      messages[0].html.indexOf(linkNow2.displayName),
                                      -1
                                    );
                                    return callback();
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
              }
            );
          }
        );
      });
    });
  });

  /**
   * Test that verifies that the email subject is translated and depends on the activities/email preference
   */
  it('verify email subject headers', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 4, (err, users) => {
      assert.notExists(err);
      const { 0: simong, 1: nico, 2: branden, 3: bert } = users;

      RestAPI.User.updateUser(
        branden.restContext,
        branden.user.id,
        { emailPreference: 'daily' },
        err => {
          assert.notExists(err);
          RestAPI.User.updateUser(
            bert.restContext,
            bert.user.id,
            { emailPreference: 'weekly' },
            err => {
              assert.notExists(err);

              // Enable daily and weekly mails
              refreshConfiguration(null, true, true, {}, (/* config */) => {
                // Trigger a mail for Nico
                RestAPI.Content.createLink(
                  simong.restContext,
                  {
                    displayName: 'Google',
                    description: 'Google',
                    visibility: PUBLIC,
                    link: 'http://www.google.ca',
                    managers: NO_MANAGERS,
                    viewers: [nico.user.id],
                    folders: NO_FOLDERS
                  },
                  (err, link) => {
                    assert.notExists(err);
                    EmailTestUtil.collectAndFetchAllEmails(messages => {
                      assert.lengthOf(messages, 1);

                      // Assert that we're using a localized message for the subject header
                      const mail = messages[0];
                      assert.strictEqual(mail.subject.indexOf('__MSG__'), -1);

                      // The message can change, but the actor's and object's displayname will usually be in there
                      assert.ok(mail.subject.includes(simong.user.displayName));
                      assert.ok(mail.subject.includes(link.displayName));

                      // Trigger a mail that contains two different activities
                      RestAPI.Content.createLink(
                        simong.restContext,
                        {
                          displayName: 'Google',
                          description: 'Google',
                          visibility: PUBLIC,
                          link: 'http://www.google.ca',
                          managers: NO_MANAGERS,
                          viewers: [nico.user.id],
                          folders: NO_FOLDERS
                        },
                        (err /* , secondLink */) => {
                          assert.notExists(err);
                          RestAPI.Discussions.createDiscussion(
                            simong.restContext,
                            'First discussion',
                            'descr',
                            'public',
                            null,
                            [nico.user.id],
                            (err /* , firstDiscussion */) => {
                              assert.notExists(err);

                              // Collect the e-mail, there should only be one
                              EmailTestUtil.collectAndFetchAllEmails(messages => {
                                assert.lengthOf(messages, 1);

                                // Assert that we're using a localized message for the subject header
                                const secondMail = messages[0];
                                assert.strictEqual(secondMail.subject.indexOf('__MSG__'), -1);

                                // Assert that this mail's subject is different from the initial mail as it spans two activities
                                assert.notStrictEqual(mail.subject, secondMail.subject);

                                // Trigger a mail for Branden and Bert
                                RestAPI.Content.createLink(
                                  simong.restContext,
                                  {
                                    displayName: 'Google',
                                    description: 'Google',
                                    visibility: PUBLIC,
                                    link: 'http://www.google.ca',
                                    managers: NO_MANAGERS,
                                    viewers: [branden.user.id, bert.user.id],
                                    folders: NO_FOLDERS
                                  },
                                  (err /* , thirdLink */) => {
                                    assert.notExists(err);
                                    EmailTestUtil.collectAndFetchAllEmails(messages => {
                                      assert.lengthOf(messages, 2);

                                      /**
                                       * Assert that the two subject headers are different
                                       * as they have different email preferences
                                       */
                                      const brandenMessage = find(
                                        compose(
                                          equals(branden.user.email),
                                          prop('address'),
                                          head,
                                          prop('to')
                                        ),
                                        messages
                                      );
                                      const bertMessage = find(
                                        compose(
                                          equals(bert.user.email),
                                          prop('address'),
                                          head,
                                          prop('to')
                                        ),
                                        messages
                                      );
                                      assert.notStrictEqual(
                                        brandenMessage.subject,
                                        bertMessage.subject
                                      );
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
            }
          );
        }
      );
    });
  });

  /**
   * Test that verifies that the email content supports Markdown comments
   */
  it('verify email markdown parsing', callback => {
    // Create users for the test
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users) => {
      assert.notExists(err);
      const { 0: user1, 1: user2 } = users;

      // Make sure that the first user receives email messages
      RestAPI.User.updateUser(
        user1.restContext,
        user1.user.id,
        { emailPreference: 'immediate' },
        err => {
          assert.notExists(err);

          // Create a discussion on which to comment
          RestAPI.Discussions.createDiscussion(
            user1.restContext,
            'Test Discussion',
            'Test Description',
            'public',
            null,
            [user2.user.id],
            (err, discussion) => {
              assert.notExists(err);

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
                /* Style inserted here */ '>Image: <img\n alt="Alternate Text"\n src="http://www.oaeproject.org/themes/oae/logo.png"\n style="',
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
                '<p'
              ];

              RestAPI.Discussions.createMessage(
                user2.restContext,
                discussion.id,
                markdownBody,
                null,
                (err /* , comment */) => {
                  assert.notExists(err);

                  // Get the resulting email notification
                  EmailTestUtil.collectAndFetchAllEmails(messages => {
                    // Find the email message for the first user
                    const mail = find(
                      compose(equals(user1.user.email), prop('address'), head, prop('to')),
                      messages
                    );
                    assert.ok(mail);

                    // Verify all the expected HTML content is present in the message
                    forEach(htmlFragment => {
                      assert.notStrictEqual(mail.html.indexOf(htmlFragment), -1, htmlFragment);
                    }, htmlBody);

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

  /**
   * Test that verifies that dates in email are in the tenant timezone
   */
  it('verify email date timezones', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users) => {
      assert.notExists(err);
      const { 0: simong, 1: nico } = users;

      const alias = TenantsTestUtil.generateTestTenantAlias();
      const host = TenantsTestUtil.generateTestTenantHost();
      TestsUtil.createTenantWithAdmin(alias, host, (err, tenant, restContext /* , admin */) => {
        assert.notExists(err);

        TestsUtil.generateTestUsers(restContext, 1, (err, users) => {
          assert.notExists(err);
          const { 0: bert } = users;

          // Configure the default timezone to something that's 5 hours behind
          ConfigTestUtil.updateConfigAndWait(
            restContext,
            null,
            { 'oae-tenants/timezone/timezone': 'Etc/GMT+5' },
            err => {
              assert.notExists(err);

              // Trigger a mail for Nico and Bert
              RestAPI.Content.createLink(
                simong.restContext,
                {
                  displayName: 'Google',
                  description: 'Google',
                  visibility: PUBLIC,
                  link: 'http://www.google.ca',
                  managers: NO_MANAGERS,
                  viewers: [nico.user.id, bert.user.id],
                  folders: NO_FOLDERS
                },
                (err /* , link */) => {
                  assert.notExists(err);
                  EmailTestUtil.collectAndFetchAllEmails(messages => {
                    assert.strictEqual(messages.length, 2);

                    // Assert that the messages contain properly formatted dates
                    const utcMessage = find(
                      compose(equals(nico.user.email), prop('address'), head, prop('to')),
                      messages
                    );
                    const plus5Message = find(
                      compose(equals(bert.user.email), prop('address'), head, prop('to')),
                      messages
                    );

                    // Parse the dates out of the messages
                    const utcDate = utcMessage.html.match(/\d\d\d\d-\d\d-\d\d \d\d:\d\d:\d\d/g)[0];
                    const plus5Date = plus5Message.html.match(
                      /\d\d\d\d-\d\d-\d\d \d\d:\d\d:\d\d/g
                    )[0];

                    // Assert that the offsets are correct
                    const utcHour = parseInt(utcDate.slice(11, 13), 10);
                    const plus5Hour = parseInt(plus5Date.slice(11, 13), 10);
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
    TestsUtil.generateTestUsers(camAdminRestContext, 5, (err, users) => {
      assert.notExists(err);
      const { 0: simong, 1: nico, 2: branden, 3: bert, 4: stuart } = users;

      // Give our 4 recipients different email preferences
      RestAPI.User.updateUser(
        nico.restContext,
        nico.user.id,
        { emailPreference: 'immediate' },
        err => {
          assert.notExists(err);
          RestAPI.User.updateUser(
            branden.restContext,
            branden.user.id,
            { emailPreference: 'daily' },
            err => {
              assert.notExists(err);
              RestAPI.User.updateUser(
                bert.restContext,
                bert.user.id,
                { emailPreference: 'weekly' },
                err => {
                  assert.notExists(err);
                  RestAPI.User.updateUser(
                    stuart.restContext,
                    stuart.user.id,
                    { emailPreference: 'never' },
                    err => {
                      assert.notExists(err);

                      // The next email collection cycle should handle immediate, daily and weekly deliveries
                      refreshConfiguration(null, true, true, {}, (/* config */) => {
                        // Trigger an email-worthy activity for our recipients
                        RestAPI.Content.createLink(
                          simong.restContext,
                          {
                            displayName: 'Google',
                            description: 'Google',
                            visibility: PUBLIC,
                            link: 'http://www.google.ca',
                            managers: NO_MANAGERS,
                            viewers: [nico.user.id, branden.user.id, bert.user.id, stuart.user.id],
                            folders: NO_FOLDERS
                          },
                          err => {
                            assert.notExists(err);

                            // Deliver the activities
                            ActivityTestUtil.collectAndGetActivityStream(
                              nico.restContext,
                              null,
                              null,
                              (err /* activityStream */) => {
                                assert.notExists(err);

                                // Let each user mark his notifications as read
                                ActivityTestUtil.markNotificationsAsRead(nico.restContext, () => {
                                  ActivityTestUtil.markNotificationsAsRead(
                                    branden.restContext,
                                    (/* result */) => {
                                      ActivityTestUtil.markNotificationsAsRead(
                                        bert.restContext,
                                        (/* result */) => {
                                          ActivityTestUtil.markNotificationsAsRead(
                                            stuart.restContext,
                                            (/* result */) => {
                                              // Deliver the e-mails, only Branden and Bert should get an e-mail as stuart has
                                              // selected to never get emails and Nico his activity email stream should've been
                                              // cleared when he marked his notifications as read
                                              EmailTestUtil.collectAndFetchAllEmails(messages => {
                                                assert.lengthOf(messages, 2);
                                                forEach(message => {
                                                  assert.ok(
                                                    contains(message.to[0].address, [
                                                      branden.user.email,
                                                      bert.user.email
                                                    ])
                                                  );
                                                }, messages);

                                                return callback();
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
    });
  });

  /**
   * Test that verifies that when a user changing his email preference, he does not get double emails
   */
  it('verify changing the email preference does not result in double emails', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users) => {
      assert.notExists(err);
      const { 0: simong, 1: nico } = users;

      // The next email collection cycle should only handle `immediate` deliveries
      refreshConfiguration(null, false, false, {}, config => {
        // Trigger an email
        RestAPI.Content.createLink(
          simong.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: [nico.user.id],
            folders: NO_FOLDERS
          },
          (err /* , link */) => {
            assert.notExists(err);

            // Run an activity collection, which will queue an immediate email for Nico
            ActivityTestUtil.collectAndGetActivityStream(nico.restContext, null, null, (
              err /* , activityStream */
            ) => {
              assert.notExists(err);

              // Change Nico's email preference to daily
              RestAPI.User.updateUser(
                nico.restContext,
                nico.user.id,
                { emailPreference: 'daily' },
                err => {
                  assert.notExists(err);
                }
              );

              ActivityAPI.emitter.once(ActivityConstants.events.UPDATED_USER, () => {
                // When we collect the emails, Nico should not get an email
                EmailTestUtil.collectAndFetchAllEmails(messages => {
                  assert.strictEqual(messages.length, 0);

                  // Sanity check that Nico gets the email when the dailies are sent out
                  ActivityEmail.collectMails(
                    0,
                    'daily',
                    null,
                    config.mail.daily.hour,
                    (err, empty, users) => {
                      assert.notExists(err);
                      assert.strictEqual(users.length, 1);
                      assert.strictEqual(users[0].id, nico.user.id);
                      return callback();
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
   * Test that verifies that user who change their email preference to never don't get any emails
   */
  it('verify changing the email preference to never results in no mail', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users) => {
      assert.notExists(err);
      const { 0: simong, 1: nico } = users;

      // The next email collection cycle should only handle `immediate` deliveries
      refreshConfiguration(null, false, false, {}, (/* config */) => {
        // Assert that the user was still receiving emails (by virtue of the default being `immediate`)
        RestAPI.Content.createLink(
          simong.restContext,
          {
            displayName: 'Google',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: [nico.user.id],
            folders: NO_FOLDERS
          },
          (err /* , link */) => {
            assert.notExists(err);

            // When we collect the emails, Nico should get an email
            EmailTestUtil.collectAndFetchAllEmails(messages => {
              assert.strictEqual(messages.length, 1);

              // Now change Nico's preference to never
              RestAPI.User.updateUser(
                nico.restContext,
                nico.user.id,
                { emailPreference: 'never' },
                err => {
                  assert.notExists(err);

                  // Try to trigger an email
                  RestAPI.Content.createLink(
                    simong.restContext,
                    {
                      displayName: 'Google',
                      description: 'Google',
                      visibility: PUBLIC,
                      link: 'http://www.google.ca',
                      managers: NO_MANAGERS,
                      viewers: [nico.user.id],
                      folders: NO_FOLDERS
                    },
                    (err /* , link */) => {
                      assert.notExists(err);

                      // When we collect the emails, Nico should get an email
                      EmailTestUtil.collectAndFetchAllEmails(messages => {
                        assert.strictEqual(messages.length, 0);
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
    TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users) => {
      assert.notExists(err);
      const { 0: simong, 1: nico, 2: branden } = users;

      // Set the aggregate expiry time to 1 second. This should give us enough time to aggregate 2 activities, wait for expiry, then create 2 more
      refreshConfiguration(
        null,
        false,
        false,
        { collectionPollingFrequency: -1, aggregateIdleExpiry: 1 },
        (/* config */) => {
          RestAPI.Content.createLink(
            simong.restContext,
            {
              displayName: 'Link A',
              description: 'Link A',
              visibility: PUBLIC,
              link: 'http://www.google.com',
              managers: NO_MANAGERS,
              viewers: NO_VIEWERS,
              folders: NO_FOLDERS
            },
            (err, contentObj) => {
              assert.notExists(err);
              RestAPI.Content.createComment(
                nico.restContext,
                contentObj.id,
                'Comment A',
                null,
                (err, commentA) => {
                  assert.notExists(err);
                  RestAPI.Content.createComment(
                    branden.restContext,
                    contentObj.id,
                    'Comment B',
                    null,
                    (err, commentB) => {
                      assert.notExists(err);

                      // Collect the activity stream so A and B can aggregate
                      ActivityTestUtil.collectAndGetActivityStream(simong.restContext, null, null, (
                        err /* , activityStream */
                      ) => {
                        assert.notExists(err);

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
                            assert.notExists(err);
                            RestAPI.Content.createComment(
                              branden.restContext,
                              contentObj.id,
                              'Comment D',
                              null,
                              (err, commentD) => {
                                assert.notExists(err);

                                // Collect the emails, there should only be one containing one activity which is an aggregate of 4 comments
                                EmailTestUtil.collectAndFetchAllEmails(messages => {
                                  // 3 messages, 1 for Simon (manager) and 2 for Nico and Branden (recent commenters)
                                  assert.strictEqual(messages.length, 3);

                                  // The message for Simon should contain 1 content-comment activity on 1 content item with 4 comments
                                  const simongMessage = find(
                                    compose(
                                      equals(simong.user.email),
                                      prop('address'),
                                      head,
                                      prop('to')
                                    ),
                                    messages
                                  );
                                  // Assert that the correct content item is included in the email
                                  assert.strictEqual(
                                    simongMessage.html.match(contentObj.profilePath).length,
                                    1
                                  );

                                  // Assert that all 4 comments are in the email
                                  assert.strictEqual(
                                    simongMessage.html.match(/activity-comment-container/g).length,
                                    4
                                  );
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
   * Test that verifies that the email template does some basic checks such as asserting there are
   * no untranslated keys, untranslated dynamic variables, links to relative paths, etc.
   */
  it('verify basic checks in email template', callback => {
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users) => {
      assert.notExists(err);
      const { 0: simong, 1: nico } = users;

      // The next email collection cycle should only handle `immediate` deliveries
      refreshConfiguration(null, false, false, {}, (/* config */) => {
        // Trigger an email with a long display name
        const displayName = TestsUtil.generateRandomText(3);
        RestAPI.Content.createLink(
          simong.restContext,
          {
            displayName,
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: [nico.user.id],
            folders: NO_FOLDERS
          },
          (err, link) => {
            assert.notExists(err);

            // Run an activity collection, which will queue an immediate email for Nico
            ActivityTestUtil.collectAndGetActivityStream(nico.restContext, null, null, (
              err /* , activityStream */
            ) => {
              assert.notExists(err);

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
                assert.strictEqual(
                  html.indexOf('href="/'),
                  -1,
                  'Links in emails should include the tenant base url'
                );
                assert.strictEqual(
                  html.indexOf('src="/'),
                  -1,
                  'Links in emails should include the tenant base url'
                );

                // Assert that html links have been converted to "plain text links"
                assert.strictEqual(text.indexOf('<a href='), -1);
                assert.notStrictEqual(text.indexOf(link.profilePath), -1);

                // Ensure the long display name gets truncated
                assert.notStrictEqual(
                  html.indexOf(util.format('%s...', displayName.slice(0, 30))),
                  -1
                );

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
    TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users) => {
      assert.notExists(err);
      const { 0: mrvisser, 1: simong } = users;

      RestAPI.User.updateUser(
        mrvisser.restContext,
        mrvisser.user.id,
        { visibility: 'private' },
        (err, updatedMrvisser) => {
          assert.notExists(err);
          assert.strictEqual(updatedMrvisser.visibility, 'private');

          // Mrvisser follows simong now that he is private
          RestAPI.Following.follow(mrvisser.restContext, simong.user.id, err => {
            assert.notExists(err);

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
              const $thumbnail = $html.find(
                util.format('img[alt="%s"]', mrvisser.user.publicAlias)
              );
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
      TestsUtil.generateTestUsers(camAdminRestContext, 2, (err, users) => {
        assert.notExists(err);
        const { 0: simong, 1: nico } = users;

        // Trigger an email with 2 activities
        RestAPI.Content.createLink(
          simong.restContext,
          {
            displayName: 'Link #1',
            description: 'Google',
            visibility: PUBLIC,
            link: 'http://www.google.ca',
            managers: NO_MANAGERS,
            viewers: [nico.user.id]
          },
          (err /* , link */) => {
            assert.notExists(err);
            RestAPI.Content.createLink(
              simong.restContext,
              {
                displayName: 'Link #2',
                description: 'Google',
                visibility: PUBLIC,
                link: 'http://www.google.ca',
                managers: NO_MANAGERS,
                viewers: [nico.user.id]
              },
              (err /* , link */) => {
                assert.notExists(err);

                // Run an activity collection, which will queue an immediate email for Nico
                ActivityTestUtil.collectAndGetActivityStream(nico.restContext, null, null, (
                  err /* , activityStream */
                ) => {
                  assert.notExists(err);

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
    TestsUtil.generateTestUsers(camAdminRestContext, 3, (err, users) => {
      assert.notExists(err);
      const { 0: simong, 1: nico } = users;

      TestsUtil.generateTestGroups(simong.restContext, 1, (err, groups) => {
        assert.notExists(err);
        let { 0: group } = groups;
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
                {
                  displayName: 'Google',
                  description: 'Google',
                  visibility: PUBLIC,
                  link: 'http://www.myawesomelinkthatilike.ca',
                  managers: [group.id],
                  viewers: NO_VIEWERS,
                  folders: NO_FOLDERS
                },
                err => {
                  assert.notExists(err);
                  RestAPI.Content.createLink(
                    simong.restContext,
                    {
                      displayName: 'Google',
                      description: 'Google',
                      visibility: PUBLIC,
                      link:
                        'http://www.anotherlinkthatilike.ca/this/is/reasonably/long?so=what&will=happen',
                      managers: [group.id],
                      viewers: NO_VIEWERS,
                      folders: NO_FOLDERS
                    },
                    err => {
                      assert.notExists(err);

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
