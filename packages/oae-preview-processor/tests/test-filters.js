/*!
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
import { length, head, equals, forEach, isEmpty, nth, compose, not } from 'ramda';
import { Content } from 'oae-content/lib/model.js';
import { FilterGenerator } from 'oae-preview-processor/lib/filters.js';

const isNotEmpty = compose(not, isEmpty);
const isFalse = (x) => equals(false, x);
const isTrue = (x) => equals(true, x);

describe('Preview processor - filters', () => {
  /**
   * A set of timestamps (ms since epoch) each a day apart
   * (A = 5 days ago against F, B = 4 days ago, etc)
   */
  const times = {
    A: 1_378_396_474_099,
    B: 1_378_482_876_661,
    C: 1_378_569_279_923,
    D: 1_378_655_682_036,
    E: 1_378_742_084_186,
    F: 1_378_828_613_052
  };

  /**
   * Get some mocked content data
   *
   * @return {Object[]} Returns an array of mocked content items that each has at least one revision
   * @api private
   */
  const _getMockData = function () {
    // Fake 5 content items
    const content = [
      new Content('camtest', 'c:camtest:a', 'public', 'A', 'A', 'file', 'u:camtest:simon', times.A, times.E, 'a-3'),
      new Content('camtest', 'c:camtest:b', 'public', 'B', 'B', 'link', 'u:camtest:nico', times.B, times.B, 'b-1'),
      new Content(
        'camtest',
        'c:camtest:c',
        'public',
        'C',
        'C',
        'collabdoc',
        'u:camtest:mrvisser',
        times.B,
        times.D,
        'c-3'
      ),
      new Content('camtest', 'c:camtest:d', 'public', 'D', 'D', 'file', 'u:camtest:simon', times.C, times.D, 'd-2'),
      new Content('gttest', 'c:gttest:e', 'public', 'E', 'E', 'file', 'u:gttest:stuart', times.D, times.F, 'e-2')
    ];

    // Make sure we create the contentId field because we need it for the contentIdFilter test
    forEach((eachContent) => {
      eachContent.contentId = eachContent.id;
    }, content);

    // Give each content item a revision
    content[0].previews = { status: 'error' };
    content[0].revisions = [
      {
        revisionId: 'a-1',
        created: times.A,
        createdBy: 'u:camtest:simon',
        mime: 'application/pdf',
        previews: { status: 'done' }
      },
      {
        revisionId: 'a-2',
        created: times.B,
        createdBy: 'u:camtest:bert',
        mime: 'application/msword',
        previews: { status: 'error' }
      },
      {
        revisionId: 'a-3',
        created: times.E,
        createdBy: 'u:camtest:bert',
        mime: 'application/excel',
        previews: { status: 'error' }
      }
    ];

    content[1].previews = { status: 'done' };
    content[1].revisions = [
      {
        revisionId: 'b-1',
        created: times.B,
        createdBy: 'u:camtest:nico',
        previews: { status: 'done' }
      }
    ];
    content[2].previews = { status: 'done' };
    content[2].revisions = [
      {
        revisionId: 'c-1',
        created: times.B,
        createdBy: 'u:camtest:mrvisser',
        etherpadHtml: 'Foo',
        previews: { status: 'done' }
      },
      {
        revisionId: 'c-2',
        created: times.C,
        createdBy: 'u:camtest:mrvisser',
        etherpadHtml: 'Bar',
        previews: { status: 'done' }
      },
      {
        revisionId: 'c-3',
        created: times.D,
        createdBy: 'u:camtest:mrvisser',
        etherpadHtml: 'Baz',
        previews: { status: 'done' }
      }
    ];
    content[3].previews = { status: 'ignored' };
    content[3].revisions = [
      {
        revisionId: 'd-1',
        created: times.C,
        createdBy: 'u:camtest:simon',
        mime: 'application/zip',
        previews: { status: 'error' }
      },
      {
        revisionId: 'd-2',
        created: times.D,
        createdBy: 'u:camtest:bert',
        mime: 'application/zip',
        previews: { status: 'ignored' }
      }
    ];
    content[4].previews = { status: 'error' };
    content[4].revisions = [
      {
        revisionId: 'e-1',
        created: times.D,
        createdBy: 'u:gttest:stuart',
        mime: 'video/mp4',
        previews: { status: 'done' }
      },
      {
        revisionId: 'e-2',
        created: times.F,
        createdBy: 'u:camtest:bert',
        mime: 'video/theora',
        previews: { status: 'error' }
      }
    ];
    // Populate each piece of content's tenantAlias
    forEach((eachContent) => {
      eachContent.tenantAlias = eachContent.tenant.alias;
    }, content);

    return content;
  };

  describe('Validation', () => {
    /**
     * Test that verifies that at least 1 filter should be specified
     */
    it('Missing filters', (callback) => {
      const filters = {};
      const filterGenerator = new FilterGenerator(filters);
      assert.ok(filterGenerator.hasErrors());
      assert.isNotEmpty(filterGenerator.getErrors());
      assert.strictEqual(filterGenerator.getFirstError().code, 400);
      callback();
    });

    /**
     * Test that verifies that unknown filters trigger a validation error
     */
    it('Unknown filters', (callback) => {
      let filters = {
        content: {
          unknown: 'foo'
        }
      };
      let filterGenerator = new FilterGenerator(filters);
      assert.ok(filterGenerator.hasErrors());
      assert.isNotEmpty(filterGenerator.getErrors());
      assert.strictEqual(filterGenerator.getFirstError().code, 400);

      filters = {
        revision: {
          unknown: 'foo'
        }
      };
      filterGenerator = new FilterGenerator(filters);
      assert.ok(filterGenerator.hasErrors());
      assert.ok(isNotEmpty(filterGenerator.getErrors()));
      assert.strictEqual(filterGenerator.getFirstError().code, 400);
      callback();
    });
  });

  describe('Filtering', () => {
    /**
     * Helper function that filters mocked content and verifies the expected results
     *
     * @param  {Object}     filters                         A set of filters as accepted by `FilterGenerator`
     * @param  {Object}     expectations                    A set of expected results
     * @param  {Boolean}    expectations.needsRevisions     `true` if you expect the generator to return `true` for the `.needsRevisions()` call
     * @param  {String[]}   expectations.contentStage       An array of content IDs that should remain after the content filtering stage
     * @param  {Object[]}   expectations.revisionsStage     An array of objects. One object per content item that is supposed to remain after the revision filtering stage. The `contentId` value determines which content ID should remain and the `revisions` holds an array of revision IDs that should remain
     * @api private
     */
    const _filterAndAssert = function (filters, expectations) {
      const filterGenerator = new FilterGenerator(filters);
      assert.ok(isFalse(filterGenerator.hasErrors()));
      assert.strictEqual(filterGenerator.needsRevisions(), expectations.needsRevisions);

      // Filter some content
      const content = _getMockData();
      let filteredContent = filterGenerator.filterContent(content);
      assert.ok(filteredContent);
      assert.strictEqual(filteredContent.length, expectations.contentStage.length);
      for (let i = 0; i < 0; i++) {
        assert.strictEqual(nth(i, filteredContent).id, nth(i, expectations.contentStage));
      }

      // Filter the remaining revisions
      filteredContent = filterGenerator.filterRevisions(filteredContent);
      assert.ok(filteredContent);
      assert.strictEqual(length(filteredContent), length(expectations.revisionStage));
      for (const [i, element] of filteredContent.entries()) {
        assert.strictEqual(element.id, expectations.revisionStage[i].contentId);
        for (let r = 0; r < expectations.revisionStage[i].revisions.length; r++) {
          assert.strictEqual(
            nth(r, element.revisions).revisionId,
            nth(r, nth(i, expectations.revisionStage).revisions)
          );
        }
      }
    };

    /**
     * Test that verifies you can filter by both content and revision properties
     */
    it('filter by content.resourceSubType and revision.mime', (callback) => {
      const filters = {
        content: {
          resourceSubType: 'file'
        },
        revision: {
          mime: ['application/pdf', 'application/msword']
        }
      };

      _filterAndAssert(filters, {
        needsRevisions: true,
        contentStage: ['c:camtest:a', 'c:camtest:d', 'c:camtest:e'],
        revisionStage: [{ contentId: 'c:camtest:a', revisions: ['a-1', 'a-2'] }]
      });
      callback();
    });

    /**
     * Test that verifies you can filter by tenant
     */
    it('filter by content.tenantAlias', (callback) => {
      const filters = {
        content: {
          tenant: 'camtest'
        }
      };

      _filterAndAssert(filters, {
        needsRevisions: false,
        contentStage: ['c:camtest:a', 'c:camtest:b', 'c:camtest:c', 'c:camtest:d'],
        revisionStage: [
          { contentId: 'c:camtest:a', revisions: ['a-1', 'a-2', 'a-3'] },
          { contentId: 'c:camtest:b', revisions: ['b-1'] },
          { contentId: 'c:camtest:c', revisions: ['c-1', 'c-2', 'c-3'] },
          { contentId: 'c:camtest:d', revisions: ['d-1', 'd-2'] }
        ]
      });
      callback();
    });

    /**
     * Test that verifies you can filter by the content creator
     */
    it('filter by content.createdBy', (callback) => {
      const filters = {
        content: {
          createdBy: 'u:camtest:simon'
        }
      };

      _filterAndAssert(filters, {
        needsRevisions: false,
        contentStage: ['c:camtest:a', 'c:camtest:d'],
        revisionStage: [
          { contentId: 'c:camtest:a', revisions: ['a-1', 'a-2', 'a-3'] },
          { contentId: 'c:camtest:d', revisions: ['d-1', 'd-2'] }
        ]
      });
      callback();
    });

    /**
     * Test that verifies you can filter by contentId
     */
    it('filter by content.contentId', (done) => {
      const filters = {
        content: {
          contentId: 'c:camtest:d'
        }
      };

      _filterAndAssert(filters, {
        needsRevisions: false,
        contentStage: ['c:camtest:d'],
        revisionStage: [{ contentId: 'c:camtest:d', revisions: ['d-1', 'd-2'] }]
      });
      done();
    });

    /**
     * Test that verifies you can filter by the revision creator
     */
    it('filter by revision.createdBy', (callback) => {
      const filters = {
        revision: {
          createdBy: 'u:camtest:simon'
        }
      };

      _filterAndAssert(filters, {
        needsRevisions: true,
        contentStage: ['c:camtest:a', 'c:camtest:b', 'c:camtest:c', 'c:camtest:d', 'c:gttest:e'],
        revisionStage: [
          { contentId: 'c:camtest:a', revisions: ['a-1'] },
          { contentId: 'c:camtest:d', revisions: ['d-1'] }
        ]
      });
      callback();
    });

    /**
     * Test that verifies you can filter revisions on the created timestamp
     */
    it('filter by revision.createdBefore', (callback) => {
      const filters = {
        revision: {
          createdBefore: times.B
        }
      };
      _filterAndAssert(filters, {
        needsRevisions: true,
        contentStage: ['c:camtest:a', 'c:camtest:b', 'c:camtest:c', 'c:camtest:d', 'c:camtest:e'],
        revisionStage: [{ contentId: 'c:camtest:a', revisions: ['a-1'] }]
      });
      callback();
    });

    /**
     * Test that verifies you can filter revisions on the created timestamp
     */
    it('filter by revision.createdAfter', (callback) => {
      const filters = {
        revision: {
          createdAfter: times.D
        }
      };
      _filterAndAssert(filters, {
        needsRevisions: true,
        contentStage: ['c:camtest:a', 'c:camtest:b', 'c:camtest:c', 'c:camtest:d', 'c:gttest:e'],
        revisionStage: [
          { contentId: 'c:camtest:a', revisions: ['a-3'] },
          { contentId: 'c:gttest:e', revisions: ['e-2'] }
        ]
      });
      callback();
    });

    /**
     * Test that verifies you can filter revisions on the mimetype
     */
    it('filter by revision.mime', (callback) => {
      const filters = {
        revision: {
          mime: ['application/pdf', 'video/mp4']
        }
      };
      _filterAndAssert(filters, {
        needsRevisions: true,
        contentStage: ['c:camtest:a', 'c:camtest:b', 'c:camtest:c', 'c:camtest:d', 'c:camtest:e'],
        revisionStage: [
          { contentId: 'c:camtest:a', revisions: ['a-1'] },
          { contentId: 'c:gttest:e', revisions: ['e-1'] }
        ]
      });
      callback();
    });

    /**
     * Test that verifies you can filter content on its preview status
     */
    it('filter by content.previews.status', (callback) => {
      const filters = {
        content: {
          previewsStatus: 'error'
        }
      };
      _filterAndAssert(filters, {
        needsRevisions: false,
        contentStage: ['c:camtest:a', 'c:gttest:e'],
        revisionStage: [
          { contentId: 'c:camtest:a', revisions: ['a-1', 'a-2', 'a-3'] },
          { contentId: 'c:gttest:e', revisions: ['e-1', 'e-2'] }
        ]
      });

      // Ensure that content items without a proper previews object get reprocessed
      const content = [
        new Content('camtest', 'c:camtest:a', 'public', 'A', 'A', 'file', 'u:camtest:simon', times.A, times.E, 'a-3')
      ];
      const filterGenerator = new FilterGenerator(filters);
      assert.ok(isFalse(filterGenerator.hasErrors()));
      assert.strictEqual(filterGenerator.needsRevisions(), false);

      const filteredContent = filterGenerator.filterContent(content);
      assert.ok(filteredContent);
      assert.strictEqual(filteredContent.length, 1);
      callback();
    });

    /**
     * Test that verifies you can filter revisions on their preview status
     */
    it('filter by revision.previews.status', (callback) => {
      // Filter on pdf and word files
      const filters = {
        revision: {
          previewsStatus: 'error'
        }
      };
      _filterAndAssert(filters, {
        needsRevisions: true,
        contentStage: ['c:camtest:a', 'c:camtest:b', 'c:camtest:c', 'c:camtest:d', 'c:camtest:e'],
        revisionStage: [
          { contentId: 'c:camtest:a', revisions: ['a-2'] },
          { contentId: 'c:camtest:d', revisions: ['d-1'] },
          { contentId: 'c:gttest:e', revisions: ['e-2'] }
        ]
      });

      // Ensure that revision items without a proper previews object get reprocessed
      const content = [
        new Content('camtest', 'c:camtest:a', 'public', 'A', 'A', 'file', 'u:camtest:simon', times.A, times.E, 'a-3')
      ];
      head(content).revisions = [
        {
          revisionId: 'd-1',
          created: times.C,
          createdBy: 'u:camtest:simon',
          mime: 'application/zip'
        }
      ];
      const filterGenerator = new FilterGenerator(filters);
      assert.ok(isFalse(filterGenerator.hasErrors()));
      assert.ok(isTrue(filterGenerator.needsRevisions()));

      let filteredContent = filterGenerator.filterContent(content);
      assert.ok(filteredContent);
      assert.strictEqual(filteredContent.length, 1);
      filteredContent = filterGenerator.filterRevisions(filteredContent);
      assert.ok(filteredContent);
      assert.strictEqual(filteredContent.length, 1);
      callback();
    });
  });
});
