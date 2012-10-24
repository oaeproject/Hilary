var shell = require('shelljs');
var sys = require('sys');

var MOCHA_OPTS = '';
var REPORTER = 'spec';
var TIMEOUT = 20000;
// List of tests directories from node_modules named oae-*  
var MODULES = shell.find('node_modules').filter(function(value, index, ar){
    return (value.match(/node_modules\/oae-.*\/tests$/)); 
});
MODULES = MODULES.join(' ');

shell.env['NODE_ENV'] = 'test';

task('test', ['test-unit']);

task('test-module', [], function(module) {
    shell.exec('node_modules/.bin/mocha -c --ignore-leaks --timeout ' + TIMEOUT + ' --reporter ' + REPORTER + ' ' + MOCHA_OPTS + ' node_modules/oae-tests/runner/beforeTests.js node_modules/' + module + '/tests');
});

task('test-unit', [], function() {
    shell.exec('node_modules/.bin/mocha -c --ignore-leaks --timeout ' + TIMEOUT + ' --reporter ' + REPORTER + ' ' + MOCHA_OPTS + ' node_modules/oae-tests/runner/beforeTests.js ' + MODULES);
});

task('test-coverage', ['lib-cov'], function() {
    shell.echo('Running tests');
    shell.cd('target');
    shell.env['OAE_COVERING'] = true;
    var output = shell.exec('../node_modules/.bin/mocha --ignore-leaks --timeout ' + TIMEOUT + ' --reporter html-cov ' + MOCHA_OPTS + ' node_modules/oae-tests/runner/beforeTests.js ' + MODULES, {silent:true}).output;
    output.to('coverage.html');
    shell.echo('Code Coverage report generated at target/coverage.html');
});

task('lib-cov', [], function() {
    shell.rm('-rf', 'target');
    shell.echo('Creating target directory');
    shell.mkdir('-p', 'target');
    shell.echo('Copying all files.');
  // List of filenames not containing 'git' or 'target'
  var files = shell.ls('-A', '.').filter(function(value, index, ar) {
    return (value.indexOf('target') === -1 &&
        value.indexOf('git') === -1);
  });
    shell.cp('-R', files, 'target');
    shell.echo('Instrumenting all files.');
    shell.exec('node node_modules/oae-tests/runner/instrument_code.js "' + shell.pwd() + '"');
    shell.echo('Code instrumented');
});
