# Hilary

The NodeJS implementation of Sakai OAE

## Build status
[![Build Status](https://travis-ci.org/sakaiproject/Hilary.png?branch=master)](https://travis-ci.org/sakaiproject/Hilary)

## Quickstart Guide

The following guide will take you through the necessary steps to run the back-end for Sakai OAE (Hilary) and its reference UI (3akai-ux) for development purposes.

### Installing dependencies

#### Node.js

Download and install the latest version of [node.js](http://nodejs.org/). The Hilary back-end is written completely in JavaScript, powered by Node.js.

#### Cassandra

Download the latest version from [here](http://cassandra.apache.org/) and extract it to a directory of your choice. Then you can start it in the backround by running the following:

```
cd my-cassandra-dir
bin/cassandra
```

If you choose to instead install with a package manager, you'll want to ensure the following directories exist:

```
sudo mkdir -p /var/log/cassandra
sudo chown -R `whoami` /var/log/cassandra
sudo mkdir -p /var/lib/cassandra
sudo chown -R `whoami` /var/lib/cassandra
```

All Hilary data is stored in Cassandra instead of a relational database. Therefore it is *not necessary* to install any RDBMS such as MySQL or PostgreSQL.

#### Redis

Download and install (or compile) the latest version of Redis, please follow the installation instructions on the [Redis download page](http://redis.io/download). Once installed, you can start it by running the following:

```
cd my-redis-dir
src/redis-server
```

Redis is used for caching frequently accessed data and for broadcasting messages (PubSub) across the application cluster.

#### ElasticSearch

Download the latest version of ElasticSearch from [here](http://www.elasticsearch.org/download/), and extract it to a directory of your choice. Once extracted, you can start it in the backround by running the following:

```
cd my-elasticsearch-dir
bin/elasticsearch
```

ElasticSearch powers the full-text search functionality of Sakai OAE.

#### RabbitMQ

To install RabbitMQ, please follow the instructions on the [RabbitMQ Download Page](http://www.rabbitmq.com/download.html). Once completed, you should be able to start RabbitMQ in the background by running:

```
rabbitmq-server -detatched
```

RabbitMQ powers the asynchronous task-queue function in Hilary. It allows heavier "background" tasks such as activity processing, search indexing and preview processing to be off-loaded to specialized clusters of servers. Though, in a development environment you don't need to worry about specialized clusters, your development machine will do just fine out-of-the-box.

#### GraphicsMagick

GraphicsMagick installation instructions can be found on their [README page](http://www.graphicsmagick.org/README.html), however for *nix OS' it is typically available in the package manager of your choice (e.g., `brew install graphicsmagick`)

GraphicsMagick provides the ability to crop and resize profile pictures, and is required to run Hilary.

#### Preview Processor (optional)

The preview processor is not a requirement to run Hilary, but it certainly makes things look wonderful. It takes care of producing previews of content items for the UI (e.g., splitting PDFs into pages, cropping / resizing uploaded images). There are a few dependencies needed only if you are planning to run the preview processor:

##### PDFTK (only if preview processor is desired)

Download and install the PDFTK installer from [here](http://www.pdflabs.com/tools/pdftk-the-pdf-toolkit/). This dependency takes care of splitting PDF files into individual pages.

##### LibreOffice (only if preview processor is desired)

Download and install LibreOffice from [here](http://www.libreoffice.org/download/). This dependency takes care of converting Microsoft Office files to PDFs so they may be further split into previews by PDFTK.

#### Nginx (version 1.3.11 or higher)

Nginx **version 1.3.11 or higher** can be downloaded [here](http://nginx.org/en/download.html) (at the time of writing, version 1.3.11 can only be found as a development version). You will need [PCRE](http://www.pcre.org/) to configure Nginx.

Once you've downloaded and extracted both to directories of your choice, you can configure and install:

```
cd your-nginx-dir
./configure --with-pcre=/path/to/pcre
make
sudo make install
cd /usr/local/nginx
sudo sbin/nginx
```

Nginx is the most tested load balancer and web server used for Sakai OAE. A web server such as Nginx is necessary for file downloads to work properly.

#### Windows Only

Windows has a few extra dependencies that are known to be needed:

##### Microsoft Visual Studio C++ 2010 (Windows 7 only)

Microsoft Visual Studio C++ 2010 can be downloaded from [here](http://go.microsoft.com/?linkid=9709949)

##### Microsoft Windows SDK for Windows 7 (Windows 7 only)

Microsoft Windows SDK for Windows 7 can be downloaded from [here](http://www.microsoft.com/en-us/download/details.aspx?id=8279)

##### Microsoft Visual Studio C++ 2012 (Windows 8 only)

Microsoft Visual Studio C++ 2012 can be downloaded from [here](http://go.microsoft.com/?linkid=9816758)

### Deploying the server

#### Get the code

By default, OAE assumes both the [Hilary repository](http://github.com/sakaiproject/Hilary) and the [3akai-ux repository](http://github.com/sakaiproject/3akai-ux) are siblings in the same directory. You should clone both sets of code as such:

```
~/oae$ git clone git@github.com:sakaiproject/Hilary
~/oae$ git clone git@github.com:sakaiproject/3akai-ux
~/oae$ cd 3akai-ux
~/oae/3akai-ux$ checkout Hilary
```

**Note:** Currently you must use the **Hilary branch** in the 3akai-ux repository, as master remains built for the Nakamura back-end.

Please remember that filenames and directories that contain spaces can sometimes result in unstable side-effects. Please ensure all paths are space-free.


#### Configuration

##### Hosts file

Sakai OAE is a multi-tenant system that discriminates the tenant by the host name with which you are accessing the server. In order to support the "Global Tenant" (i.e., the tenant that hosts the administration UI) and a "User Tenant", you will need to have at least 2 different host names that point to your server. To do this, you will need to add the following entries to your `/etc/hosts` file:

```
127.0.0.1   admin.oae.com
127.0.0.1   tenant1.oae.com
```

Where "admin.oae.com" is the hostname that we will use to access the global administration tenant, and "tenant1.oae.com" would be one of many potential user tenant hosts.

##### Hilary config.js

Open the `config.js` file in the root of the Hilary directory. This file is a node.js module that contains a JavaScript object that represents the configuration for your server.

* Configure the `config.files.uploadDir` property to point to a directory that exists. This is where files such as profile pictures, content bodies, previews, etc... will be stored
* Ensure that the property `config.server.globalAdminHost` is configured to the same host name you set for your global admin host in /etc/hosts (Note: at time of writing, this property does not exist as Preview Processing has not been merged to master)

**If you want preview processing enabled, configure the following:**

* Ensure that the property `config.previews.enabled` is set to `true`
* Ensure that the locations of the LibreOffice and PDFTK binaries are correct in the `config.previews.binaries` property

##### Nginx Configuration

Find the "nginx.conf" template file located in the 3akai-ux repository that you cloned earlier. You will want to overwrite your nginx.conf file (e.g., `/usr/local/nginx/conf/nginx.conf`) with this one and perform the following edits:

* Replace `<%= NGINX_USER %>` and `<%= NGINX_GROUP %>` with the OS user and group that the nginx process should run as
* Replace `<%= UX_HOME %>` with the full absolute path to your cloned 3akai-ux directory (e.g., /Users/branden/oae/3akai-ux)
* Replace `<%= LOCAL_FILE_STORAGE_DIRECTORY %>` with the full absolute path that you configured for file storage in the `Hilary config.js` step
* Ensure that the `server_name` property for the *global administration server* (the one whose current value would be "admin.oae.com") is set to the same value you configured for the global administration host in `/etc/hosts`. **Note:** The `server_name` property for the *user tenant server* further down the configuration file should remain set to "*".

When you have finished making changes to the nginx.conf file, reload Nginx:

```
sudo /usr/local/nginx/sbin/nginx -s reload
```

##### Install NPM dependencies

NPM is the package manager that downloads all the Node.js dependencies on which Hilary relies. To tell NPM to download all the dependencies, run this command in your Hilary directory:

```
npm install -d
```

### Starting the server

Now we're ready to start the app server. You can do so by going into the Hilary directory and running:

```
node app.js | node_modules/.bin/bunyan
```

The server is now running and you can access the administration UI at http://admin.oae.com/!

**Tip:** If you install bunyan as a global depency with `npm install -g bunyan`, you can start the app instead with 'node app | bunyan'. 

### Creating your first user tenant

When you start the server, all data schemas will be created for you if they don't already exist. A global administrator user and global administration tenant will be ready for you as well. You can use these to create a new user tenant that hosts the actual OAE user interface.

1. Visit http://admin.oae.com/  (substitute "admin.oae.com" with the administration host you configured in `/etc/hosts`)
2. Log in with username and password: administrator / administrator
3. Click "Create a new tenant"
4. Choose an alias (a short, unique 2-5 character alphanumeric string such as "oae"), and a name of your liking.
5. For the Host field, use the host you configured for your user tenant in `/etc/hosts` (e.g., "tenant1.oae.com")
6. Click "Create new tenant"

That's it! You can now access the user tenant by their host http://tenant1.oae.com and start creating new users.

We're looking forward to seeing your contributions to the Sakai OAE project!

