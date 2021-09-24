import { assert } from 'chai';

import * as AuthzUtil from 'oae-authz/lib/util.js';
import * as RestAPI from 'oae-rest';
import * as SearchTestsUtil from 'oae-search/lib/test/util.js';
import * as TestsUtil from 'oae-tests';

const { createMeeting, updateMeeting } = RestAPI.MeetingsJitsi;

describe('Meeting Search', () => {
  let camAdminRestContext = null;

  before((callback) => {
    camAdminRestContext = TestsUtil.createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    return callback();
  });

  describe('Indexing', () => {
    it('verify a meeting is correctly indexed when it is created', (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
        assert.notExists(error);
        const { 0: homer } = users;
        const asHomer = homer.restContext;

        // Create a meeting
        const randomText = TestsUtil.generateRandomText(25);

        createMeeting(asHomer, randomText, randomText, false, false, 'public', null, null, (error, meeting) => {
          assert.notExists(error);

          // Ensure the meeting has been correctly indexed
          SearchTestsUtil.searchAll(
            asHomer,
            'general',
            null,
            { resourceTypes: 'meeting-jitsi', q: randomText },
            (error, results) => {
              assert.notExists(error);
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
        });
      });
    });

    it("verify updating the meeting's metadata updates the index", (callback) => {
      TestsUtil.generateTestUsers(camAdminRestContext, 1, (error, users) => {
        assert.notExists(error);
        const { 0: homer } = users;
        const asHomer = homer.restContext;

        // Create a meeting
        const randomTextA = TestsUtil.generateRandomText(25);
        const randomTextB = TestsUtil.generateRandomText(25);

        createMeeting(asHomer, randomTextA, randomTextA, false, false, 'public', null, null, (error, meeting) => {
          assert.notExists(error);

          // Update the meeting's metadata
          updateMeeting(asHomer, meeting.id, { displayName: randomTextB, description: randomTextB }, (error_) => {
            assert.notExists(error_);

            // Ensure the meeting is correctly indexed
            SearchTestsUtil.searchAll(
              asHomer,
              'general',
              null,
              { resourceTypes: 'meeting-jitsi', q: randomTextB },
              (error, results) => {
                assert.notExists(error);
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
          });
        });
      });
    });
  });
});
