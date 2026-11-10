# Defaults, and how they differ from release 1.6.30

This page lists every configuration key Banana reads, the value it has when you change nothing, the value release 1.6.30
had, and the decision record behind any difference. Release 1.6.30 is the version that Lucidworks Fusion 5.9 ships, so
it is the reference: a difference is either a restored 1.6.30 behaviour, a new option whose default behaves like
1.6.30, or a change that has its own record. The decision records are indexed in [adr/README.md](adr/README.md).

"New" means the key does not exist in 1.6.30. "Removed" means 1.6.30 had it and it is gone. A dash in the 1.6.30 column
means there is no such value. The records are cited as ADR 0006 and so on.

The values were read from `src/config.js`, `src/config.solr.js`, `src/app/components/settings.js`, the panel modules
and `docker/banana-entrypoint`, and compared with the same files at the commit of release 1.6.30
(`76a7d3f4b9d8f69a74ee714d5de2ad4889499068`; for example `git show 76a7d3f:src/config.js`). The checks in
`test/node/default-config.test.js` hold the 1.6.30 values of the configuration keys and fail when `config.js`, the Solr
preset or the fallbacks in `settings.js` drift.

## How settings are read

`config.js` is a plain file in the deployed directory that an operator can edit or replace without a rebuild. It lists
the keys it wants to set. `settings.js` supplies a fallback for every key that `config.js` leaves out, and drops any key
it has no fallback for, so a new setting needs a fallback in `settings.js`. Since ADR 0006 the fallbacks equal the values
that `config.js` ships (Fusion), where in 1.6.30 two of them pointed at a local Solr. The Solr preset is a second file,
`config.solr.js`, that an operator copies over `config.js`.

## 1. `config.js`: the shipped Fusion defaults

| Key | Default now | 1.6.30 | Difference | Record |
|---|---|---|---|---|
| `solr` | `"/api/query-pipelines/_system/collections/"` | same | none (the comment now says the value is a relative path) | ADR 0006 |
| `solr_core` | `"system_logs"` | same | none | |
| `timefield` | `"timestamp_tdt"` | same | none | |
| `banana_index` | `"system_banana"` | same | none. With `USE_FUSION` true the code still forces it to `system_banana`, as in 1.6.30 | |
| `default_dashboard` | `"default.json"` | - (the file name was fixed in the code) | **new**; the default loads the same file 1.6.30 loaded | ADR 0006 |
| `banana_server` | not set (a commented example) | not set | none in `config.js`. In 1.6.30 setting it had no effect because `settings.js` dropped it; it now takes effect (see section 3) | ADR 0006 |
| `allowed_dashboard_servers` | `[]` | - | **new**; only matters when `USE_FUSION` is false | ADR 0021 |
| `USE_FUSION` | `true` | same | none | ADR 0006 |
| `apollo` | `"/api"` | same | none | |
| `apollo_queryPipeline` | `"/api/query-pipelines/"` | same | none | |
| `apollo_indexPipeline` | `"/api/index-pipelines/"` | same | none | |
| `SYSTEM_BANANA_QUERY_PIPELINE` | `"/api/query-pipelines/default/collections/system_banana"` | same | none | |
| `SYSTEM_BANANA_INDEX_PIPELINE` | `"/api/index-pipelines/_system/collections/system_banana"` | same | none | |
| `SYSTEM_BANANA_BLOB_API` | `"/api/blobs"` | same | none | |
| `SYSTEM_BANANA_BLOB_ID_SUBTYPE_PARAM` | `"resourceType=banana"` | same | none | |
| `SYSTEM_BANANA_BLOB_ID_SUBTYPE_QUERY` | `"resourceType=banana"` | same | none | |
| `FUSION_API_STATIC_FIELDS` | `"/schema/fields"` | same | none | |
| `FUSION_API_DYNAMIC_FIELDS` | `"/schema/dynamicfields"` | same | none | |
| `FUSION_API_COLLECTIONS` | `"/api/collections"` | same | none | |
| `USE_ADMIN_LUKE` | `true` | same | none | |
| `USE_ADMIN_CORES` | `true` | same | none | |
| `panel_names` | the 1.6.30 list plus `graph`, `significantTerms`, `timeseries`, `sankey`, `force`, `boxplot` | `bar`, `histogram`, `map`, `table`, `filtering`, `timepicker`, `text`, `hits`, `column`, `ticker`, `bettermap`, `query`, `terms`, `rangeFacet`, `heatmap`, `scatterplot`, `fullTextSearch`, `facet`, `tagcloud`, `multiseries`, `sunburst`, `docviewer` | six entries added, so six more panel types in the "add panel" list; no panel was removed, and existing dashboards are unaffected | ADR 0006 (the first five), ADR 0031 (`boxplot`), ADR 0019 (how the three stream panels send requests) |

