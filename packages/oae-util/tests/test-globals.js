/*
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
import { describe, it } from 'mocha';

import _ from 'underscore';

describe('Globals', () => {
  describe('Underscore', () => {
    describe('oaeObj', () => {
      /**
       * Test that verifies that an object is created from a variety of input
       */
      it('verify an object is created from a variety of input', (callback) => {
        assert.deepStrictEqual(_.oaeObj(), {});
        assert.deepStrictEqual(_.oaeObj('key0'), { key0: undefined });
        assert.deepStrictEqual(_.oaeObj('key0', null), { key0: null });
        assert.deepStrictEqual(_.oaeObj('key0', 'val1'), { key0: 'val1' });
        assert.deepStrictEqual(_.oaeObj('key0', 1), { key0: 1 });
        assert.deepStrictEqual(_.oaeObj('key0', { hey: 'great!' }), { key0: { hey: 'great!' } });
        assert.deepStrictEqual(_.oaeObj('key0', { hey: 'great!' }, 'key1', 5), {
          key0: { hey: 'great!' },
          key1: 5
        });
        callback();
      });
    });

    describe('oaeExtendDefined', () => {
      /**
       * Test that verifies that keys are only extended if their values are not undefined
       */
      it('verify keys are only extended if their values are not undefined', (callback) => {
        const source = {
          undefined,
          0: 0,
          null: null
        };

        const extendWith = {
          undefined: null,
          0: undefined,
          null: undefined,
          anotherUndefined: undefined,
          anotherNull: null,
          another0: 0
        };

        const expectedDest = {
          undefined: null,
          0: 0,
          null: null,
          anotherNull: null,
          another0: 0
        };

        // Ensure the result is the expected object, and that `source` gets overridden
        assert.deepStrictEqual(_.oaeExtendDefined(source, extendWith), expectedDest);
        assert.deepStrictEqual(source, expectedDest);
        callback();
      });
    });
  });
});
