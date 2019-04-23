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

import assert from 'assert';
import { Locale } from 'locale';

import { User } from 'oae-principals/lib/model';

import { Context } from 'oae-context';

describe('Context', () => {
  /**
   * Test that verifies a simple context
   */
  it('verify simple context', callback => {
    const user = new User(global.oaeTests.tenants.cam.alias, 'u:camtest:physx', 'physx', 'bert@apereo.org');
    const imposter = new User(global.oaeTests.tenants.cam.alias, 'u:camtest:simong', 'simong', 'simon@apereo.org');
    const ctx = new Context(global.oaeTests.tenants.cam, user, 'twitter', null, imposter);
    assert.deepStrictEqual(ctx.tenant(), global.oaeTests.tenants.cam);
    assert.deepStrictEqual(ctx.user(), user);
    assert.strictEqual(ctx.authenticationStrategy(), 'twitter');
    assert.strictEqual(ctx.locale(), null);
    assert.deepStrictEqual(ctx.imposter(), imposter);
    return callback();
  });

  /**
   * Test that verifies the locale setter can handle defaulted locales
   */
  it('verify the locale setter can handle defaulted locales', callback => {
    const user = new User(global.oaeTests.tenants.cam.alias, 'u:camtest:physx', 'physx', 'bert@apereo.org');
    const ctx = new Context(global.oaeTests.tenants.cam, user, 'twitter', 'en_UK');
    assert.deepStrictEqual(ctx.tenant(), global.oaeTests.tenants.cam);
    assert.deepStrictEqual(ctx.user(), user);

    // Check that if no locale is passed in, the default constructor value is used
    assert.strictEqual(ctx.locale(), 'en_UK');

    // Check that if a "defaulted" locale is passed in, the default constructor value is used
    const defaultedLocale = new Locale('en_US');
    defaultedLocale.defaulted = true;
    assert.strictEqual(ctx.locale(defaultedLocale), 'en_UK');

    // Sanity-check that proper locale values aren't defaulted
    assert.strictEqual(ctx.locale(new Locale('be_BE')), 'be_BE');
    return callback();
  });
});