Removed keys: none. The two `FUSION_LOGIN_URL` and `FUSION_SESSION_API` keys of section 3 are not listed in `config.js`; an
operator can add them there.

## 2. `config.solr.js`: the Solr preset (new file)

The file does not exist in 1.6.30. It equals `config.js` except for these keys, which reproduce the standalone-Solr
configuration of the unreleased development line. Selecting it is a copy over `config.js` (ADR 0006, ADR 0007).

| Key | Preset value | Value in `config.js` | Record |
|---|---|---|---|
| `solr` | `"/solr/"` | `"/api/query-pipelines/_system/collections/"` | ADR 0006 |
| `solr_core` | `"logs"` | `"system_logs"` | ADR 0006 |
| `banana_index` | `"banana-int"` | `"system_banana"` | ADR 0006 |
| `default_dashboard` | `"default.solr.json"` | `"default.json"` | ADR 0006 |
| `USE_FUSION` | `false` | `true` | ADR 0006 |

`panel_names` in the preset is the same list as in `config.js`. `default.solr.json` is a new dashboard file; `default.json`
is unchanged from 1.6.30.

## 3. `settings.js`: the fallbacks for keys `config.js` leaves out

| Key | Fallback now | 1.6.30 | Difference | Record |
|---|---|---|---|---|
| `solr` | `"/api/query-pipelines/_system/collections/"` | `"http://" + window.location.hostname + ":8983/solr/"` | changed to match `config.js`. Only matters for a `config.js` that omits the key | ADR 0006 |
| `solr_core` | `"system_logs"` | `"logs"` | changed to match `config.js`. Same condition | ADR 0006 |
| `timefield` | `"timestamp_tdt"` | same | none | |
| `USE_ADMIN_LUKE` | `true` | same | none | |
| `USE_ADMIN_CORES` | `true` | same | none | |
| `panel_names` | `[]` | same | none (the list is in `config.js`) | |
| `banana_index` | `"system_banana"` | same | none | |
| `default_dashboard` | `"default.json"` | - | **new** | ADR 0006 |
| `allowed_dashboard_servers` | `[]` | - | **new** | ADR 0021 |
| `banana_server` | no fallback; copied from `config.js` when set | not copied (the key was commented out in `settings.js`, so setting it in `config.js` did nothing) | **behaviour change**: a value set in `config.js` now takes effect. It only matters when `USE_FUSION` is false | ADR 0006 |
| `USE_FUSION` | `true` | same | none | |
| `apollo` | `"/api"` | same | none | |
| `apollo_queryPipeline` | `"/api/query-pipelines/"` | same | none | |
| `apollo_indexPipeline` | `"/api/index-pipelines/"` | same | none | |
| `SYSTEM_BANANA_QUERY_PIPELINE` | `"/api/query-pipelines/default/collections/system_banana"` | same | none | |
| `SYSTEM_BANANA_INDEX_PIPELINE` | `"/api/index-pipelines/_system/collections/system_banana"` | same | none | |
| `SYSTEM_BANANA_BLOB_API` | `"/api/blobs"` | same | none | |
| `SYSTEM_BANANA_BLOB_ID_SUBTYPE_PARAM` | `"resourceType=banana"` | same | none | |
| `SYSTEM_BANANA_BLOB_ID_SUBTYPE_QUERY` | `"resourceType=banana"` | same | none | |
| `FUSION_API_STATIC_FIELDS` | `"/schema/fields"` | same | none | |
| `FUSION_API_DYNAMIC_FIELDS` | `"/schema/dynamicfields"` | same | none | |
| `FUSION_API_COLLECTIONS` | `"/api/collections"` | same | none | |
| `FUSION_LOGIN_URL` | `"../login"` | - (the code sent the browser to `../login`) | **new**; the default is what 1.6.30 did | ADR 0003, ADR 0023 |
| `FUSION_SESSION_API` | `"/api/session"` | - (the code built the address from the page's protocol and host followed by `/api/session`) | **new**; the default resolves to the same address | ADR 0003, ADR 0023 |

Removed keys: none. A property of the code, `lucidworksSrv.fusionHost` (the page's protocol and host), was removed because
nothing used it once the session address became a setting (ADR 0023).

## 4. The Docker image's environment settings

The image is new and has no 1.6.30 counterpart, so every row is new. The names, the defaults and the reasons are in
ADR 0023 (the design is ADR 0003); [hosting-docker.md](hosting-docker.md) is the operator's guide. The values below are
read from `docker/banana-entrypoint`.

| Variable | Default | Meaning |
|---|---|---|
| `FUSION_URL` | required | The Fusion origin (scheme, host, optional port). |
| `BANANA_PUBLIC_ORIGIN` | required | The address people open Banana at; other `Host` values are refused. |
| `BANANA_ALLOWED_ORIGINS` | none | More origins accepted as the container's own. |
| `BANANA_REDIRECT_HOSTS` | none | Alias host names that are redirected to the public address. |
| `BANANA_PRESET` | `fusion` | Only `fusion` is accepted; `solr` stops the start. |
| `FUSION_LOGIN_URL` | `/auth/login` | Where an expired session is sent. This is the value for the root page; the application's own fallback is `../login` (section 3), and the optional `/admin/banana/` mount keeps `../login`. |
| `BANANA_SETTING_<name>` | the preset's value | Sets one application setting by its name. Only settings that have a fallback in `src/app/components/settings.js` are accepted (so not `banana_server`); an unknown name stops the start. The login address is set only through `FUSION_LOGIN_URL`. |
| `BANANA_ADMIN_MOUNT` | `off` | Also serve Banana at `/admin/banana/` with its own `config.js`. |
| `FUSION_PROXY_ADMIN_UI` | `on` | Forward `/admin/` to Fusion. |
| `FUSION_TLS_VERIFY` | `on` | Verify Fusion's certificate. |
| `FUSION_CA_FILE` | system CAs | A PEM file of trusted certificates. |
| `BANANA_INSECURE_COOKIES` | `off` | Development only: drop `Secure` from the session cookie and allow an `http://` Fusion URL. |
| `BANANA_HSTS` | `off` | Send `Strict-Transport-Security`. |
| `BANANA_CSP_MODE` | `enforce` | `report-only` sends the content policy under the report-only header. |
| `BANANA_CSP_SCRIPT_SRC`, `BANANA_CSP_STYLE_SRC`, `BANANA_CSP_IMG_SRC`, `BANANA_CSP_FONT_SRC`, `BANANA_CSP_CONNECT_SRC` | none | Sources appended to that directive. The image's default `script-src` is `'self' https://api.github.com` (ADR 0029). |
| `BANANA_STRIP_HEADERS` | none | Header names added to the built-in list of identity headers removed from requests. |
| `BANANA_PREFLIGHT` | `warn` | `strict` makes a failed start-up check stop the start. |
| `BANANA_ACK_TRUSTED_REALMS` | none | Names of acknowledged Trusted-HTTP realms. |
| `BANANA_HEALTH_UPSTREAM` | `off` | Serve `/healthz/upstream`. |
| `BANANA_LIVE_DIGEST_KEY` | unset | For the project's own tests; leave it unset. |

## 5. Panel defaults that differ from 1.6.30

A panel saves its settings in the dashboard, so these defaults apply to panels created from the menu and to saved
panels that lack the setting. A dashboard saved by 1.6.30 keeps the values it was saved with.

| Panel and setting | Default now | 1.6.30 | Difference | Record |
|---|---|---|---|---|
| Heatmap `row_size` | `300` | `300` | none. The unreleased development line had changed it to 5 and it was put back | ADR 0030 |
| Hits `chart` and its bar, pie and list styles | `total` | `total` | the default is unchanged. The bar, pie and list styles now draw the hit count of each query; in 1.6.30 they drew nothing. The `total` style is laid out differently, see section 7 | ADR 0030, ADR 0034 |
| Terms `custom_query_filters` | `false` | - | **new**; off keeps 1.6.30 behaviour (a click adds only the term) | ADR 0031 |
| Ticker `ignore_time_picker` | `false` | - | **new**; off keeps 1.6.30 behaviour | ADR 0031 |
| Ticker `trend_interval` | day to day | - | **new**; only used when `ignore_time_picker` is on | ADR 0031 |
| Sunburst `labels` | `false` | - | **new**; off keeps 1.6.30 drawing | ADR 0031 |
| Sunburst `bold_labels`, `label_rings` | `true`, `2` | - | **new**; only used when `labels` is on | ADR 0031 |
| Tag cloud `customStopWords` | empty | - | **new** | ADR 0031 |
| Tag cloud `customStopWordsLowercase` | `true` | - | **new**; only used with custom stop words | ADR 0031 |
| Tag cloud "Stop Words" option | checking it filters the cloud | checking it threw an error | fix: the list of stop words can be found | ADR 0031 |
| Force and Sankey `node_limit` | `0` (no limit) | - (new panels) | **new** | ADR 0031 |
| Sankey `label_limit` | `0` (no limit) | - (new panel) | **new** | ADR 0031 |
| Force `mute_remaining_categories` | `true` | - (new panel; the earlier name was `mute_category_2`) | renamed; a dashboard saved with the old name keeps its value | ADR 0031 |
| Box plot panel (all settings) | see the panel | - (new panel) | **new panel**, added to `panel_names` | ADR 0031 |
| Time filter (all panels with a time range): relative ranges | sent as `NOW/HOUR-6HOUR` to `NOW/HOUR+1HOUR` style, rounded to the unit | same | none. The development line had sent `NOW-6HOUR`; 1.6.30's form is restored | ADR 0030 |
| Time filter: a range in months | sends `MONTH` | sent `NOW/undefined-1undefined` | fix | ADR 0030 |
| Terms `bar_chart_arrangement` | `vertical` | - | **new**, see "Differences inherited from the development line" (section 7) | ADR 0034 |
| Query panel `operator` ("Mode") | `OR` | - (the queries were always joined with `OR`) | **new**; the default reproduces 1.6.30, see "Differences inherited from the development line" (section 7) | ADR 0034 |
| Heatmap `row_field`, `col_field` | empty | `start_station_name`, `gender` | **changed**, see "Differences inherited from the development line" (section 7) | ADR 0034 |
| Heatmap `editor_size` | removed | `0` | **removed**, see "Differences inherited from the development line" (section 7) | ADR 0034 |

The panel types that 1.6.30 does not have (graph, significant terms, time series, sankey, force, box plot) have no 1.6.30
defaults; ADR 0019 and ADR 0031 describe them.

## 6. Other behaviour that changed, with its record

These are not configuration keys, but they are differences from 1.6.30 that a no-breaking-change check needs to see.
[CHANGELOG.md](../CHANGELOG.md) is the user-facing list.

| Behaviour | Now | 1.6.30 | Record |
|---|---|---|---|
| A failed request | shown in the panel or an alert | looked like a success | ADR 0014 |
| `{{ ... }}` in a loaded dashboard | only `{{ARGS.name}}` is replaced; the rest is text | any expression ran as JavaScript | ADR 0018 |
| `#/dashboard/script/<file>` route | does not exist | does not exist (the development line had brought it back) | ADR 0018 |
| The `server` parameter of a dashboard link (Solr mode) | honoured only for a relative path, `banana_server`, `solr` or a listed server | any server | ADR 0021 |
| Text from documents, schema and dashboards written as HTML | escaped or sanitised | written as is | ADR 0024 |
| Saving over an existing title | asks for confirmation, shows the owner | replaced silently | ADR 0027 |
| Dashboard ids and Solr deletes | one encoding for save, load and delete; no query built from a raw title | different encodings; query built from the title | ADR 0027 |
| Collection list in Solr mode | collections API first, CoreAdmin when it fails | CoreAdmin | ADR 0030 |
| Filters with the mandate "either", on a dashboard that has no time filter | sent to Solr as one `OR` filter query, so the results can differ from 1.6.30's | dropped, so the filter was listed but had no effect (with a time filter 1.6.30 sent it, as now) | ADR 0030 (update of 2026-11-07) |
| Duplicate-filter test | refuses a filter only when type, field, query, value, bounds and editing state all match; a second query-string filter, or a second filter on the same field from the table or full text search panels, is accepted | compared type, field and value only, so those second filters were refused | ADR 0030 (update of 2026-11-07) |
| Content policy of the Docker image | `script-src 'self' https://api.github.com` | no image | ADR 0029 |
| Content policy when Fusion serves Banana | none (Fusion sends none) | none | ADR 0032 |
| jQuery, Underscore, Moment.js | 3.7.1, 1.13.8, 2.31.0 | 1.12.1, 1.5.1, 2.1.0 | ADR 0033 |
| Expressions in the page | AngularJS `ng-csp` mode (may be slower) | `Function` compiled | ADR 0029 |
| Build and browser minimum | webpack build; ES2015 browsers; `dist/` is what runs | Grunt build with ES5 output; `src/` was servable | ADR 0009 |
| Panels fixed at build time | a panel added to a deployed `dist/` is not picked up | loaded at run time | ADR 0009 |
| Map data, percent-stacking plugin | regenerated from public-domain data; rewritten plugin | files with no stated licence | ADR 0015 |
| Version text in the editor, licence files, WAR and Maven files | one version source; `LICENSE` and `NOTICE`; no WAR | several copies; short notice; WAR build | ADR 0011, ADR 0026 |
| Publishing | the package is private; nothing is published | `banana-fusion` on npm | ADR 0028 |

## 7. Differences inherited from the development line

These differences from 1.6.30 came with the unreleased development line that this version continues. They are in the
code, and [ADR 0034](adr/0034-differences-inherited-from-the-development-line.md) records each
of them (what a 1.6.30 user sees and why it is kept). They are listed here so that a no-breaking-change check can judge
them. None changes a dashboard that 1.6.30 saved unless it is noted. The first five are defaults and features; the rest
are presentation and export differences.

1. **Query panel `operator` ("Mode"), default `OR`.** The unreleased development line added an OR/AND choice and changed how
   the queries of a dashboard are combined (`getOPQuery`). With the default the queries are joined with `OR`, as 1.6.30's
   `getORquery` did. Without a query panel the operator is `OR`.
2. **Terms `bar_chart_arrangement`, default `vertical`.** A horizontal bar arrangement was added. Vertical is how 1.6.30
   drew the bars.
3. **Heatmap defaults and look.** The default `row_field` and `col_field` are empty, where 1.6.30 named a sample data
   set (`start_station_name` and `gender`), so a heatmap created from the menu has no fields set and shows no cells
   until fields are chosen. The internal `editor_size` setting and the "invalid rows number" alert were removed with the
   row-count check. The shading is now one continuous scale, from about three steps lighter to three steps darker than
   the chosen colour, where 1.6.30 used 11 fixed steps with its own lighter and darker split, so the same counts can
   come out in a slightly different shade, and the colour menu offers `lime` (labelled Greens) in place of `green`; a
   saved `green` still renders. The other colours are labelled Blues, Reds, Grays and Browns. Every heatmap is also
   drawn differently: the cells fill the panel (1.6.30 drew 15px squares), and a colour legend, axis titles with the
   field names, grid lines and tick marks are new; the labels are 12px text where 1.6.30 used 9pt Consolas in grey, and
   a label is cut after 10 characters (`...`) where 1.6.30 cut rows at 8 and columns at 6 (`..`). The heatmap's
   stylesheet applies only inside a heatmap panel. ADR 0030 mentions the field defaults and says they are not changed
   there; ADR 0034 decides that they stay.
4. **Dashboard default `home: true` and the "Home" switch in the dashboard settings.** New. The default reproduces 1.6.30,
   which always showed the Home button; turning the switch off hides it.
5. **The sample dashboard `logstash.js` was removed.** It was a scripted dashboard, which 1.6.30's code could not load
   (ADR 0018 notes that the route is gone), and nothing referenced it.
6. **Icons are links with titles.** Panel header, row and dashboard-menu icons are `<a title alt href="">` where 1.6.30
   used `<i>` (the dashboard menu already used links; it gained `href`, `title` and `alt`). Styled tooltips still show
   and use the title text ("Configure Row" replaces "Configure row"); where the styled tooltip is on an outer element
   (the menu's Save and Configure icons, the panel export icon) the browser's own title tooltip appears as well, and
   menu entries that gained a title now show one. Three icons have no `href` and cannot be reached with the keyboard.
   Panel-header and row icons take the theme's link colour (`#08c` light, `#fff` dark instead of `#333` and `#c8c8c8`);
   expanded-row icons are about 14.7px instead of 13.3px and collapsed-row icons about 11.9px instead of 14px. The
   heatmap's transpose icon is `icon-repeat` instead of the `rotate-icon` span; for the values the interface sets its
   visibility is unchanged.
7. **Bettermap coordinate hint.** The "Coordinate Field" hint, the "no field" message and the module comment say
   latitude then longitude. 1.6.30's hint said the opposite; the code in both versions reads latitude first. Only the
   wording changed.
8. **Full text search file export applies the custom query.** CSV, XML and JSON exports add the panel's custom query, as
   the panel's own search already did. With no custom query (the default) the export is unchanged; with one set, the
   request and the exported rows differ from 1.6.30.
9. **Sunburst sizing.** The container takes a `min-height` from the panel or row height, its element id was removed and
   the SVG is sized by attributes; debug logging was removed.
10. **Internet Explorer 8 and 9 adapter.** `vendor/xhr-xdr-adapter.js` is loaded and does nothing unless
    `window.XDomainRequest` exists, which this version cannot run in; the `X-UA-Compatible` meta tag in `index.html`
    changed and has no effect in supported browsers. `css/vis.css` (graph panel, `.vis-*` selectors) is also linked.
11. **Theme CSS.** Panel padding is 11px instead of 10px, the light theme's panel background and both themes' row
    background are lighter shades, and the dark theme draws axis labels with a stroke. The query panel's last query has
    `padding-right: 70px` where 1.6.30 had 45px, so the text stops further from the search, add and clear icons.
12. **Hits panel `total` style layout.** The metrics are in a flex container that spreads them across the panel's width
    (`justify-content: space-between`), the values are bold, and the font size is set on the container; 1.6.30 placed
    inline blocks side by side. The editor shows "List Format" for every style, and for `total` it sets the direction
    (Horizontal by default, Vertical stacks the metrics); opening the panel writes a `flex-direction` entry into its
    `style` setting. The line height follows the font size instead of the theme's fixed line height, so at the default 10pt
    the metrics sit closer together (about a fifth closer in the light theme, where lines were 20px and a block 40px; about
    a quarter closer in the dark theme, where lines were 21px and a block 42px).

The comparison for the first five was made key by key against 1.6.30, and for the rest file by file. Section 6 and the
list above come from the decision records and the changelog, and from comparing the panel defaults and the dashboard
defaults; they are not an audit of every behaviour in the application.
