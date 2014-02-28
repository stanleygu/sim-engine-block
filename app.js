'use strict';
var nconf = require('nconf');
var kue = require('kue');

nconf.argv()
  .env()
  .file({
    file: 'config.json'
  });

var conf = nconf.get('redis');

kue.createQueue({
  redis: {
    host: conf.host,
    port: conf.port
  }
});
console.log('View simulation job queue at: http://127.0.0.1:' + nconf.get('kue').app.port);
kue.app.listen(nconf.get('kue').app.port);
