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

import { assert } from 'chai';

import * as RestAPI from 'oae-rest';
import * as TestsUtil from 'oae-tests/lib/util';

describe('Long url', () => {
  let anonymousCamRestContext = null;

  before(callback => {
    anonymousCamRestContext = TestsUtil.createTenantRestContext(global.oaeTests.tenants.cam.host);
    return callback();
  });

  /**
   * Test that verifies that short URLs are expanded
   */
  it('verify it expands short URLs', callback => {
    RestAPI.Previews.expandUrl(anonymousCamRestContext, 'http://youtu.be/FYWLiGOBy1k', (err, data) => {
      assert.notExists(err);
      assert.ok(data);
      assert.strictEqual(data['long-url'], 'https://youtu.be/FYWLiGOBy1k');
      return callback();
    });
  });
});
