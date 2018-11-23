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

FROM oaeproject/oae-hilary-deps-docker:v0.3

LABEL Name=OAE-Hilary
LABEL Author=ApereoFoundation
LABEL Email=oae@apereo.org

# Create the temp directory for Hilary
ENV TMP_DIR "/tmp/oae"
RUN mkdir -p "$TMP_DIR" && export TMP="$TMP_DIR"

# Set the base directory
RUN mkdir -p /usr/src/Hilary
WORKDIR /usr/src/Hilary

# Expose ports for node server
EXPOSE 2000
EXPOSE 2001

# Run the app - you may override CMD via docker run command line instruction
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["nodemon -L app.js | bunyan"]
