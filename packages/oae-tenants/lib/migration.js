import { createColumnFamilies } from 'oae-util/lib/cassandra';

/**
 * Ensure that the tenant schema is created. If the tenant schema has not been created, or the default tenant has not been seeded,
 * both will be performed automatically. If both the schema and the default tenant exist, then this method will do nothing.
 *
 * @param  {Function}  callback     Standard callback function
 * @api private
 */
const ensureSchema = function(callback) {
  createColumnFamilies(
    {
      Tenant:
        'CREATE TABLE "Tenant" ("alias" text PRIMARY KEY, "displayName" text, "host" text, "emailDomains" text, "countryCode" text, "active" boolean)',
      TenantNetwork: 'CREATE TABLE "TenantNetwork" ("id" text PRIMARY KEY, "displayName" text);',
      TenantNetworkTenants:
        'CREATE TABLE "TenantNetworkTenants" ("tenantNetworkId" text, "tenantAlias" text, "value" text, PRIMARY KEY ("tenantNetworkId", "tenantAlias")) WITH COMPACT STORAGE;'
    },
    callback
  );
};

export { ensureSchema };
