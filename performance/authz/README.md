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

The following metrics were run on my MacBook Air, running one cassandra instance with one node.js process locally.

<table>
  <tr>
    <th>Phase</th>
    <th>Created Memberships</th>
    <th>Positive Checks / sec</th>
    <th>Checks Sweep #1 (checks / sec)</th>
  </tr>
  <tr>
    <th colspan="4">Test #1: 1 phase; 1 concurrent tenant per phase</th>
  </tr>
  <tr>
    <td>0</td>
    <td>594 @ 1350/s</td>
    <td>594 @ 1036/s</td>
    <td>125000 @ 715/s</td>
  </tr>
  <tr>
    <th colspan="4">Test #2: 1 phase, 4 concurrent tenants per phase</th>
  </tr>
  <tr>
    <td>0</td>
    <td>2376 @ 1126/s</td>
    <td>2376 @ 718/s</td>
    <td>500000 @ 925/s</td>
  </tr>
  <tr>
    <th colspan="4">Test #3: 3 phases, 4 concurrent tenants per phase</th>
  </tr>
  <tr>
    <td>0</td>
    <td>2376 @ 2136/s</td>
    <td>2376 @ 786/s</td>
    <td>500000 @ 363/s</td>
  </tr>
  <tr>
    <td>1</td>
    <td>2376 @ 787/s</td>
    <td>2376 @ 556/s</td>
    <td>500000 @ 363/s</td>
  </tr>
  <tr>
    <td>2</td>
    <td>2376 @ 556/s</td>
    <td>2376 @ 481/s</td>
    <td>500000 @ 364/s</td>
  </tr>
</table>

In **Test #3**, it's important to note that since the Check Sweep step takes so long, that after about 15 seconds, the remainder of the ~22min of test was just the "Invalid Permissions Checks".. which is actually a throughput of 363+363+364 = 1090 checks / s.

