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
  var jobs = kue.createQueue({
    redis: {
      host: conf.host,
      port: conf.port
    }
  });

  var redisClient = kue.redis.client();

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
    jobs.process('sim', function(job, done) {
      console.log('Container ' + i + ' is processing sim job: ' + JSON.stringify(job.data.params));
      if (!job.data.sbml) {
        done('No SBML in job');
      }
      Q.npost(rpcClient, 'invoke', ['rrRun', 'load', [job.data.sbml.string]])
        .then(function() {
          console.log('Loaded model, now setting parameters');
          var parameterSetPromises = [];
          var params = _.keys(job.data.params);
          _.each(params, function(p) {
            parameterSetPromises.push(
              Q.npost(rpcClient, 'invoke', ['setParameterValueById', {id: p, value: job.data.params[p]}]));
          });
          return Q.all(parameterSetPromises);
        })
        .then(function() {
          console.log('Set parameters, now simulating...');
          // this way the next return function can access the sim data
          var time = job.data.time;
          return Q.npost(rpcClient, 'invoke', ['rrRun', 'simulate', [time.start, time.end, time.steps]]);
        })
        .then(function(res) {
          console.log('Simulation complete!');
          console.log('Last time point:', _.last(res[0]));
          var name = job.data.sbml.name;
          var params = _.keys(job.data.params);
          redisClient.sadd('global:sims', name);
          _.each(params, function(p) {
            redisClient.sadd('sim:' + name + ':params', p);
            var value = job.data.params[p];
            redisClient.sadd('sim:' + name + ':param:' + p + ':values', value);
            redisClient.set('sim:' + name + ':param:' + p + ':' + value, JSON.stringify(res[0]));
          });
          done();
        })
        .catch(function(err) {
          console.log('Error', err);
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
