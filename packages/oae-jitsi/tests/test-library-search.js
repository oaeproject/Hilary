import { assert } from 'chai';

import * as RestAPI from 'oae-rest';
import * as SearchTestsUtil from 'oae-search/lib/test/util';
import * as TestsUtil from 'oae-tests';

import { head, last } from 'ramda';

const { createMeeting } = RestAPI.MeetingsJitsi;
const { generateTestUsers, generateRandomText, createTenantAdminRestContext } = TestsUtil;
const { searchAll } = SearchTestsUtil;

const PUBLIC = 'public';

describe('Meeting Library Search', () => {
  let camAdminRestContext = null;

  before(callback => {
    camAdminRestContext = createTenantAdminRestContext(global.oaeTests.tenants.cam.host);
    return callback();
  });

  describe('Library search', () => {
    it('verify searching through a meeting library', callback => {
      generateTestUsers(camAdminRestContext, 1, (err, users) => {
        assert.notExists(err);

        const { 0: homer } = users;
        const asHomer = homer.restContext;

        // Create 2 meetings
        const randomTextA = generateRandomText(25);
        const randomTextB = generateRandomText(25);

        createMeeting(asHomer, randomTextA, randomTextA, false, false, PUBLIC, null, null, (err, meetingA) => {
          assert.notExists(err);

          createMeeting(asHomer, randomTextB, randomTextB, false, false, PUBLIC, null, null, (err /* , meetingB */) => {
            assert.notExists(err);

            // Ensure that the randomTextA meeting returns and scores better than randomTextB
            searchAll(asHomer, 'meeting-jitsi-library', [homer.user.id], { q: randomTextA }, (err, results) => {
              assert.notExists(err);
              assert.ok(results.results);

              const firstResult = head(results.results);
              const lastResult = last(results.results);

              assert.ok(firstResult);
              assert.ok(lastResult);

              assert.strictEqual(firstResult.id, meetingA.id);
              assert.strictEqual(firstResult.displayName, randomTextA);
              assert.strictEqual(firstResult.description, randomTextA);

              return callback();
            });
          });
        });
      });
    });
  });
});
