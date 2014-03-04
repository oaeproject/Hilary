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

var assert = require('assert');

var Sanitization = require('oae-util/lib/sanitization');

describe('Sanitization', function() {

    /**
     * Verifies that HTML strings are escaped correctly for HTML
     */
    it('verify that encodeForHTML escapes strings correctly', function(callback) {

        // Sanitize a string
        var stringToEscape = '\n\n\n<script>window.alert("hello world!");</script><p class="test"><span>Nice</span> link, would <a href="http://www.google.be" target="_blank"><a>click</a></b> again</p>';
        var stringEscaped = '&#xa;&#xa;&#xa;&lt;script&gt;window.alert&#x28;&quot;hello world&#x21;&quot;&#x29;&#x3b;&lt;&#x2f;script&gt;&lt;p class&#x3d;&quot;test&quot;&gt;&lt;span&gt;Nice&lt;&#x2f;span&gt; link, would &lt;a href&#x3d;&quot;http&#x3a;&#x2f;&#x2f;www.google.be&quot; target&#x3d;&quot;_blank&quot;&gt;&lt;a&gt;click&lt;&#x2f;a&gt;&lt;&#x2f;b&gt; again&lt;&#x2f;p&gt;';

        // Check if the returned value contains HTML entities instead of HTML tags
        assert.equal(Sanitization.encodeForHTML(stringToEscape), stringEscaped);

        return callback();
    });

    /**
     * Verifies that HTML strings are escaped correctly for HTML attributes
     */
    it('verify that encodeForHTMLAttribute escapes strings correctly', function(callback) {

        // Sanitize a string
        var stringToEscape = '\n\n\n<script>window.alert("hello world!");</script><p class="test"><span>Nice</span> link, would <a href="http://www.google.be" target="_blank"><a>click</a></b> again</p>';
        var stringEscaped = '&#xa;&#xa;&#xa;&lt;script&gt;window.alert&#x28;&quot;hello world&#x21;&quot;&#x29;&#x3b;&lt;&#x2f;script&gt;&lt;p class&#x3d;&quot;test&quot;&gt;&lt;span&gt;Nice&lt;&#x2f;span&gt; link, would &lt;a href&#x3d;&quot;http&#x3a;&#x2f;&#x2f;www.google.be&quot; target&#x3d;&quot;_blank&quot;&gt;&lt;a&gt;click&lt;&#x2f;a&gt;&lt;&#x2f;b&gt; again&lt;&#x2f;p&gt;';

        // Check if the returned value contains HTML entities instead of HTML tags
        assert.equal(Sanitization.encodeForHTMLAttribute(stringToEscape), stringEscaped);

        return callback();
    });

});
