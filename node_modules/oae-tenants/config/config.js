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

const util = require('util');
const _ = require('underscore');

const Fields = require('oae-config/lib/fields');
const TZ = require('oae-util/lib/tz');

// Get an object that we can pass in the config List field as the set of options that should be
// presented to the user. We add in the offset in the displayname of each element
const timezoneConfigValues = _.chain(TZ.getZones())
  .map((timezone, id) => {
    return _.extend({}, timezone, { id });
  })

  // Secondary sort on the timezone id (e.g., Europe/Istanbul)
  .sortBy(timezone => {
    return timezone.id;
  })

  // Primary sort on the offset
  .sortBy(timezone => {
    return -1 * timezone.offset;
  })

  // Convert it into name/value pairs for the UI
  .map(timezone => {
    const offsetHours = Math.abs(Math.floor(timezone.offset));
    const offsetMinutes = Math.abs((timezone.offset % 1) * 60);

    const sign = timezone.offset > 0 ? '-' : '+';
    const offsetHoursStr = offsetHours < 10 ? '0' + offsetHours.toString() : offsetHours.toString();
    const offsetMinutesStr =
      offsetMinutes < 10 ? '0' + offsetMinutes.toString() : offsetMinutes.toString();

    let offsetLabel = 'GMT';
    if (timezone.offset !== 0) {
      offsetLabel += util.format(' %s%s:%s', sign, offsetHoursStr, offsetMinutesStr);
    }

    return {
      name: util.format('%s (%s)', timezone.id, offsetLabel).replace('_', ' '),
      value: timezone.id
    };
  })
  .value();

module.exports = {
  title: 'OAE Tenant Module',
  instance: {
    name: 'Instance Information',
    description: 'Information about the current instance',
    elements: {
      instanceName: new Fields.Text('Instance name', 'The name of the current instance', '', {
        tenantOverride: false
      }),
      instanceURL: new Fields.Text('Instance URL', 'The URL of the main instance website', '', {
        tenantOverride: false
      }),
      hostingOrganization: new Fields.Text(
        'Hosting organization',
        'The name of the organization hosting the current instance',
        '',
        { tenantOverride: false }
      ),
      hostingOrganizationURL: new Fields.Text(
        'Hosting organization URL',
        'The URL of the hosting organization website',
        '',
        { tenantOverride: false }
      )
    }
  },
  actions: {
    name: 'Tenant Admin Action',
    description: 'Actions a tenant admin is allowed to do',
    elements: {
      allowStop: new Fields.Bool(
        'Stop tenant',
        'Allow a tenant admin to stop the tenant server',
        false,
        { tenantOverride: false, suppress: true }
      )
    }
  },
  tenantprivacy: {
    name: 'Tenant Privacy',
    description: 'Specifies if the tenant is private',
    elements: {
      tenantprivate: new Fields.Bool('Private Tenant', 'The tenant is private', false, {
        tenantOverride: false,
        suppress: false
      })
    }
  },
  timezone: {
    name: 'Tenant Timezone',
    description: 'Specifies the tenant timezone',
    elements: {
      timezone: new Fields.List(
        'Tenant Timezone',
        'Tenant timezone',
        'Etc/UTC',
        timezoneConfigValues,
        { suppress: true }
      )
    }
  },
  guests: {
    name: 'Tenant Guests',
    description: 'Allow guests to be invited from this tenant',
    elements: {
      allow: new Fields.Bool('Tenant Guests', 'Allow guests to be invited from this tenant', true, {
        tenantOverride: true
      })
    }
  }
};
