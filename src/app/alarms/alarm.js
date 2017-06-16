define([
    'angular',
    'config',
    'underscore',
    'services/all',
    'angular-aria',
    'angular-animate',
    'angular-material',
  ],
  function (angular) {
    "use strict";

    var module = angular.module('kibana.alarms', ['ngMaterial']);

    module.controller('AlarmCtrl', function ($scope, $timeout, $filter, timer, querySrv, dashboard, filterSrv) {

      $scope.option_solr = "http://10.4.55.171:8983/solr/";
      $scope.option_collection = "option";

      $scope.rca_solr = "http://10.4.55.171:8983/solr/";
      $scope.rca_collection = "rca1";

      $scope.ad_name_field = "ad_name_s";
      $scope.facet_limit = 100;

      $scope.opened_incidents = [
        {
          "id": "24527",
          "name":"日报系统流量告警",
          "status": "warning",
          "open_num": "3",
          "open_time": "2016-11-11 20:50:00",
          "close_time": "",
          "duration": "1小时35分钟",
          "acknowledge": "shi.zf@neusoft.com",
        },
        {
          "id": "23127",
          "name":"日报系统CPU使用率告警",
          "status": "warning",
          "open_num": "4",
          "open_time": "2016-11-11 19:50:00",
          "close_time": "",
          "duration": "25分钟",
          "acknowledge": "shi.zf@neusoft.com",
        },
        {
          "id": "14998",
          "name":"日报系统内存使用率告警",
          "status": "warning",
          "open_num": "3",
          "open_time": "2016-11-11 10:50:00",
          "close_time": "",
          "duration": "35分钟",
          "acknowledge": "shi.zf@neusoft.com",
        },
        {
          "id": "17861",
          "name":"日报系统吞吐量告警",
          "status": "warning",
          "open_num": "5",
          "open_time": "2016-11-11 20:50:00",
          "close_time": "",
          "duration": "2小时10分钟",
          "acknowledge": "shi.zf@neusoft.com",
        },
        {
          "id": "09823",
          "name":"日报系统用户体验告警",
          "status": "danger",
          "open_num": "1",
          "open_time": "2016-11-11 18:45:00",
          "close_time": "",
          "duration": "10分钟",
          "acknowledge": "shi.zf@neusoft.com",
        },
        {
          "id": "07617",
          "name":"日报系统健康度告警",
          "status": "warning",
          "open_num": "1",
          "open_time": "2016-11-11 10:20:00",
          "close_time": "",
          "duration": "3分钟",
          "acknowledge": "shi.zf@neusoft.com",
        },
      ]

      $scope.build_query = function(filetype, isForExport) {
        // Build Solr query
        var fq = '';
        var wt_json = '&wt=' + filetype;
        var rows_limit = '&rows=10';
        var facet = '&facet=true&facet.field=' + $scope.ad_name_field + '&facet.limit=' + $scope.facet_limit + '&facet.missing=true';

        return querySrv.getORquery() + wt_json + rows_limit + fq + facet;
      };

      $scope.get_data = function() {

        var request, results;

        $scope.sjs.client.server($scope.rca_solr + $scope.rca_collection);

        request = $scope.sjs.Request().indices(dashboard.indices);


        var query = this.build_query('json', false);
        console.log(query);
        // Set the panel's query
        request.setQuery(query);
        results = request.doSearch();
        // Populate scope when we have results

        $scope.data = [];
        results.then(function successCallback(response) {
          console.log(response);
          _.each(response.response, function (item) {
            console.log(item)
          })

        }, function errorCallback() {
          console.log("error");

        });
      };

      $scope.get_data();




    });
  });
