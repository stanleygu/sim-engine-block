'use strict';
var nconf = require('nconf');
var kue = require('kue');
var qDocker = require('q-dockerode');
var os = require('os');
var Q = require('q');
var _ = require('lodash');
var zerorpc = require('zerorpc');

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

  _.each(containers, function(container, i) {
    var rpcClient = new zerorpc.Client();
    rpcClient.connect('tcp://127.0.0.1:' +
      container.portMap[nconf.get('cylinder').rpcPort]);
    // check that rpc server is connected
    Q.ninvoke(rpcClient, 'invoke', 'getVersion').then(function(res) {
      console.log(res);
    });

    Q.npost(rpcClient, 'invoke', ['rrRun', 'getInfo', []])
      .then(function(res) {
        console.log(res);
      }, function(err) {
        console.log(err);
      });
    q.process('sim', function(job, done) {
      console.log('Container ' + i + ' is processing sim job: ' + JSON.stringify(job.data.params));
      if (!job.data.sbml) {
        done('No SBML in job');
      }
      Q.npost(rpcClient, 'invoke', ['rrRun', 'load', [job.data.sbml.string]])
      .then(function() {
        return Q.npost(rpcClient, 'invoke', ['rrRun', 'simulate', []]);
      })
        .then(function(res) {
          console.log(res);
          done();
        }, function(err) {
          console.log(err);
          done(err);
        });
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
