#
# Copyright 2018 Apereo Foundation (AF) Licensed under the
# Educational Community License, Version 2.0 (the "License"); you may
# not use this file except in compliance with the License. You may
# obtain a copy of the License at
#
#     http://opensource.org/licenses/ECL-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an "AS IS"
# BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
# or implied. See the License for the specific language governing
# permissions and limitations under the License.
#

# Heavily based on:
# - https://hub.docker.com/r/bwits/pdf2htmlex-alpine
# - https://gist.github.com/Rockstar04/c77f9f46f15be7b156aaed9a34bb5188

#
# Setup in two steps
#
# Step 1: Build the image
# $ docker build -f Dockerfile -t oae-hilary:latest .
# Step 2: Run the docker
# $ docker run -it --name=hilary --net=host oae-hilary:latest
#

# This tag corresponds to node 15.x and alpine 3.11
FROM node:15.2.1-alpine3.11

LABEL Name=OAE-Hilary
LABEL Author=ApereoFoundation
LABEL Email=oae@apereo.org

# Avoid prompt when using npx
ENV npm_config_yes true

# Upgrade system libraries
RUN apk update ; apk upgrade

# Install system dependencies
RUN apk --no-cache add \
      curl \
      git \
      build-base \
      make \
      python2 \
      ghostscript \
      libreoffice \
      vips \
      ca-certificates \
      openjdk8-jre

# Installs latest Chromium
RUN apk --no-cache add \
      chromium \
      nss \
      freetype \
      freetype-dev \
      harfbuzz \
      ca-certificates \
      ttf-freefont

# Tell Puppeteer to skip installing Chrome. We'll be using the installed package.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
      PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Set the Hilary directory
ENV CODE_DIR /usr/src
ENV HILARY_DIR ${CODE_DIR}/Hilary
RUN mkdir -p ${HILARY_DIR}
WORKDIR ${HILARY_DIR}

# Set the right permissions for Hilary
RUN chown -R node:node ${CODE_DIR} \
      && chmod -R 755 ${CODE_DIR}

# Create the temp directory for Hilary
ENV TMP_DIR /tmp
RUN mkdir -p ${TMP_DIR}
RUN chown -R node:node ${TMP_DIR} \
      && chmod -R 755 ${TMP_DIR} \
      && export TMP=${TMP_DIR}

# Expose ports for node server
EXPOSE 2000
EXPOSE 2001

# Change user from now on
USER node

# Run the app - you may override CMD via docker run command line instruction
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["node app.js | bunyan"]
