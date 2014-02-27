'use strict';
var nconf = require('nconf');
var kue = require('kue');
var qDocker = require('q-dockerode');
var os = require('os');
var Q = require('q');
var _ = require('lodash');

nconf.argv()
  .env()
  .file({
    file: 'config.json'
  });

// Start number of containers equal to num cpus
var startPromises = [];
_.each(os.cpus(), function() {
  startPromises.push(qDocker.makeContainer({
      Image: 'stanleygu/engine-cylinder'
    })
    .then(function(container) {
      return qDocker.startContainer(container);
    }));
});

Q.all(startPromises).then(function(containers) {
  console.log('Started these containers: ');
  console.log(containers);
  var conf = nconf.get('redis');
  var q = kue.createQueue({
    redis: {
      host: conf.host,
      port: conf.port
    }
  });
  q.process('sim', function(job, done) {
    console.log('Processing job:', job.data);
    done();
  });
  // var closePromises = qDocker.removeAllContainers();
  // Q.all(closePromises).then(function() {
  //   process.exit(1);
  // });
});

qDocker.closeContainersOnExit();

