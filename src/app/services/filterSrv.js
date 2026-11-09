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

    // Turns a stored time bound into a Date: an ISO date (with or without a trailing rounding such as
    // "/SECOND"), "*" or "NOW" for now, or Solr date math such as NOW/HOUR-6HOUR or NOW/DAY%2B1DAY.
    // Returns an invalid Date for anything else.
    function parseTime(text) {
      var now = new Date();
      var value = text;
      try { value = decodeURIComponent(text); } catch (e) { /* keep the text as it is */ }
      value = value.replace(/\s+/g, '');
      if (value === '*') {
        return now;
      }
      var math = /^NOW((?:\/[A-Z]+|[+-]\d+[A-Z]+)*)$/.exec(value);
      var base, rest;
      if (math) {
        base = now;
        rest = math[1];
      } else {
        var iso = /^(\d{4}-\d\d-\d\dT[\d:.]+Z?)((?:\/[A-Z]+|[+-]\d+[A-Z]+)*)$/.exec(value);
        if (!iso) {
          return new Date(NaN);
        }
        base = new Date(iso[1]);
        rest = iso[2];
      }
      var t = new Date(base.getTime());
      var ops = rest.match(/\/[A-Z]+|[+-]\d+[A-Z]+/g) || [];
      for (var i = 0; i < ops.length && !isNaN(t.getTime()); i++) {
        var m = /^(?:\/([A-Z]+?)S?|([+-]\d+)([A-Z]+?)S?)$/.exec(ops[i]);
        var unit = m[1] || m[3];
        var y = t.getUTCFullYear(), mo = t.getUTCMonth(), d = t.getUTCDate(), h = t.getUTCHours(),
          mi = t.getUTCMinutes(), sec = t.getUTCSeconds();
        if (m[1]) {
          switch (unit) {
          case 'YEAR': t = new Date(Date.UTC(y, 0, 1)); break;
          case 'MONTH': t = new Date(Date.UTC(y, mo, 1)); break;
          case 'DAY': case 'DATE': t = new Date(Date.UTC(y, mo, d)); break;
          case 'HOUR': t = new Date(Date.UTC(y, mo, d, h)); break;
          case 'MINUTE': t = new Date(Date.UTC(y, mo, d, h, mi)); break;
          case 'SECOND': t = new Date(Date.UTC(y, mo, d, h, mi, sec)); break;
          default: t = new Date(NaN);
          }
        } else {
          var n = parseInt(m[2], 10);
          switch (unit) {
          case 'YEAR': t = new Date(Date.UTC(y + n, mo, d, h, mi, sec)); break;
          case 'MONTH': t = new Date(Date.UTC(y, mo + n, d, h, mi, sec)); break;
          case 'DAY': case 'DATE': t = new Date(t.getTime() + n * 86400000); break;
          case 'HOUR': t = new Date(t.getTime() + n * 3600000); break;
          case 'MINUTE': t = new Date(t.getTime() + n * 60000); break;
          case 'SECOND': t = new Date(t.getTime() + n * 1000); break;
          case 'MILLI': t = new Date(t.getTime() + n); break;
          default: t = new Date(NaN);
          }
        }
      }
      return t;
    }

    // Call this whenever we need to reload the important stuff
    this.init = function() {
      // Populate defaults
      _.defaults(dashboard.current.services.filter,_d);

      // Accessors
      self.list = dashboard.current.services.filter.list;
      self.ids = dashboard.current.services.filter.ids;
      _f = dashboard.current.services.filter;

      // A dashboard saved with an absolute time range stores the range as ISO strings and has no date
      // objects (only the time picker's relative and since modes save those), and a dashboard file can hold a
      // relative range such as NOW/HOUR-1HOUR without them. Work the date objects out from the strings then,
      // so that the panels that ask for the range (timeRange) never get an invalid date.
      var toDate = function(dateObj, value) {
        var date = _.isUndefined(dateObj) || dateObj === null ? new Date(NaN) : new Date(dateObj);
        if (isNaN(date.getTime()) && _.isString(value)) {
          date = parseTime(value);
        }
        return date;
      };

      _.each(self.getByType('time',true),function(time) {
        self.list[time.id].from = time.from;
        self.list[time.id].to = time.to;
        self.list[time.id].fromDateObj = toDate(time.fromDateObj, time.from);
        self.list[time.id].toDateObj = toDate(time.toDateObj, time.to);
      });
    };

    // set() stores a filter's query or value URL-encoded, so a filter that is about to be added has to be
    // compared with the stored ones in either form: the text as given, or the same text encoded.
    function sameText(stored, incoming) {
      if (stored === incoming) {
        return true;
      }
      if (_.isUndefined(incoming) || incoming === null) {
        return false;
      }
      return stored === encodeURIComponent(incoming);
    }

    /**
     * Check if the specified filter is already exist in the filter service.
     * @param filter
     * @returns {boolean}
     */
    function isDuplicate(filter) {
      var foundDup = _.find(self.list, function(f) {
        if (f.editing === filter.editing &&
            f.type === filter.type &&
            sameText(f.query, filter.query) &&
            f.field === filter.field &&
            sameText(f.value, filter.value) &&
            // two ranges on the same field are different filters when their bounds differ
            f.from === filter.from &&
            f.to === filter.to) {
          // This filter is a duplicate.
          return true;
        }
      });

      return !!foundDup; // Return boolean value of foundDup
    }

    // This is used both for adding filters and modifying them.
    // If an id is passed, the filter at that id is updated.
    this.set = function(filter,id) {
      // Check for duplicate filter, if it is already exist, do nothing (don't add it to the Filter panel).
      // If the filter type is 'time', then we allow duplicate so that Histogram panel will behave correctly
      // (by adding a new time filter to the Filter panel, every time when a user selects an area in the histogram).
      if (filter.type !== 'time' && isDuplicate(filter)) {
        return false;
      }

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

    // Filter values and queries are stored URL-encoded (see set()), because getSolrFq puts them in a
    // URL as they are. Undo that for the code that needs the text itself.
    var decodeValue = function(value) {
      try {
        return decodeURIComponent(value);
      } catch (e) {
        return value;
      }
    };

    // Gather the active filters as plain (not URL-encoded) filter query strings, and the time range.
    var collectFilters = function(decode) {
      var val = decode ? decodeValue : _.identity;
      var start_time, end_time, time_field;
      var filters = [];
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
              filters.push(v.field + ':"' + val(v.value) + '"');
            } else if (v.mandate === 'mustNot') {
              filters.push('-' + v.field + ':"' + val(v.value) + '"');
            } else if (v.mandate === 'either') {
              filter_either.push(v.field + ':"' + val(v.value) + '"');
            }
          } else if (v.type === 'field') {
            // v.query contains double-quote around it.
            if (v.mandate === 'must') {
              filters.push(v.field + ':' + val(v.query));
            } else if (v.mandate === 'mustNot') {
              filters.push('-' + v.field + ':' + val(v.query));
            } else if (v.mandate === 'either') {
              filter_either.push(v.field + ':' + val(v.query));
            }
          } else if (v.type === 'querystring') {
            if (v.mandate === 'must') {
              filters.push(val(v.query));
            } else if (v.mandate === 'mustNot') {
              filters.push('-' + val(v.query));
            } else if (v.mandate === 'either') {
              filter_either.push(val(v.query));
            }
          } else if (v.type === 'range') {
            if (v.mandate === 'must') {
              filters.push(v.field + ':[' + v.from + ' TO ' + v.to + ']');
            } else if (v.mandate === 'mustNot') {
              filters.push('-' + v.field + ':[' + v.from + ' TO ' + v.to + ']');
            } else if (v.mandate === 'either') {
              filter_either.push(v.field + ':[' + v.from + ' TO ' + v.to + ']');
            }
          } else {
            // Unsupport filter type
            return false;
          }
        }
      });

      // parse filter_either array values, if exists. This happens before the
      // time check so that dashboards without a time filter keep these filters.
      if (filter_either.length > 0) {
        filters.push('(' + filter_either.join(' OR ') + ')');
      }

      return {
        filters: filters,
        time: (start_time && end_time && time_field) ?
          { field: time_field, from: start_time, to: end_time } : undefined
      };
    };

    // Return fq string for constructing a query to send to Solr.
    // noTime param use only in ticker panel so the filter query will return without
    // time filter query
    this.getSolrFq = function(noTime, sep) {
      var collected = collectFilters();
      var filter_fq = '';

      if (sep) {} else { sep = '&' }

      _.each(collected.filters, function(f) {
        filter_fq = filter_fq + sep + 'fq=' + f;
      });

      // For undefined time field, return filter_fq and strip-off the leading separator.
      // This will enable the dashboard without timepicker to function properly.
      if (!collected.time) {
        if (filter_fq.indexOf(sep) === 0) {
          filter_fq = filter_fq.substring(sep.length);
        }
        return filter_fq;
      }

      if (noTime) {
        return filter_fq;
      } else {
        return 'fq=' + collected.time.field + ':[' + collected.time.from + '%20TO%20' +
          collected.time.to + ']' + filter_fq;
      }
    };

    // The same filters as getSolrFq, as an array of filter queries that are neither prefixed with
    // 'fq=' nor URL-encoded (values are decoded). The time range, when there is one, comes first. Used by the panels that
    // build streaming expressions, which must quote the values themselves.
    this.getSolrFqList = function(noTime) {
      var collected = collectFilters(true);
      var list = [];
      if (collected.time && !noTime) {
        list.push(collected.time.field + ':[' + collected.time.from + ' TO ' + collected.time.to + ']');
      }
      return list.concat(collected.filters);
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
