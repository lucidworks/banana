define([
  'angular',
  'underscore',
  'config'
], function (angular, _, config) {
  'use strict';

  var DEBUG = false; // DEBUG mode

  var module = angular.module('kibana.services');

  module.service('filterSrv', function(dashboard, ejsResource, sjsResource) {
    // Create an object to hold our service state on the dashboard
    dashboard.current.services.filter = dashboard.current.services.filter || {};

    // Defaults for it
    var _d = {
      idQueue : [],
      list : {},
      ids : []
    };

    // For convenience
    // var ejs = ejsResource(config.elasticsearch);
    var solrserver = dashboard.current.solr.server + dashboard.current.solr.core_name || config.solr + config.solr_core;
    var sjs = sjsResource(solrserver);

    var _f = dashboard.current.services.filter;

    // Save a reference to this
    var self = this;

    // Call this whenever we need to reload the important stuff
    this.init = function() {
      // Populate defaults
      _.defaults(dashboard.current.services.filter,_d);

      // Accessors
      self.list = dashboard.current.services.filter.list;
      self.ids = dashboard.current.services.filter.ids;
      _f = dashboard.current.services.filter;

      _.each(self.getByType('time',true),function(time) {
        self.list[time.id].from = time.from;
        self.list[time.id].to = time.to;
        self.list[time.id].fromDateObj = new Date(time.fromDateObj);
        self.list[time.id].toDateObj = new Date(time.toDateObj);
      });

    };

    // This is used both for adding filters and modifying them.
    // If an id is passed, the filter at that id is updated.
    this.set = function(filter,id) {
      _.defaults(filter,{mandate:'must'});
      filter.active = true;

      // Need to url encode the filter query or value
      if (filter.query) {
        filter.query = encodeURIComponent(filter.query);
      } else if (filter.value) {
        filter.value = encodeURIComponent(filter.value);
      }

      if(!_.isUndefined(id)) {
        if(!_.isUndefined(self.list[id])) {
          _.extend(self.list[id],filter);
          return id;
        } else {
          return false;
        }
      } else {
        if(_.isUndefined(filter.type)) {
          return false;
        } else {
          var _id = nextId();
          var _filter = {
            alias: '',
            id: _id
          };
          _.defaults(filter,_filter);
          self.list[_id] = filter;
          self.ids.push(_id);
          return _id;
        }
      }
    };

    /**
     * Translate a key to the value defined in a dashboard's lang field
     *
     * translateLanguageKey("facet", "id", {... "lang" : { "facet.id" : "Model ID" }}) → "Model ID"
     *
     * @param (String) domain       an optional namespace for the key
     * @param {String} key          lang  the key that should be translated
     * @param {Dashboard} dashboard reference to the currently displayed dashboard, which may or may not have a "lang" field stored with
     */
    this.translateLanguageKey = function(domain, key, currentDashboard) {

        var target = (domain ? domain + '.' : '') + key;

        // if the dashboard has a translation for the key...
        if (currentDashboard.lang && currentDashboard.lang.hasOwnProperty(target)) {
          return currentDashboard.lang[target];
        }

        // otherwise return the key itself
        return key;
    };


    this.getBoolFilter = function(ids) {
      // A default match all filter, just in case there are no other filters
      var bool = sjs.BoolFilter().must(sjs.MatchAllFilter());

      var either_bool = sjs.BoolFilter().must(sjs.MatchAllFilter());
      _.each(ids,function(id) {
        if(self.list[id].active) {
          switch(self.list[id].mandate)
          {
          case 'mustNot':
            bool = bool.mustNot(self.getEjsObj(id));
            break;
          case 'either':
            either_bool = either_bool.should(self.getEjsObj(id));
            break;
          default:
            bool = bool.must(self.getEjsObj(id));
          }
        }
      });
      return bool.must(either_bool);
    };

    this.getEjsObj = function(id) {
      return self.toEjsObj(self.list[id]);
    };

    this.toEjsObj = function (filter) {
      if(!filter.active) {
        return false;
      }
      switch(filter.type)
      {
      case 'time':
        return sjs.RangeFilter(filter.field)
          .from(filter.from.valueOf())
          .to(filter.to.valueOf());
      case 'range':
        return sjs.RangeFilter(filter.field)
          .from(filter.from)
          .to(filter.to);
      case 'querystring':
        return sjs.QueryFilter(sjs.QueryStringQuery(filter.query)).cache(true);
      case 'field':
        return sjs.QueryFilter(sjs.FieldQuery(filter.field,filter.query)).cache(true);
      case 'terms':
        return sjs.TermsFilter(filter.field,filter.value);
      case 'exists':
        return sjs.ExistsFilter(filter.field);
      case 'missing':
        return sjs.MissingFilter(filter.field);
      default:
        return false;
      }
    };

    // Return fq string for constructing a query to send to Solr.
    // noTime param use only in ticker panel so the filter query will return without
    // time filter query
    this.getSolrFq = function(noTime) {
      var start_time, end_time, time_field;
      var filter_fq = '';
      var filter_either = [];

      // Loop through the list to find the time field, usually it should be in self.list[0]
      _.each(self.list, function(v, k) {

        if (DEBUG) {
          console.debug('filterSrv: v=', v, ' k=', k);
        }

        if (v.active) {
          if (v.type === 'time') {
            time_field = v.field;
            // Check for type of timestamps
            // In case of relative timestamps, they will be string, not Date obj.
            if (v.from instanceof Date) {
              start_time = new Date(v.from).toISOString();
            } else {
              start_time = v.from;
            }

            if (v.to instanceof Date) {
              end_time = new Date(v.to).toISOString();
            } else {
              end_time = v.to;
            }
          } else if (v.type === 'terms') {
            if (v.mandate === 'must') {
              filter_fq = filter_fq + '&fq=' + v.field + ':"' + v.value + '"';
            } else if (v.mandate === 'mustNot') {
              filter_fq = filter_fq + '&fq=-' + v.field + ':"' + v.value + '"';
            } else if (v.mandate === 'either') {
              filter_either.push(v.field + ':"' + v.value + '"');
            }
          } else if (v.type === 'field') {
            // v.query contains double-quote around it.
            if (v.mandate === 'must') {
              filter_fq = filter_fq + '&fq=' + v.field + ':' + v.query;
            } else if (v.mandate === 'mustNot') {
              filter_fq = filter_fq + '&fq=-' + v.field + ':' + v.query;
            } else if (v.mandate === 'either') {
              filter_either.push(v.field + ':' + v.query);
            }
          } else if (v.type === 'querystring') {
            if (v.mandate === 'must') {
              filter_fq = filter_fq + '&fq=' + v.query;
            } else if (v.mandate === 'mustNot') {
              filter_fq = filter_fq + '&fq=-' + v.query;
            } else if (v.mandate === 'either') {
              filter_either.push(v.query);
            }
          } else if (v.type === 'range') {
            if (v.mandate === 'must') {
              filter_fq = filter_fq + '&fq=' + v.field + ':[' + v.from + ' TO ' + v.to + ']';
            } else if (v.mandate === 'mustNot') {
              filter_fq = filter_fq + '&fq=-' + v.field + ':[' + v.from + ' TO ' + v.to + ']';
            } else if (v.mandate === 'either') {
              filter_either.push(v.field + ':[' + v.from + ' TO ' + v.to + ']');
            }
          } else {
            // Unsupport filter type
            return false;
          }
        }
      });

      // For undefined time field, return filter_fq and strip-off the prefix '&'.
      // This will enable the dashboard without timepicker to function properly.
      if (!start_time || !end_time || !time_field) {
        return filter_fq.replace(/^&/,'');
      }

      // parse filter_either array values, if exists
      if (filter_either.length > 0) {
        filter_fq = filter_fq + '&fq=(' + filter_either.join(' OR ') + ')';
      }

      if (noTime) {
        return filter_fq;
      } else {
        return 'fq=' + time_field + ':[' + start_time + '%20TO%20' + end_time + ']' + filter_fq;
      }
    };

    // Get time field for Solr query
    this.getTimeField = function() {
      var time_field;
      _.each(self.list, function(v) {
        if (v.type === 'time') {
          time_field = v.field;
          return;
        }
      });
      return time_field;
    };

    // Get range field for Solr query
    this.getRangeField = function() {
      var range_field;
      _.each(self.list, function(v) {
        if (v.type === 'range') {
          range_field = v.field;
          return;
        }
      });
      return range_field;
    };

    // Get start time for Solr query (e.g. facet.range.start)
    this.getStartTime = function() {
      var start_time;
      _.each(self.list, function(v) {
        if (v.type === 'time') {
          if (v.from instanceof Date) {
            start_time = new Date(v.from).toISOString();
          } else {
            start_time = v.from;
          }
          return;
        }
      });
      return start_time;
    };

    // Get end time for Solr query (e.g. facet.range.end)
    this.getEndTime = function() {
      var end_time;
      _.each(self.list, function(v) {
        if (v.type === 'time') {
          if (v.to instanceof Date) {
            end_time = new Date(v.to).toISOString();
          } else {
            end_time = v.to;
          }
          return;
        }
      });
      return end_time;
    };

    // Get both start and end time in one shot
    this.getStartTimeAndEndTime = function() {
      var start_time, end_time;
      _.each(self.list, function(v) {
        if (v.type === 'time') {
          start_time = new Date(v.from).toISOString();
          end_time = new Date(v.to).toISOString();
          return;
        }
      });
      return [start_time, end_time];
    };

    this.getByType = function(type,inactive) {
      return _.pick(self.list,self.idsByType(type,inactive));
    };

    // get the ids of filters using type and field
    this.idsByTypeAndField = function(type,field,inactive){
      var _require = inactive ? {type:type} : {type:type, field:field, active:true};
      return _.pluck(_.where(self.list,_require),'id');
    };

    // this method used to get the range filter with specific field
    this.getRangeFieldFilter = function(type, field, inactive){
      return _.pick(self.list, self.idsByTypeAndField(type, field, inactive));
    };

    this.removeByType = function(type) {
      var ids = self.idsByType(type);
      _.each(ids,function(id) {
        self.remove(id);
      });
      return ids;
    };

    // remove filter by type and field
    this.removeByTypeAndField = function(type,field) {
      var ids = self.idsByTypeAndField(type,field);
      _.each(ids,function(id) {
        self.remove(id);
      });
      return ids;
    };

    this.idsByType = function(type,inactive) {
      var _require = inactive ? {type:type} : {type:type,active:true};
      return _.pluck(_.where(self.list,_require),'id');
    };

    // TOFIX: Error handling when there is more than one field
    this.timeField = function() {
      return _.pluck(self.getByType('time'),'field');
    };

    // This special function looks for all time filters, and returns a time range according to the mode
    // No idea when max would actually be used
    this.timeRange = function(mode) {
      var _t = _.where(self.list,{type:'time',active:true});
      if(_t.length === 0) {
        return false;
      }
      switch(mode) {
      case "min":
        // If time is not Date obj (e.g. String time for Relative time mode or Since time mode)
        if (!(_t[_t.length-1].from instanceof Date) || !(_t[_t.length-1].to instanceof Date)) {
          return {
            from: _t[_t.length-1].fromDateObj,
            to: _t[_t.length-1].toDateObj
          };
        } else {
          return {
            from: new Date(_.max(_.pluck(_t,'from'))),
            to: new Date(_.min(_.pluck(_t,'to')))
          };
        }
        break; // not neccessary, but added to pass jshint test
      case "max":
        return {
          from: new Date(_.min(_.pluck(_t,'from'))),
          to: new Date(_.max(_.pluck(_t,'to')))
        };
      default:
        return false;
      }
    };

    //get the facet range using specific field
    this.facetRange = function(field){
      var _t = _.where(self.list,{type:'range', field:field, active:true});
      if(_t.length === 0) {
        return false;
      }
      return {
          from: _.max(_.pluck(_t,'from')),
          to: _.min(_.pluck(_t,'to'))
      };
    };

    this.remove = function(id) {
      if(!_.isUndefined(self.list[id])) {
        delete self.list[id];
        // This must happen on the full path also since _.without returns a copy
        self.ids = dashboard.current.services.filter.ids = _.without(self.ids,id);
        _f.idQueue.unshift(id);
        _f.idQueue.sort(function(v,k){return v-k;});
        return true;
      } else {
        return false;
      }
    };

    var nextId = function() {
      if(_f.idQueue.length > 0) {
        return _f.idQueue.shift();
      } else {
        return self.ids.length;
      }
    };

    // Now init
    self.init();
  });

});
