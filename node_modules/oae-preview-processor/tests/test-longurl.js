/*!
 * Copyright 2015 Apereo Foundation (AF) Licensed under the
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

const assert = require('assert');

const RestAPI = require('oae-rest');
const TestsUtil = require('oae-tests/lib/util');

describe('Long url', () => {
  let anonymousCamRestContext = null;

  before(callback => {
    anonymousCamRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    return callback();
  });

  /**
   * Mock the HEAD requests the expander API will make
   *
   * @api private
   */
  const _mockRequests = function() {
    // Require nock inline as it messes with the HTTP stack
    // We only want this to happen in a controlled environment
    const nock = require('nock');

    // Ensure we can still perform regular HTTP requests during our tests
    nock.enableNetConnect();

    // The first request redirects to HTTPS
    nock('http://youtu.be')
      .head('/FYWLiGOBy1k')
      .reply(301, 'OK', {
        location: 'https://youtu.be/FYWLiGOBy1k'
      });

    // The second request redirects to the full page
    nock('https://youtu.be')
      .get('/FYWLiGOBy1k')
      .reply(301, 'OK', {
        location: 'https://www.youtube.com/watch?v=FYWLiGOBy1k&feature=youtu.be'
      });

    // The third request does not redirect
    nock('https://www.youtube.com')
      .get('/watch?v=FYWLiGOBy1k&feature=youtu.be')
      .reply(200, '<html>..</html>');
  };

  /**
   * Test that verifies that short URLs are expanded
   */
  it('verify it expands short URLs', callback => {
    // Mock the HEAD requests
    _mockRequests();

    RestAPI.Previews.expandUrl(
      anonymousCamRestContext,
      'http://youtu.be/FYWLiGOBy1k',
      (err, data) => {
        assert.ok(!err);
        assert.ok(data);
        assert.strictEqual(
          data['long-url'],
          'https://www.youtube.com/watch?v=FYWLiGOBy1k&feature=youtu.be'
        );
        return callback();
      }
    );
  });
});
