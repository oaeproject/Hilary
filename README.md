# Open Academic Environment (OAE Project)

Hilary is the back-end for the [Open Academic Environment](http://www.oaeproject.org/)

## Build status
[![Build Status](https://travis-ci.org/oaeproject/Hilary.png?branch=master)](https://travis-ci.org/oaeproject/Hilary)

## Quickstart Guide

The following guide will take you through the necessary steps to run the back-end for OAE (Hilary) and its reference UI (3akai-ux) for development purposes.

### Installing dependencies
If you're installing on Windows (not recommended for production) there's a package manager called Chocolatey that can be used to install all the dependencies quickly. See the `Windows Dependencies` section of this document for more information.

#### Node.js

Download and install the latest version of [Node.js](http://nodejs.org/). Hilary is best tested with node 0.8.x (0.8.24 at time of writing), however is reported to work fine on at least 0.10.6 as well. Do not use any version prior to 0.8.x.

The Hilary back-end is written completely in JavaScript, powered by Node.js.

#### Apache Cassandra

Download the latest version if [Apache Cassandra](http://cassandra.apache.org/) and extract it to a directory of your choice. Then you can start it in the backround by running the following:

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

All Hilary data is stored in Apache Cassandra. Therefore it is *not necessary* to install any RDBMS such as MySQL or PostgreSQL.

#### Redis

Download and install (or compile) the latest version of Redis, please follow the installation instructions on the [Redis download page](http://redis.io/download). Once installed, you can start it by running the following:

```
cd my-redis-dir
src/redis-server
```

Redis is used for caching frequently accessed data and for broadcasting messages (PubSub) across the application cluster.

#### ElasticSearch

Download the latest version of [ElasticSearch](http://www.elasticsearch.org/download/), and extract it to a directory of your choice. Once extracted, you can start it in the backround by running the following:

```
cd my-elasticsearch-dir
bin/elasticsearch
```

ElasticSearch powers the full-text search functionality of OAE.

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

Download and install [PDFTK](http://www.pdflabs.com/tools/pdftk-the-pdf-toolkit/). This dependency takes care of splitting PDF files into individual pages.

##### LibreOffice (only if preview processor is desired)

Download and install [LibreOffice](http://www.libreoffice.org/download/). This dependency takes care of converting Microsoft Office files to PDFs so they may be further split into previews by PDFTK.

#### Nginx (version 1.4.1 or higher)

Download [Nginx **version 1.4.1 or higher**](http://nginx.org/en/download.html). You will need to download [PCRE](http://www.pcre.org/) as well for configuring Nginx.

Once you've downloaded and extracted both to directories of your choice, you can configure and install:

```
cd your-nginx-dir
./configure --with-pcre=/path/to/pcre
make
sudo make install
cd /usr/local/nginx
sudo sbin/nginx
```

Nginx is the most tested load balancer and web server used for OAE. A web server such as Nginx is necessary for file downloads to work properly.

#### Etherpad lite

[Etherpad](http://etherpad.org/) is an open-source editor for online collaborative editing in real-time and is used to power the OAE collaborative documents. Follow the [Etherpad README](https://github.com/ether/etherpad-lite/blob/develop/README.md) to get it installed.

Once you've installed the server you will also need the [Etherpad OAE](https://github.com/oaeproject/ep_oae) plugin. It's the glue for authenticating users between Hilary and etherpad-lite.
The simplest method of installing the plugin is cloning it in the top node_modules folder that can be found in your etherpad-lite directory.

```
cd your-etherpad-dir
cd node_modules
git clone https://github.com/oaeproject/ep_oae
cd ..
```

You can copy or symlink the `static/css/pad.css` in the `ep_oae` module to `your-etherpad-dir/src/static/custom/pad.css` in order to apply the OAE skin on etherpad.

```
cd your-etherpad-dir
rm src/static/custom/pad.css
ln -s your-etherpad-dir/static/css/pad.css src/static/custom/pad.css
```

Next, we need to enable websockets as a way of communicating between Etherpad and Hilary. In order to do this, open the settings.json file in your favourite editor and change

```
"socketTransportProtocols" : ["xhr-polling", "jsonp-polling", "htmlfile"],
```

to

```
"socketTransportProtocols" : ["websocket", "xhr-polling", "jsonp-polling", "htmlfile"],
```

It is also recommended that you change the default pad text. In order to do this, open the settings.json file in your favourite editor and change

```
"defaultPadText" : "Welcome to Etherpad!\n\nThis pad text is synchronized ..."
```

to

```
"defaultPadText" : ""
```

You can optionally add the [Etherpad headings plugin](https://github.com/fourplusone/etherpad-plugins/tree/master/ep_headings) which allows you to use HTML headings in your document.
The installation process is the same as the OAE plugin so it should be installed in the top-level node_modules directory.

```
cd your-etherpad-dir
cd ..
git clone git://github.com/fourplusone/etherpad-plugins.git
cd your-etherpad-dir
npm install your-etherpad-plugins-dir/ep_headings
```

Now, Etherpad can be started by running the following command:

```
bin/run.sh
```

#### Windows Dependencies

##### Installing with chocolatey

Open a command line and install Chocolatey with the following command:

    @powershell -NoProfile -ExecutionPolicy unrestricted -Command "iex ((new-object net.webclient).DownloadString('http://chocolatey.org/install.ps1'))" && SET PATH=%PATH%;%systemdrive%\chocolatey\bin

If you don't yet have git installed you can use Chocolatey to install it with `cinst msysgit`.

You can then install the remaining dependencies using the `chocolatey.config` in this repo:

    cinst chocolatey.config

Note that this will install the dependencies, but doesn't necessarily configure and start them for you. You should still read the individual service sections of this document to ensure you've configured and started all the necessary services.

##### Installing manually

Windows has a few extra dependencies that are known to be needed:

**Windows 7:**

* [Microsoft Visual Studio C++ 2010](http://go.microsoft.com/?linkid=9709949); and
* [Microsoft Windows SDK for Windows](http://www.microsoft.com/en-us/download/details.aspx?id=8279)

**Windows 8:**

* [Microsoft Visual Studio C++ 2012](http://go.microsoft.com/?linkid=9816758)

### Deploying the server

#### Get the code

By default, OAE assumes both the [Hilary repository](http://github.com/oaeproject/Hilary) and the [3akai-ux repository](http://github.com/oaeproject/3akai-ux) are siblings in the same directory. If you want to make changes to the code, you will want your own fork of these repositories, which can then be used to push to and send pull requests from. If you are only trying to set up a new OAE instance, the Github repositories below should be sufficient. We now clone both of the repositories. If you have created your own forks of Hilary and 3akai-ux, please substitute the repositories below with your repositories:

```
~/oae$ git clone git://github.com/oaeproject/Hilary.git
~/oae$ git clone git://github.com/oaeproject/3akai-ux.git
```

Please remember that filenames and directories that contain spaces can sometimes result in unstable side-effects. Please ensure all paths are space-free.


#### Configuration

##### Hosts file

OAE is a multi-tenant system that discriminates the tenant by the host name with which you are accessing the server. In order to support the "Global Tenant" (i.e., the tenant that hosts the administration UI) and a "User Tenant", you will need to have at least 3 different host names that point to your server. To do this, you will need to add the following entries to your `/etc/hosts` file:

```
127.0.0.1   admin.oae.com
127.0.0.1   tenant1.oae.com
127.0.0.1   0.etherpad.oae.com
```

Where "admin.oae.com" is the hostname that we will use to access the global administration tenant, "tenant1.oae.com" would be one of many potential user tenant hosts and "0.etherpad.oae.com" is the default domain for the Etherpad server.

##### Hilary config.js

Open the `config.js` file in the root of the Hilary directory. This file contains a JavaScript object that represents the configuration for your server.

* Configure the `config.files.uploadDir` property to point to a directory that exists. This is where files such as profile pictures, content bodies, previews, etc... will be stored
* Ensure that the property `config.server.globalAdminHost` is configured to the same host name you set for your global admin host in /etc/hosts
* Configure the `config.etherpad.apikey` property to the API Key that can be found in `your-etherpad-dir/APIKEY.txt`

**If you want preview processing enabled, configure the following:**

* Ensure that the property `config.previews.enabled` is set to `true`
* Ensure that the locations of the LibreOffice and PDFTK binaries are correct in the `config.previews.binaries` property

##### Nginx Configuration

Find the "nginx.conf" template file located in the root folder of the 3akai-ux (3akai-ux/nginx.conf) repository that you cloned earlier. Now replace your the nginx.conf file that came with your Nginx install (e.g., `/usr/local/nginx/conf/nginx.conf`) with this one and perform the following edits:

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

We're looking forward to seeing your contributions to the OAE project!

