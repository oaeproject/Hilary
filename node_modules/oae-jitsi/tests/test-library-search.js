const assert = require('assert');
const _ = require('underscore');

const RestAPI = require('oae-rest');
const SearchTestsUtil = require('oae-search/lib/test/util');
const TestsUtil = require('oae-tests');

describe('Meeting Library Search', () => {
  // REST contexts we can use to do REST requests
  let anonymousRestContext = null;
  let camAdminRestContext = null;

  before(callback => {
    anonymousRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    return callback();
  });

  describe('Library search', () => {
    it('verify searching through a meeting library', callback => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (err, user) => {
        assert.ok(!err);
        const simong = _.values(user)[0];

        // Create 2 meetings
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
          (err, meetingA) => {
            assert.ok(!err);

            RestAPI.MeetingsJitsi.createMeeting(
              simong.restContext,
              randomTextB,
              randomTextB,
              false,
              false,
              'public',
              null,
              null,
              (err, meetingB) => {
                assert.ok(!err);

                // Ensure that the randomTextA meeting returns and scores better than randomTextB
                SearchTestsUtil.searchAll(
                  simong.restContext,
                  'meeting-jitsi-library',
                  [simong.user.id],
                  { q: randomTextA },
                  (err, results) => {
                    assert.ok(!err);
                    assert.ok(results.results);

                    const doc = results.results[0];
                    assert.ok(doc);
                    assert.strictEqual(doc.id, meetingA.id);
                    assert.strictEqual(doc.displayName, randomTextA);
                    assert.strictEqual(doc.description, randomTextA);

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
