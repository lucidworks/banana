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
    module.service('dashboard', function ($routeParams, $http, $rootScope, $injector, $location,
                                          sjsResource, timer, $timeout, kbnIndex, alertSrv, lucidworksSrv) {
        // Store a reference to this
        var self = this;

        // A hash of defaults to use when loading a dashboard
        var _dash = {
            title: "",
            username: "guest", // default
            style: "dark",
            editable: true,
            home: true,
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
                save_as_public: false,
                load_gist: true,
                load_elasticsearch: true,
                load_elasticsearch_size: 10,
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
                core_name: config.solr_core,
                core_list: [],
                global_params: ''
            }
        };

        // Solr and Fusion uses different field names for their schema.
        // Solr uses banana-int collection, and Fusion uses system_banana collection.
        self.TITLE_FIELD = 'title';
        self.DASHBOARD_FIELD = 'dashboard';
        self.USER_FIELD = 'user';
        self.GROUP_FIELD = 'group';

        // If USE_FUSION, change the schema field names and banana_index setting.
        // Also, get the login username and store it.
        if (config.USE_FUSION) {
            config.banana_index = 'system_banana';
            self.TITLE_FIELD = 'banana_title_s';
            self.DASHBOARD_FIELD = 'banana_dashboard_s';
            self.USER_FIELD = 'banana_user_s';
            self.GROUP_FIELD = 'banana_group_s';

            lucidworksSrv.getFusionUsername().then(function (username) {
                _dash.username = username;
            });
        }

        var sjs = sjsResource(config.solr + config.solr_core);
        var gist_pattern = /(^\d{5,}$)|(^[a-z0-9]{10,}$)|(gist.github.com(\/*.*)\/[a-z0-9]{5,}\/*$)/;
        var filterSrv, querySrv;

        this.current = _.clone(_dash);
        this.last = {};

        $rootScope.$on('$routeChangeSuccess', function () {
            // Clear the current dashboard to prevent reloading
            self.current = {};
            self.indices = [];
            route();
        });

        var route = function () {
            // Is there a dashboard type and id in the URL?
            if (!(_.isUndefined($routeParams.kbnType)) && !(_.isUndefined($routeParams.kbnId))) {
                var _type = $routeParams.kbnType;
                var _id = $routeParams.kbnId;

                switch (_type) {
                    case ('elasticsearch'):
                        self.elasticsearch_load('dashboard', _id);
                        break;
                    case ('solr'):
                        self.elasticsearch_load('dashboard', _id);
                        break;
                    case ('temp'):
                        self.elasticsearch_load('temp', _id);
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
                if (Modernizr.localstorage && !(_.isUndefined(window.localStorage['dashboard'])) &&
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

        // Since the dashboard is responsible for index computation, we can compute and assign the indices
        // here before telling the panels to refresh
        this.refresh = function () {
            // Retrieve Solr collections for the dashboard
            kbnIndex.collections(self.current.solr.server).then(function (p) {
                if (DEBUG) {
                    console.debug('dashboard: kbnIndex.collections p = ', p);
                }
                if (p.length > 0) {
                    self.current.solr.core_list = p;
                } else {
                    // No collections returned from Solr
                    // Display alert only if USE_ADMIN_CORES flag in config.js is true.
                    if (config.USE_ADMIN_CORES) {
                        alertSrv.set('No collections', 'There were no collections returned from Solr.', 'info', 5000);
                    }
                }
            });

            if (self.current.index.interval !== 'none') {
                if (filterSrv.idsByType('time').length > 0) {
                    var _range = filterSrv.timeRange('min');
                    kbnIndex.indices(_range.from, _range.to,
                        self.current.index.pattern, self.current.index.interval
                    ).then(function (p) {
                        if (DEBUG) {
                            console.debug('dashboard: p = ', p);
                        }

                        if (p.length > 0) {
                            self.indices = p;
                        } else {
                            // Option to not failover
                            if (self.current.failover) {
                                self.indices = [self.current.index.default];
                            } else {
                                // Do not issue refresh if no indices match. This should be removed when panels
                                // properly understand when no indices are present
                                alertSrv.set('No results', 'There were no results because no indices were found that match your' +
                                    ' selected time span', 'info', 5000);
                                return false;
                            }
                        }

                        $rootScope.$broadcast('refresh');
                    });
                } else {
                    if (self.current.failover) {
                        self.indices = [self.current.index.default];
                        $rootScope.$broadcast('refresh');
                    } else {
                        alertSrv.set("No time filter",
                            'Timestamped indices are configured without a failover. Waiting for time filter.',
                            'info', 5000);
                    }
                }
            } else {
                self.indices = [self.current.index.default];
                $rootScope.$broadcast('refresh');
            }

            if (DEBUG) {
                console.debug('dashboard: after refresh', self);
            }
        };

        var dash_defaults = function (dashboard) {
            _.defaults(dashboard, _dash);
            _.defaults(dashboard.index, _dash.index);
            _.defaults(dashboard.loader, _dash.loader);
            // Solr
            _.defaults(dashboard.collection, _dash.collection);
            return dashboard;
        };

        this.dash_load = function (dashboard) {
            // Cancel all timers
            timer.cancel_all();

            // update browser window/tab title to reflect current dashboard's title
            document.title = dashboard.title;

            // Make sure the dashboard being loaded has everything required
            dashboard = dash_defaults(dashboard);

            // If not using time based indices, use the default index
            if (dashboard.index.interval === 'none') {
                self.indices = [dashboard.index.default];
            }

            self.current = _.clone(dashboard);

            // Ok, now that we've setup the current dashboard, we can inject our services
            querySrv = $injector.get('querySrv');
            filterSrv = $injector.get('filterSrv');

            // Make sure these re-init
            querySrv.init();
            filterSrv.init();

            // If there's an index interval set and no existing time filter, send a refresh to set one
            if (dashboard.index.interval !== 'none' && filterSrv.idsByType('time').length === 0) {
                self.refresh();
            }

            return true;
        };

        this.gist_id = function (string) {
            if (self.is_gist(string)) {
                return string.match(gist_pattern)[0].replace(/.*\//, '');
            }
        };

        this.is_gist = function (string) {
            if (!_.isUndefined(string) && string !== '' && !_.isNull(string.match(gist_pattern))) {
                return string.match(gist_pattern).length > 0 ? true : false;
            } else {
                return false;
            }
        };

        this.to_file = function () {
            var blob = new Blob([angular.toJson(self.current, true)], {type: "text/json;charset=utf-8"});
            // from filesaver.js
            window.saveAs(blob, self.current.title + "-" + new Date().getTime());
            return true;
        };

        this.set_default = function (dashboard) {
            if (Modernizr.localstorage) {
                window.localStorage['dashboard'] = angular.toJson(dashboard || self.current);
                $location.path('/dashboard');
                return true;
            } else {
                return false;
            }
        };

        this.purge_default = function () {
            if (Modernizr.localstorage) {
                window.localStorage['dashboard'] = '';
                return true;
            } else {
                return false;
            }
        };

        // TOFIX: Pretty sure this breaks when you're on a saved dashboard already
        this.share_link = function (title, type, id) {
            return {
                location: window.location.href.replace(window.location.hash, ""),
                type: type,
                id: id,
                link: window.location.href.replace(window.location.hash, "") + "#dashboard/" + type + "/" + id,
                title: title
            };
        };

        var renderTemplate = function (json, params) {
            var _r;
            _.templateSettings = {interpolate: /\{\{(.+?)\}\}/g};
            var template = _.template(json);
            var rendered = template({ARGS: params});
            try {
                _r = angular.fromJson(rendered);
            } catch (e) {
                _r = false;
            }
            return _r;
        };

        this.file_load = function (file) {
            return $http({
                url: "app/dashboards/" + file + '?' + new Date().getTime(),
                method: "GET",
                transformResponse: function (response) {
                    return renderTemplate(response, $routeParams);
                }
            }).then(function (result) {
                if (!result) {
                    return false;
                }
                self.dash_load(dash_defaults(result.data));
                return true;
            }, function () {
                alertSrv.set('Error', "Could not load <i>dashboards/" + file + "</i>. Please make sure it exists", 'error');
                return false;
            });
        };

        this.script_load = function (file) {
            return $http({
                url: "app/dashboards/" + file,
                method: "GET",
                transformResponse: function (response) {
                    /*jshint -W054 */
                    var _f = new Function('ARGS', 'kbn', '_', 'moment', 'window', 'document', 'angular', 'require', 'define', '$', 'jQuery', response);
                    return _f($routeParams, kbn, _, moment);
                }
            }).then(function (result) {
                if (!result) {
                    return false;
                }
                self.dash_load(dash_defaults(result.data));
                return true;
            }, function () {
                alertSrv.set('Error',
                    "Could not load <i>scripts/" + file + "</i>. Please make sure it exists and returns a valid dashboard",
                    'error');
                return false;
            });
        };

        // NOTES: Fusion uses Blob Store API now. No need to create system collection.
        // This function is only used for Fusion.
        // this.create_system_collection = function () {
        //   $http({
        //     url: "/api/apollo/collections/" + config.banana_index,
        //     method: "PUT",
        //     data: {}
        //     //TODO: handle params
        //   }).error(function (data, status) {
        //     console.log("Error creating system collection");
        //     console.log(status); //check to see if the collection exists or some other error
        //     console.log(data);
        //     //if it exists, that is fine
        //   }).success(function () {
        //     //console.log("Success creating collection");
        //     //console.log(data);
        //   });
        // };

        // Load a saved dashboard from Solr
        this.elasticsearch_load = function (type, id) {
          // For dashboard field, Fusion uses 'banana_dashboard_s', but Solr uses 'dashboard'
          var server = $routeParams.server + config.banana_index || config.solr + config.banana_index;
          var url = server + '/select?wt=json&q=' + self.TITLE_FIELD + ':"' + id + '"';
          var method = 'GET';

          if (config.USE_FUSION) {
            // Use Blob Store API to load the saved dashboard json.
            url = config.SYSTEM_BANANA_BLOB_API + '/' + id;
          }

          return $http({
            url: url,
            method: method,
            transformResponse: function (response) {
              response = angular.fromJson(response);
              var source_json = {};
              if (config.USE_FUSION) {
                source_json = angular.fromJson(response[0][self.DASHBOARD_FIELD]);
              } else {
                // Handle a case where the dashboard field is a multi-valued field (array).
                if (response.response.docs[0][self.DASHBOARD_FIELD] instanceof Array) {
                  source_json = angular.fromJson(response.response.docs[0][self.DASHBOARD_FIELD][0]);
                } else {
                  source_json = angular.fromJson(response.response.docs[0][self.DASHBOARD_FIELD]);
                }                
              }

              if (DEBUG) {
                console.debug('dashboard: type=', type, ' id=', id, ' response=', response, ' source_json=', source_json);
              }

              // return renderTemplate(angular.fromJson(response)._source.dashboard, $routeParams);
              // return renderTemplate(JSON.stringify(source_json.dashboard), $routeParams);
              return renderTemplate(JSON.stringify(source_json), $routeParams);
            }
          }).error(function (data, status) {
            if (status === 0) {
              alertSrv.set('Error', "Could not contact Solr at " + config.solr +
                ". Please ensure that Solr is reachable from your system.", 'error');
            } else {
              alertSrv.set('Error', 'Could not find dashboard named "' + id + '". Please ensure that the dashboard name is correct or exists in the system.', 'error');
            }
            return false;
          }).success(function (data) {
            self.dash_load(data);
          });
        };

        // Save a dashboard to Fusion or Solr
        this.elasticsearch_save = function (type, title, ttl) {
            // Clone object so we can modify it without influencing the existing obejct
            var save = _.clone(self.current);
            var id;
            var dashboard_user = self.current.username;
            var isPublic = false;

            // Change title on object clone
            if (type === 'dashboard') {
                id = save.title = _.isUndefined(title) ? self.current.title : title;
            }

            // Check if the dashboard is saved as a public dashboard (Make Public)
            if (self.current.loader.save_as_public) {
                isPublic = true;
            }

            // Create request with id as title.
            // var request = sjs.Document(config.banana_index, type, id).source({
            //   id: id,
            //   banana_user_s: dashboard_user,
            //   banana_group_s: 'none',
            //   banana_title_s: save.title,
            //   banana_dashboard_s: angular.toJson(save),
            //   is_public_b: isPublic
            // });
            var dashboardDoc = {};
            dashboardDoc.id = id;
            dashboardDoc[self.USER_FIELD] = dashboard_user;
            dashboardDoc[self.GROUP_FIELD] = 'none';
            dashboardDoc[self.TITLE_FIELD] = save.title;
            dashboardDoc[self.DASHBOARD_FIELD] = angular.toJson(save);
            if (config.USE_FUSION) {
                dashboardDoc.is_public_b = isPublic;
            }
            // Add SUBTYPE_PARAM to create metadata field in Blob to indicate that this is Banana dashboard object.
            var blobId = encodeURIComponent(dashboardDoc.id) + '?' + config.SYSTEM_BANANA_BLOB_ID_SUBTYPE_PARAM;

            var request = sjs.Document(config.banana_index, type, id).source(dashboardDoc);
            request = type === 'temp' && ttl ? request.ttl(ttl) : request;

            // For Fusion, set sjs.client.server to use Index Pipeline for saving the dashboard.
            var server = self.current.solr.server + config.banana_index || config.solr + config.banana_index;
            var dashboardUrl = '/dashboard/solr/' + title + '?server=' + self.current.solr.server;
            if (config.USE_FUSION) {
                // The index pipeline uses /index endpoint, which is different from Solr /update and accepts different params.
                // server = config.SYSTEM_BANANA_INDEX_PIPELINE;
                server = config.SYSTEM_BANANA_BLOB_API;
                dashboardUrl = '/dashboard/solr/' + title;
            }

            sjs.client.useFusion(config.USE_FUSION);
            sjs.client.server(server);

            return request.doIndex(
                config.USE_FUSION,
                blobId,
                function (success) {
                    if (type === 'dashboard') {
                        // Delay loading the newly saved dashboard by 2 sec
                        // in case it does not show up in Solr collection yet.
                        var ms = 2000;
                        $timeout(function () {
                            // $location.path('/dashboard/solr/' + title);
                            // $location.url('/dashboard/solr/' + title + '?server=' + self.current.solr.server);
                            $location.url(dashboardUrl);
                        }, ms);
                    }
                    return success;
                },
                function (error) {
                    console.log('Error: ', error);
                    return false;
                }
            );
        };

        this.elasticsearch_delete = function (id) {
            var server = self.current.solr.server + config.banana_index || config.solr + config.banana_index;
            // The index pipeline use /index endpoint, which is different from Solr (/update) and accepts different params.
            if (config.USE_FUSION) {
                // Fusion uses Blob Store API to manage saved dashboards.
                server = config.SYSTEM_BANANA_BLOB_API;
            }

            // Set sjs.client.server to use 'banana-int' for deleting dashboard
            sjs.client.useFusion(config.USE_FUSION);
            sjs.client.server(server);

            return sjs.Document(config.banana_index, 'dashboard', id).doDelete(
                config.USE_FUSION,
                // Success
                function (result) {
                    // NOTES:
                    // The result returned from Blob Store API (DELETE request) will be an empty string.
                    // Need to return the result in Solr json format, but for some reasons, when I tried
                    // to format the result and returned it here. It did not work. dashLoader.js would get
                    // an empty result. So I'll have to put this logic in dashLoader.js
                    //   result = {
                    //     responseHeader: {status: 0}
                    //   };
                    return result;
                },
                // Failure
                function () {
                    return false;
                }
            );
        };

        // Get a list of saved dashboards from Fusion or Solr
        this.elasticsearch_list = function (query, count) {
            var server = self.current.solr.server + config.banana_index || config.solr + config.banana_index;
            if (config.USE_FUSION) {
                // Use Blob Store API to list all dashboards
                return lucidworksSrv.getDashboardList(query);
            }

            sjs.client.server(server);
            var request = sjs.Request().indices(config.banana_index).types('dashboard');

            // Need to set sjs.client.server back to use 'logstash_logs' collection
            // But cannot do it here, it will interrupt other modules.
            // sjs.client.server(config.solr);

            return request.query(
                sjs.QueryStringQuery(query || '*:*')
            ).size(count).doSearch(
                function (success) {
                    return success;
                },
                function (error) {
                    console.log('Error: ', error);
                    return false;
                }
            );
        };

        this.save_gist = function (title, dashboard) {
            var save = _.clone(dashboard || self.current);
            save.title = title || self.current.title;
            return $http({
                url: "https://api.github.com/gists",
                method: "POST",
                data: {
                    "description": save.title,
                    "public": false,
                    "files": {
                        "kibana-dashboard.json": {
                            "content": angular.toJson(save, true)
                        }
                    }
                }
            }).then(function (data) {
                return data.data.html_url;
            }, function () {
                return false;
            });
        };

        this.gist_list = function (id) {
            return $http.jsonp("https://api.github.com/gists/" + id + "?callback=JSON_CALLBACK"
            ).then(function (response) {
                var files = [];
                _.each(response.data.data.files, function (v) {
                    try {
                        var file = JSON.parse(v.content);
                        files.push(file);
                    } catch (e) {
                        return false;
                    }
                });
                return files;
            }, function () {
                return false;
            });
        };

        this.numberWithCommas = function (x) {
            if (x) {
                return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
            } else {
                return x;
            }
        };

    });

});
