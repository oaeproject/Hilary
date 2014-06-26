#!/bin/bash

# We must ensure phantomjs is not available so the travis build will include it in node_modules when deploying
sudo rm -rf /usr/local/phantomjs

# Install Hilary deps
sudo apt-get install -qq graphicsmagick libreoffice pdftk chrpath pdf2htmlex
npm install -g grunt-cli
git clone --depth 1 --branch master git://github.com/oaeproject/3akai-ux.git ../3akai-ux
