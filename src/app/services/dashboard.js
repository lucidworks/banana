define([
  'angular',
  'jquery',
  'kbn',
  'underscore',
  'config',
  'moment',
  'modernizr',
  'filesaver'
],
function (angular, $, kbn, _, config, moment, Modernizr) {
  'use strict';

  var DEBUG = false; // DEBUG mode

  var module = angular.module('kibana.services');

  module.service('dashboard', function($routeParams, $http, $rootScope, $injector, $location,
    sjsResource, timer, kbnIndex, alertSrv
  ) {
    // A hash of defaults to use when loading a dashboard
    var _dash = {
      title: "",
      style: "dark",
      editable: true,
      failover: false,
      panel_hints: true,
      rows: [],
      services: {},
      loader: {
        dropdown_collections: false,
        save_gist: true,
        save_elasticsearch: true,
        save_local: true,
        save_default: true,
        save_temp: true,
        save_temp_ttl_enable: true,
        save_temp_ttl: '30d',
        load_gist: true,
        load_elasticsearch: true,
        load_elasticsearch_size: 20,
        load_local: true,
        hide: false
      },
      index: {
        interval: 'none', // this will always be none because we disable 'Index Settings' tab in dasheditor.html
        pattern: '_all',  // TODO: Remove it
        default: 'INDEX_MISSING'
      },
      solr: {
        server: config.solr,
        zkHost: config.zk_server,
        core_name: config.solr_core,
        core_list: [],
        global_params: ''
      },
      server_type: config.server_type
    };

    var sjs = sjsResource(config.solr + config.solr_core);

    var gist_pattern = /(^\d{5,}$)|(^[a-z0-9]{10,}$)|(gist.github.com(\/*.*)\/[a-z0-9]{5,}\/*$)/;

    // Store a reference to this
    var self = this;
    var filterSrv,querySrv;

    // To see if zkHost is changed and a refresh is needed
    var current_zk;

    // Live nodes usually don't change that frequently so will fetch live_nodes list only once
    var current_children;

    // Instead of trying always randomly, the first live_node will be selected randomly. If that
    // does not work, then cycle through all the live_nodes to make sure that not too many requests occur.
    var children_count = 0;

    this.current = _.clone(_dash);
    this.last = {};

    $rootScope.$on('$routeChangeSuccess',function(){
      // Clear the current dashboard to prevent reloading
      self.current = {};
      self.indices = [];
      route();
    });

    var route = function() {
      // Is there a dashboard type and id in the URL?
      if(!(_.isUndefined($routeParams.kbnType)) && !(_.isUndefined($routeParams.kbnId))) {
        var _type = $routeParams.kbnType;
        var _id = $routeParams.kbnId;

        switch(_type) {
        case ('elasticsearch'):
          self.elasticsearch_load('dashboard',_id);
          break;
        case ('solr'):
          self.elasticsearch_load('dashboard',_id);
          break;
        case ('temp'):
          self.elasticsearch_load('temp',_id);
          break;
        case ('file'):
          self.file_load(_id);
          break;
        case('script'):
          self.script_load(_id);
          break;
        default:
          self.file_load('default.json');
        }

      // No dashboard in the URL
      } else {
        // Check if browser supports localstorage, and if there's a dashboard
        if (Modernizr.localstorage &&
          !(_.isUndefined(window.localStorage['dashboard'])) &&
          window.localStorage['dashboard'] !== ''
        ) {
          var dashboard = JSON.parse(window.localStorage['dashboard']);
          self.dash_load(dashboard);
        // No? Ok, grab default.json, its all we have now
        } else {
          self.file_load('default.json');
        }
      }
    };

    // Collections API request to fetch clusterstatus. Should work for both solr 4.x and 5.x
    this.get_clusterstatus = function() {
      current_zk = self.current.solr.zkHost;
      if (!self.current.solr.server.endsWith('/')) {
        self.current.solr.server = self.current.solr.server + '/';
      }
      return $http({
        url: self.current.solr.server + "admin/collections?action=clusterstatus&wt=json",
        method: "GET"
      }).error(function(data, status) {
          if (self.current.server_type === 'zk_server') {
            self.get_live_node_from_zk();
          }
          if (DEBUG) { console.debug('Clusterstatus could not be retrieved. Will try zookeeper server', data); }
          return false;
      }).success(function(data) {
          data = angular.fromJson(data.cluster);
          var rndm_rep = self.get_random_replica(data.collections);
          if (rndm_rep !== false) {
            self.current.solr.server = rndm_rep.base_url + '/';
            self.refresh();
          }
          if (DEBUG) { console.debug('Retrieved clusterstatus from solr. Will not query zk server'); }
      });
    };

    this.get_random_replica = function(collections) {
      var current_solr = self.current.solr.core_name;

      // If collection name is of the form xxxxxxx_shardY_replicaZ then clusterstatus node will not be found.
      // Strip collection name of the unwanted string.
      var regex = new RegExp('[\\S]+_shard[0-9]+_replica[0-9]+$');
      if (regex.test(current_solr)) {
        var no_of_occurrences = current_solr.split('_');
        current_solr = current_solr('_', no_of_occurrences - 2).join('_');
      }
      if (typeof collections !== 'undefined' &&
          collections.hasOwnProperty(current_solr)) {
            var shards = angular.fromJson(collections[self.current.solr.core_name]["shards"]);
            var arr = Object.keys(shards).map(function (key) { return shards[key] });
            var i;
            // Check if all shards are in active state or not
            for (i = 0; i < arr.length; i++) {
              if (arr[i].state !== 'active') {
                alertSrv.set('Error', 'All shards are not active currently. Please try again after some time', 'error');
                return false;
              }
            }
            i = Math.floor(Math.random()*arr.length);
            var random_shard = arr[i];
            arr = Object.keys(random_shard.replicas).map(function (key) { return random_shard.replicas[key] });
            i = Math.floor(Math.random()*arr.length);
            var random_replica = arr[i];
            while (random_replica.state !== 'active' && i < arr.length) {
              random_replica = arr[i];
              i++;
            }
            if (random_replica.state !== 'active') {
              alertSrv.set('Error', 'No active node present currently. Please try again after some time', 'error');
              return false;
            }
            return random_replica;
      } else {
        alertSrv.set('Error', 'Collection ' + self.current.solr.core_name +
                         ' does not exist. Please check the configuration again', 'error');
        return false;
      }
    };

    this.get_random_live_node = function(live_nodes) {
      if (typeof live_nodes !== 'undefined') {
        var i = Math.floor(Math.random()*live_nodes.length);
        return live_nodes[i];
      } else {
        return;
      }
    };

    // Use zookeeper rest server APIs to get available solr server address. The address is extracted from
    // clusterstate.json only when the dashboard is loaded or when the current solr server is unreachable
    this.get_live_node_from_zk = function() {
      if (!self.zk_config_changed() && typeof current_children !== 'undefined') {
       while (children_count < current_children.length) {
         self.current.solr.server = current_children[children_count];
         children_count++;
         self.get_clusterstatus();
         return;
       }
       alertSrv.set('Error', 'Cannot get clusterstatus from any of the live_nodes. Please check the cluster status', 'error');
       return;
      }
      if (!self.current.solr.zkHost.endsWith('/')) {
        self.current.solr.zkHost = self.current.solr.zkHost + '/';
      }
      return $http({
        url: self.current.solr.zkHost + 'live_nodes?view=children',
        method: "JSONP",
        params: {
          callback : 'JSON_CALLBACK'
        },
        transformResponse: function(response) {
          response = angular.fromJson(response);
          if (typeof response.children === 'undefined') {
            alertSrv.set('Error', 'No live nodes found. Check the zookeeper path' +
             'or select specify solr server.', 'error');
            return false;
          }
          response = angular.fromJson(response.children);
          // Change live_nodes to usable format
          var children = Object.keys(response).map(function(key) { return "http://" + response[key].replace("_", "/")});
          current_children = children;
          children_count = 0;
          var rndm_live_node = self.get_random_live_node(children);
          if (typeof rndm_live_node !== 'undefined') {
            self.current.solr.server = rndm_live_node;
            self.get_clusterstatus();
          }
          return;
        }
      }).error(function(data, status) {
          alertSrv.set('Error', 'Cannot connect to Zookeeper Rest server at ' + self.current.solr.zkHost, 'error');
          return false;
      }).success(function(data) {
          if (DEBUG) { console.debug('Method to fetch solr server from zookeeper called'); }
      });
    };

    // Check if Zookeeper configuration has changed.
    this.zk_config_changed = function() {
      return (current_zk != self.current.solr.zkHost);
    };

    // Since the dashboard is responsible for index computation, we can compute and assign the indices
    // here before telling the panels to refresh
    this.refresh = function() {

      // If zookeeper url is changed, then get new set of live_nodes
      // Otherwise, continue using the same solr server
      if (self.current.server_type === 'zk_server' && self.zk_config_changed()) {
        self.get_live_node_from_zk();
        return;
      }

      // Retrieve Solr collections for the dashboard
      kbnIndex.collections(self.current.solr.server).then(function (p) {
        if (DEBUG) { console.debug('dashboard: kbnIndex.collections p = ',p); }
        if (p.length > 0) {
          self.current.solr.core_list = p;
        } else {
          // No collections returned from Solr
          // Display alert only if USE_ADMIN_CORES flag in config.js is true.
          if (config.USE_ADMIN_CORES) {
            alertSrv.set('No collections','There were no collections returned from Solr.','info',5000);
          }
        }
      });

      if(self.current.index.interval !== 'none') {
        if(filterSrv.idsByType('time').length > 0) {
          var _range = filterSrv.timeRange('min');
          kbnIndex.indices(_range.from,_range.to,
            self.current.index.pattern,self.current.index.interval
          ).then(function (p) {
            if (DEBUG) { console.debug('dashboard: p = ',p); }

            if(p.length > 0) {
              self.indices = p;
            } else {
              // Option to not failover
              if(self.current.failover) {
                self.indices = [self.current.index.default];
              } else {
                // Do not issue refresh if no indices match. This should be removed when panels
                // properly understand when no indices are present
                alertSrv.set('No results','There were no results because no indices were found that match your'+
                  ' selected time span','info',5000);
                return false;
              }
            }

            $rootScope.$broadcast('refresh');
          });
        } else {
          if(self.current.failover) {
            self.indices = [self.current.index.default];
            $rootScope.$broadcast('refresh');
          } else {
            alertSrv.set("No time filter",
              'Timestamped indices are configured without a failover. Waiting for time filter.',
              'info',5000);
          }
        }
      } else {
        self.indices = [self.current.index.default];
        $rootScope.$broadcast('refresh');
      }

    };

    var dash_defaults = function(dashboard) {
      _.defaults(dashboard,_dash);
      _.defaults(dashboard.index,_dash.index);
      _.defaults(dashboard.loader,_dash.loader);
      // Solr
      _.defaults(dashboard.collection,_dash.collection);
      // Default Zookeeper host
      _.defaults(dashboard.zkHost, _dash.zkHost);
      // Default server type
      _.defaults(dashboard.server_type, _dash.server_type);
      return dashboard;
    };

    this.dash_load = function(dashboard) {
      // Cancel all timers
      timer.cancel_all();

      // Make sure the dashboard being loaded has everything required
      dashboard = dash_defaults(dashboard);

      // If not using time based indices, use the default index
      if(dashboard.index.interval === 'none') {
        self.indices = [dashboard.index.default];
      }

      self.current = _.clone(dashboard);

      // Ok, now that we've setup the current dashboard, we can inject our services
      querySrv = $injector.get('querySrv');
      filterSrv = $injector.get('filterSrv');

      // Set Solr Server as default type for older dashboards
      if (typeof self.current.server_type === 'undefined') {
        self.current.server_type = 'solr_server';
      }

      // Make sure these re-init
      querySrv.init();
      filterSrv.init();

      // If there's an index interval set and no existing time filter, send a refresh to set one
      if(dashboard.index.interval !== 'none' && filterSrv.idsByType('time').length === 0) {
        self.refresh();
      }

      return true;
    };

    this.gist_id = function(string) {
      if(self.is_gist(string)) {
        return string.match(gist_pattern)[0].replace(/.*\//, '');
      }
    };

    this.is_gist = function(string) {
      if(!_.isUndefined(string) && string !== '' && !_.isNull(string.match(gist_pattern))) {
        return string.match(gist_pattern).length > 0 ? true : false;
      } else {
        return false;
      }
    };

    this.to_file = function() {
      var blob = new Blob([angular.toJson(self.current,true)], {type: "text/json;charset=utf-8"});
      // from filesaver.js
      window.saveAs(blob, self.current.title+"-"+new Date().getTime());
      return true;
    };

    this.set_default = function(dashboard) {
      if (Modernizr.localstorage) {
        window.localStorage['dashboard'] = angular.toJson(dashboard || self.current);
        $location.path('/dashboard');
        return true;
      } else {
        return false;
      }
    };

    this.purge_default = function() {
      if (Modernizr.localstorage) {
        window.localStorage['dashboard'] = '';
        return true;
      } else {
        return false;
      }
    };

    // TOFIX: Pretty sure this breaks when you're on a saved dashboard already
    this.share_link = function(title,type,id) {
      return {
        location  : window.location.href.replace(window.location.hash,""),
        type      : type,
        id        : id,
        link      : window.location.href.replace(window.location.hash,"")+"#dashboard/"+type+"/"+id,
        title     : title
      };
    };

    var renderTemplate = function(json,params) {
      var _r;
      _.templateSettings = {interpolate : /\{\{(.+?)\}\}/g};
      var template = _.template(json);
      var rendered = template({ARGS:params});
      try {
        _r = angular.fromJson(rendered);
      } catch(e) {
        _r = false;
      }
      return _r;
    };

    this.file_load = function(file) {
      return $http({
        url: "app/dashboards/"+file+'?' + new Date().getTime(),
        method: "GET",
        transformResponse: function(response) {
          return renderTemplate(response,$routeParams);
        }
      }).then(function(result) {
        if(!result) {
          return false;
        }
        self.dash_load(dash_defaults(result.data));
        return true;
      },function() {
        alertSrv.set('Error',"Could not load <i>dashboards/"+file+"</i>. Please make sure it exists" ,'error');
        return false;
      });
    };

    this.elasticsearch_load = function(type,id) {
      return $http({
        url: config.solr + config.banana_index + '/select?wt=json&q=title:"' + id + '"',
        method: "GET",
        transformResponse: function(response) {
          response = angular.fromJson(response);
          var source_json = angular.fromJson(response.response.docs[0].dashboard);

          if (DEBUG) { console.debug('dashboard: type=',type,' id=',id,' response=',response,' source_json=',source_json); }

          // return renderTemplate(angular.fromJson(response)._source.dashboard, $routeParams);
          // return renderTemplate(JSON.stringify(source_json.dashboard), $routeParams);
          return renderTemplate(JSON.stringify(source_json), $routeParams);
        }
      }).error(function(data, status) {
        if(status === 0) {
          alertSrv.set('Error',"Could not contact Solr at "+config.solr+
            ". Please ensure that Solr is reachable from your system." ,'error');
          // Try a different solr server if zookeeper server is enabled
          if (self.current.server_type == 'zk_server') {
            self.get_live_node_from_zk();;
          }
        } else {
          alertSrv.set('Error','Could not find dashboard named "'+id+'". Please ensure that the dashboard name is correct or exists in the system.','error');
        }
        return false;
      }).success(function(data) {
        self.dash_load(data);
      });
    };

    this.script_load = function(file) {
      return $http({
        url: "app/dashboards/"+file,
        method: "GET",
        transformResponse: function(response) {
          /*jshint -W054 */
          var _f = new Function('ARGS','kbn','_','moment','window','document','angular','require','define','$','jQuery',response);
          return _f($routeParams,kbn,_,moment);
        }
      }).then(function(result) {
        if(!result) {
          return false;
        }
        self.dash_load(dash_defaults(result.data));
        return true;
      },function() {
        alertSrv.set('Error',
          "Could not load <i>scripts/"+file+"</i>. Please make sure it exists and returns a valid dashboard" ,
          'error');
        return false;
      });
    };

    this.elasticsearch_save = function(type,title,ttl) {
      // Clone object so we can modify it without influencing the existing obejct
      var save = _.clone(self.current);
      var id;

      // Change title on object clone
      if (type === 'dashboard') {
        id = save.title = _.isUndefined(title) ? self.current.title : title;
      }

      // Create request with id as title. Rethink this.
      // Use id instead of _id, because it is the default field of Solr schema-less.
      var request = sjs.Document(config.banana_index,type,id).source({
        // _id: id,
        id: id,
        user: 'guest',
        group: 'guest',
        title: save.title,
        dashboard: angular.toJson(save)
      });

      request = type === 'temp' && ttl ? request.ttl(ttl) : request;

      // Solr: set sjs.client.server to use 'banana-int' for saving dashboard
      sjs.client.server(config.solr + config.banana_index);

      return request.doIndex(
        // Success
        function(result) {
          if(type === 'dashboard') {
            // TODO
            $location.path('/dashboard/solr/'+title);
          }
          return result;
        },
        // Failure
        function() {
          return false;
        }
      );
    };

    this.elasticsearch_delete = function(id) {
      // Set sjs.client.server to use 'banana-int' for deleting dashboard
      sjs.client.server(config.solr + config.banana_index);

      return sjs.Document(config.banana_index,'dashboard',id).doDelete(
        // Success
        function(result) {
          return result;
        },
        // Failure
        function() {
          return false;
        }
      );
    };

    this.elasticsearch_list = function(query,count) {
      // set indices and type
      var solrserver = self.current.solr.server + config.banana_index || config.solr + config.banana_index;
      sjs.client.server(solrserver);

      var request = sjs.Request().indices(config.banana_index).types('dashboard');

      // Need to set sjs.client.server back to use 'logstash_logs' collection
      // But cannot do it here, it will interrupt other modules.
      // sjs.client.server(config.solr);

      return request.query(
        sjs.QueryStringQuery(query || '*:*')
        ).size(count).doSearch(
          // Success
          function(result) {
            return result;
          },
          // Failure
          function() {
            return false;
          }
        );

    };

    this.save_gist = function(title,dashboard) {
      var save = _.clone(dashboard || self.current);
      save.title = title || self.current.title;
      return $http({
        url: "https://api.github.com/gists",
        method: "POST",
        data: {
          "description": save.title,
          "public": false,
          "files": {
            "banana-dashboard.json": {
              "content": angular.toJson(save,true)
            }
          }
        }
      }).then(function(data) {
        return data.data.html_url;
      }, function() {
        return false;
      });
    };

    this.gist_list = function(id) {
      return $http.jsonp("https://api.github.com/gists/"+id+"?callback=JSON_CALLBACK"
      ).then(function(response) {
        var files = [];
        _.each(response.data.data.files,function(v) {
          try {
            var file = JSON.parse(v.content);
            files.push(file);
          } catch(e) {
            return false;
          }
        });
        return files;
      }, function() {
        return false;
      });
    };

    this.numberWithCommas = function(x) {
      if (x) {
        return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      } else {
        return x;
      }
    };

  });

});
