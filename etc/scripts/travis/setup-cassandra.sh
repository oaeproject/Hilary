#!/bin/bash

# Install cassandra 1.2 manually
sudo apt-get install -y -o Dpkg::Options::=--force-confnew cassandra=1.2.16
sudo sed -i 's/-Xss180k/-Xss256k/g' /etc/cassandra/cassandra-env.sh
sudo sh -c "echo 'JVM_OPTS=\"\${JVM_OPTS} -Djava.net.preferIPv4Stack=false\"' >> /etc/cassandra/cassandra-env.sh"
sudo service cassandra stop
sudo service cassandra start
sudo service cassandra status
