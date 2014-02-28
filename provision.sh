#!/bin/sh

# This file should be run on the linux machine that will be running docker
# it is set up as the provisioning file for vagrant images, but can be run
# manually if you are not using vagrant. It should be run as root.

# note that all of the sudo usage in this script is due to the uncertainty
# of the provisioning user by vagrant.

sudo apt-get -y update
sudo apt-get install -q -y curl
sudo apt-get install -q -y python-software-properties
sudo add-apt-repository -y ppa:chris-lea/node.js
sudo add-apt-repository -y ppa:git-core/ppa
sudo apt-get -y update
sudo apt-get -y install git nodejs

# ZeroRPC dependencies
sudo add-apt-repository -y ppa:chris-lea/zeromq
sudo apt-get -y update
sudo apt-get install -y libzmq3-dev g++

# Pull docker engine cylinder
sudo docker pull stanleygu/engine-cylinder
