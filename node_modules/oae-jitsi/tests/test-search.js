const assert = require('assert');
const _ = require('underscore');

const AuthzUtil = require('oae-authz/lib/util');
const RestAPI = require('oae-rest');
const SearchTestsUtil = require('oae-search/lib/test/util');
const TestsUtil = require('oae-tests');

describe('Meeting Search', () => {
  // REST contexts we can use to do REST requests
  let anonymousRestContext = null;
  let camAdminRestContext = null;

  before(callback => {
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    return callback();
  });

  describe('Indexing', () => {
    it('verify a meeting is correctly indexed when it is created', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, user) => {
        assert.ok(!err);
        const simong = _.values(user)[0];

        // Create a meeting
        const randomText = TestsUtil.generateRandomText(25);

        RestAPI.MeetingsJitsi.createMeeting(
          simong.restContext,
          randomText,
          randomText,
          false,
          false,
          'public',
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            // Ensure the meeting has been correctly indexed
            SearchTestsUtil.searchAll(
              simong.restContext,
              'general',
              null,
              { resourceTypes: 'meeting-jitsi', q: randomText },
              (err, results) => {
                assert.ok(!err);
                assert.ok(results.results);

                const doc = results.results[0];
                assert.ok(doc);
                assert.strictEqual(doc.id, meeting.id);
                assert.strictEqual(doc.displayName, randomText);
                assert.strictEqual(doc.description, randomText);
                assert.strictEqual(
                  doc.profilePath,
                  '/meeting-jitsi/' +
                    global.oaeTests.tenants.cam.alias +
                    '/' +
                    AuthzUtil.getResourceFromId(meeting.id).resourceId
                );

                return callback();
              }
            );
          }
        );
      });
    });

    it("verify updating the meeting's metadata updates the index", callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, user) => {
        assert.ok(!err);
        const simong = _.values(user)[0];

        // Create a meeting
        const randomTextA = TestsUtil.generateRandomText(25);
        const randomTextB = TestsUtil.generateRandomText(25);

        RestAPI.MeetingsJitsi.createMeeting(
          simong.restContext,
          randomTextA,
          randomTextA,
          false,
          false,
          'public',
          null,
          null,
          (err, meeting) => {
            assert.ok(!err);

            // Update the meeting's metadata
            RestAPI.MeetingsJitsi.updateMeeting(
              simong.restContext,
              meeting.id,
              { displayName: randomTextB, description: randomTextB },
              err => {
                assert.ok(!err);

                // Ensure the meeting is correctly indexed
                SearchTestsUtil.searchAll(
                  simong.restContext,
                  'general',
                  null,
                  { resourceTypes: 'meeting-jitsi', q: randomTextB },
                  (err, results) => {
                    assert.ok(!err);
                    assert.ok(results.results);

                    const doc = results.results[0];
                    assert.ok(doc);
                    assert.strictEqual(doc.id, meeting.id);
                    assert.strictEqual(doc.displayName, randomTextB);
                    assert.strictEqual(doc.description, randomTextB);
                    assert.strictEqual(
                      doc.profilePath,
                      '/meeting-jitsi/' +
                        global.oaeTests.tenants.cam.alias +
                        '/' +
                        AuthzUtil.getResourceFromId(meeting.id).resourceId
                    );

                    return callback();
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
