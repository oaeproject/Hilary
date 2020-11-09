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

import { assert } from 'chai';

import * as Sanitization from 'oae-util/lib/sanitization';

describe('Sanitization', () => {
  /**
   * Verifies that HTML strings are escaped correctly for HTML
   */
  it('verify that encodeForHTML escapes strings correctly', callback => {
    // Sanitize a string
    const stringToEscape =
      '\n\n\n<script>window.alert("hello world!");</script><p class="test"><span>Nice</span> link, would <a href="http://www.google.be" target="_blank"><a>click</a></b> again</p>';
    const stringEscaped =
      '\n\n\n&#x3C;script&#x3E;window.alert(&#x22;hello world!&#x22;);&#x3C;/script&#x3E;&#x3C;p class=&#x22;test&#x22;&#x3E;&#x3C;span&#x3E;Nice&#x3C;/span&#x3E; link, would &#x3C;a href=&#x22;http://www.google.be&#x22; target=&#x22;_blank&#x22;&#x3E;&#x3C;a&#x3E;click&#x3C;/a&#x3E;&#x3C;/b&#x3E; again&#x3C;/p&#x3E;';

    // Check if the returned value contains HTML entities instead of HTML tags
    assert.strictEqual(Sanitization.encodeForHTML(stringToEscape), stringEscaped);

    return callback();
  });

  /**
   * Verifies that HTML strings are escaped correctly for HTML attributes
   */
  it('verify that encodeForHTMLAttribute escapes strings correctly', callback => {
    // Sanitize a string
    const stringToEscape =
      '\n\n\n<script>window.alert("hello world!");</script><p class="test"><span>Nice</span> link, would <a href="http://www.google.be" target="_blank"><a>click</a></b> again</p>';
    const stringEscaped =
      '\n\n\n&#x3C;script&#x3E;window.alert(&#x22;hello world!&#x22;);&#x3C;/script&#x3E;&#x3C;p class=&#x22;test&#x22;&#x3E;&#x3C;span&#x3E;Nice&#x3C;/span&#x3E; link, would &#x3C;a href=&#x22;http://www.google.be&#x22; target=&#x22;_blank&#x22;&#x3E;&#x3C;a&#x3E;click&#x3C;/a&#x3E;&#x3C;/b&#x3E; again&#x3C;/p&#x3E;';

    // Check if the returned value contains HTML entities instead of HTML tags
    assert.strictEqual(Sanitization.encodeForHTMLAttribute(stringToEscape), stringEscaped);

    return callback();
  });
});
