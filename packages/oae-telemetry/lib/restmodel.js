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

// Add the REST models for Telemetry

/**
 * @RESTModel Telemetry
 *
 * @Required  []
 * @Property  {ActivityTelemetry}           activity            Activity telemetry data
 * @Property  {CassandraTelemetry}          cassandra           Cassandra telemetry data
 * @Property  {EmailTelemetry}              activity-email      Email telemtry data
 * @Property  {PreviewProcessorTelemtry}    preview-processor   Preview processor telemetry data
 * @Property  {PushTelemetry}               push                Push telemetry data
 * @Property  {SearchTelemetry}             search              Search telemetry data
 * @Property  {ServerTelemetry}             server              Server telemetry data
 */

/**
 * @RESTModel ActivityTelemetry
 *
 * @Required  []
 * @Property  {number}          {activityStatistic}             Value of named activity statistic
 */

/**
 * @RESTModel CassandraTelemetry
 *
 * @Required  []
 * @Property  {number}          {cassandraStatistic}            Value of named cassandra statistic
 */

/**
 * @RESTModel EmailTelemetry
 *
 * @Required  []
 * @Property  {number}          {emailStatistic}                Value of named email statistic
 */

/**
 * @RESTModel PreviewProcessorTelemtry
 *
 * @Required  []
 * @Property  {number}          {previewProcessorStatistic}     Value of named preview processor statistic
 */

/**
 * @RESTModel PushTelemetry
 *
 * @Required  []
 * @Property  {number}          {pushStatistic}                 Value of named push notifications statistic
 */

/**
 * @RESTModel SearchTelemetry
 *
 * @Required  []
 * @Property  {number}          {searchStatistic}               Value of named search statistic
 */

/**
 * @RESTModel ServerTelemetry
 *
 * @Required  []
 * @Property  {number}          {serverStatistic}               Value of named server statistic
 */

