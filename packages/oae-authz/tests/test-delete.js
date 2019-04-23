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

import * as AuthzTestUtil from 'oae-authz/lib/test/util';

describe('Authz Delete', () => {
  /**
   * Test that verifies marking resource ids as deleted works as expected
   */
  it('verify it successfully marks a resource id as deleted', callback => {
    const group1 = 'g:oae-ad:d1';
    const group2 = 'g:oae-ad:d2';

    // Verify simple delete works as expected
    AuthzTestUtil.assertSetDeletedSucceeds(group1, () => {
      // Verify isDeleted that contains 1 non-deleted id works as expected
      AuthzTestUtil.assertIsDeletedSucceeds([group1, group2], [group1], () => {
        // Verify we successfully delete the second id
        AuthzTestUtil.assertSetDeletedSucceeds(group2, () => {
          // Verify isDeleted that contains both deleted ids works as expected
          return AuthzTestUtil.assertIsDeletedSucceeds([group1, group2], [group1, group2], callback);
        });
      });
    });
  });

  /**
   * Test that verifies restoring resource ids works as expected
   */
  it('verify it successfully restores a resource id', callback => {
    const group1 = 'g:oae-ad:r1';
    const group2 = 'g:oae-ad:r2';

    // Delete both groups
    AuthzTestUtil.assertSetDeletedSucceeds(group1, () => {
      AuthzTestUtil.assertSetDeletedSucceeds(group2, () => {
        // Verify simple restore of one id succeeds
        AuthzTestUtil.assertUnsetDeletedSucceeds(group1, () => {
          // Verify isDeleted that contains 1 restored id works as expected
          AuthzTestUtil.assertIsDeletedSucceeds([group1, group2], [group2], () => {
            // Verify we successfully restore the second id
            AuthzTestUtil.assertUnsetDeletedSucceeds(group2, () => {
              // Verify isDeleted that contains both restored ids works as expected
              return AuthzTestUtil.assertIsDeletedSucceeds([group1, group2], [], callback);
            });
          });
        });
      });
    });
  });
});
