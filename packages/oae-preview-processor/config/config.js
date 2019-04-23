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

import * as Fields from 'oae-config/lib/fields';

export const title = 'OAE Preview Processor Module';
export const slideshare = {
  name: 'SlideShare configuration',
  description: 'Configuration for the SlideShare retriever',
  elements: {
    apikey: new Fields.Text('API Key', 'The SlideShare API key', '', {
      tenantOverride: false,
      suppress: true,
      globalAdminOnly: true
    }),
    sharedsecret: new Fields.Text('Shared Secret', 'The SlideShare shared secret', '', {
      tenantOverride: false,
      suppress: true,
      globalAdminOnly: true
    })
  }
};
export const flickr = {
  name: 'Flickr configuration',
  description: 'Configuration for the Flickr retriever',
  elements: {
    apikey: new Fields.Text('API Key', 'The Flickr API key', '', {
      tenantOverride: false,
      suppress: true,
      globalAdminOnly: true
    }),
    apisecret: new Fields.Text('API Secret', 'The Flickr API secret', '', {
      tenantOverride: false,
      suppress: true,
      globalAdminOnly: true
    })
  }
};
export const youtube = {
  name: 'YouTube configuration',
  description: 'Configuration for the YouTube retriever',
  elements: {
    key: new Fields.Text('Key', 'The YouTube server key', '', {
      tenantOverride: false,
      suppress: true,
      globalAdminOnly: true
    })
  }
};
