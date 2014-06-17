#!/bin/bash

# Turn off unneeded services to free some memory
sudo service mysql stop
sudo service memcached stop
sudo service postgresql stop
