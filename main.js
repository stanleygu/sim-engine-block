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
  startPromises.push(qDocker.makeContainer(nconf.get('cylinder').image)
    .then(function(container) {
      return qDocker.startContainer(container, nconf.get('cylinder').portBindings);
    })
    .then(function(container) {
      console.log(container);
      return Q.ninvoke(container, 'inspect').then(function(data) {
        qDocker.addPortmap(container, data.NetworkSettings.Ports);
        console.log(container.portMap);
        return container;
      });
    })
  );
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

  _.each(containers, function(container, i){
    q.process('sim', function(job, done) {

      console.log('Container ' + i + ' is processing job: ' +  JSON.stringify(job.data));
      done();
    });
  });
}, function(err) {
  console.log('Error occurred', err);
  var closePromises = qDocker.removeAllContainers();
  Q.all(closePromises).then(function() {
    process.exit(1);
  });
});

qDocker.closeContainersOnExit();
