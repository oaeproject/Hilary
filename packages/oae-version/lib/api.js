/*! r

 * Copyright 2015 Apereo Foundation (AF) Licensed under the
 * Educational Community License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://opensource.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS"
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

import path from 'path';
import fs from 'fs';
import { Map } from 'immutable';
import * as git from 'isomorphic-git';
import { gt as greaterThan, head, last } from 'ramda';

// A variable that will hold the path to the UI directory
const hilaryDirectory = path.resolve(__dirname, '..', '..', '..');

/**
 * Get the version information for OAE
 *
 * @param  {Function}   callback                    Standard callback function
 * @param  {Object}     callback.err                An error that occurred, if any
 * @param  {Object}     callback.version            The version information
 * @param  {String}     callback.version.hilary     The version information for Hilary
 * @param  {String}     callback.version.3akai-ux   The version information for the UI
 */
const getVersionCB = function(callback) {
  getVersion().then(version => callback(null, version));
};

const getVersion = async function(repoPath = hilaryDirectory, repoInformation = new Map()) {
  const commitLog = await git.log({ fs, dir: repoPath, depth: 1 });
  const headCommit = head(commitLog);
  const lastCommitId = headCommit.oid;
  const lastCommitDate = new Date(headCommit.commit.author.timestamp);
  const tags = await git.listTags({ fs, dir: repoPath });
  const latestTag = tags.reduce((highestTag, eachTag) =>
    greaterThan(parseFloat(highestTag), parseFloat(eachTag)) ? highestTag : eachTag
  );

  /**
   * Isomorphic-git does not yet support submodules
   * so we have to list them by hand for now
   */
  const submodules = {
    'oae-rest': {
      path: await git.statusMatrix({
        fs,
        dir: repoPath,
        filepaths: ['packages/oae-rest'],
        filter: f => f.match(/^packages\/oae-rest\/package.json$/)
      })
    },
    '3akai-ux': {
      path: await git.statusMatrix({
        fs,
        dir: repoPath,
        filepaths: ['3akai-ux/package.json'],
        filter: f => f.match(/^3akai-ux\/package\.json$/)
      })
    },
    restjsdoc: {
      path: await git.statusMatrix({
        fs,
        dir: repoPath,
        filepaths: ['packages/restjsdoc'],
        filter: f => f.match(/^packages\/restjsdoc\/package.json$/)
      })
    }
  };

  const repoName = last(repoPath.split('/'));
  repoInformation = repoInformation.set(repoName, {
    lastCommitId,
    lastCommitDate,
    latestTag,
    submodules
  });

  return repoInformation;
};

export { getVersion, getVersionCB };
