## run-profiles.js

### Description

This script sets up data according to the model-loader output (only one batch), and retrieves users entire profile.
A Profile consists of the basic user info (which sits in the Principals CF) and 2 Profile sections (aboutme and publications).

**Usage:**

```
Options:
 -s, --scripts-dir     The location of generated model-loader scripts                  [required]
 -n, --number-of-runs  The number of times total the performance test will be run.     [default: 1]
 -c, --concurrent      The number of performance tests that will be run concurrently.  [default: 1]
```

The test spits both status info and the JSON results out to stdout. I would recommend using a tool like node's `npm install -g jsontool` to pipe the results, and also filter out the results using `grep`. For example:

`node performance/run-profiles.js -s /path/to/OAE-model-loader/scripts -n 10 -c 2 | grep -e "^{" | json > authz-results-1.json`

This test has 2 parts, first it performs a dataload to load in all data, second it performs the performance test. All tests are performed using different tenants -- all tenants load the same data.

If **-n** is set larger than 1, then this test is run in a number of phases that are staggered. Meaning, once the dataload of phase 1 is completed, the dataload of phase 2 begins. This allows to stage a test that undergoes both heavy reads and writes concurrently.

The results look like the following:

```json
{
    "phase-0": {
        "dataload": {
            "profileSections": {
                "num": 10000,
                "perSecond": 405.5972419387548,
                "time": 24655
            }
        },
        "performanceTest": {
            "get-full-profile": {
                "duration": 42222,
                "msg": "Each profile consists out of a basic profile (in Principals) and 2 profile sections",
                "profiles": 5000,
                "profilesPerSecond": 118.42167590355739
            }
        },
        "phase": [
            "perf-test-1348327893496-0-0",
            "perf-test-1348327893496-0-1",
            "perf-test-1348327893496-0-2",
            "perf-test-1348327893496-0-3"
        ]
    }
}
```

**phase-0:** The ID of the phase that was run
**phase:** The tenants that were run concurrently with eachother
**dataload:** The data-loading timing metrics
**performanceTest:** The performance test timing metrics

### Base-line metrics

The following metrics were run on a MacBook Pro, running one cassandra instance with one node.js process locally.

<table style="width:100%">
  <tr>
    <th>Phase</th>
    <th>Sections created/s</th>
    <th>Profiles retrieved/s</th>
    <th>time spent</th>
  </tr>
  <tr>
    <th colspan="6">Test #1: 1 phase; 1 concurrent tenant per phase</th>
  </tr>
  <tr>
    <td>0</td>
    <td>1148.5</td>
    <td>424.5</td>
    <td>0m26.225s</td>
  </tr>
  <tr>
    <th colspan="6">Test #2: 1 phase, 4 concurrent tenants per phase</th>
  </tr>
  <tr>
    <td>0</td>
    <td>423.5</td>
    <td>123.2</td>
    <td>1m30.806s</td>
  </tr>
  <tr>
    <th colspan="6">Test #3: 3 phases, 4 concurrent tenants per phase</th>
  </tr>
  <tr>
    <td>0</td>
    <td>458.6</td>
    <td>87</td>
    <td></td>
  </tr>
  <tr>
    <td>1</td>
    <td>287</td>
    <td>83.8</td>
    <td></td>
  </tr>
  <tr>
    <td>2</td>
    <td>290.5</td>
    <td>121.9</td>
    <td>3m57.107s</td>
  </tr>
</table>