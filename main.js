'use strict';
var nconf = require('nconf');
var kue = require('kue');
var qDocker = require('q-dockerode');
var os = require('os');
var Q = require('q');
var _ = require('lodash');
var zerorpc = require('zerorpc');
var crypto = require('crypto');

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
  console.log('View simulation job queue at: http://127.0.0.1:' + nconf.get('kue').app.port);
  kue.app.listen(nconf.get('kue').app.port);

  var redisClient = kue.redis.client();

  _.each(containers, function(container, i) {
    console.log('Attempting to connect to RPC Server at ' + 'tcp://127.0.0.1:' +
                container.portMap[nconf.get('cylinder').rpcPort]);
    var rpcClient = new zerorpc.Client();
    rpcClient.connect('tcp://127.0.0.1:' +
      container.portMap[nconf.get('cylinder').rpcPort]);
    // check that rpc server is connected
    Q.ninvoke(rpcClient, 'invoke', 'getVersion').then(function(res) {
      console.log(JSON.stringify(res, undefined, 2));
    });

    Q.npost(rpcClient, 'invoke', ['rrRun', 'getInfo', []])
      .then(function(res) {
        console.log(res);
      }, function(err) {
        console.log(err);
      });

    var loadedModelHash;
    jobs.process('sim', function(job, done) {
      console.log('Container ' + i + ' is processing sim job: ' + JSON.stringify(job.data.params));
      if (!job.data.sbml) {
        done('No SBML in job');
      }
      var start;
      var md5sum = crypto.createHash('md5');
      md5sum.update(job.data.sbml.string);
      var newModelHash = md5sum.digest('hex');
      if (newModelHash === loadedModelHash) {
        console.log('Model already loaded');
        start = Q.npost(rpcClient, 'invoke', ['rrRun', 'reset', []]);
      } else {
        console.log('New model to load');
        start = Q.npost(rpcClient, 'invoke', ['rrRun', 'load', [job.data.sbml.string]]);
        loadedModelHash = newModelHash;
      }
      start
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
          redisClient.set('sim:' + name, JSON.stringify(res[0]));
          redisClient.expire('sim:' + name, 60); // Expires in 60 seconds
          done(null); // Passing result back here doesn't work for some reason
        })
        .catch(function(err) {
          console.log('Error', JSON.stringify(err, undefined, 2));
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
