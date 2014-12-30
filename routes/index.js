var app = require('../app');
var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res) {
    res.render('index', {});
});

router.get('/solr/*', function(req, res) {
    app.get('proxy').web(req, res);
});

router.post('/solr/*', function(req, res, next) {
    app.get('proxy').web(req, res);
});

module.exports = router;