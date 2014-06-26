#!/bin/bash

# Install cassandra 1.2 manually
sudo apt-get install -y -o Dpkg::Options::=--force-confnew cassandra=1.2.16
sudo sed -i 's/-Xss180k/-Xss256k/g' /etc/cassandra/cassandra-env.sh
sudo sh -c "echo 'JVM_OPTS=\"\${JVM_OPTS} -Djava.net.preferIPv4Stack=false\"' >> /etc/cassandra/cassandra-env.sh"
sudo service cassandra stop
sudo service cassandra start
sudo service cassandra status

# Install etherpad-lite
sudo apt-get install etherpad-lite
cd /opt/etherpad
sudo touch APIKEY.txt
sudo chmod -R 777 .

# Create a keyspace that we can start etherpad up into. There is a chicken-and-egg problem by having unit tests drop/create and have
# etherpad be available, so we just create a separate keyspace for it
echo "CREATE KEYSPACE etherpad WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};" > /tmp/.create_etherpad_keyspace.cql3
cqlsh -3 -f /tmp/.create_etherpad_keyspace.cql3

# Configure etherpad to talk to Cassandra
sed -i -e 's/dbType\" : \"dirty/dbType\" : \"cassandra/g' \
       -e 's/\"filename\" : \"var\\/dirty.db\"/\"hosts\": [ \"localhost:9160\" ], \"keyspace\": \"etherpad\", \"cfName\": \"Etherpad\", \"user\": \"\", \"pass\": \"\", \"timeout\": 3000, \"replication\": \"1\", \"strategyClass\": \"SimpleStrategy\", \"cqlVersion\": \"2.0.0\"/g' \
       -e 's/defaultPadText\" : \".*\"/defaultPadText\" : \"\"/g' settings.json

echo "13SirapH8t3kxUh5T5aqWXhXahMzoZRA" > APIKEY.txt
node src/node/server.js &> /dev/null &
