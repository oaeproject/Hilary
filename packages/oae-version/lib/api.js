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
import { Map } from 'immutable';
import git from 'nodegit';
import _ from 'underscore';

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
  // eslint-disable-next-line promise/prefer-await-to-then
  getVersion().then(version => {
    return callback(null, version);
  });
};

const getVersion = async function(repoPath = hilaryDirectory, repoInformation = new Map()) {
  const repo = await git.Repository.open(repoPath);
  const headCommit = await repo.getHeadCommit();

  const lastCommitId = headCommit.id().toString();
  const lastCommitDate = headCommit.date();

  const tags = await git.Tag.list(repo);

  const findLatestTag = (accumulator, currentValue) => {
    return parseFloat(accumulator) > parseFloat(currentValue) ? accumulator : currentValue;
  };

  const latestTag = tags.reduce(findLatestTag);

  const submodulePointers = {};
  const submodules = await repo.getSubmoduleNames();
  if (!_.isEmpty(submodules)) {
    for (let index = 0; index < submodules.length; index++) {
      const eachSubmodule = submodules[index];
      // eslint-disable-next-line no-await-in-loop
      const eachSubmoduleRepo = await git.Submodule.lookup(repo, eachSubmodule);
      submodulePointers[eachSubmodule] = eachSubmoduleRepo.headId().toString();
      // eslint-disable-next-line no-await-in-loop
      repoInformation = await getVersion(path.join(repoPath, eachSubmodule), repoInformation);
    }
  }

  const repoName = _.last(repoPath.split('/'));
  repoInformation = repoInformation.set(repoName, {
    lastCommitId,
    lastCommitDate,
    latestTag,
    submodulePointers
  });

  return repoInformation;
};

export { getVersion, getVersionCB };
