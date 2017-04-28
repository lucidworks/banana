/*

  ## Timepicker

  ### Parameters
  * mode :: The default mode of the panel. Options: 'relative', 'absolute' 'since' Default: 'relative'
  * time_options :: An array of possible time options. Default: ['5m','15m','1h','6h','12h','24h','2d','7d','30d']
  * timespan :: The default options selected for the relative view. Default: '15m'
  * timefield :: The field in which time is stored in the document.
  * refresh: Object containing refresh parameters
    * enable :: true/false, enable auto refresh by default. Default: false
    * interval :: Seconds between auto refresh. Default: 30
    * min :: The lowest interval a user may set
*/
define([
  'angular',
  'app',
  'underscore',
  'moment',
  'kbn',
  'jquery'
],
function (angular, app, _, moment, kbn, $) {
  'use strict';

  var module = angular.module('kibana.panels.timepicker', []);
  app.useModule(module);

  module.controller('timepicker', function($scope, $rootScope, $timeout, timer, $http, dashboard, filterSrv) {
    $scope.panelMeta = {
      modals: [{
        description: "Inspect",
        icon: "icon-info-sign",
        partial: "app/partials/inspector.html",
        show: true
      }],
      status  : "Stable",
      description : "A panel for controlling the time range filters. If you have time based data, "+
        " or if you're using time stamped indices, you need one of these"
    };

    // Set and populate defaults
    var _d = {
      status: "Stable",
      mode: "relative",
      time_options: ['5m', '15m', '1h', '6h', '12h', '24h', '2d', '7d', '30d'],
      timespan: '15m',
      timefield: 'event_timestamp',
      timeformat: "",
      spyable: true,
      refresh: {
        enable: false,
        interval: 30,
        min: 3
      }
    };
    _.defaults($scope.panel,_d);

    $scope.init = function() {
      // Private refresh interval that we can use for view display without causing
      // unnecessary refreshes during changes
      $scope.refresh_interval = $scope.panel.refresh.interval;
      $scope.filterSrv = filterSrv;

      // Init a private time object with Date() objects depending on mode
      switch($scope.panel.mode) {
      case 'absolute':
        $scope.time = {
          from : moment($scope.panel.time.from,'MM/DD/YYYY HH:mm:ss') || moment(kbn.time_ago($scope.panel.timespan)),
          to   : moment($scope.panel.time.to,'MM/DD/YYYY HH:mm:ss') || moment()
        };
        break;
      case 'since':
        $scope.time = {
          from : moment($scope.panel.time.from,'MM/DD/YYYY HH:mm:ss') || moment(kbn.time_ago($scope.panel.timespan)),
          to   : moment()
        };
        break;
      case 'relative':
        $scope.time = {
          from : moment(kbn.time_ago($scope.panel.timespan)),
          to   : moment()
        };
        break;
      }

      $scope.time.field = $scope.panel.timefield;
      // These 3 statements basicly do everything time_apply() does
      set_timepicker($scope.time.from,$scope.time.to);
      update_panel();
      set_time_filter($scope.time);
      dashboard.refresh();

      // Start refresh timer if enabled
      if ($scope.panel.refresh.enable) {
        $scope.set_interval($scope.panel.refresh.interval);
      }

      // In case some other panel broadcasts a time, set us to an absolute range
      $scope.$on('refresh', function() {
        if(filterSrv.idsByType('time').length > 0) {
          var time = filterSrv.timeRange('min');
          if($scope.time.from.diff(moment.utc(time.from),'seconds') !== 0 ||
            $scope.time.to.diff(moment.utc(time.to),'seconds') !== 0) {
            $scope.set_mode('absolute');
            // These 3 statements basicly do everything time_apply() does
            set_timepicker(moment(time.from),moment(time.to));
            $scope.time = $scope.time_calc();
            update_panel();
          }
        }
      });
    };

    $scope.set_interval = function (refresh_interval) {
      $scope.panel.refresh.interval = refresh_interval;
      if(_.isNumber($scope.panel.refresh.interval)) {
        if($scope.panel.refresh.interval < $scope.panel.refresh.min) {
          $scope.panel.refresh.interval = $scope.panel.refresh.min;
          timer.cancel($scope.refresh_timer);
          return;
        }
        timer.cancel($scope.refresh_timer);
        $scope.refresh();
      } else {
        timer.cancel($scope.refresh_timer);
      }
    };

    $scope.refresh = function() {
      if ($scope.panel.refresh.enable) {
        timer.cancel($scope.refresh_timer);
        $scope.refresh_timer = timer.register($timeout(function() {
          $scope.refresh();
          $scope.time_apply();
        },$scope.panel.refresh.interval*1000));
      } else {
        timer.cancel($scope.refresh_timer);
      }
    };

    var update_panel = function() {
      // Update panel's string representation of the time object. Don't update if
      // we're in relative mode since we dont want to store the time object in the
      // json for relative periods
      if($scope.panel.mode !== 'relative') {

        $scope.panel.time = {
          from : $scope.time.from.format("MM/DD/YYYY HH:mm:ss"),
          to : $scope.time.to.format("MM/DD/YYYY HH:mm:ss"),
        };
      } else {
        delete $scope.panel.time;
      }
    };

    $scope.set_mode = function(mode) {
      $scope.panel.mode = mode;
      $scope.panel.refresh.enable = mode === 'absolute' ?
        false : $scope.panel.refresh.enable;

      update_panel();
    };

    $scope.to_now = function() {
      $scope.timepicker.to = {
        time : moment().format("HH:mm:ss"),
        date : moment().format("MM/DD/YYYY")
      };
    };

    $scope.set_timespan = function(timespan) {
      $scope.panel.timespan = timespan;
      $scope.timepicker.from = {
        time : moment(kbn.time_ago(timespan)).format("HH:mm:ss"),
        date : moment(kbn.time_ago(timespan)).format("MM/DD/YYYY")
      };
      $scope.time_apply();
    };

    $scope.close_edit = function() {
      $scope.time_apply();
    };

    $scope.time_calc = function(){
      var from,to;

      // If time picker is defined (usually is) TOFIX: Horrible parsing
      if(!(_.isUndefined($scope.timepicker))) {

        // Fix for SILK-4 and SILK-29 bugs: by using moment.utc() instead of just moment()
        // Need to account for leap year by using moment.subtract()
        // Get the time suffix (ie.s/m/h/d/w/M/y)
        var timeShorthand = $scope.panel.timespan.substr(-1);
        var timeNumber = $scope.panel.timespan.substr(0, $scope.panel.timespan.length-1);

        from = $scope.panel.mode === 'relative' ? moment().subtract(timeShorthand,timeNumber) :
          moment(moment($scope.timepicker.from.date).format('MM/DD/YYYY') + " " + $scope.timepicker.from.time,'MM/DD/YYYY HH:mm:ss');
        // from = $scope.panel.mode === 'relative' ? moment(kbn.time_ago($scope.panel.timespan)) :
        //   moment(moment.utc($scope.timepicker.from.date).format('MM/DD/YYYY') + " " + $scope.timepicker.from.time,'MM/DD/YYYY HH:mm:ss');
        to = $scope.panel.mode !== 'absolute' ? moment() :
          moment(moment($scope.timepicker.to.date).format('MM/DD/YYYY') + " " + $scope.timepicker.to.time,'MM/DD/YYYY HH:mm:ss');
        
      // Otherwise (probably initialization)
      } else {
        from = $scope.panel.mode === 'relative' ? moment(kbn.time_ago($scope.panel.timespan)) :
          $scope.time.from;
        to = $scope.panel.mode !== 'absolute' ? moment() :
          $scope.time.to;
      }

      if (from.valueOf() >= to.valueOf()) {
        from = moment(to.valueOf() - 1000);
      }

      // Fix for SILK-4 and SILK-29 bugs
      // This $timeout function causes the timepicker skip-back-one-day bugs.
      // Because it will set the timepicker values to $scope.time.from and $scope.time.to, which
      // are the calculated UTC time values, and depending on your browser timezone, these values
      // might be minus one day. And when you press the timepicker button to update the time, it
      // will keep decreasing the date by one day.
      //    $scope.timepicker => time based on browser timezone
      //    $scope.time       => calculated UTC time
      //
      // $timeout(function(){
      //   set_timepicker(from,to);
      // });

      return {
        from : from,
        to   : to
      };
    };

    $scope.time_apply = function() {
      // Update internal time object
      $scope.panel.error = "";
      
      // Remove all other time filters
      filterSrv.removeByType('time');

      $scope.time = $scope.time_calc();
      $scope.time.field = $scope.panel.timefield;

      update_panel();
      set_time_filter($scope.time);

      dashboard.refresh();
    };

    // No need to automatically call time_apply() when changing time mode,
    // because it will mess up the timepicker.
    // 
    // $scope.$watch('panel.mode', $scope.time_apply);

    $scope.time_check = function() {
    };

    function set_time_filter(time) {
      time.type = 'time';
      // Clear all time filters, set a new one
      filterSrv.removeByType('time');
      $scope.panel.filter_id = filterSrv.set(compile_time(time));
      return $scope.panel.filter_id;
    }

    // Prefer to pass around Date() objects since interacting with
    // moment objects in libraries that are expecting Date()s can be tricky
    function compile_time(time) {
      // Clone time obj
      var filterTime = $.extend(true, {}, time);
      if ($scope.panel.mode === 'relative') {
        // Get the time suffix (ie.s/m/h/d/w/M/y)
        var timeShorthand = $scope.panel.timespan.substr(-1);
        var timeNumber = $scope.panel.timespan.substr(0, $scope.panel.timespan.length-1);
        var timeUnit;
        switch (timeShorthand) {
          case 's':
            timeUnit = 'SECOND';
            break;
          case 'm':
            timeUnit = 'MINUTE';
            break;
          case 'h':
            timeUnit = 'HOUR';
            break;
          case 'd':
            timeUnit = 'DAY';
            break;
          case 'w':
            // Convert weeks into days
            timeNumber = timeNumber * 7;
            timeUnit = 'DAY';
            break;
          case 'y':
            timeUnit = 'YEAR';
            break;
        }
        filterTime.from = 'NOW/' + timeUnit + '-' + timeNumber + timeUnit;
        filterTime.to   = 'NOW/' + timeUnit + '%2B1' + timeUnit;
        // Add Date objects representation of from and to, for use with histogram panel
        // where it needs Date objects for plotting x-axis on a chart.
        filterTime.fromDateObj = moment().subtract(timeShorthand,timeNumber).toDate();
        filterTime.toDateObj = new Date();
      } else if ($scope.panel.mode === 'since') {
        // Add Date objects representation of from and to, for use with histogram panel
        // where it needs Date objects for plotting x-axis on a chart.
        filterTime.fromDateObj = filterTime.from.toDate();
        filterTime.toDateObj = new Date();
        filterTime.from = filterTime.from.toDate().toISOString() + '/SECOND';
        filterTime.to   = '*';
      } else if ($scope.panel.mode === 'absolute') {
        filterTime.from = filterTime.from.toDate();
        filterTime.to   = filterTime.to.toDate();
      }

      return filterTime;
    }

    function set_timepicker(from,to) {
      // Janky 0s timeout to get around $scope queue processing view issue
      $scope.timepicker = {
        from : {
          time : from.format("HH:mm:ss"),
          date : from.format("MM/DD/YYYY")
        },
        to : {
          time : to.format("HH:mm:ss"),
          date : to.format("MM/DD/YYYY")
        }
      };
    }

  });
});
