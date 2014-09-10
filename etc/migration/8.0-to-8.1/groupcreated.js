var _ = require('underscore');

var Cassandra = require('oae-util/lib/cassandra');

var config = require('./config').config;

Cassandra.init(config.cassandra, function(err) {
    if (err) {
        console.error(err);
        return;
    }

    startProcessing();
});

var done = function() {
    console.log('All done!');
    console.log(arguments);
}

var onEach = function(rows, callback) {
    var queries = [];

    _.each(rows, function(row) {
        var created = row.get('wt').value / 1000;
        var principalId = row.get('principalId').value;
        var query = Cassandra.constructUpsertCQL('Principals', 'principalId', principalId, {'created': created});
        queries.push(query);
    });

    // Add the created timestamp and move on to the next page
    Cassandra.runBatchQuery(queries, callback);
}

var startProcessing = function() {
    Cassandra.iterateAll(['principalId', 'WRITETIME("tenantAlias") AS wt'], 'Principals', 'principalId', {'batchSize': 30}, onEach, done);
};
