/*!
 * Copyright 2013 Apereo Foundation (AF) Licensed under the
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

var semver = require('semver');
var shell = require('shelljs');
var util = require('util');

var BinUtil = require('../util');

/**
 * Verify that the release process can begin with the current state of the repository.
 *
 * @param  {Number}     [errCode]   The process error code to return on failure. Default: 1
 */
var validateRelease = module.exports.validateRelease = function(errCode) {
    errCode = errCode || 1;


    // This refreshes the index state, somehow, for the following validations
    BinUtil.exec('git status', 'Error refreshing git cache with a git status', errCode);

    // Ensure there are no unstaged changes in the repository
    BinUtil.exec('git diff-files --quiet', 'It appears you may have unstaged changes in your repository', errCode);
    BinUtil.exec('git diff-index --quiet --cached HEAD', 'It appears you may have uncommitted changes in your repository', errCode);
    BinUtil.logSuccess('Repository state is clean for a release');
};

/**
 * Verify that the specified target version is a valid semver version and is greater than the current version.
 *
 * @param  {Object}     packageJson     The parsed hilary package.json
 * @param  {String}     toVersion       The target version to validate
 * @param  {Number}     errCode         The process error code to return on failure
 */
var validateTargetVersion = module.exports.validateTargetVersion = function(packageJson, toVersion, errCode) {

    // Ensure the target version is a valid semver version
    if (!semver.valid(toVersion)) {
        BinUtil.logFail('The target version of '.text + toVersion.error + ' is not a valid semver version'.text);
        return process.exit(errCode);
    }

    // Ensure that the new version number is greater than the old
    if (!semver.gt(toVersion, packageJson.version)) {
        BinUtil.logFail('The target version of '.text + toVersion.error + ' should be greater than the current version '.text + packageJson.version.error);
        return process.exit(errCode);
    }

    BinUtil.logSuccess(util.format('Validated the target release version %s', toVersion));
};

/**
 * Update the hilary package.json file to have the new target version.
 *
 * @param  {String}     packageJsonPath     The path to the hilary package.json to update
 * @param  {String}     fromVersion         The expected previous version in the package.json file
 * @param  {String}     toVersion           The target version to update the package.json to
 * @param  {Number}     errCode             The process error code to return on failure
 */
var bumpPackageJsonVersion = module.exports.bumpPackageJsonVersion = function(packageJsonPath, fromVersion, toVersion, errCode) {

    var replaceSource = util.format('\n  "version": "%s",\n', fromVersion);
    var replaceWith = util.format('\n  "version": "%s",\n', toVersion);

    // Perform a bogus replace so we can get the content back from sed's output
    var contentBefore = shell.sed('-i', '}"', '}"', packageJsonPath);
    var contentAfter = shell.sed('-i', replaceSource, replaceWith, packageJsonPath);

    if (contentBefore === contentAfter) {
        // We didn't replace anything
        BinUtil.logFail('Replacing regexp '.text + replaceSource.trim().error + ' with '.text + replaceWith.trim().error + ' in package.json resulted in no changes'.text);
        return process.exit(errCode);
    }

    if (shell.cat(packageJsonPath).indexOf(replaceWith) === -1) {
        BinUtil.logFail('Resulting package.json file did not contain the text ' + replaceWith.trim().error);
        return process.exit(errCode);
    }
};

/**
 * Shrinkwrap the current set of hilary dependencies. It's important that unit tests are run and testing has been done with
 * this set of dependencies before shrinkwrapping them into a release.
 *
 * @param  {Number}     errCode     The process error code to return on failure. Default: 1
 */
var shrinkwrap = module.exports.shrinkwrap = function(errCode) {
    errCode = errCode || 1;
    BinUtil.logInfo('Starting to run npm shrinkwrap');
    BinUtil.exec('npm shrinkwrap', 'Failed to shrinkwrap dependencies', errCode);
    BinUtil.logSuccess('Successfully shrinkwrapped dependencies');
};

/**
 * Commit the npm-shrinkwrap.json file and tag the commit as the target version.
 *
 * @param  {String}     tagVersion  The validated target version
 * @param  {Number}     [errCode]   The process error code to return on failure. Default: 1
 */
var gitCommitShrinkwrapAndTag = module.exports.gitCommitShrinkwrapAndTag = function(tagVersion, errCode) {
    errCode = errCode || 1;
    var commitMessage = util.format('(Release %s) Add shrinkwrap, bump version', tagVersion);

    BinUtil.logInfo('Commiting npm shrinkwrap and tagging release');

    // Stage changes
    BinUtil.exec('git add npm-shrinkwrap.json', 'Error adding npm-shrinkwrap.json to git index', errCode);
    BinUtil.exec('git add package.json', 'Error adding package.json to git index', errCode);

    // Commit and tag
    BinUtil.exec(util.format('git commit -m "%s"', commitMessage), 'Error committng shrinkwrap to git', errCode);
    BinUtil.exec(util.format('git tag -a %s -m v%s', tagVersion, tagVersion), 'Error creating tag for release', errCode);

    BinUtil.logSuccess('Created tag '.text + tagVersion.white + ' and '.text + '1 commit (shrinkwrap)'.white);
};

/**
 * Remove the shrinkwrap from the hilary repository and commit it after the release tag.
 *
 * @param  {String}     tagVersion  The validated target version
 * @param  {Number}     [errCode]   The process error code to return on failure. Default: 1
 */
var gitRemoveShrinkwrapAndCommit = module.exports.gitRemoveShrinkwrapAndCommit = function(tagVersion, errCode) {
    errCode = errCode || 1;
    var commitMessage = util.format('(Release %s) Remove shrinkwrap', tagVersion);

    BinUtil.logInfo('Removing shrinkwrap after tag');

    // Remove npm-shrinkwrap
    BinUtil.exec('git rm npm-shrinkwrap.json', 'Error removing npm-shrinkwrap.json from git index', errCode);
    BinUtil.exec(util.format('git commit -m "%s"', commitMessage), 'Error committing shrinkwrap removal to git', errCode);

    BinUtil.logSuccess('Removed shrinkwrap with '.text + '1 comment'.white);
};
