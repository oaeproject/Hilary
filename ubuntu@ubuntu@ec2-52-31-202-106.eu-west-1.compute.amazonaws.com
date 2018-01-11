/**
 * Copyright 2018 Apereo Foundation (AF) Licensed under the
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

module.exports = {
  /**
   * Application configuration section
   * http://pm2.keymetrics.io/docs/usage/application-declaration/
   */
  apps : [

    // Running application
    {
      name      : 'Hilary',
      script    : 'app.js',
      env: {
        // NODE_ENV: 'development',
        ETHERPAD_APIKEY: 'abc'
      },
      watch: false,
      ignore_watch: ['test', '.git', 'files'],
      instances: 2,
      exec_mode: "cluster",
      log_file: 'hilary.log',
      error_file: 'hilary-err.log'
    },
  ]
};
