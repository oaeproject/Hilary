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

FROM node:10-alpine3.9

LABEL Name=OAE-Hilary
LABEL Author=ApereoFoundation
LABEL Email=oae@apereo.org

# Install system dependencies
RUN apk --update --no-cache add \
      git \
      python \
      ghostscript \
      graphicsmagick \
      libreoffice \
      openjdk8-jre

# Installs the 3.9 Chromium package
RUN apk update && apk upgrade && \
      echo @3.9 http://nl.alpinelinux.org/alpine/v3.9/community >> /etc/apk/repositories && \
      echo @3.9 http://nl.alpinelinux.org/alpine/v3.9/main >> /etc/apk/repositories && \
      apk add --no-cache \
      chromium@3.9 \
      nss@3.9 \
      freetype@3.9 \
      harfbuzz@3.9 \
      ttf-freefont@3.9

# Tell Puppeteer to skip installing Chrome. We'll be using the installed package.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true

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
