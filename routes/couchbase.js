var app = require('../app');
var express = require('express');
var http = require('http');
var router = express.Router();

router.use('/lookup/:bucket/:doc/:view/:key', function(req, res, next) {
    var options = {
        hostname: app.get('couchbaseHostname'),
        port: app.get('couchbasePort'),
        path: '/'+req.params.bucket+'/_design/'+req.params.doc+'/_view/'+req.params.view+'?key="'+req.params.key+'"',
        method: 'GET'
    };

    var reqSolr = http.request(options, function(resSolr) {
        var result = '';

        resSolr.on('data', function(chunk) {
            result += chunk;
        });

        resSolr.on('end', function() {
            res.send(result);
        });
    });

    reqSolr.on('error', function(e) {
        console.log('Error with http request:',e);
    });

    reqSolr.end();
});

module.exports = router;