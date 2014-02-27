FROM        ubuntu
MAINTAINER  Stanley Gu <stanleygu@gmail.com>
RUN         apt-get update -qq
RUN         apt-get install -y -q python-software-properties
RUN         add-apt-repository -y ppa:chris-lea/redis-server
RUN         apt-get update -qq
RUN         apt-get -y -q install redis-server
EXPOSE      6379
ENTRYPOINT  ["/usr/bin/redis-server"]