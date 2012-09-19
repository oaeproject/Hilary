# Performance Test Scripts

## run-authz.js

### Description

This script sets up data according to the model-loader output (only one batch), and hammers permissions/membership checks out of the data.

**Usage:**

```
Options:
 -s, --scripts-dir     The location of generated model-loader scripts                  [required]
 -n, --number-of-runs  The number of times total the performance test will be run.     [default: 1]
 -c, --concurrent      The number of performance tests that will be run concurrently.  [default: 1]
```

The test spits both status info and the JSON results out to stdout. I would recommend using a tool like node's `npm install -g jsontool` to pipe the results, and also filter out the results using `grep`. For example:

`node performance/run-authz.js -s /path/to/OAE-model-loader/scripts -n 10 -c 2 | grep -e "^{" | json > authz-results-1.json`

This test has 2 parts, first it performs a dataload to load in all data, second it performs the performance test. All tests are performed using different tenants -- all tenants load the same data.

If **-n** is set larger than 1, then this test is run in a number of phases that are staggered. Meaning, once the dataload of phase 1 is completed, the dataload of phase 2 begins. This allows to stage a test that undergoes both heavy reads and writes concurrently.

The results look like the following:

```json
{
  "phase-0": {
    "phase": [
      "perf-test-1347714329374-4-0",
      "perf-test-1347714329374-4-1"
    ],
    "dataload": {
      "users": {
        "num": 50,
        "time": 138,
        "perSecond": 362.3188405797101
      },
      "groups": {
        "num": 5,
        "time": 58,
        "perSecond": 86.20689655172414
      },
      "memberships": {
        "num": 52,
        "time": 495,
        "perSecond": 105.05050505050505
      }
    },
    "performanceTest": {
      "valid-permissions": {
        "duration": 114,
        "operations": 104,
        "perSec": 912.280701754386
      },
      "all-permissions": {
        "durationMs": 5641,
        "operations": 500,
        "perSec": 88.63676653075696
      }
    }
  },
```

**phase-0:** The ID of the phase that was run
**phase:** The tenants that were run concurrently with eachother
**dataload:** The data-loading timing metrics
**performanceTest:** The performance test timing metrics

### Base-line metrics

The following metrics were run on my MacBook Air, running one cassandra instance with one node.js process locally.

<table>
  <tr>
    <th>Phase</th>
    <th>Users/s</th>
    <th>Groups/s</th>
    <th>Memberships/s</th>
    <th>Positive Checks / sec</th>
    <th>Checks Sweep #1 (checks/s)</th>
  </tr>
  <tr>
    <th colspan="6">Test #1: 1 phase; 1 concurrent tenant per phase</th>
  </tr>
  <tr>
    <td>0</td>
    <td>7.9</td>
    <td>266.4</td>
    <td>186.5</td>
    <td>1133.6</td>
    <td>245.9</td>
  </tr>
  <tr>
    <th colspan="6">Test #2: 1 phase, 4 concurrent tenants per phase</th>
  </tr>
  <tr>
    <td>0</td>
    <td>3.63</td>
    <td>84.4</td>
    <td>57.58</td>
    <td>1893.2</td>
    <td>298.5</td>
  </tr>
  <tr>
    <th colspan="6">Test #3: 3 phases, 4 concurrent tenants per phase</th>
  </tr>
  <tr>
    <td>0</td>
    <td>3.57</td>
    <td>86.2</td>
    <td>61.5</td>
    <td>692</td>
    <td>94.3</td>
  </tr>
  <tr>
    <td>1</td>
    <td>2.6</td>
    <td>32.6</td>
    <td>23.3</td>
    <td>232.8</td>
    <td>95.1</td>
  </tr>
  <tr>
    <td>2</td>
    <td>2.4</td>
    <td>20</td>
    <td>14.7</td>
    <td>393.4</td>
    <td>99.3</td>
  </tr>
</table>

