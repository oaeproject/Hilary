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

/**
 * @RESTModel WidgetConfigs
 *
 * @Required  [{widgetName}]
 * @Property  {WidgetConfig}    {widgetName}    Configuration data for the named widget
 */

/**
 * @RESTModel WidgetConfig
 *
 * @Required  [id, path, src]
 * @Property  {WidgetI18n}      i18n            Internationalization data for the widget
 * @Property  {string}          id              Unique identifier for the widget
 * @Property  {string}          path            Path of widget folder relative to `/node_modules`
 * @Property  {string}          src             Name of the HTML file containing the widget HTML
 * @Property  {WidgetTriggers}  trigger         Triggers used for lazy loading the widget
 */

/**
 * @RESTModel WidgetI18n
 *
 * @Required  [{language}]
 * @Property  {string}          {language}      Path of translation bundle for named language relative to the widget folder
 */

/**
 * @RESTModel WidgetTriggers
 *
 * @Required  []
 * @Property  {string[]}        events          jQuery events that will trigger the widget to be lazy loaded
 * @Property  {string[]}        selectors       jQuery selectors for the HTML elements for which a click should trigger the widget to be lazy loaded
 */

/**
 * @RESTModel StaticBatch
 *
 * @Required  [{path}]
 * @Property  {string}          {path}          Contents of file available at named path
 */

/**
 * @RESTModel SkinVariables
 *
 * @Required  [results]
 * @Property  {SkinVariableSection[]}       results         Section of related skin variables
 */

/**
 * @RESTModel SkinVariableSection
 *
 * @Required  [name, subsections]
 * @Property  {string}                      name            Name of skin variable section
 * @Property  {SkinVariableSubsection[]}    subsections     Subsection of related skin variables
 */

/**
 * @RESTModel SkinVariableSubsection
 *
 * @Required  [name, variables]
 * @Property  {string}              name        Name of skin variable subsection
 * @Property  {SkinVariable[]}      variables   Skin variable
 */

/**
 * @RESTModel SkinVariable
 *
 * @Required  [name, defaultValue, description, type]
 * @Property  {string}              name            Name of skin variable
 * @Property  {string}              defaultValue    Default value of variable
 * @Property  {string}              description     Description of variable
 * @Property  {string}              type            Type of variable                [color,url]
 */
