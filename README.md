# Open Academic Environment (OAE Project)

Hilary is the back-end for the [Open Academic Environment](http://www.oaeproject.org/)

## Build status

[![Build Status](https://travis-ci.org/oaeproject/Hilary.png?branch=master)](https://travis-ci.org/oaeproject/Hilary)
[![Coverage Status](https://coveralls.io/repos/oaeproject/Hilary/badge.png)](https://coveralls.io/r/oaeproject/Hilary)

## Installation

If you're looking to install the OAE project manually, check out [this page](https://github.com/brecke/Hilary/wiki/Manual-installation-&-setup) and then go the the [Setup section](#setup) below.

Otherwise, please follow our docker quickstart guide:

### Docker Quickstart Guide

The recommended way to install docker is to follow the official guide at https://docs.docker.com/engine/installation/. After you have installed docker, proceed to cloning the repos:

#### Clone the repos

```
git clone git@github.com:oaeproject/Hilary.git && cd Hilary
git submodule init
git submodule update
```

#### Customize the folder paths

The `docker-compose.yml` file includes the folder paths (mountpoints) where the container volumes will be mounted, namely:

- `oae-hilary`:
  - `/src/Hilary`
  - `/src/files`
- `oae-elasticsearch`:
  - `/data/elasticsearch`
- `oae-nginx`:
  - `/src/files`
  - `/src/Hilary/3akai-ux/nginx/nginx.conf.docker`
  - `/src/Hilary/3akai-ux/nginx/mime.conf`
  - `/src/Hilary/3akai-ux`
- `oae-cassandra`:
  - `oae-cassandra`
- `oae-etherpad`:
  - `/data/etherpad/dirty.db`
- `oae-portainer`:
  - `/data/portainer/data and /var/run/docker.sock`

Either make sure these paths are the ones you're using or change them in the `docker-compose.yml` file to match your own paths.

#### Build the docker image locally

```
docker-compose create # this will build the hilary:latest image
docker-compose up

# as a temporary measure, we will need to start hilary again to make sure it boots after cassandra:
docker-compose restart oae-hilary
```

### Extra docker utilities

The service names and description are in the `docker-compose.yml` file.

To start and stop all containers at once, run `docker-compose up` and `docker-compose down` respectively. Check `docker-compose` documentation for more information.

If you need to rebuild the `hilary:latest` docker image, try running `docker build -f Dockerfile -t hilary:latest .`.

If you need to tail the logs of a specific server for debugging, try running `docker logs -f oae-hilary` (for the `oae-hilary` service).

If you're having network problems, run `docker network inspect bridge` for check container network configuration or `docker inspect oae-hilary` to take a look at `oae-hilary` container details.

--

For making it easy to manage docker containers and images, we have included [portainer](http://portainer.io/) in the `docker-compose.yml` file. Portainer is easily installed and becomes accessible via `http://DOCKER_HOST:9000` when `docker-compose up` is ran. More information on Portainer at [the official documentation website](https://portainer.readthedocs.io/en/stable/).

### Setup

#### Change the /etc/hosts file

OAE is a multi-tenant system that discriminates the tenant by the host name with which you are accessing the server. In order to support the "Global Tenant" (i.e., the tenant that hosts the administration UI) and a "User Tenant", you will need to have at least 2 different host names that point to your server. To do this, you will need to add the following entries to your `/etc/hosts` file:

```
127.0.0.1   admin.oae.com
127.0.0.1   tenant1.oae.com
```

Where `admin.oae.com` is the hostname that we will use to access the global administration tenant and `tenant1.oae.com` would be one of many potential user tenant hosts. After making this change, you should now be able to visit http://admin.oae.com \o/

#### Change the docker-compose DNS entries

This same DNS information must be made explicit be done in the `docker-compose.yml` file, to make sure that the `oae-hilary` container can connect to the `oae-nginx` container holding HTTP server (for instance, for preview processing purposes). Go to the file and look for the following section:

```
extra_hosts:
- "admin.oae.com:172.20.0.9"
- "tenant1.oae.com:172.20.0.9"
```

As you see, we already included both `admin.oae.com` and `tenant1.oae.com`, both associated with the `oae-nginx` static IP. If you're looking to add an extra host, say, `tenant2.oae.com`, then you should add the following line and you're good to go:

```
- "tenant2.oae.com:172.20.0.9"
```

#### Creating your first user tenant

When you start the server, all data schemas will be created for you if they don't already exist. A global administrator user and global administration tenant will be ready for you as well. You can use these to create a new user tenant that hosts the actual OAE user interface.

1. Visit http://admin.oae.com/  (substitute "admin.oae.com" with the administration host you configured in `/etc/hosts`)
1. Log in with username and password: `administrator` / `administrator`
1. Click the "Tenants" header to open up the actions
1. Click "Create tenant"
1. Choose an alias (a short, unique 2-5 character alphanumeric string such as "oae"), and a name of your liking.
1. For the Host field, use the host you configured for your user tenant in `/etc/hosts` (e.g., "tenant1.oae.com")
1. Click "Create new tenant"

You can now access the user tenant by their host http://tenant1.oae.com and start creating new users.

#### Creating your first user

To create a new user, use either the Sign Up link at the top left, or the Sign In link at the top right.

**Tip:** OAE requires that users have an email address that is verified VIA an email that is sent to the user. To avoid the requirement of having a valid email server configuration, you can instead watch the app server logs when a user is created or their email address is updated. When `config.email.debug` is set to `true` in `config.js`, the content of the verification email can be seen in the logs, and you can copy/paste the email verification link from the log to your browser to verify your email. The URL will look similar to: `http://tenant1.oae.com/?verifyEmail=abc123`

We're looking forward to seeing your contributions to the OAE project!

## Get in touch

The project website can be found at http://www.oaeproject.org. The [project blog](http://www.oaeproject.org/blog) will be updated with the latest project news from time to time.

The mailing list used for Apereo OAE is oae@apereo.org. You can subscribe to the mailing list at https://groups.google.com/a/apereo.org/d/forum/oae.

Bugs and other issues can be reported in our [issue tracker](https://github.com/oaeproject/Hilary/issues). Ideas for new features and capabilities can be suggested and voted for in our [UserVoice page](http://oaeproject.uservoice.com).
