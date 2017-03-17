#
# Copyright 2017 Apereo Foundation (AF) Licensed under the
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

# Setup in two steps
# 
# Step 1: Build the image
# $ docker build -f Dockerfile -t hilary:latest .
# Step 2: Run the docker
# $ docker run -it --name=node --net=host -v /src/brecke/Hilary:/usr/src/app -v /src/brecke/3akai-ux:/usr/src/3akai-ux hilary:latest

FROM node:6.10
LABEL Name=hilary Version=12.5.0 
MAINTAINER Apereo Foundation <which.email@here.question>

# npm dependencies
RUN npm install --global nodemon
RUN npm install --global bunyan

# Update aptitude with new repo
RUN apt-get update

# Install git
RUN apt-get install -y git

# Install dependencies
WORKDIR /usr/src/app
RUN mkdir -p /usr/src/app/node_modules
COPY package.json /tmp/package.json
COPY ./node_modules /usr/src/app/
RUN npm install && npm ls

# Expose ports
EXPOSE 2000
EXPOSE 2001

# Run the app
CMD ["/bin/sh", "-c", "nodemon -L app.js | bunyan"]