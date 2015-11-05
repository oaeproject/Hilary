# Open Academic Environment (OAE Project)

Hilary is the back-end for the [Open Academic Environment](http://www.oaeproject.org/)

## Build status
[![Build Status](https://travis-ci.org/oaeproject/Hilary.png?branch=master)](https://travis-ci.org/oaeproject/Hilary)
[![Coverage Status](https://coveralls.io/repos/oaeproject/Hilary/badge.png)](https://coveralls.io/r/oaeproject/Hilary)

## Quickstart Guide

The following guide will take you through the necessary steps to run the back-end for OAE (Hilary) and its reference UI (3akai-ux) for development purposes.

### Installing dependencies

If you're installing on Windows (not recommended for production) there's a package manager called Chocolatey that can be used to install all the dependencies quickly. See the `Windows Dependencies` section of this document for more information.

#### Node.js

Download and install the latest version of [Node.js](http://nodejs.org/). Hilary is best tested with node 0.10.x (0.10.25 at the time of writing).

The Hilary back-end is written completely in JavaScript, powered by Node.js.

#### Apache Cassandra

Download the latest 2.1 version of [Apache Cassandra](http://cassandra.apache.org/download/) and extract it to a directory of your choice.

**Important:**
* Cassandra is best supported with the latest version of Oracle Java 7. Trying to run vanilla Cassandra with OpenJDK can result in a silent segmentation fault

Create the following directories and set the owner to be the user that will be running Cassandra:

```
sudo mkdir -p /var/log/cassandra
sudo chown -R `whoami` /var/log/cassandra
sudo mkdir -p /var/lib/cassandra
sudo chown -R `whoami` /var/lib/cassandra
```

Then you can start Cassandra by running the following:

```
cd my-cassandra-dir
bin/cassandra -f
```

To start it in the background, you can omit the `-f` parameter.

All canonical Hilary data is stored in Apache Cassandra. Therefore it is *not necessary* to install any RDBMS such as MySQL or PostgreSQL.

#### Redis

Download and install (or compile) the latest version of Redis, please follow the installation instructions on the [Redis download page](http://redis.io/download).

**Important:**
* In order to install Redis on Mac OS X, you will first need to make sure that [XCode](https://developer.apple.com/xcode/downloads/) is installed

Once installed, you can start Redis by running the following:

```
cd my-redis-dir
src/redis-server
```

To start it in the background, you can update the `redis.conf` to set the property `daemonize yes`.

Redis is used for caching frequently accessed data and for broadcasting messages (PubSub) across the application cluster.

#### ElasticSearch

Download the latest 1.1.x point release of [ElasticSearch](http://www.elasticsearch.org/download/), and extract it to a directory of your choice. Once extracted, you can start it by running the following:

```
cd my-elasticsearch-dir
bin/elasticsearch -f
```

To start it in the background, you can omit the `-f` parameter.

ElasticSearch powers the full-text search functionality of OAE.

#### RabbitMQ

To install RabbitMQ, please follow the instructions on the [RabbitMQ download page](http://www.rabbitmq.com/download.html). Once completed, you should be able to start RabbitMQ by running the following:

```
rabbitmq-server
```

To start it in the background, you can run: `rabbitmq-server -detached`

RabbitMQ powers the asynchronous task-queue function in Hilary. It allows heavier "background" tasks such as activity processing, search indexing and preview processing to be off-loaded to specialized clusters of servers. Though, in a development environment you don't need to worry about specialized clusters, your development machine will do just fine out-of-the-box.

#### GraphicsMagick

GraphicsMagick installation instructions can be found on their [README page](http://www.graphicsmagick.org/README.html), however for *nix OS' it is typically available in the package manager of your choice (e.g., `brew install graphicsmagick`).
When installing GraphicsMagick manually, make sure you have at least [libpng](http://www.libpng.org/pub/png/libpng.html), [libjpeg](http://libjpeg.sourceforge.net) and [Ghostscript](http://www.ghostscript.com) installed.

GraphicsMagick provides the ability to crop and resize profile pictures, and is required to run Hilary.

#### Preview Processor (optional)

The preview processor is not a requirement to run Hilary, but it certainly makes things look wonderful. It takes care of producing previews of content items for the UI (e.g., splitting PDFs into pages, cropping / resizing uploaded images). There are a few dependencies needed only if you are planning to run the preview processor:

##### pdf2htmlEX (only if preview processor is desired)

Download and install [pdf2htmlEX](https://github.com/coolwanglu/pdf2htmlEX) **0.11 or later**. This dependency takes care of converting a pdf file to a set of HTML files.

On Ubuntu this can be installed by running:
```
sudo add-apt-repository ppa:coolwanglu/pdf2htmlex
sudo apt-get update
sudo apt-get install pdf2htmlEX
```

##### LibreOffice (only if preview processor is desired)

Download and install [LibreOffice](http://www.libreoffice.org/download/). This dependency takes care of converting Microsoft Office files to PDFs so they may be further split into previews by PDFTK.

##### pdftotext (only if preview processor is desired)

`pdftotext` is used to extract text out of PDF documents so that the contents of document uploads can be searched in OAE.

The required version of `pdftotext` comes with a library called Poppler which is installed when you install `pdf2htmlEX`. Note that this version of `pdftotext` is approximately **0.29**. The latest stand-alone version of `pdftotext` is approximately 3+ and it is not supported.

  * If you installed `pdf2htmlEX` with the Ubuntu PPA, then you probably already have the correct version of pdftotext in your path
  * If you installed `pdf2htmlEX` with Homebrew for MacOSX, then you probably have it available. If you can't find it on your path, try running `brew unlink poppler` then `brew link poppler`, and that should ensure all binary links (including `pdftotext`) get installed to your path
  * If you compiled `pdf2htmlEX` yourself, you're a wizard. `pdftotext` is available in your poppler distribution's `bin` directory

If none of these work for you, you can download and compile the latest [Poppler](http://poppler.freedesktop.org/releases.html) tarball. `pdftotext` will be available in the installed `bin` directory.

#### Nginx

Download [Nginx **version 1.4.2 or higher**](http://nginx.org/en/download.html). You will also need to download and extract [PCRE](http://www.pcre.org/), which will be used to configure Nginx.

Once you've downloaded and extracted both to directories of your choice, you can configure and install:

```
cd your-nginx-dir
./configure --with-pcre=/path/to/pcre
make
sudo make install
```

Nginx is the most tested load balancer and web server used for OAE. A web server such as Nginx is necessary for file downloads to work properly.

#### Etherpad lite

[Etherpad](http://etherpad.org/) is an open-source editor for online collaborative editing in real-time and is used to power the OAE collaborative documents. Follow the [Etherpad README](https://github.com/ether/etherpad-lite/blob/develop/README.md) to get it installed. Make sure you get the 1.5.6 release.

Once you've installed Etherpad, you will also need the [Etherpad OAE](https://github.com/oaeproject/ep_oae) plugin. This is the glue for authenticating users between Hilary and etherpad-lite. The simplest method of installing the plugin is cloning it in the top node_modules folder that can be found in your etherpad-lite directory.

```
cd your-etherpad-dir
cd node_modules
git clone https://github.com/oaeproject/ep_oae
cd ep_oae
npm install
cd ../..
```

You can copy or symlink the `static/css/pad.css` in the `ep_oae` module to `your-etherpad-dir/src/static/custom/pad.css` in order to apply the OAE skin on etherpad. The module needs to send events back to OAE, which happens over RabbitMQ. If you're not running RabbitMQ on the IP or port, you can configure the settings by adding the following block to Etherpad's `settings.json` file.

```javascript
"ep_oae": {
    "mq": {
        "host": "127.0.0.1",
        "port": 5672
    }
}
```

```
cd your-etherpad-dir
rm src/static/custom/pad.css
ln -s ../../../node_modules/ep_oae/static/css/pad.css src/static/custom/pad.css
```

Next, we need to enable websockets as a way of communicating between Etherpad and Hilary. In order to do this, open the settings.json file in your favourite editor and change

```javascript
"socketTransportProtocols" : ["xhr-polling", "jsonp-polling", "htmlfile"],
```

to

```javascript
"socketTransportProtocols" : ["websocket", "xhr-polling", "jsonp-polling", "htmlfile"],
```

It is also recommended that you change the default pad text. In order to do this, open the settings.json file in your favourite editor and change

```javascript
"defaultPadText" : "Welcome to Etherpad!\n\nThis pad text is synchronized ..."
```

to

```javascript
"defaultPadText" : ""
```

You can optionally add some plugins which make Etherpad look and feel slightly better.
The installation process is the same as the OAE plugin so it should be installed in the top-level node_modules directory.

 * `ep_headings`: Allows you to use HTML headings in the collaborative document

```
cd your-etherpad-dir
npm install ep_headings
```

In order to have custom titles for headers, copy or symlink the `static/templates/editbarButtons.ejs` file in the `ep_oae` module to `your-etherpad-directory/node_modules/ep_headings/templates/editbarButtons.ejs`.

```
cd your-etherpad-dir
rm node_modules/ep_headings/templates/editbarButtons.ejs
ln -s ../../../node_modules/ep_oae/static/templates/editbarButtons.ejs node_modules/ep_headings/templates/editbarButtons.ejs
```

In order to use the OAE toolbar, the etherpad `settings.json` file needs to be updated to reflect the following changes:

```javascript
"toolbar": {
    "left": [
        ["bold", "italic", "underline", "strikethrough", "orderedlist", "unorderedlist", "indent", "outdent"]
    ],
    "right": [
        ["showusers"]
    ]
}
```

Now, Etherpad can be started by running the following command:

```
bin/run.sh
```

To run it in the background, simply fork the process: `bin/run.sh &`

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

OAE is a multi-tenant system that discriminates the tenant by the host name with which you are accessing the server. In order to support the "Global Tenant" (i.e., the tenant that hosts the administration UI) and a "User Tenant", you will need to have at least 2 different host names that point to your server. To do this, you will need to add the following entries to your `/etc/hosts` file:

```
127.0.0.1   admin.oae.com
127.0.0.1   tenant1.oae.com
```

Where "admin.oae.com" is the hostname that we will use to access the global administration tenant and "tenant1.oae.com" would be one of many potential user tenant hosts.

##### Hilary config.js

Open the `config.js` file in the root of the Hilary directory. This file contains a JavaScript object that represents the configuration for your server.

* Configure the `config.files.localStorageDirectory` property to point to a directory that exists. The reference to this directory should not have a trailing slash. This directory is used to store files such as profile pictures, content bodies, previews, etc...
* Ensure that the property `config.servers.globalAdminHost` is configured to the same host name you set for your global admin host in /etc/hosts
* Configure the `config.etherpad.apikey` property to the API Key that can be found in `your-etherpad-dir/APIKEY.txt`

**If you want preview processing enabled, configure the following:**

* Ensure that the property `config.previews.enabled` is set to `true`
* Ensure that the locations of the LibreOffice and PDFTK binaries are correct in the `config.previews.binaries` property

##### Nginx Configuration

Find the "nginx.conf" template file located in the nginx folder of the 3akai-ux (3akai-ux/nginx/nginx.conf) repository that you cloned earlier and perform the following edits:

* Replace `<%= nginxConf.NGINX_USER %>` and `<%= nginxConf.NGINX_GROUP %>` with the OS user and group that the nginx process should run as
* Replace `<%= nginxConf.NGINX_HOSTNAME %>` with the same value you configured for the global administration server host in `/etc/hosts` (the one whose current value would be "admin.oae.com"). **Note:** The `server_name` property for the *user tenant server* further down the configuration file should remain set to "\*".
* Replace all instances of `<%= nginxConf.UX_HOME %>` with the full absolute path to your cloned 3akai-ux directory (e.g., /Users/branden/oae/3akai-ux) or the 3akai-ux production build directory (e.g., /Users/branden/oae/3akai-ux/target/optimized)
* Replace `<%= nginxConf.LOCAL_FILE_STORAGE_DIRECTORY %>` with the full absolute path that you configured as the `localStorageDirectory` in the `files` section of the  Hilary `config.js` file. This path should not have a trailing slash

When you have finished making changes to the nginx.conf file, start Nginx:

```
sudo /usr/local/nginx/sbin/nginx -c your-3akai-ux-dir/nginx/nginx.conf
```

#### Install NPM dependencies

NPM is the package manager that downloads all the Node.js dependencies on which Hilary relies. To tell NPM to download all the dependencies, run this command in your Hilary directory:

```
npm install -d
```

### Starting the server

Now we're ready to start the app server. You can do so by going into the Hilary directory and running:

```
node app.js | node_modules/.bin/bunyan
```

To start it in the background, you can run: `node app.js | node_modules/.bin/bunyan &`. An [upstart script](https://github.com/oaeproject/puppet-hilary/blob/master/modules/hilary/templates/upstart_hilary.conf.erb) can also be used to spawn and manage Hilary as a daemon process. The benefit of tying into upstart is that you get first-class support from deployment tools like MCollective and Puppet.

The server is now running and you can access the administration UI at http://admin.oae.com/!

**Tip:** If you install bunyan as a global dependency with `npm install -g bunyan`, you can start the app instead with 'node app | bunyan'.

### Creating your first user tenant

When you start the server, all data schemas will be created for you if they don't already exist. A global administrator user and global administration tenant will be ready for you as well. You can use these to create a new user tenant that hosts the actual OAE user interface.

1. Visit http://admin.oae.com/  (substitute "admin.oae.com" with the administration host you configured in `/etc/hosts`)
1. Log in with username and password: administrator / administrator
1. Click the "Tenants" header to open up the actions
1. Click "Create tenant"
1. Choose an alias (a short, unique 2-5 character alphanumeric string such as "oae"), and a name of your liking.
1. For the Host field, use the host you configured for your user tenant in `/etc/hosts` (e.g., "tenant1.oae.com")
1. Click "Create new tenant"

You can now access the user tenant by their host http://tenant1.oae.com and start creating new users.

### Creating your first user

To create a new user, use either the Sign Up link at the top left, or the Sign In link at the top right.

**Tip:** OAE requires that users have an email address that is verified VIA an email that is sent to the user. To avoid the requirement of having a valid email server configuration, you can instead watch the app server logs when a user is created or their email address is updated. When `config.email.debug` is set to `true` in `config.js`, the content of the verification email can be seen in the logs, and you can copy/paste the email verification link from the log to your browser to verify your email. The URL will look similar to: `http://tenant1.oae.com/?verifyEmail=abc123`

We're looking forward to seeing your contributions to the OAE project!

## Get in touch

The project website can be found at http://www.oaeproject.org. The [project blog](http://www.oaeproject.org/blog) will be updated with the latest project news from time to time.

The mailing list used for Apereo OAE is oae@apereo.org. You can subscribe to the mailing list at https://groups.google.com/a/apereo.org/d/forum/oae.

Bugs and other issues can be reported in our [issue tracker](https://github.com/oaeproject/Hilary/issues). Ideas for new features and capabilities can be suggested and voted for in our [UserVoice page](http://oaeproject.uservoice.com).
