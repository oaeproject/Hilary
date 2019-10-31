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

FROM node:10-alpine

LABEL Name=OAE-Hilary
LABEL Author=ApereoFoundation
LABEL Email=oae@apereo.org

RUN apk --update --no-cache add \
      git \
      python \
      ghostscript \
      graphicsmagick curl openssh-client python py-pip bash su-exec wget

# Installs the 3.9 Chromium package.
RUN apk update && apk upgrade && \
    echo @3.9 http://nl.alpinelinux.org/alpine/v3.9/community >> /etc/apk/repositories && \
    echo @3.9 http://nl.alpinelinux.org/alpine/v3.9/main >> /etc/apk/repositories && \
    apk add --no-cache \
      chromium@3.9 \
      nss@3.9 \
      freetype@3.9 \
      harfbuzz@3.9 \
      ttf-freefont@3.9

# Install libreoffice
RUN apk add --no-cache libreoffice openjdk8-jre

# Install nodegit
RUN apk --update --no-cache add build-base libgit2-dev
RUN ln -s /usr/lib/libcurl.so.4 /usr/lib/libcurl-gnutls.so.4

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

# Set base folder
ENV BASE_DIR /opt
RUN mkdir -p ${BASE_DIR}

# Set etherpad folder
ENV ETHERPAD_DIR ${BASE_DIR}/etherpad
RUN mkdir -p ${ETHERPAD_DIR}

# Set ethercalc folder
ENV ETHERCALC_DIR ${BASE_DIR}/ethercalc
RUN mkdir -p ${ETHERCALC_DIR}

# Set permissions for base dir and its contents
RUN chown -R node:node ${BASE_DIR} \
      && chmod -R 755 ${BASE_DIR}

# Install cqlsh for etherpad
RUN pip install cqlsh==4.0.1
RUN pip install thrift==0.9.3

# Install PM2 for etherpad and ethercalc
RUN yarn global add pm2

# Install lerna
RUN yarn global add lerna

# Copy specific configuration for running tests
COPY .circleci/settings.json ${BASE_DIR}

# Expose ports for node server
EXPOSE 2000
EXPOSE 2001

USER node

# Run the app - you may override CMD via docker run command line instruction
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["nodemon -L app.js | bunyan"]
