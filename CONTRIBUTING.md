# Contributing
## Welcome!

First things first: thank you! As an open source project, Open Academic Environment relies on contributions and we really appreciate that you're taking the time to think about contributing. If you don't know where to start, have a look at our [API issue tracker](https://github.com/oaeproject/Hilary/issues) and [front-end issue tracker](https://github.com/oaeproject/3akai-ux/issues) for a list of current problems you could help us solve. (PS. If you're new to open source, we use the `first-timers-only` tag for issues that would make a good first contribution!)

## Table of contents
1. [How-to](#how-to)

    1.1 [Set up the Open Academic Environment](#set-up-oae)

    1.2 [Report a bug](#report-a-bug)

    1.3 [Suggest an improvement](#suggest-an-improvement)

    1.4 [Style your code](#style-your-code)

    1.5 [Using submodules](#using-submodules)

    1.6 [Run tests](#run-tests)

    1.7 [Submit a pull request](#submit-a-pull-request)

    1.8 [Ask for help](#ask-for-help)

2. [Code of Conduct](#code-of-conduct)

## How-to

### Set up OAE

Instructions on how to run OAE Project locally can be found in our [README.md](README.md). If you have any problems getting it up and running, please let us know by [email](mailto:oaeproject@gmail.com).

### Report a bug

Have you found a bug in OAE? Please first check our [API issue tracker](https://github.com/oaeproject/Hilary/issues) and [front-end issue tracker](https://github.com/oaeproject/3akai-ux/issues) to make sure it has not already been reported, and create a new issue in the correct repository if you can't find it! A good bug report will include at least the following details:
- A short, descriptive title;
- A clear description of the bug, including what you expected to happen and what actually happened. Please include a screenshot if possible!
- The environment in which the bug took place, including your browser and OS versions and the version of OAE you were using. If you were using an older version of OAE, consider first upgrading to the latest version to see if the bug has already been fixed;
- A set of steps to reproduce the bug. If the bug cannot be reproduced reliably, please give as much information as possible about what you were doing when the problem occurred. For intermittent bugs it's also helpful to know approximately what percentage of the time they occur;
- If possible, please include any related log statements or errors from your console with your bug report;
- Give your new issue the label `type: Bug`;

### Suggest an improvement

Do you have an idea for a feature that would make OAE _so much better_? We'd love to hear it! As a first step though, please have a look through issues with the tag `type: Enhancement` and `type: Feature` in our bug trackers ([here](https://github.com/oaeproject/Hilary/issues) and [here](https://github.com/oaeproject/3akai-ux/issues)), as well as our [UserVoice](https://oaeproject.uservoice.com/) to see if someone has already suggested the same feature or improvement. If you find a similar issue, give it a vote or a comment instead of creating a new one. The more demand there is for a specific enhancement the more likely we are to prioritise it for development. A good improvement suggestion is composed of:
- A descriptive title;
- A use case; explain how your suggestion will improve the experience for OAE users;
- A clear description of the improvement with as much detail as possible. Screenshots and mock-ups are greatly appreciated!
- Give your new issue a label: `type: Enhancement` for improvements to existing features or `type: Feature` for new, never-seen-before features;

### Style your code

OAE Project has tools that can help you style your code according to our guidelines. You should always run `grunt jshint` and fix all highlighted issues before creating a pull request. If your editor supports it, consider using the [.editorconfig](.editorconfig) file. Some general styling recommendations:
- Code style:
    - Indent with four spaces;
    - Always use semicolons;
    - Always use braces for control structures (eg. if-statements);
    - Files should end with a newline;
    - Use single quotes for strings;
    - Trim trailing whitespace;
- In Hilary, dependencies should be in alphabetised groups - first external dependencies, then dependencies to other OAE modules, then dependencies to the same module;

### Using submodules

In `git` terms, here are some tips to help you get started!

#### Checkout

For pulling changes from the parent repository:

```
git pull
```

If there are new commits from submodules, we need to pull those explicitly:

```
git submodule update
````

However, if we go inside the recently updated submodule and run `git status`, we get the `Not currently on any branch` message. This is because the `git submodule update` command checks out submodules in a `HEADLESS` state by default, meaning we're not on any branch. Because of this, be sure to `git checkout <your-branch>` (e.g. master) before you commit anything to the `3akai-ux` repository. Always follow these steps in this exact same order:

```
# step 1
git submodule update
# step 2
git checkout <your-branch>
# step 3
git commit -m "commit message"
```

#### Push

It is important to remember that the parent repository (`Hilary`) needs to pushed every time a submodule is pushed as well, otherwise it will always point to the same commit even if the submodule has been updated. If you want to make sure that doesn't happen, there are two things you can do:

```
# Option 1: make sure git checks it for you **from the parent directory**
git push --recurse-submodules=check # Will abort a push if you haven't pushed a submodule

# Option 2: make sure everything is pushed at the same time
git push --recurse-submodules=on-demand # Will push all repositories even submodules
````

You may want to create a `git alias` for either option as follows:
```
# Option 1:
git config alias.pushall "push --recurse-submodules=check" # run from the parent repository

# Option 2:
git config alias.pushall "push --recurse-submodules=on-demand" # run from the parent repository
```

### Run tests

We use Grunt to run our tests. To test a single module, run `grunt test-module:<module-name>`. You can also run tests for the whole project by typing `grunt test`, but remember that this will take a while!

If you're using the docker setup, run the container with a custom command (example for module `oae-principals`):

```
docker-compose stop oae-hilary && docker-compose run oae-hilary grunt test:oae-principals
```

### Submit a pull request

[Pull requests](https://help.github.com/articles/about-pull-requests/) are the main way contributions can be submitted to the OAE Project. The basic OAE workflow for pull requests on GitHub is as follows:
- [Fork](https://help.github.com/articles/fork-a-repo/) the appropriate repository under your GitHub account;
- Create a new branch for your changes - if you are writing a fix for an existing issue, use the issue number as your branch name (eg. issue-1331), otherwise make sure to give your branch a descriptive name!
- __Remember to include tests in your pull request__ - untested features can not be merged!
- Before you submit your pull request, run `grunt jshint` and fix any style issues that may have popped up;
- Double-check that you haven't included anything you didn't mean to in your commits - configuration changes have an annoying tendency to sneak into PRs;
- Push your branch and [submit a pull request](https://help.github.com/articles/creating-a-pull-request/) for it;

### Ask for help

You can contact us via the [project website](http://www.oaeproject.org) or by emailing us at [oaeproject@gmail.com](mailto:oaeproject@gmail.com).

## Code of Conduct

This project adheres to the Contributor Covenant [code of conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to [oaeproject@gmail.com](mailto:oaeproject@gmail.com).
