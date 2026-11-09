define([
    'angular',
    'jquery',
    'kbn',
    'underscore',
    'config',
    'moment',
    'modernizr',
    'components/dashboard-ids',
    'filesaver'
],
function (angular, $, kbn, _, config, moment, Modernizr, ids) {
    'use strict';

    var DEBUG = false; // DEBUG mode

    var module = angular.module('kibana.services');
    module.service('dashboard', function ($routeParams, $http, $rootScope, $injector, $location,
                                          sjsResource, timer, $timeout, kbnIndex, alertSrv, lucidworksSrv, $q) {
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

        // How long a save waits for the session user, and for each answer to its look-ups, before it gives up.
        var SESSION_WAIT_MS = 3000;
        var LOOKUP_TIMEOUT_MS = 10000;
        // The delay before a saved dashboard is opened (it may not show up in the collection at once).
        var OPEN_AFTER_SAVE_MS = 2000;

        // The logged-in user, asked of the Fusion session once. `sessionUser` stays undefined until it is known.
        var sessionPromise = null;
        var sessionUser;
        var startSession = function () {
            if (!sessionPromise) {
                sessionPromise = lucidworksSrv.getFusionUsername().then(function (username) {
                    sessionUser = username;
                    _dash.username = username;
                    return username;
                });
            }
            return sessionPromise;
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

            startSession();
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

                // Links that Banana writes for a saved dashboard carry its id encoded twice (see
                // dashboard-ids.js), and AngularJS decodes the address once, so the id is decoded once more here.
                // Only for the routes that load a saved dashboard: the file route names a path, and a second
                // decode there would let an address walk out of the dashboards folder.
                if (_type === 'solr' || _type === 'elasticsearch' || _type === 'temp') {
                    _id = ids.routeId(_id);
                }

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
                    default:
                        self.file_load(config.default_dashboard || 'default.json');
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
                    self.file_load(config.default_dashboard || 'default.json');
                }
            }
        };

        // Since the dashboard is responsible for index computation, we can compute and assign the indices
        // here before telling the panels to refresh
        this.refresh = function () {
            // Retrieve Solr collections for the dashboard
            var requested = self.current;
            kbnIndex.collections(self.current.solr.server).then(function (p) {
                if (DEBUG) {
                    console.debug('dashboard: kbnIndex.collections p = ', p);
                }
                // Opening another dashboard while this list loads replaces self.current, and the
                // dashboard that asked for the list is gone: there is nothing to give the list to.
                if (self.current !== requested) {
                    return;
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

        // Substitutes {{ARGS.name}} placeholders with the matching URL parameter and parses the result.
        // Only those placeholders are replaced, and each value is escaped for use inside a JSON string,
        // so a parameter cannot end the string it sits in. Any other {{...}} text is left as written:
        // nothing in a stored dashboard is evaluated as code. A parameter that is not set gives ''.
        var renderTemplate = function (json, params) {
            var _r;
            var rendered = String(json).replace(/\{\{\s*ARGS\.([A-Za-z_$][\w$]*)\s*\}\}/g, function (match, name) {
                var value = Object.prototype.hasOwnProperty.call(params || {}, name) ? params[name] : undefined;
                if (value === undefined || value === null) {
                    return '';
                }
                return JSON.stringify(String(value)).slice(1, -1);
            });
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
                alertSrv.set('Error', "Could not load <i>dashboards/" + kbn.escapeHtml(file) + "</i>. Please make sure it exists", 'error');
                return false;
            });
        };

        // Whether a "server" URL parameter may name the server a dashboard is loaded from. It is
        // accepted when it is a same-origin relative path (one slash, then not another slash or a
        // backslash; no backslash, whitespace or control character anywhere, because browsers drop or
        // rewrite those; and none of ? # & ;, because the value is joined to the rest of the request
        // without encoding and those would let a link write the query string or drop the end of it), when it equals the server Banana writes into the links it creates
        // (banana_server, or solr), or when it is listed in allowed_dashboard_servers.
        this.isAcceptableServer = function (server) {
          if (!_.isString(server) || server === '') {
            return false;
          }
          if (/^\/(?![\/\\])/.test(server) && !/[\\\x00-\x20\x7f?#&;]/.test(server)) {
            return true;
          }
          if (server === config.banana_server || server === config.solr) {
            return true;
          }
          return _.contains(config.allowed_dashboard_servers || [], server);
        };

        // The text of the dashboard in a stored record, or undefined when the answer holds none: a Fusion blob
        // answers a one-element array, a Solr select a result with documents. Never throws.
        var storedDashboardText = function (body, fusion) {
            var record;
            if (fusion) {
                record = _.isArray(body) && body.length > 0 ? body[0] : undefined;
            } else {
                var docs = body && body.response && body.response.docs;
                record = _.isArray(docs) ? docs[0] : undefined;
            }
            var text = record && record[self.DASHBOARD_FIELD];
            // Handle a case where the dashboard field is a multi-valued field (array).
            if (_.isArray(text)) {
                text = text[0];
            }
            return _.isString(text) ? text : undefined;
        };

        var parseJson = function (text) {
            try {
                return angular.fromJson(text);
            } catch (e) {
                return undefined;
            }
        };

        // Load a saved dashboard from Solr
        this.elasticsearch_load = function (type, id) {
          // For dashboard field, Fusion uses 'banana_dashboard_s', but Solr uses 'dashboard'
          // The server that holds the saved dashboards: the one named by the "server" URL parameter
          // when it is acceptable (see isAcceptableServer), otherwise the configured one. With Fusion
          // the URL below is replaced by the blob API, so the parameter is not used.
          var fusion = !!config.USE_FUSION;
          var configured_server = config.banana_server || config.solr;
          var requested_server = $routeParams.server;
          var server_base = configured_server;
          if (!fusion && !_.isUndefined(requested_server)) {
            if (self.isAcceptableServer(requested_server)) {
              server_base = requested_server;
            } else {
              alertSrv.set('Warning', 'Ignored the dashboard server <i>' + kbn.escapeHtml(String(requested_server)) +
                '</i> from the link and used the configured server instead. To allow it, add it to ' +
                '<i>allowed_dashboard_servers</i> in config.js.', 'warning');
            }
          }
          var server = server_base + config.banana_index;
          var method = 'GET';
          var url;

          if (fusion) {
            // Use Blob Store API to load the saved dashboard json. A title that the blob path cannot carry
            // names no stored dashboard: no request is sent.
            if (!ids.isStorableBlobId(id)) {
              alertSrv.set('Error', 'Could not open a dashboard named "' + kbn.escapeHtml(id) + '": ' +
                kbn.escapeHtml(ids.blobIdProblem(id)), 'error');
              return $q.reject({ reason: 'invalid-title' });
            }
            url = config.SYSTEM_BANANA_BLOB_API + '/' + ids.blobSegment(id);
          } else {
            url = server + '/select?wt=json&q=' +
              encodeURIComponent(self.TITLE_FIELD + ':' + ids.solrPhrase(id));
          }

          var notFound = function () {
            alertSrv.set('Error', 'Could not find dashboard named "' + kbn.escapeHtml(id) + '". Please ensure that the dashboard name is correct or exists in the system.', 'error');
          };

          return $http({
            url: url,
            method: method,
            // Never throws: it returns the dashboard when the body holds one and the body as it came otherwise
            // (it also runs on the body of an error answer).
            transformResponse: function (response) {
              var body = parseJson(response);
              var text = storedDashboardText(body, fusion);
              var source_json = _.isUndefined(text) ? undefined : parseJson(text);
              if (_.isUndefined(source_json)) {
                return response;
              }

              if (DEBUG) {
                console.debug('dashboard: type=', type, ' id=', id, ' response=', body, ' source_json=', source_json);
              }

              // return renderTemplate(angular.fromJson(response)._source.dashboard, $routeParams);
              // return renderTemplate(JSON.stringify(source_json.dashboard), $routeParams);
              return renderTemplate(JSON.stringify(source_json), $routeParams);
            }
          }).error(function (data, status) {
            if (status === 0) {
              alertSrv.set('Error', "Could not contact Solr at " + kbn.escapeHtml(config.solr) +
                ". Please ensure that Solr is reachable from your system.", 'error');
            } else {
              notFound();
            }
            return false;
          }).success(function (data) {
            // A 2xx whose body holds no dashboard (a 204, a result with no document) is a dashboard that is not there.
            if (!_.isObject(data) || _.isArray(data)) {
              notFound();
              return;
            }
            self.dash_load(data);
          });
        };

        // A save or a delete that wrote nothing rejects with one of these: `reason` says why, `message` is plain text.
        var refusal = function (reason, message) {
            return $q.reject({ reason: reason, message: message });
        };

        var lastStamp = 0;
        // A number that is larger on every call: it makes the address of a Solr look-up differ from the last one.
        var nextStamp = function () {
            lastStamp = Math.max(new Date().getTime(), lastStamp + 1);
            return lastStamp;
        };

        // The first line of a stored owner text; '' when there is none.
        var firstLine = function (text) {
            return _.isString(text) ? text.split(/\r\n|\r|\n/)[0] : '';
        };

        // Wait for the session user of a Fusion save. A session that does not answer in time gives 'guest', as it
        // did in 1.6.30 when the answer came too late. A session with no user name is also 'guest'.
        var waitForSessionUser = function () {
            if (!_.isUndefined(sessionUser)) {
                return $q.when(sessionUser);
            }
            var deferred = $q.defer();
            var settled = false;
            var timer = $timeout(function () {
                if (!settled) {
                    settled = true;
                    deferred.resolve('guest');
                }
            }, SESSION_WAIT_MS);
            var answer = function (username) {
                if (!settled) {
                    settled = true;
                    $timeout.cancel(timer);
                    deferred.resolve(username || 'guest');
                }
            };
            startSession().then(answer, function () { answer('guest'); });
            return deferred.promise;
        };

        // Reads what is stored under the title, with $http and the address captured when the user clicked Save,
        // never through the shared Solr client (whose server is re-pointed by every panel query).
        // Resolves with { state: 'free' }, { state: 'exists', owner, text, version } or { state: 'foreign' } (something
        // that is not a Banana dashboard is stored there). Rejects with a 'cannot-check' refusal for every other
        // answer, including a resolved `undefined`, which is what a 401 gives while the browser goes to the login page.
        var lookup = function (plan) {
            var cannotCheck = function () {
                return refusal('cannot-check', 'Could not check whether a dashboard with this title already exists, so nothing was written.');
            };
            var request = {
                method: 'GET',
                url: plan.fusion ? plan.blobUrl : plan.lookupUrl(),
                timeout: LOOKUP_TIMEOUT_MS,
                // the answer is read here as text: a body that does not parse is "cannot check", not an exception
                transformResponse: function (data) { return data; }
            };
            if (plan.fusion) {
                // Fusion: a header keeps a cache from answering the second look-up with the first answer.
                // Solr: a header that is not a standard one makes a cross-origin Solr answer a preflight, so the
                // address carries a changing parameter instead.
                request.headers = { 'Cache-Control': 'no-cache' };
            }
            return $http(request).then(function (response) {
                if (_.isUndefined(response) || !response) {
                    return cannotCheck();
                }
                var body = parseJson(response.data);
                if (response.status === 204) {
                    return { state: 'foreign' };
                }
                if (response.status !== 200 || _.isUndefined(body)) {
                    return cannotCheck();
                }
                if (plan.fusion) {
                    if (_.isArray(body) && body.length === 1 && body[0] && _.isString(body[0][self.DASHBOARD_FIELD])) {
                        return { state: 'exists', owner: body[0][self.USER_FIELD], text: response.data, version: response.data };
                    }
                    return { state: 'foreign' };
                }
                var docs = body && body.response && body.response.docs;
                if (!_.isArray(docs)) {
                    return cannotCheck();
                }
                if (docs.length === 0) {
                    return { state: 'free' };
                }
                var doc = docs[0];
                var owner = _.isArray(doc[self.USER_FIELD]) ? doc[self.USER_FIELD][0] : doc[self.USER_FIELD];
                var text = _.isArray(doc[self.DASHBOARD_FIELD]) ? doc[self.DASHBOARD_FIELD][0] : doc[self.DASHBOARD_FIELD];
                return { state: 'exists', owner: owner, text: text, version: doc._version_ };
            }, function (error) {
                // Only the blob store's own "no such blob" answer means the title is free.
                var body = error && error.status === 404 ? parseJson(error.data) : undefined;
                if (plan.fusion && body && body.error === 'BLOB-0001') {
                    return { state: 'free' };
                }
                return cannotCheck();
            });
        };

        // The same stored dashboard as the one the user was shown? Fusion: the whole answer. Solr: the version
        // number, the dashboard text and the owner (the owner alone is not enough, it is 'guest' for everyone).
        var sameRecord = function (first, second) {
            return first.state === 'exists' && second.state === 'exists' &&
                first.owner === second.owner && first.text === second.text && first.version === second.version;
        };

        // The question that the dialog of an overwrite asks, as plain text (it is not HTML, so nothing is escaped).
        // `existing` is { title, owner, byYou }: the title, the first line of the stored owner text ('' when there is
        // none) and whether the stored owner is the logged-in user.
        this.overwriteQuestion = function (existing) {
            var who = existing.byYou ? 'you' : (existing.owner || 'an unknown user');
            return 'A dashboard named "' + existing.title + '" already exists. It was saved by ' + who +
                '. Saving replaces it, and the earlier version cannot be restored. Replace it?';
        };

        // Save a dashboard to Fusion or Solr.
        //
        // The promise resolves only after the write succeeded. Every outcome that writes nothing rejects with
        // { reason, message }: 'invalid-title', 'cannot-check', 'not-a-dashboard', 'declined', 'changed'. A failed
        // write rejects with the HTTP response, as before.
        //
        // When the title is already taken, `confirmOverwrite` (a function that receives { title, owner, byYou } and
        // returns true to replace the stored dashboard) is asked first; without one, an overwrite is refused.
        //
        // The save reads everything it needs when it is called (the mode, the dashboard, the title, the addresses):
        // the route can replace the current dashboard and the settings can change the mode while it waits.
        this.elasticsearch_save = function (type, title, ttl, confirmOverwrite) {
            var fusion = !!config.USE_FUSION;
            var current = self.current;
            // A deep copy: what is saved is what was on the screen at the click
            var save = angular.copy(current);
            var id;
            var isPublic = !!(current.loader && current.loader.save_as_public);
            var index = config.banana_index;
            var startUrl = $location.url();

            // Change title on object clone
            if (type === 'dashboard') {
                id = save.title = _.isUndefined(title) ? current.title : title;
            }

            // For Fusion, the blob API; otherwise the collection of saved dashboards on the banana server.
            var banana_server = config.banana_server || (current.solr && current.solr.server) || config.solr;
            var plan = {
                fusion: fusion,
                blobApi: config.SYSTEM_BANANA_BLOB_API,
                server: banana_server + index
            };
            var dashboardUrl;
            if (fusion) {
                dashboardUrl = '/dashboard/solr/' + ids.linkId(id);
            } else {
                dashboardUrl = '/dashboard/solr/' + ids.linkId(id) + '?server=' + banana_server;
            }

            // Validate the title: an overwrite check needs a title that names exactly one stored dashboard.
            var problem = fusion ? ids.blobIdProblem(id) : ((_.isString(id) && id !== '') ? null : 'The title is empty.');
            if (problem) {
                return refusal('invalid-title', problem);
            }

            if (fusion) {
                // Add SUBTYPE_PARAM to create metadata field in Blob to indicate that this is Banana dashboard object.
                plan.blobUrl = plan.blobApi + '/' + ids.blobSegment(id);
                plan.blobId = ids.blobSegment(id) + '?' + config.SYSTEM_BANANA_BLOB_ID_SUBTYPE_PARAM;
            } else {
                plan.lookupUrl = function () {
                    return plan.server + '/select?wt=json&rows=1&fl=' +
                        ['id', self.USER_FIELD, self.DASHBOARD_FIELD, '_version_'].join(',') +
                        '&q=' + encodeURIComponent('id:' + ids.solrPhrase(id)) + '&_=' + nextStamp();
                };
            }

            // The owner label of a Solr save is what 1.6.30 wrote: the value in the dashboard JSON.
            var solrOwner = current.username;

            // The write. Nothing asynchronous happens between setting the shared client and using it, and the
            // client is set from the values captured above, whatever other code did to it while the save waited.
            var write = function (owner) {
                if (fusion) {
                    save.username = owner;
                } else {
                    owner = solrOwner;
                }
                var dashboardDoc = {};
                dashboardDoc.id = id;
                dashboardDoc[self.USER_FIELD] = owner;
                dashboardDoc[self.GROUP_FIELD] = 'none';
                dashboardDoc[self.TITLE_FIELD] = save.title;
                dashboardDoc[self.DASHBOARD_FIELD] = angular.toJson(save);
                if (fusion) {
                    dashboardDoc.is_public_b = isPublic;
                }

                var request = sjs.Document(index, type, id).source(dashboardDoc);
                request = type === 'temp' && ttl ? request.ttl(ttl) : request;

                sjs.client.useFusion(fusion);
                sjs.client.server(fusion ? plan.blobApi : plan.server);

                return request.doIndex(
                    fusion,
                    plan.blobId,
                    function (success) {
                        if (type === 'dashboard') {
                            // Delay loading the newly saved dashboard by 2 sec
                            // in case it does not show up in Solr collection yet.
                            // Not if the user has gone to another dashboard meanwhile.
                            $timeout(function () {
                                if ($location.url() === startUrl) {
                                    $location.url(dashboardUrl);
                                }
                            }, OPEN_AFTER_SAVE_MS);
                        }
                        return success;
                    },
                    function (error) {
                        console.log('Error: ', error);
                        return false;
                    }
                );
            };

            var ownerStep = fusion ? waitForSessionUser() : $q.when(solrOwner);

            return ownerStep.then(function (owner) {
                return lookup(plan).then(function (found) {
                    if (found.state === 'free') {
                        return write(owner);
                    }
                    if (found.state === 'foreign') {
                        return refusal('not-a-dashboard', 'Something that is not a Banana dashboard is stored under this title, so nothing was written.');
                    }

                    var storedOwner = firstLine(found.owner);
                    var realUser = fusion && !_.isUndefined(sessionUser) && sessionUser !== 'guest';
                    var replace = false;
                    if (_.isFunction(confirmOverwrite)) {
                        try {
                            replace = confirmOverwrite({
                                title: id,
                                owner: storedOwner,
                                byYou: realUser && storedOwner !== '' && storedOwner === sessionUser
                            });
                        } catch (e) {
                            replace = false;
                        }
                    }
                    if (replace !== true) {
                        return refusal('declined', 'The existing dashboard was left as it was.');
                    }

                    // Look again: what the user was shown must still be what is stored.
                    return lookup(plan).then(function (again) {
                        if (again.state === 'free') {
                            return write(owner);
                        }
                        if (!sameRecord(found, again)) {
                            return refusal('changed', 'The dashboard changed while you were deciding, so nothing was written.');
                        }
                        return write(owner);
                    });
                });
            });
        };

        // Delete a saved dashboard. The id comes from a row of the list of saved dashboards.
        // The promise resolves only when the dashboard was deleted: a refusal, an error answer, and a resolved
        // `undefined` (a 401: the browser is going to the login page) all reject, so a caller cannot report them as done.
        this.elasticsearch_delete = function (id) {
            var fusion = !!config.USE_FUSION;
            var banana_server = config.banana_server || (self.current.solr && self.current.solr.server) || config.solr;
            var index = config.banana_index;
            var server = banana_server + index;
            // The index pipeline use /index endpoint, which is different from Solr (/update) and accepts different params.
            if (fusion) {
                // Fusion uses Blob Store API to manage saved dashboards.
                server = config.SYSTEM_BANANA_BLOB_API;
            }

            var problem = fusion ? ids.blobIdProblem(id) : ((_.isString(id) && id !== '') ? null : 'The title is empty.');
            if (problem) {
                return refusal('invalid-id', problem);
            }

            // Set sjs.client.server to use 'banana-int' for deleting dashboard
            sjs.client.useFusion(fusion);
            sjs.client.server(server);

            return sjs.Document(index, 'dashboard', id).doDelete(
                fusion,
                // Success
                function (result) {
                    // NOTES:
                    // The result returned from Blob Store API (DELETE request) will be an empty string.
                    return result;
                },
                // Failure
                function () {
                    return false;
                }
            ).then(function (result) {
                if (_.isUndefined(result)) {
                    return refusal('no-answer', 'The server did not confirm the delete.');
                }
                return result;
            });
        };

        // Get a list of saved dashboards from Fusion or Solr
        this.elasticsearch_list = function (query, count) {
            var banana_server = config.banana_server || self.current.solr.server || config.solr;
            var server = banana_server + config.banana_index;
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

      /**
       * Escape the given HTML string.
       *
       * @param html_str
       * @returns {*|void|string}
       */
        this.escapeHtml = function(html_str) {
          return html_str.replace(/[&<>"]/g, function(tag) {
            var chars_to_replace = {
              '&': '&amp;',
              '<': '&lt;',
              '>': '&gt;',
              '"': '&quot;',
              "'": '&#39;',
              '/': '&#x2F;',
              '`': '&#x60;',
              '=': '&#x3D;'
            };

            return chars_to_replace[tag] || tag;
          });
        };
    });

});
