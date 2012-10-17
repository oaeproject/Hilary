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

The following metrics were run on an app server pointed at an OOTB 3-node Cassandra ring. The keyspace is configured with a replication factor of 3, and all queries (reads and writes) were performed with a consistency of quorum.

<table>
  <tr>
    <th>Phase</th>
    <th>Created Memberships</th>
    <th>Positive Checks / sec</th>
    <th>Negative Checks / sec</th>
  </tr>
  <tr>
    <th colspan="4">Test #1: 1 phase; 1 concurrent tenant per phase</th>
  </tr>
  <tr>
    <td>0</td>
    <td>3573 @ 765/s</td>
    <td>3573 @ 758/s</td>
    <td>15000 @ 420/s</td>
  </tr>
  <tr>
    <th colspan="4">Test #2: 1 phase, 4 concurrent tenants per phase</th>
  </tr>
  <tr>
    <td>0</td>
    <td>14292 @ 1523/s</td>
    <td>14292 @ 1635/s</td>
    <td>60000 @ 1008/s</td>
  </tr>
  <tr>
    <th colspan="4">Test #3: 1 phase; 6 concurrent tenants per phase</th>
  </tr>
  <tr>
    <td>0</td>
    <td>21438 @ 1906/s</td>
    <td>21438 @ 1776/s</td>
    <td>90000 @ 1040/s</td>
  </tr>
  <tr>
    <th colspan="4">Test #4: 1 phase; 8 concurrent tenants per phase</th>
  </tr>
  <tr>
    <td>0</td>
    <td>28584 @ 1547/s</td>
    <td>28584 @ 1788/s</td>
    <td>120000 @ 1046/s</td>
  </tr>
  <tr>
    <th colspan="4">Test #5: 3 phases, 4 concurrent tenants per phase</th>
  </tr>
  <tr>
    <td>0</td>
    <td>14292 @ 1878/s</td>
    <td>14292 @ 1041/s</td>
    <td>60000 @ 357/s</td>
  </tr>
  <tr>
    <td>1</td>
    <td>14292 @ 968/s</td>
    <td>14292 @ 718/s</td>
    <td>60000 @ 373/s</td>
  </tr>
  <tr>
    <td>2</td>
    <td>14292 @ 678/s</td>
    <td>14292 @ 680/s</td>
    <td>60000 @ 411/s</td>
  </tr>
</table>


