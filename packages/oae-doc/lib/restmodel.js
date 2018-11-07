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

// Add the REST models for Docs

/**
 * @RESTModel Doc
 *
 * The container object that holds all the documentation for a library
 *
 * @Required  [tags, description, code, ignore]
 * @Property  {DocTag[]}      tags            A list of JSDoc tags
 * @Property  {DocDesc}       description     A description of what the code does
 * @Property  {string}        code            The source code being documented
 * @Property  {boolean}       ignore          Whether this block should be ignored by the UI
 * @Property  {DocCtx}        ctx             The documentation context
 * @Property  {boolean}       isPrivate       Whether this section is private
 */

/**
 * @RESTModel DocTag
 *
 * A JSDoc tag like `@param` with all of its relevant info
 *
 * @Required  [type, types, name, description]
 * @Property  {string}        type          The type of tag
 * @Property  {string[]}      types         An array of types that the tag contained
 * @Property  {string}        name          The name from the tag
 * @Property  {string}        description   A description from the tag
 */

/**
 * @RESTModel DocDesc
 *
 * The description block from the JSDoc
 *
 * @Required  [full, summary, body]
 * @Property  {string}        full      The complete description block
 * @Property  {string}        summary   The first paragraph of the description block
 * @Property  {string}        body      All paragraphs of the description block except the first
 */

/**
 * @RESTModel DocCtx
 *
 * The context the documentation appeared in
 *
 * @Required  [type, name, value, string]
 * @Property  {string}        type      The type of code that was documented by the block (function, variable, etc)
 * @Property  {string}        name      The name of the documented piece of code
 * @Property  {string}        value     The value assigned to the documented code
 * @Property  {string}        string    A displayName like string for the documented code
 */
