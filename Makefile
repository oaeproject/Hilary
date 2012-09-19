MOCHA_OPTS=
REPORTER = spec
TIMEOUT = 20000
MODULES:=`find node_modules -maxdepth 2 | grep 'node_modules/oae-.*/tests' | tr "\\n" " "`

test: test-unit

test-module:
	@NODE_ENV=test node_modules/.bin/mocha --ignore-leaks --timeout $(TIMEOUT) --reporter $(REPORTER) $(MOCHA_OPTS) node_modules/oae-tests/runner/beforeTests.js node_modules/$(module)/tests

test-unit:
	@NODE_ENV=test node_modules/.bin/mocha --ignore-leaks --timeout $(TIMEOUT) --reporter $(REPORTER) $(MOCHA_OPTS) node_modules/oae-tests/runner/beforeTests.js $(MODULES)

test-coverage: lib-cov
	@echo "Running tests"
	@cd target; export OAE_COVERING=true; ../node_modules/.bin/mocha --ignore-leaks --reporter html-cov $(MOCHA_OPTS) node_modules/oae-tests/runner/beforeTests.js $(MODULES) > coverage.html
	@echo "Code Coverage report generated at target/coverage.html"
	@open target/coverage.html

lib-cov:
	@rm -rf target
	@echo "Creating target directory"
	@mkdir -p target
	@echo "Copying all files."
	@cp -r `find . -maxdepth 1 -not -name "*target*" -a -not -name "*git*" -a -not -name "."` target
	@echo "Instrumenting all files."
	@node node_modules/oae-tests/runner/instrument_code.js "`pwd`"
	@echo "Code instrumented"


.PHONY: test test-module test-unit test-cov lib-cov
