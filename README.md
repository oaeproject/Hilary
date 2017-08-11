# Open Academic Environment (OAE Project)

Hilary is the back-end for the [Open Academic Environment](http://www.oaeproject.org/)

## Build status

[![CircleCI](https://circleci.com/gh/oaeproject/Hilary/tree/master.svg?style=svg)](https://circleci.com/gh/oaeproject/Hilary/tree/master)
[![Coverage Status](https://coveralls.io/repos/oaeproject/Hilary/badge.png)](https://coveralls.io/r/oaeproject/Hilary)
[![Code Climate](https://codeclimate.com/github/oaeproject/Hilary/badges/gpa.svg)](https://codeclimate.com/github/oaeproject/Hilary)
[![dependencies](https://david-dm.org/oaeproject/Hilary.svg)](https://david-dm.org/oaeproject/Hilary)
[![devdependencies](https://david-dm.org/oaeproject/Hilary/dev-status.svg)](https://david-dm.org/oaeproject/Hilary#info=devDependencies)

## Installation

If you're looking to install the OAE project manually, check out [this page](https://github.com/brecke/Hilary/wiki/Manual-installation-&-setup) and then go the the [Setup section](#setup) below.

If you're looking to setup a development environment, you might want to run node locally instead of inside a docker container. If that's the case, follow through the instructions below and then check the troubleshooting section.

Otherwise, please follow our docker quickstart guide:

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

The `docker-compose.yml` file includes the folder paths (mountpoints) where the container volumes will be mounted, namely:

- `oae-hilary`:
  - `/src/Hilary`
  - `/src/files`
  - `/src/tmp/oae`
- `oae-elasticsearch`:
  - `/data/elasticsearch`
- `oae-nginx`:
  - `/src/files`
  - `/src/Hilary/3akai-ux/nginx/nginx.conf.docker`
  - `/src/Hilary/3akai-ux/nginx/mime.conf`
  - `/src/Hilary/3akai-ux/nginx/nginx-selfsigned.crt`
  - `/src/Hilary/3akai-ux/nginx/nginx-selfsigned.key`
  - `/src/Hilary/3akai-ux/nginx/self-signed.conf`
  - `/src/Hilary/3akai-ux/nginx/ssl-params.conf`
  - `/src/Hilary/3akai-ux/nginx/dhparam.pem`
  - `/src/Hilary/3akai-ux`
- `oae-cassandra`:
  - `/data/cassandra`
- `oae-etherpad`:
  - `/data/etherpad/dirty.db`
- `oae-portainer`:
  - `/data/portainer/data`
  - `/var/run/docker.sock`

Either make sure these paths are the ones you're using or change them in the `docker-compose.yml` file to match your own paths.

Then, we need to edit the `config.js` file and change the `config.ui` path from:

```
config.ui = {
    'path': '../3akai-ux'
};
```

to

```
config.ui = {
    'path': './3akai-ux'
};
```

and then make sure you change the following settings in `config.js` as well:

```
    'hosts': ['127.0.0.1:9160'], # replace this
    'hosts': ['oae-cassandra:9160'], # by this
```

```
    'host': '127.0.0.1', # replace this
    'host': 'oae-redis', # by this
```

```
    'host': 'localhost', # replace this
    'host': 'oae-elasticsearch', # by this
```

```
    'host': 'localhost', # replace this
    'host': 'oae-rabbitmq', # by this
```

```
config.previews = {
    'enabled': false, # replace this
    'enabled': true, # by this (optional)
```

```
    'host': '127.0.0.1', # replace this
    'host': 'oae-etherpad', # by this
```


#### Build the docker image locally

```
docker-compose create --build # this will build the hilary:latest image
```

NOTE: if the previous step fails due to network problems, try changing the DNS server to Google's: 8.8.8.8 or 8.8.4.4. In order to do this, either use your operating system's settings or do it via the command line interface by editing `/etc/resolv.conf` and making sure these two lines are on top:

```
nameserver 8.8.8.8
nameserver 8.8.4.4
```

#### Install dependencies

In order to install dependencies for the frontend and the backend, we need to run a one-off command for each:

```
docker-compose run oae-hilary "cd node_modules/oae-rest && npm install" # install dependencies for oae-rest
docker-compose run oae-hilary "cd 3akai-ux && npm install" # install dependencies for 3akai-ux
docker-compose run oae-hilary "npm install" # install dependencies for Hilary
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

#### Run the containers

Run `docker-compose up` and all the containers will boot.

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

### Troubleshooting

#### Booting takes too much time

If you're on OSX, you might experience very slow booting especially for the Hilary server. This is a well known issue due to volume mounting. As a workaround, we recommend using [docker-sync](https://github.com/EugenMayer/docker-sync). Just follow the installation instructions on the website, edit the `docker-sync.yml` file so that `syncs > oae-hilary-sync > src` contains your Hilary source path as follows:

```
syncs:
  oae-hilary-sync:
    ...
    src: '/src/Hilary' # <- make sure this path is correct
  ...
```

Then, make sure you rename the mac-specific `docker-compose.mac.json` file we've included:

```
cp docker-compose.yml docker-compose.backup.yml
cp docker-compose.mac.yml docker-compose.yml
```

Finally, try one of these two alternatives to boot all the containers:

1. Run `docker-sync start` on a terminal window and then `docker-compose -f docker-compose.mac.yml up` on another, in this order
2. Run `docker-sync-stack start` which combines both commands above

More information on docker-sync is available [here](https://github.com/EugenMayer/docker-sync/wiki).

#### All I see is the 502 service unavailable page

If you still can't see the Web interface correctly by the time the containers start, it might be due to Hilary starting before Cassandra was available. This usually results in 502 _Service unavailable_ pages. We recommend to start hilary again to make sure it boots after cassandra is accepting connections: `docker-compose restart oae-hilary`. This is something we're looking to fix in the future.

#### I would like to run node directly on my machine instead of inside a container

We understand that, and we do that ourselves too :) You can have that with just a few changes. If you're using linux:

In `config.js` change the following values:

- `oae-rabbitmq`
- `oae-cassandra`
- `oae-elasticsearch`
- `oae-etherpad`
- `oae-redis`

...all to `localhost`.

Then, edit `nginx.conf.docker` and make sure these lines:

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

Also, don't forget that running `Hilary` locally implies installing several other packages, namely `soffice` (libreoffice), `pdftotext` and `pdf2htmlEX`. You can find instructions on how to do this [here](https://github.com/brecke/Hilary/wiki/Manual-installation-&-setup).

Now if you comment out the `oae-hilary` service in the `docker-compose.yml` file and run `docker-compose up`, all services boot except for Hilary. Then you may then run `nodemon app.js | bunyan` locally on the terminal and you should be able to start the server.

## Get in touch

The project website can be found at http://www.oaeproject.org. The [project blog](http://www.oaeproject.org/blog) will be updated with the latest project news from time to time.

The mailing list used for Apereo OAE is oae@apereo.org. You can subscribe to the mailing list at https://groups.google.com/a/apereo.org/d/forum/oae.

Bugs and other issues can be reported in our [issue tracker](https://github.com/oaeproject/Hilary/issues). Ideas for new features and capabilities can be suggested and voted for in our [UserVoice page](http://oaeproject.uservoice.com).
