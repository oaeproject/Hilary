This document outlines the Shibboleth authentication workflow and requirements, including some of the measure required to support easy multi-tenant Shibboleth authentication.

Pre-requisites:
-   `Apache` + `mod_shib` is running on the load balancer
-   There is a single URL that is Shibboleth protected, which will be referred to as the `SP tenant`. This documentation assumes that the `SP tenant` runs at `shib-sp.oae.com`
-   You have registered your SP with the required access management federations


A special `SP tenant` is required for the following reasons:
Shibboleth demands that service providers declare what URLs they operate on. This is required to ensure that a user can be sent back to the application by the IdP following authentication. Whilst it is possible to register the URLs for all tenants that will use Shibboleth, this will cause a lot of maintenance overhead. Each time a Shibboleth-enabled tenant is added, we would need to:
-   Add an Apache vhost (manageable via puppet)
-   Update the Shibboleth metadata (somewhat manageable via puppet)
-   Propagate the Shibboleth metadata to the various access management federations our SP is part of, which will require a lot of manual coordination with the federations

There are also some additional technical limitation caused by the one-domain-per-tenant ideology. A typical OAE installation is expected to have many tenants on a single physical installation (5000+). Registering the Shibboleth URLs for all of those would end up taking up a very significant part of their metadata files. Having a single `SP tenant` domain that is registered with the various federations/IdPs allows us to:

-   Register a single domain
-   Enable Shibboleth on-the-fly for tenants that have an IdP in an access management federation our SP is a member of
-   Reduce configuration complexity


Setup:

-   An OAE tenant is running at `tenant.oae.com`
    -   It's configured to use Shibboleth for its authentication
    -   It's configured to use the Shibboleth Identity Provider with entityID `https://idp.university.edu/shibboleth`
-   Our `SP tenant` is running at `shib-sp.oae.com` with `https://shib-sp.oae.com/shibboleth` as its entityID
-   Nginx is our main load balancer
-   Nginx proxies all requests to Hilary, except for the following that are proxied to `Apache` + `mod_shib`:
    -   `/Shibboleth.sso/*` (Shibboleth login/metadata/logout/...)
    -   `/api/auth/shibboleth/sp/returned`.


The authentication flow is a 5 step process:

1. The user clicks the "Sign in with Shibboleth"-button. This takes him to `https://tenant.oae.com/api/authentication/shibboleth`. This endpoint will forward the user to `https://shib-sp.oae.com/api/auth/shibboleth/sp?tenantAlias=tenant&signature=...&expires=...`
2. The user arrives at `https://shib-sp.oae.com/api/auth/shibboleth/sp?tenantAlias=tenant&signature=...&expires=...`. He is now on the `SP tenant`. Because the tenant alias is provided, the `SP tenant` knows where this user originated. A cookie is set to persist that tenant alias. This will allow the `SP tenant` to redirect the authenticated user back to tenant from which the authentication was initiated. The endpoint will redirect the user to `https://shib-sp.oae.com/Shibboleth.sso/Login?entityID=https://idp.university.edu/shibboleth&target=/api/authentication/shibboleth/sp/returned`. This gives mod_shib enough information to redirect the user to the correct IdP and where to send the user back to.
3. The user authenticates on the IdP and is sent back to `https://shib-sp.oae.com/api/auth/shibboleth/sp/returned`
4. The user arrives at `https://shib-sp.oae.com/api/auth/shibboleth/sp/returned`. Nginx will proxy this request to `Apache` + `mod_shib` for validation. If that succeeds, Apache will proxy a request with all the necessary attributes to `https://shib-sp.oae.com/api/auth/shibboleth/sp/callback`. This endpoint is responsible for taking all those attributes and retrieving or creating the proper user object. Once that's done, this endpoint will redirect the user to `https://tenant.oae.com/api/auth/shibboleth/callback?userId=..&signature=..&expires=..`. The tenant hostname for this redirect is determined by the cookie-persisted tenant alias.
5. The user arrives at `https://tenant.oae.com/api/auth/shibboleth/callback?userId=..&signature=..&expires=..`. The user is back at the originating tenant and the endpoint will verify the userid and signature and will authenticate the user into the system. Lastly, the user is redirected to the home page (or the `redirectUrl` if one was specified in step 1).
