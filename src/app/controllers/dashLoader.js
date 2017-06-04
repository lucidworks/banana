define([
    'angular',
    'underscore',
    'config'
],
function (angular, _, config) {
    'use strict';

    var module = angular.module('kibana.controllers');

    module.controller('dashLoader', function ($scope, $http, timer, dashboard, alertSrv) {
        var self = this;
        // Solr and Fusion uses different field names for their schema.
        // Solr uses banana-int collection, and Fusion uses system_banana collection.
        self.TITLE_FIELD = 'title';
        self.DASHBOARD_FIELD = 'dashboard';
        self.USER_FIELD = 'user';
        self.GROUP_FIELD = 'group';

        // NOTES: Fusion uses Blob Store API now, so it does not need TITLE_FIELD for querying dashboards.
        // If USE_FUSION, change the schema field names and banana_index setting.
        // Also, get the login username and store it.
        if (config.USE_FUSION) {
            config.banana_index = 'system_banana';
            self.TITLE_FIELD = 'banana_title_s';
            self.DASHBOARD_FIELD = 'banana_dashboard_s';
            self.USER_FIELD = 'banana_user_s';
            self.GROUP_FIELD = 'banana_group_s';
        }

        $scope.getTitleField = function getTitleField() {
            return self.TITLE_FIELD;
        };

        $scope.loader = dashboard.current.loader;

        $scope.init = function () {
            $scope.gist_pattern = /(^\d{5,}$)|(^[a-z0-9]{10,}$)|(gist.github.com(\/*.*)\/[a-z0-9]{5,}\/*$)/;
            $scope.gist = $scope.gist || {};
            $scope.elasticsearch = $scope.elasticsearch || {};
            $scope.resetNewDefaults();
            // $scope.elasticsearch is used throught out this file, dashLoader.html and others.
            // So we'll keep using it for now before refactoring it to $scope.solr.
            // $scope.solr = $scope.solr || {};

            // Pagination
            $scope.loadMenu = {
                currentPage: 1,    // Current active page in the pager.
                firstPageShown: 1, // First page number that is shown in the pager.
                lastPageShown: 5,  // Last page number that is shown in the pager.
                totalPages: 5,     // total number of pages needed to display all saved dashboards:
                                   // = Math.ceil(total_num_of_saved_dashboards / dashboard.current.loader.load_elasticsearch_size)
                maxShownPages: 5,  // Hard coded value. The maximum number of pages to be shown in the pager.
                pages: [],  // Example pages obj => {offset: 0, number: 1, state: 'active'}
                backwardButtonState: 'disabled',
                forwardButtonState: 'disabled'
            };

            $scope.elasticsearch.query = '';  // query for filtering the dashboard list
        };

        // This function should be replaced by one-way binding feature of AngularJS 1.3
        $scope.resetNewDefaults = function () {
            $scope.new = {
                server: $scope.config.solr,
                core_name: $scope.config.solr_core,
                time_field: $scope.config.timefield,
                USE_FUSION: $scope.config.USE_FUSION
            };
        };

        $scope.showDropdown = function (type) {
            // var _l = $scope.loader;
            var _l = dashboard.current.loader || $scope.loader;

            if (type === 'new') {
                return (_l.load_elasticsearch || _l.load_gist || _l.load_local);
            }
            if (type === 'load') {
                return (_l.load_elasticsearch || _l.load_gist || _l.load_local);
            }
            if (type === 'save') {
                return (_l.save_elasticsearch || _l.save_gist || _l.save_local || _l.save_default);
            }
            if (type === 'share') {
                return (_l.save_temp);
            }
            if(type === 'home') {
                return (dashboard.current.home || $scope.home);
            }  

            return false;
        };

        $scope.create_new = function (type) {
            $http.get('app/dashboards/' + type + '.json?' + new Date().getTime()).success(function (data) {
                data.solr.server = $scope.new.server;
                data.solr.core_name = $scope.new.core_name;
                // If time series dashboard, update all timefield references in the default dashboard
                if (type === 'default-ts') {
                    data.services.filter.list[0].field = $scope.new.time_field;
                    // Iterate over panels and update timefield
                    for (var i = 0; i < data.rows.length; i++) {
                        for (var j = 0; j < data.rows[i].panels.length; j++) {
                            if (data.rows[i].panels[j].timefield) {
                                data.rows[i].panels[j].timefield = $scope.new.time_field;
                            } else if (data.rows[i].panels[j].time_field) {
                                data.rows[i].panels[j].time_field = $scope.new.time_field;
                            }
                        }
                    }
                }

                dashboard.dash_load(data);

                // Reset new dashboard defaults
                $scope.resetNewDefaults();
            }).error(function () {
                alertSrv.set('Error', 'Unable to load default dashboard', 'error');
            });
        };

        $scope.set_default = function () {
            if (dashboard.set_default()) {
                alertSrv.set('Local Default Set', dashboard.current.title + ' has been set as your local default', 'success', 5000);
            } else {
                alertSrv.set('Incompatible Browser', 'Sorry, your browser is too old for this feature', 'error', 5000);
            }
        };

        $scope.purge_default = function () {
            if (dashboard.purge_default()) {
                alertSrv.set('Local Default Clear', 'Your local default dashboard has been cleared', 'success', 5000);
            } else {
                alertSrv.set('Incompatible Browser', 'Sorry, your browser is too old for this feature', 'error', 5000);
            }
        };

        $scope.elasticsearch_save = function (type, ttl) {
            dashboard.elasticsearch_save(
                type,
                ($scope.elasticsearch.title || dashboard.current.title),
                ($scope.loader.save_temp_ttl_enable ? ttl : false)
            ).then(function (result) {
                alertSrv.set('Dashboard Saved', 'This dashboard has been saved to Solr as "' +
                    ($scope.elasticsearch.title || dashboard.current.title) + '"', 'success', 5000);
                if (type === 'temp') {
                    $scope.share = dashboard.share_link(dashboard.current.title, 'temp', result.response.docs[0].id);
                }
                $scope.elasticsearch.title = '';
            }, function (error) {
                console.log('ERROR: ' + error);
                alertSrv.set('Save failed', 'Dashboard could not be saved to Solr', 'error', 5000);
            });
        };

        $scope.elasticsearch_delete = function (id) {
            dashboard.elasticsearch_delete(id).then(
                function (result) {
                    if (config.USE_FUSION) {
                        // The result returned from Blob Store API (DELETE request) will be an empty string.
                        // Need to return the result in Solr json format.
                        result = {
                          responseHeader: {status: 0}
                        };
                    }

                    if (!_.isUndefined(result)) {
                        if (result.responseHeader.status === 0) {
                            alertSrv.set('Dashboard Deleted', id + ' has been deleted', 'success', 5000);
                            // Find the deleted dashboard in the cached list and remove it
                            var toDelete = _.where($scope.elasticsearch.dashboards, {id: id})[0];
                            $scope.elasticsearch.dashboards = _.without($scope.elasticsearch.dashboards, toDelete);
                        } else {
                            alertSrv.set('Dashboard Not Found', 'Could not find ' + id + ' in Solr', 'warning', 5000);
                        }
                    } else {
                        alertSrv.set('Dashboard Not Deleted', 'An error occurred deleting the dashboard', 'error', 5000);
                    }
                }
            );
        };

        $scope.elasticsearch_dblist = function (query) {
            dashboard.elasticsearch_list(query, dashboard.current.loader.load_elasticsearch_size).then(
                function (result) {
                    if (!_.isUndefined(result.response.docs)) {
                        $scope.hits = result.response.numFound;
                        $scope.elasticsearch.dashboards = parseDashboardList(result.response.docs);

                        // Handle pagination
                        $scope.loadMenu.totalPages = Math.ceil($scope.hits / dashboard.current.loader.load_elasticsearch_size);
                        var pages = [];
                        for (var j = 0; j < $scope.loadMenu.totalPages; j++) {
                            pages.push({
                                offset: j * dashboard.current.loader.load_elasticsearch_size,
                                number: j + 1,
                                state: ''
                            });
                        }

                        $scope.loadMenu.pages = pages;
                        $scope.loadMenu.currentPage = 1;
                        if ($scope.loadMenu.pages.length > 0) {
                          $scope.loadMenu.pages[0].state = 'active';
                        }

                        if ($scope.loadMenu.totalPages > $scope.loadMenu.maxShownPages) {
                            $scope.loadMenu.forwardButtonState = '';
                        } else {
                            $scope.loadMenu.forwardButtonState = 'disabled';
                            $scope.loadMenu.backwardButtonState = 'disabled';
                        }
                    }
                });
        };

        // Get the dashboard list for the specified pageNum
        $scope.getSavedDashboard = function (event, query, offset, pageNum) {
            // To stop dropdown-menu from disappearing after click
            event.stopPropagation();

            // Fusion uses Blob Store API, so Solr query will not work here.
            if (config.USE_FUSION) {
                query = query || ''; 
            } else {
                // TODO: getTitleField() + ':' + elasticsearch.query + '*'
                // query += '&start=' + offset;
                query = $scope.getTitleField() + ':' + query + '*&start=' + offset;
            }

            dashboard.elasticsearch_list(query, dashboard.current.loader.load_elasticsearch_size).then(
                function (result) {
                    if (!_.isUndefined(result.response.docs)) {
                        $scope.hits = result.response.numFound;
                        // Get the list according to pageNum (paging).
                        var startIndex = offset;
                        var endIndex = offset + dashboard.current.loader.load_elasticsearch_size;
                        $scope.elasticsearch.dashboards = parseDashboardList(result.response.docs).slice(startIndex, endIndex);
                    }
                }
            );

            if (pageNum >= 1) {
                $scope.loadMenu.pages[$scope.loadMenu.currentPage-1].state = '';
                $scope.loadMenu.pages[pageNum-1].state = 'active';
                $scope.loadMenu.currentPage = pageNum;
            }
        };

        $scope.getPrevSavedDashboard = function (event) {
            // To stop dropdown-menu from disappearing after click
            event.stopPropagation();

            if ($scope.loadMenu.firstPageShown !== 1) {
                var newFirstPage = $scope.loadMenu.firstPageShown - $scope.loadMenu.maxShownPages;
                $scope.loadMenu.forwardButtonState = '';

                if (newFirstPage <= 1) {
                    $scope.loadMenu.firstPageShown = 1;
                    $scope.loadMenu.lastPageShown = $scope.loadMenu.maxShownPages;
                    $scope.loadMenu.backwardButtonState = 'disabled';
                } else {
                    $scope.loadMenu.firstPageShown = newFirstPage;
                    $scope.loadMenu.lastPageShown = newFirstPage + $scope.loadMenu.maxShownPages - 1;
                }
            } else {
                $scope.loadMenu.backwardButtonState = 'disabled';
            }
        };

        $scope.getNextSavedDashboard = function (event) {
            // To stop dropdown-menu from disappearing after click
            event.stopPropagation();

            if ($scope.loadMenu.lastPageShown !== $scope.loadMenu.totalPages) {
                var newLastPage = $scope.loadMenu.lastPageShown + $scope.loadMenu.maxShownPages;
                $scope.loadMenu.firstPageShown = $scope.loadMenu.lastPageShown + 1;
                $scope.loadMenu.backwardButtonState = '';

                if (newLastPage >= $scope.loadMenu.totalPages) {
                    $scope.loadMenu.lastPageShown = $scope.loadMenu.totalPages;
                    $scope.loadMenu.forwardButtonState = 'disabled';
                } else {
                    $scope.loadMenu.lastPageShown = newLastPage;
                }
            } else {
                $scope.loadMenu.forwardButtonState = 'disabled';
            }
        };

        $scope.save_gist = function () {
            dashboard.save_gist($scope.gist.title).then(
                function (link) {
                    if (!_.isUndefined(link)) {
                        $scope.gist.last = link;
                        alertSrv.set('Gist saved', 'You will be able to access your exported dashboard file at ' +
                            '<a href="' + link + '">' + link + '</a> in a moment', 'success');
                    } else {
                        alertSrv.set('Save failed', 'Gist could not be saved', 'error', 5000);
                    }
                });
        };

        $scope.gist_dblist = function (id) {
            dashboard.gist_list(id).then(
                function (files) {
                    if (files && files.length > 0) {
                        $scope.gist.files = files;
                    } else {
                        alertSrv.set('Gist Failed', 'Could not retrieve dashboard list from gist', 'error', 5000);
                    }
                });
        };

        function parseDashboardList(dashboardList) {
            var docs = [];
            for (var i=0; i < dashboardList.length; i++) {
                var doc = {};
                if (config.USE_FUSION) {
                  doc.id = dashboardList[i].name;
                  // Don't need doc.server for Fusion Blob Store API.
                  doc.server = '';
                } else {
                  doc.id = dashboardList[i].id;
                  // Handle a case where the dashboard field is a multi-valued field (array).
                  if (dashboardList[i][self.DASHBOARD_FIELD] instanceof Array) {
                    doc.server = angular.fromJson(dashboardList[i][self.DASHBOARD_FIELD][0]).solr.server;
                  } else {
                    doc.server = angular.fromJson(dashboardList[i][self.DASHBOARD_FIELD]).solr.server;
                  }                  
                }
                docs.push(doc);
            }

            return docs;
        }
    });
});
