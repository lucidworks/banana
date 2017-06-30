/*global angular */

define(['jquery', 'underscore'],
function($, _) {
  'use strict';

  var kbn = {};

  /**
   * Return a sorted array containing all keys stored in an object (regardless of the keys' nested depth within the object)
   *
   * @see    kbn.flatten_object
   * @param  {Object} obj
   * @return {Array}
   */
  kbn.get_object_fields = function(obj) {
    var field_array = [];
    obj = kbn.flatten_json(obj._source);
    for (var field in obj) {
      field_array.push(field);
    }
    return field_array.sort();
  };

  /**
   * Save a response object to the visitor's computer
   *
   * @param {Object} response  sdf
   * @param {String} type      one of "json", "csv", or "xml"
   * @param {String} basename  serves as the basename for the file
   * @return {Boolean}         true if the file downloaded successfully, false if not
   */
  kbn.download_response = function(response, type, basename) {

    var blob; // the file to be written
    // TODO: manipulating solr requests
    // pagination (batch downloading)
    // example: 1,000,000 rows will explode the memory !
    if(type === 'json') {
        blob = new Blob([angular.toJson(response,true)], {type: "text/json;charset=utf-8"});
    } else if(type === 'csv') {
        blob = new Blob([response.toString()], {type: "text/csv;charset=utf-8"});
    } else if(type === 'xml'){
        blob = new Blob([response.toString()], {type: "text/xml;charset=utf-8"});
    } else {
        // incorrect file type
        alert('incorrect file type');
        return false;
    }
    // from filesaver.js
    window.saveAs(blob, basename +"-"+new Date().getTime()+"."+type);
    return true;
  };

  /**
   *
   *
   * @param  {Array} data
   * @return {Array}
   */
  kbn.get_all_fields = function(data) {
    var fields = [];
    _.each(data,function(hit) {
      fields = _.uniq(fields.concat(_.keys(hit)));
    });
    // Remove stupid angular key
    fields = _.without(fields,'$$hashKey');
    return fields;
  };


  /**
   * Determine if a given key exists in an object, supporting nested key path
   *
   * @see    kbn.flatten_json
   * @param  {Object} obj
   * @param  {String} field
   * @return {Boolean}
   */
  kbn.has_field = function(obj,field) {
    var obj_fields = kbn.get_object_fields(obj);
    if (_.inArray(obj_fields,field) < 0) {
      return false;
    } else {
      return true;
    }
  };

  kbn.get_related_fields = function(docs,field) {
    var field_array = [];
    _.each(docs, function(doc) {
      var keys = _.keys(doc);
      if(_.contains(keys,field)) {
        field_array = field_array.concat(keys);
      }
    });
    var counts = _.countBy(_.without(field_array,field),function(field){return field;});
    return counts;
  };

  kbn.recurse_field_dots = function(object,field) {
    var value = null;
    var nested;
    if (typeof object[field] !== 'undefined') {
      value = object[field];
    }
    else if (nested = field.match(/(.*?)\.(.*)/)) {
      if(typeof object[nested[1]] !== 'undefined') {
        value = (typeof object[nested[1]][nested[2]] !== 'undefined') ?
          object[nested[1]][nested[2]] : kbn.recurse_field_dots(
            object[nested[1]],nested[2]);
      }
    }

    return value;
  };

  kbn.top_field_values = function(docs,field,count,grouped) {
    var all_values = _.pluck(docs,field),
      groups = {},
      counts,
      hasArrays;
    // manually grouping into pairs allows us to keep the original value,
    _.each(all_values, function (value) {
      var k;
      if(_.isArray(value)) {
        hasArrays =  true;
      }
      if(_.isArray(value) && !grouped) {
        k = value;
      } else {
        k = _.isUndefined(value) ? '' : [value.toString()];
      }
      _.each(k, function(key) {
        if (_.has(groups, key)) {
          groups[key][1] ++;
        } else {
          groups[key] = [(grouped ? value : key), 1];
        }
      });
    });

    counts = _.values(groups).sort(function(a, b) {
      return a[1] - b[1];
    }).reverse().slice(0,count);

    return {
      counts: counts,
      hasArrays : hasArrays
    };
  };

   /**
     * Calculate range facet interval
     *
     * @param  {Integer} from                    Number containing the start of range
     * @param  {Integer} to                      Number containing the end of range
     * @param  {Integer} size                    Calculate to approximately this many bars
     * @param  {Integer,optional} user_interval  User-specified histogram interval (defaults to 0)
     * @return {Number}
     *
     */
  kbn.calculate_gap = function(from,to,size,user_interval) {
    return user_interval === 0 ? kbn.round_gap((to - from)/size) : user_interval;
  };

   /**
     * Round the value of interval to fit this defined resolution
     *
     * @param  {number} interval  The value to be rounded
     * @return {number}           Rounded value
     */
  kbn.round_gap = function(interval) {
    return Math.round(interval) + 1;
  };

   /**
     * Calculate a graph interval
     *
     * @param  {Date}   from          Date object containing the start time
     * @param  {Date}   to            Date object containing the finish time
     * @param  {number} size          Calculate to approximately this many bars
     * @param  {number} user_interval User-specified histogram interval
     * @return {number}
     *
     */
  kbn.calculate_interval = function(from,to,size,user_interval) {
    if(_.isObject(from)) {
      from = from.valueOf();
    }
    if(_.isObject(to)) {
      to = to.valueOf();
    }
    return user_interval === 0 ? kbn.round_interval((to - from)/size) : user_interval;
  };


  /**
   * Retrieve a human-friendly period of time whose window is most applicable for a time interval
   *
   * @param {Number} interval  Number of milliseconds for the time interval
   * @return {Integer}
   */
  kbn.round_interval = function(interval) {
    switch (true) {
    // 0.5s
    case (interval <= 500):
      return 100;       // 0.1s
    // 5s
    case (interval <= 5000):
      return 1000;      // 1s
    // 7.5s
    case (interval <= 7500):
      return 5000;      // 5s
    // 15s
    case (interval <= 15000):
      return 10000;     // 10s
    // 45s
    case (interval <= 45000):
      return 30000;     // 30s
    // 3m
    case (interval <= 180000):
      return 60000;     // 1m
    // 9m
    case (interval <= 450000):
      return 300000;    // 5m
    // 20m
    case (interval <= 1200000):
      return 600000;    // 10m
    // 45m
    case (interval <= 2700000):
      return 1800000;   // 30m
    // 2h
    case (interval <= 7200000):
      return 3600000;   // 1h
    // 6h
    case (interval <= 21600000):
      return 10800000;  // 3h
    // 24h
    case (interval <= 86400000):
      return 43200000;  // 12h
    // 48h
    case (interval <= 172800000):
      return 86400000;  // 24h
    // 1w
    case (interval <= 604800000):
      return 86400000;  // 24h
    // 3w
    case (interval <= 1814400000):
      return 604800000; // 1w
    // 2y
    case (interval < 3628800000):
      return 2592000000; // 30d
    default:
      return 31536000000; // 1y
    }
  };

  /**
   * Build a human-friendly description of how much time has passed since a point in time
   *
   * @param  {Number} seconds  The number of seconds that have passed since the event in question
   * @return {String}          String with human-friendly relative time interval
  */
  kbn.secondsToHms = function(seconds){
    var numyears = Math.floor(seconds / 31536000);
    if(numyears){
      return numyears + 'y';
    }
    var numdays = Math.floor((seconds % 31536000) / 86400);
    if(numdays){
      return numdays + 'd';
    }
    var numhours = Math.floor(((seconds % 31536000) % 86400) / 3600);
    if(numhours){
      return numhours + 'h';
    }
    var numminutes = Math.floor((((seconds % 31536000) % 86400) % 3600) / 60);
    if(numminutes){
      return numminutes + 'm';
    }
    var numseconds = (((seconds % 31536000) % 86400) % 3600) % 60;
    if(numseconds){
      return numseconds + 's';
    }
    return 'less than a second'; //'just now' //or other string you like;
  };

  /**
   * Build a human-friendly representation for the state of completion between two values, ex: kbn.to_percent(7,9) → "78%"
   *
   * @param  {Number} number
   * @param  {Number} outof
   * @return {String} String with human-friendly percentage of completion
  */
  kbn.to_percent = function(number,outof) {
    return Math.floor((number/outof)*10000)/100 + "%";
  };

  kbn.addslashes = function(str) {
    str = str.replace(/\\/g, '\\\\');
    str = str.replace(/\'/g, '\\\'');
    str = str.replace(/\"/g, '\\"');
    str = str.replace(/\0/g, '\\0');
    return str;
  };

  kbn.interval_regex = /(\d+(?:\.\d+)?)([Mwdhmsy])/;

  // histogram & trends
  kbn.intervals_in_seconds = {
    y: 31536000,
    M: 2592000,
    w: 604800,
    d: 86400,
    h: 3600,
    m: 60,
    s: 1
  };

  kbn.describe_interval = function (string) {
    var matches = string.match(kbn.interval_regex);
    if (!matches || !_.has(kbn.intervals_in_seconds, matches[2])) {
      throw new Error('Invalid interval string, expecting a number followed by one of "Mwdhmsy"');
    } else {
      return {
        sec: kbn.intervals_in_seconds[matches[2]],
        type: matches[2],
        count: parseInt(matches[1], 10)
      };
    }
  };

  kbn.interval_to_ms = function(string) {
    var info = kbn.describe_interval(string);
    return info.sec * 1000 * info.count;
  };

  kbn.interval_to_seconds = function (string) {
    var info = kbn.describe_interval(string);
    return info.sec * info.count;
  };

  // This should go away, moment.js can do this
  kbn.time_ago = function(string) {
    return new Date(new Date().getTime() - (kbn.interval_to_ms(string)));
  };

  /**
   * Return a single-level object where nested object keys are concatenated representations of path syntax
   *
   * ex: kbn.flatten_json({"a": 1, "b" : {"c" : 25, "d" : 13}}) → {"b.d": 13, "b.c": 25, "a": 1}
   *
   * // LOL. hahahahaha. DIE.
   *
   * @param  {Object}          object
   * @param  {String,optional} root
   * @param  {Object,optional} array
   * @return {Object}
   */
  kbn.flatten_json = function(object,root,array) {
    if (typeof array === 'undefined') {
      array = {};
    }
    if (typeof root === 'undefined') {
      root = '';
    }
    for(var index in object) {
      var obj = object[index];
      var rootname = root.length === 0 ? index : root + '.' + index;
      if(typeof obj === 'object' ) {
        if(_.isArray(obj)) {
          if(obj.length > 0 && typeof obj[0] === 'object') {
            var strval = '';
            for (var objidx = 0, objlen = obj.length; objidx < objlen; objidx++) {
              if (objidx > 0) {
                strval = strval + ', ';
              }

              strval = strval + JSON.stringify(obj[objidx]);
            }
            array[rootname] = strval;
          } else if(obj.length === 1 && _.isNumber(obj[0])) {
            array[rootname] = parseFloat(obj[0]);
          } else {
            array[rootname] = typeof obj === 'undefined' ? null : obj;
          }
        } else {
          kbn.flatten_json(obj,rootname,array);
        }
      } else {
        array[rootname] = typeof obj === 'undefined' ? null : obj;
      }
    }
    return kbn.sortObj(array);
  };


  /**
   * Sanitize string for displaying in the document by replacing characters with appropriate values for  "<",">","&","<del>","</del>", & whitespace
   *
   * @param  {String} value
   * @return {String}
   */
  kbn.xmlEnt = function(value) {
    if(_.isString(value)) {
      var stg1 = value.replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\r\n/g, '<br/>')
        .replace(/\r/g, '<br/>')
        .replace(/\n/g, '<br/>')
        .replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;')
        .replace(/  /g, '&nbsp;&nbsp;')
        .replace(/&lt;del&gt;/g, '<del>')
        .replace(/&lt;\/del&gt;/g, '</del>');
      return stg1;
    } else {
      return value;
    }
  };

  /**
   * An attempt to sort alphabetically sort an object's keys.
   *
   * Note that this method should be removed as it is useless: http://stackoverflow.com/questions/5467129/sort-javascript-object-by-key
   *
   * @param  {Object} arr  The object whose keys should be sorted
   * @return {Object}     Copy of the object whose keys should be in sorted order (ie:
   */
  kbn.sortObj = function(arr) {
    // Setup Arrays
    var sortedKeys = [];
    var sortedObj = {};
    var i;
    // Separate keys and sort them
    for (i in arr) {
      sortedKeys.push(i);
    }
    sortedKeys.sort();

    // Reconstruct sorted obj based on keys
    for (i in sortedKeys) {
      sortedObj[sortedKeys[i]] = arr[sortedKeys[i]];
    }
    return sortedObj;
  };

  /**
   * Generate HTML markup for the colored bullet associated with a query term
   *
   * @param {String} color      CSS/HTML color declaration for the dot
   * @param {Integer} diameter  Size of the dot (in pixels)
   * @return {String}
   */
  kbn.query_color_dot = function (color, diameter) {
    return '<div class="icon-circle" style="' + [
        'display:inline-block',
        'color:' + color,
        'font-size:' + diameter + 'px',
      ].join(';') + '"></div>';
  };

  return kbn;
});
