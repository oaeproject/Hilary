# Hilary

The NodeJS implementation of Sakai OAE

## Build status
[![Build Status](https://travis-ci.org/sakaiproject/Hilary.png?branch=master)](https://travis-ci.org/sakaiproject/Hilary)

## Quickstart guide

The following guide will take you through the necessary steps to set up the back-end for Sakai OAE.

Start by forking and cloning the repository onto your local machine, instructions can be found [here](https://help.github.com/articles/fork-a-repo).

### Installing node.js

Download and install the latest version of [node.js](http://nodejs.org/).

### Installing dependencies

Once you have successfully cloned the repository and installed node.js, run the following commands in order to install all required dependencies.
More information about npm can be found [here](https://npmjs.org/).

```
cd your-sakai-repo-dir
npm install -d
```

### Setting up Cassandra

Download and install the latest version of [cassandra](http://cassandra.apache.org/).
Once downloaded and extracted in a directory of your choice, run the following commands to create the necessary folders that cassandra needs to run.

```
cd your-cassandra-dir
sudo mkdir -p /var/log/cassandra
sudo chown -R `whoami` /var/log/cassandra
sudo mkdir -p /var/lib/cassandra
sudo chown -R `whoami` /var/lib/cassandra
```

When that is complete, you can start up Cassandra in the foreground:

```
cd your-cassandra-dir
bin/cassandra -f
```

### Download and install the latest version of Redis

Download and install (or compile) the latest version of [redis](http://redis.io/download).

Once installed, start the server by running the `redis-server` binary.

### Download and install the latest version of ElasticSearch

ElasticSearch can be downloaded [here](http://www.elasticsearch.org/download/). By default, Hilary will expect ElasticSearch to be available on its default port: 9200.

Once you've installed ElasticSearch, you can start it up in the background:

```
cd your-elasticsearch-dir
bin/elasticsearch
```

### Download and install version 1.3.11 or up of Nginx

Nginx can be downloaded [here](http://nginx.org/en/download.html). You will need [PCRE](http://www.pcre.org/) to configure Nginx. Nginx 1.3.11+ is required for preview processing to work.

Once you've downloaded and unpacked both, you can configure and install:

```
cd your-nginx-dir
./configure --with-pcre=/path/to/pcre
sudo make
sudo make install
cd /usr/local/nginx
sudo sbin/nginx
```

Once the installation has completed you will need to replace the Nginx config with the default provided in 3akai-ux.

### Download and install the latest version of RabbitMQ

RabbitMQ can be downloaded [here](http://www.rabbitmq.com/download.html). By default, Hilary will expect RabbitMQ to be available on its default port: 5672.

Once installed, you can start up RabbitMQ in the background by running `rabbitmq-server -detached`, assuming rabbitmq-server is on your PATH.

### Download and install GraphicsMagick
On OS X: sudo port install graphicsmagick
On Linux: sudo apt-get install graphicsmagick
GraphicsMagick is used to crop profile pictures and is a requirement if you wish to run the tests successfully.

### Download and install the latest version of PDFTK

PDFTK is used to process PDF files and create previews of them. PDFTK is optional. You can download the PDFTK installer [here](http://www.pdflabs.com/tools/pdftk-the-pdf-toolkit/).

#### Start Hilary

```
cd your-sakai-repo-dir
node app.js
```

And that's it, the server should now be up and running! You can optionally install bunyan for pretty-printed logs.

You can access the admin page at http://localhost:2000/admin.html and login with `administrator - administrator`

We're looking forward to seeing your contributions to the Sakai OAE project!
