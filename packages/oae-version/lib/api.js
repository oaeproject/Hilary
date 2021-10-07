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

import path, { dirname } from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Map } from 'immutable';
import * as git from 'isomorphic-git';
import { nth, reduce, gt as greaterThan, head, last } from 'ramda';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
const getVersionCB = function (callback) {
  getVersion().then((version) => callback(null, version));
};

const getVersion = async function (repoPath = hilaryDirectory, repoInformation = new Map()) {
  const commitLog = await git.log({ fs, dir: repoPath, depth: 1 });
  const headCommit = head(commitLog);
  const lastCommitId = headCommit.oid;
  const lastCommitDate = new Date(headCommit.commit.author.timestamp);
  const tags = await git.listTags({ fs, dir: repoPath });
  const latestTag = reduce(
    (highestTag, eachTag) =>
      greaterThan(Number.parseFloat(highestTag), Number.parseFloat(eachTag)) ? highestTag : eachTag,
    null,
    tags
  );

  /**
   * Isomorphic-git does not yet support submodules
   * so we have to list them by hand for now
   */
  const submodulePath = {
    fs,
    dir: repoPath
  };
  const submoduleFilters = [
    {
      filepaths: ['packages/oae-rest'],
      filter: (f) => f.match(/^packages\/oae-rest\/package.json$/)
    },
    {
      filepaths: ['3akai-ux/package.json'],
      filter: (f) => f.match(/^3akai-ux\/package\.json$/)
    },

    {
      filepaths: ['packages/restjsdoc'],
      filter: (f) => f.match(/^packages\/restjsdoc\/package.json$/)
    }
  ];
  const submodules = {
    'oae-rest': {
      path: await git.statusMatrix({
        ...submodulePath,
        ...nth(0, submoduleFilters)
      })
    },
    '3akai-ux': {
      path: await git.statusMatrix({
        ...submodulePath,
        ...nth(1, submoduleFilters)
      })
    },
    restjsdoc: {
      path: await git.statusMatrix({
        ...submodulePath,
        ...nth(-1, submoduleFilters)
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
