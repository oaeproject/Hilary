# Open Academic Environment (OAE Project)

Hilary is the back-end for the [Open Academic Environment](http://www.oaeproject.org/). The current frontend is at [3akai-ux](https://github.com/oaeproject/3akai-ux) but we're slowly building a new one, check it out: [Cake](https://github.com/oaeproject/Cake)

### Project channels

[![Discord](https://img.shields.io/badge/chat-on_discord-green.svg)](https://discord.gg/CcNnbGk)

### Project status

<!-- current project status -->

[![CircleCI](https://circleci.com/gh/oaeproject/Hilary/tree/master.svg?style=shield)](https://circleci.com/gh/oaeproject/Hilary/tree/master)
[![CodeFactor](https://www.codefactor.io/repository/github/oaeproject/hilary/badge)](https://www.codefactor.io/repository/github/oaeproject/hilary)
[![Code Climate](https://codeclimate.com/github/oaeproject/Hilary/badges/gpa.svg)](https://codeclimate.com/github/oaeproject/Hilary)
[![Depfu](https://badges.depfu.com/badges/6850bf0412f4446e0a9eecf4da358ba7/overview.svg)](https://depfu.com/github/oaeproject/Hilary?project_id=29898)
[![Depfu](https://badges.depfu.com/badges/6850bf0412f4446e0a9eecf4da358ba7/count.svg)](https://depfu.com/github/oaeproject/Hilary?project_id=29898)
[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Foaeproject%2FHilary.svg?type=shield)](https://app.fossa.io/projects/git%2Bgithub.com%2Foaeproject%2FHilary?ref=badge_shield)

### Project standards

<!-- standards used in project -->

[![Datree](https://img.shields.io/badge/policy%20by-datree-yellow)](https://datree.io/?src=badge)
![code style](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)
[![XO code style](https://img.shields.io/badge/code_style-XO-5ed9c7.svg)](https://github.com/xojs/xo)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg)](https://conventionalcommits.org)
![GitHub release (latest SemVer)](https://img.shields.io/github/v/tag/oaeproject/Hilary)

## Take OAE for a spin

There's a docker image on docker-hub that works out of the box: https://hub.docker.com/r/oaeproject/oae-demo

If you want to build that image locally, you can do that by following instructions at https://github.com/oaeproject/oae-demo/

## Development

Here are the quick instructions on how to get OAE set up locally. There's also a more in-depth step-by-step tutorial in the [wiki](https://github.com/oaeproject/Hilary/wiki/Setting-up-a-dev-environment:-step-by-step-tutorial).

```
node -v # make sure you have v16+
npm -v # make sure you have 7.0.8+

git clone https://github.com/oaeproject/Hilary.git && cd Hilary
git submodule update --init
docker-compose up -d oae-cassandra oae-elasticsearch oae-redis oae-nginx
cd ethercalc && npm install && cd ..
cp ep-settings.json etherpad/settings.json
# on settings.json, please change `oae-redis` and `oae-cassandra` to `localhost`, for now
cp ep-package.json etherpad/src/package.json
cp ep-root-package.json etherpad/package.json
./prepare-etherpad.sh
cd 3akai-ux && npm install && cd ..
npm i
npm run migrate ; npx pm2 startOrReload process.json ; npx pm2 logs
```

## Github Codespaces

In order to set up OAE on Codespaces, you need to follow the same steps as above. However, every time you re-create a codespace, you'll just need to re-run the services as follows:

```
docker-compose up -d oae-cassandra oae-elasticsearch oae-redis oae-nginx
npm run migrate
npx pm2 startOrReload process.json --only "Ethercalc, Etherpad"

# if you want to run tests
npm run test

# if you want to run the backend
npm run serve
```

## Running tests

To run tests just make sure you have installed all dependencies (check wiki page on how to set up a dev environment) and run `npm run test`. To run tests on a specific module, just append its path as follows: `npm run test-module --module=oae-principals`.

## Get in touch

The project website can be found at http://www.oaeproject.org. The [project blog](http://www.oaeproject.org/blog) will be updated with the latest project news from time to time.

The mailing list used for Apereo OAE is oae@apereo.org. You can subscribe to the mailing list at https://groups.google.com/a/apereo.org/d/forum/oae.

Bugs and other issues can be reported in our [issue tracker](https://github.com/oaeproject/Hilary/issues) and we're always available to help in our [discord channel](https://discord.gg/CcNnbGk).

## Stargazers

[![Stargazers repo roster for @oaeproject/Hilary](https://reporoster.com/stars/oaeproject/Hilary)](https://github.com/oaeproject/Hilary/stargazers)

## Forkers

[![Forkers repo roster for @oaeproject/Hilary](https://reporoster.com/forks/oaeproject/Hilary)](https://github.com/oaeproject/Hilary/network/members)
