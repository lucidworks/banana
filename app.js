var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var fs = require("fs");
var httpProxy = require('http-proxy');
var url = require('url');

var app = module.exports = express();

// Read settings from config.json
var config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
var couchbaseUrl = url.parse(config.couchbaseUrl);
app.set('serverPort', config.serverPort);
app.set('solrUrl', config.solrUrl);
app.set('couchbaseHostname', couchbaseUrl.hostname);
app.set('couchbasePort', couchbaseUrl.port);
app.set('proxy',
    httpProxy.createProxyServer({
        target: config.solrUrl
    })
    .on('error', function(e) {
        console.log('Error proxy:',e);
    })
);

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
// uncomment after placing your favicon in /public
//app.use(favicon(__dirname + '/public/favicon.ico'));
app.use(logger('dev'));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'src')));

app.use('/', require('./routes/index'));
app.use('/couchbase', require('./routes/couchbase'));

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
    app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});

module.exports = app;