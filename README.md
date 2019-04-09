# Open Academic Environment (OAE Project)

Hilary is the back-end for the [Open Academic Environment](http://www.oaeproject.org/)

[![Discord](https://img.shields.io/badge/chat-on_discord-green.svg)](https://discord.gg/RShTcdq)

## Build status
 
 
 
 
<!-- current project status -->
[![CircleCI](https://circleci.com/gh/oaeproject/Hilary/tree/master.svg?style=shield)](https://circleci.com/gh/oaeproject/Hilary/tree/master)
[![Code Climate](https://codeclimate.com/github/oaeproject/Hilary/badges/gpa.svg)](https://codeclimate.com/github/oaeproject/Hilary)
[![Codacy Badge](https://api.codacy.com/project/badge/Grade/8a6104cadb6b442596c418534cf97db3)](https://www.codacy.com/app/brecke/Hilary?utm_source=github.com&utm_medium=referral&utm_content=oaeproject/Hilary&utm_campaign=Badge_Grade)
[![Codacy Badge](https://api.codacy.com/project/badge/Coverage/8a6104cadb6b442596c418534cf97db3)](https://www.codacy.com/app/oaeproject/Hilary?utm_source=github.com&utm_medium=referral&utm_content=oaeproject/Hilary&utm_campaign=Badge_Coverage)
[![dependencies](https://david-dm.org/oaeproject/Hilary.svg)](https://david-dm.org/oaeproject/Hilary)
[![devdependencies](https://david-dm.org/oaeproject/Hilary/dev-status.svg)](https://david-dm.org/oaeproject/Hilary#info=devDependencies)
[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Foaeproject%2FHilary.svg?type=shield)](https://app.fossa.io/projects/git%2Bgithub.com%2Foaeproject%2FHilary?ref=badge_shield)
[![Known Vulnerabilities](https://snyk.io/test/github/oaeproject/Hilary/badge.svg)](https://snyk.io/test/github/oaeproject/Hilary)

<!-- standards used in project -->
![code style](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)
[![XO code style](https://img.shields.io/badge/code_style-XO-5ed9c7.svg)](https://github.com/xojs/xo)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg)](https://conventionalcommits.org)
[![Semver](http://img.shields.io/SemVer/2.0.0.png)](http://semver.org/spec/v2.0.0.html)

## Install

This guide will install OAE locally for a development setup. Node is required on the host machine whereas the remaining servers will run as docker containers.

### Docker Quickstart Guide

The recommended way to install docker is to follow the official guide at https://docs.docker.com/engine/installation/. Make sure you have `docker` version `>= 17.x` and `docker-compose` version `>= 1.6.0` before you proceed to cloning the repos. Check your versions by running the following commands:

```
$ docker -v
Docker version 17.03.0-ce, build 60ccb2265
$ docker-compose -v
docker-compose version 1.11.2, build dfed245
```

Also, don't forget the [post-install instructions](https://docs.docker.com/engine/installation/linux/linux-postinstall/) if you're using linux.

#### Clone the repos

```
git clone https://github.com/oaeproject/Hilary.git && cd Hilary
git submodule init
git submodule update
cd 3akai-ux && git checkout master # because HEAD is detached after pulling submodules by default
```

#### Customize the folder paths

If you accept the following directory structure, `docker-compose` will work out of the box.

```
<some-local-path>
|-- Hilary
    |-- 3akai-ux
    |-- tmp
        |-- previews
        |-- uploads
        |-- files
|-- data
    |-- elasticsearch
    |-- cassandra
    |-- etherpad
```

If you want to use different (local) paths, make sure to change container volumes accordingly on `docker-compose.yml`:

#### Build the docker image locally

```
# this will build the hilary:latest image and create all containers
docker-compose up --no-start --build oae-cassandra oae-redis oae-rabbitmq oae-elasticsearch oae-hilary
```

NOTE: if the previous step fails due to network problems, try changing the DNS server to Google's: 8.8.8.8 or 8.8.4.4. In order to do this, either use your operating system's settings or do it via the command line interface by editing `/etc/resolv.conf` and making sure these two lines are on top:

```
nameserver 8.8.8.8
nameserver 8.8.4.4
```

#### Install dependencies

In order to install dependencies for the frontend and the backend, we need to run a one-off command for each:

```
npm install # install dependencies locally for Hilary
cd 3akai-ux && npm install" # install dependencies for 3akai-ux
```

#### Create the SSL Certificate

If we're looking to use HTTPS via nginx, first we need to create the SSL certificate. You can do do that by running:

```
openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout 3akai-ux/nginx/nginx-selfsigned.key -out 3akai-ux/nginx/nginx-selfsigned.crt
```

This will create two new files: `3akai-ux/nginx/nginx-selfsigned.key` and `3akai-ux/nginx/nginx-selfsigned.crt`.

Then, run the following command:

```
openssl dhparam -out 3akai-ux/nginx/dhparam.pem 2048
```

This may take a few minutes, but when it's done you will have the file `nginx/dhparam.pem` that you can use in your configuration.

--

Before moving on to the next step, make sure these three files exist otherwise there will be errors.

#### Setup nginx

Open the file `nginx.conf.docker` and make sure these lines:

```
...
server oae-hilary:2000;
...
server oae-hilary:2001;
...
```

..become:

```
...
server 172.20.0.1:2000; # `172.20.0.1` is the IP address of the host machine, which can be obtained by running `/sbin/ip route|awk '/default/ { print $3 }'` from any container (e.g. `docker exec -it oae-nginx sh`).
...
server 172.20.0.1:2001;
...
```

If you're using mac osx, you'll need to use the external IP address (e.g. `en0`) instead of the `docker0` IP address for `oae-nginx` to access `Hilary`, like this:

```
...
server 192.168.1.2:2000; # assuming 192.168.1.2 is the external network IP address
...
server 192.168.1.2:2001; # assuming 192.168.1.2 is the external network IP address
...
```

#### Run migrations

Before running the app we need to ensure the schema exists on the database. To achieve that we need to run

```
npm run migrate
```

If the database settings are correct (`config.js`) then the output should resemble the following:

```
 INFO: Running schema for oae-activity
 INFO: Running schema for oae-authentication
 INFO: Running schema for oae-authz
 INFO: Running schema for oae-config
 INFO: Running schema for oae-content
 INFO: Running schema for oae-discussions
 INFO: Running schema for oae-folders
 INFO: Running schema for oae-following
 INFO: Running schema for oae-jitsi
 INFO: Running schema for oae-library
 INFO: Running schema for oae-lti
 INFO: Running schema for oae-mediacore
 INFO: Running schema for oae-messagebox
 INFO: Running schema for oae-principals
 INFO: Running schema for oae-tenants
 INFO: Migration complete.
```

#### Run the server and the containers

Now run `docker-compose up -d oae-cassandra oae-redis oae-rabbitmq oae-elasticsearch oae-etherpad` and then `docker-compose logs -f` to check the logs. You may then run `nodemon app.js | npx bunyan` (or `npm start` for short) locally on the terminal to start the server.

### Extra docker utilities

The service names and description are in the `docker-compose.yml` file.

To start and stop all containers at once, run `docker-compose up` and `docker-compose down` respectively. Check `docker-compose` documentation for more information.

If you need to rebuild the `hilary:latest` docker image, try running `docker build -f Dockerfile -t hilary:latest .`.

If you need to tail the logs of a specific server for debugging, try running `docker logs -f oae-cassandra` (for the `oae-cassandra` service).

If you're having network problems, run `docker network inspect bridge` for check container network configuration or `docker inspect oae-hilary` to take a look at `oae-hilary` container details.

--

### Setup

#### Set up external authentication strategies (optional)

In order to set up twitter authentication, you'll need to set your twitter dev account environment variables like this:

```
export TWITTER_KEY="<your key here>"
export TWITTER_SECRET"="<your secret here>"
```

Same thing goes for google auth and facebook auth. The environment variables for each are:

```
export GOOGLE_CLIENT_ID=""
export GOOGLE_CLIENT_SECRET=""

export FACEBOOK_APP_ID=""
export FACEBOOK_APP_SECRET=""
```

This is enough to run all the tests locally in a dev environment. For production purposes, all environment variables can and should be overwritten by the admin in the tenant configuration form.

#### Change the /etc/hosts file

OAE is a multi-tenant system that discriminates the tenant by the host name with which you are accessing the server. In order to support the "Global Tenant" (i.e., the tenant that hosts the administration UI) and a "User Tenant", you will need to have at least 2 different host names that point to your server. To do this, you will need to add the following entries to your `/etc/hosts` file:

```
127.0.0.1   admin.oae.com
127.0.0.1   tenant1.oae.com
```

Where `admin.oae.com` is the hostname that we will use to access the global administration tenant and `tenant1.oae.com` would be one of many potential user tenant hosts. After making this change, you should now be able to visit http://admin.oae.com \o/

#### Change the docker-compose DNS entries

This same DNS information must be made explicit in the `docker-compose.yml` file, to make sure that the `oae-hilary` container can connect to the `oae-nginx` container holding HTTP server (for instance, for preview processing purposes). Go to the file and look for the following section:

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

1.  Visit http://admin.oae.com/ (substitute "admin.oae.com" with the administration host you configured in `/etc/hosts`)
1.  Log in with username and password: `administrator` / `administrator`
1.  Click the "Tenants" header to open up the actions
1.  Click "Create tenant"
1.  Choose an alias (a short, unique 2-5 character alphanumeric string such as "oae"), and a name of your liking.
1.  For the Host field, use the host you configured for your user tenant in `/etc/hosts` (e.g., "tenant1.oae.com")
1.  Click "Create new tenant"

You can now access the user tenant by their host http://tenant1.oae.com and start creating new users.

#### Creating your first user

To create a new user, use either the Sign Up link at the top left, or the Sign In link at the top right.

**Tip:** OAE requires that users have an email address that is verified VIA an email that is sent to the user. To avoid the requirement of having a valid email server configuration, you can instead watch the app server logs when a user is created or their email address is updated. When `config.email.debug` is set to `true` in `config.js`, the content of the verification email can be seen in the logs, and you can copy/paste the email verification link from the log to your browser to verify your email. The URL will look similar to: `http://tenant1.oae.com/?verifyEmail=abc123`

We're looking forward to seeing your contributions to the OAE project!

### Running tests

To run tests just make sure you have installed all dependencies (`npm i`) and run `npm test`. To run tests on a specific module, just append its name as follows: `npm run test-module -- oae-principals`.

### Troubleshooting

#### All I see is the 502 service unavailable page

If you still can't see the Web interface correctly by the time the containers start, it might be due to Hilary starting before Cassandra was available. This usually results in 502 _Service unavailable_ pages. We recommend to start hilary again to make sure it boots after cassandra is accepting connections: `docker-compose restart oae-hilary`. This is something we're looking to fix in the future.

## Get in touch

The project website can be found at http://www.oaeproject.org. The [project blog](http://www.oaeproject.org/blog) will be updated with the latest project news from time to time.

The mailing list used for Apereo OAE is oae@apereo.org. You can subscribe to the mailing list at https://groups.google.com/a/apereo.org/d/forum/oae.

Bugs and other issues can be reported in our [issue tracker](https://github.com/oaeproject/Hilary/issues). Ideas for new features and capabilities can be suggested and voted for in our [UserVoice page](http://oaeproject.uservoice.com).
