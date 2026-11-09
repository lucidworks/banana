# Banana

[![CI](https://github.com/lucidworks/banana/actions/workflows/ci.yml/badge.svg?branch=release)](https://github.com/lucidworks/banana/actions/workflows/ci.yml)

The Banana project was forked from [Kibana](https://github.com/elastic/kibana), and works with all kinds of time series
(and non-time series) data stored in [Apache Solr](https://lucene.apache.org/solr/). It uses Kibana's powerful dashboard
configuration capabilities, ports key panels to work with Solr, and provides significant additional capabilities,
including new panels that leverage [D3.js](http://d3js.org).

The goal is to create a rich and flexible UI, enabling users to rapidly develop end-to-end applications that leverage
the power of Apache Solr. Data can be ingested into Solr through a variety of ways, including
[Logstash](https://www.elastic.co/products/logstash), [Flume](https://flume.apache.org) and other connectors.
 
## Branches

The `release` branch holds the current code. Use it for deployment, and branch from it when you contribute (see
[CONTRIBUTING.md](CONTRIBUTING.md)). Releases are tagged `vX.Y.Z`.

The older `develop` and `fusion` branches are no longer used for development.

## Release notes

What changed in this version, and in 1.6.27 to 1.6.30, is in [CHANGELOG.md](CHANGELOG.md). The version number is the one in
`package.json`. Notes for older versions are on the
[wiki](https://github.com/LucidWorks/banana/wiki/Release-Notes).

## Getting Banana

Banana is not published to npm any more: `package.json` is marked `"private": true`, and the `banana-fusion` package that
is already on npm stays at 1.6.30. Build Banana from this repository (`npm ci`, `npm run build`, see below), or build the
Docker image ([Option 5](#option-5-run-banana-in-docker-in-front-of-fusion)). See
[docs/adr/0028-private-package.md](docs/adr/0028-private-package.md). Hosting outside Fusion is described in
[docs/hosting-docker.md](docs/hosting-docker.md) and the security trade-offs in [docs/security.md](docs/security.md).

## Installation and Quick Start
### Requirements
* Lucidworks Fusion 5.9.x is the supported back end (the version this release is developed and tested against is 5.9.16).
  Banana runs inside Fusion's admin UI, or in the Docker image in front of Fusion.
* Node.js and npm to build Banana from source. Node.js 22 (22.18 or later) is the reference toolchain; the build and tests
  also run on Node.js 24.11 or later and on 26 or later, and continuous integration covers 22, 24 and 26 (the exact range is
  `engines` in `package.json`). The repository has an `.nvmrc` for the 22 line. Run `npm ci`, not `npm install`, so that the
  committed `package-lock.json` is used.
* Docker, if you want the container image (any recent Docker with BuildKit).
* A modern web browser. The latest version of [Chrome](http://www.google.com/chrome/) and
[Firefox](https://www.mozilla.org/en-US/firefox/new/) have been tested to work. [Safari](http://www.apple.com/safari/)
also works, except for the "Export to File" feature for saving dashboards. We recommend that you use Chrome or Firefox
while building dashboards.
* For the Solr preset only: a plain Solr server (Solr's endpoint must be open, or a proxy configured to allow access to it).
  The preset was smoke-tested once on Solr 9.11 in a local container; see "Solr preset" below for what that did and did not
  cover. Other Solr versions are untested by this project.
* A webserver (optional).

### Build and test
Banana is built with webpack. From a fresh clone:

        npm ci                            # install exactly what package-lock.json lists
        npx playwright install chromium   # the unit tests and the smoke check use this browser
        npm run build                     # writes dist/
        npm test                          # unit tests (Karma, headless Chromium)
        npm run test:node                 # tests that need no browser

`npm start` serves `dist/` on port 8000. Contributors: see [CONTRIBUTING.md](CONTRIBUTING.md).

### Configuration: Fusion defaults and the Solr preset
`src/config.js` ships with the Lucidworks Fusion defaults (`USE_FUSION: true`, query pipelines API under
`/api/query-pipelines/_system/collections/`, collection `system_logs`, dashboards stored in the Fusion blob store).

To run Banana against a plain Solr server instead, use the Solr preset: copy `config.solr.js` over `config.js`
(`dist/config.js` in a built distribution; `src/config.js` is its source). No rebuild is needed, because `config.js` is not part of
the bundled code. The preset sets `USE_FUSION: false`, `solr: "/solr/"`, `solr_core: "logs"`,
`banana_index: "banana-int"` and `default_dashboard: "default.solr.json"`, the Solr default dashboard. Reload the page
after copying, because the browser may cache `config.js`. A built `dist` requests `config.js` without a cache-busting tag
(unlike the application bundle), so a hard reload or no-cache headers on `config.js` may be needed.

Set `banana_server` in `config.js` to load and save dashboards on a different server than the data server. It only
matters when `USE_FUSION` is false; with Fusion, dashboards are saved and loaded through the blob API.
A shared link can carry `?server=...` to name the server a dashboard is loaded from (Solr mode only). Banana uses it only
when it is a relative path such as `/solr/`, equals `banana_server` (or `solr`), or is listed in `allowed_dashboard_servers`
in `config.js`; any other value is ignored with a warning. See `docs/adr/0021-dashboard-server-parameter.md`.
See `docs/adr/0006-fusion-defaults-and-solr-preset.md` and `docs/adr/0007-plain-solr-scope.md`.

#### Solr preset: what was tested
The preset was run once, by hand, against a local `solr:9` container (Solr 9.11.0, standalone mode, not SolrCloud). A copy of
`dist/` with `config.solr.js` as `config.js` was served by a static web server that forwarded `/solr/` to the container on the
same origin. Results:

* The default Solr dashboard loaded, and its panel queries and the field list (`/admin/luke`) returned results from a core
  named `collection1`. One facet query returned 400 because the test data had no `message` field, which is a data problem,
  not a Banana one. The shipped dashboard names `collection1` (and the field `event_timestamp`) itself, so point the
  dashboard at your own core with _Configure Dashboard_.
* A `banana-int` core created from `resources/banana-int-solr-5.0/conf` saved a dashboard from the Save menu, and the
  document was found in the core afterwards. Solr 9 logged errors that it could not load the `solr.LRUCache`, `solr.search.LRUCache` and `solr.FastLRUCache`
  classes named by that old `solrconfig.xml`, and carried on. Creating `banana-int` with the default configset
  (`solr create -c banana-int`) was not tried on Solr 9.
* That run was made before Banana learned to fall back to the CoreAdmin list. It then showed the alert "Could not retrieve
  collections from Solr (error status = 400)" on a standalone Solr, because the collection list it asks for first
  (`/admin/collections?action=LIST`) exists only in SolrCloud. Banana now asks `/admin/cores?action=STATUS` when that request
  fails and shows the alert only if both fail. The fallback is covered by unit tests and was not run against Solr 9.
* Copying `dist/` into Solr's own web application directory (Option 1 and Option 3) was not tried on Solr 9, and neither was
  SolrCloud or any other Solr version.

Plain Solr support is limited to keeping the preset working (see `docs/adr/0007-plain-solr-scope.md`).

### Installation Options
#### Option 1: Run Banana webapp within your existing Solr instance
##### Solr 5+ Instructions
1. Run Solr at least once to create the webapp directory (this step might be unnecessary for Solr 6):

        cd $SOLR_HOME/bin
        ./solr start

2. Build Banana (this needs Node.js 22.18 or later in the 22 line, 24.11 or later in the 24 line, or 26 or later) and copy the built `dist` folder to `$SOLR_HOME/server/solr-webapp/webapp/`. The `src` folder cannot be served as it is, because the application is bundled by `npm run build`:

        cd $BANANA_HOME
        npm ci
        npm run build
        cp -R ./dist $SOLR_HOME/server/solr-webapp/webapp/banana

    Then select the Solr preset by copying `config.solr.js` over `config.js` (the shipped `config.js` has the Fusion defaults):

        cp $SOLR_HOME/server/solr-webapp/webapp/banana/config.solr.js $SOLR_HOME/server/solr-webapp/webapp/banana/config.js

3. Browse to [http://localhost:8983/solr/banana/index.html](http://localhost:8983/solr/banana/index.html)

##### Solr 4 Instructions
1. Run Solr at least once to create the webapp directories:

        cd $SOLR_HOME/example
        java -jar start.jar
    
2. Build Banana as described above (`npm ci`, then `npm run build`) and copy the `dist` folder to `$SOLR_HOME/example/solr-webapp/webapp/banana`.
3. Select the Solr preset by copying `config.solr.js` over `config.js` in `banana` (the shipped `config.js` has the Fusion defaults).
4. Browse to [http://localhost:8983/solr/banana/index.html](http://localhost:8983/solr/banana/index.html)

_**NOTES:**_ If your Solr server/port is different from [localhost:8983](http://localhost:8983), then after the
copy step above edit `solr` in banana/config.js and `server` in
banana/app/dashboards/default.solr.json to enter the hostname and port that you are using.
Remember that banana runs within the client browser, so provide a fully qualified domain name (FQDN), because the
hostname and port number you provide should be resolvable from the client machines.

If you have not created the data collections and ingested data into Solr, you will see an error message saying
"Collection not found at .." You can use any connector to get data into Solr. If you want to use Logstash, please go to
the Solr Output Plug-in for [Logstash Page](https://github.com/LucidWorks/solrlogmanager) for code, documentation and
examples.

#### Option 2: Complete SLK Stack
Lucidworks has packaged Solr, Logstash (with a Solr Output Plug-in), and Banana (the Solr port of Kibana), along with
example collections and dashboards in order to rapidly enable proof-of-concepts and initial development/testing.
See [http://www.lucidworks.com/lucidworks-silk/](http://www.lucidworks.com/lucidworks-silk/).

#### Option 3: Copy the build into Solr's web application
There is no WAR file. Build Banana as described in Option 1, then copy the contents of the `dist` folder into a
`banana` directory inside the directory that holds Solr's own web application (the one that contains Solr's admin
`index.html`; where that is depends on your Solr version and installation). Then select the Solr preset by copying
`config.solr.js` over `config.js` in that `banana` directory (the shipped `config.js` has the Fusion defaults), as in
Option 1, and set `solr` there if your Solr is not on `localhost:8983`. Browse to
`http://localhost:8983/solr/banana/index.html` (or the FQDN of your Solr server). Solr may replace that directory when
you upgrade it, so for anything long-lived serve `dist` from a web server instead (Option 4). See
[docs/adr/0026-remove-war-build.md](docs/adr/0026-remove-war-build.md) for why the WAR build was removed.

#### Option 4: Run Banana webapp in a web server
Banana is an [AngularJS app](https://angularjs.org) and can be run in any webserver that has access to Solr.
You will need to enable [CORS](https://en.wikipedia.org/wiki/Cross-origin_resource_sharing) on the Solr instances that
you query, or configure a proxy that makes requests to banana and Solr as same-origin. We typically recommend the
latter approach.

Build Banana as described in Option 1 and serve the `dist` folder (`npm run build` writes it); `src` cannot be served
as it is. `npm start` serves `dist` on port 8000 once it is built. `npm run dev` serves the application with
webpack-dev-server on the local machine only (set `BANANA_DEV_HOST` to change that), but it does not proxy `/api` or
`/solr`, so it cannot reach Fusion or Solr unless you add a proxy or enable CORS on the server you query.
Panel directories or `map.<name>.js` files that you add to a deployed `dist` folder are not picked up: panels are
bundled at build time, so add them under `src` and rebuild.

#### Option 5: Run Banana in Docker, in front of Fusion
The repository has a `Dockerfile` that builds Banana and serves it with an unprivileged nginx that also forwards `/api/`,
`/auth/` and `/admin/` to one Fusion instance on the same origin. People log in with their own Fusion accounts; the
container holds no Fusion credential.

```bash
docker build -t banana-hosting .
docker run --rm -p 127.0.0.1:8080:8080 \
  -e FUSION_URL=https://fusion.example.com \
  -e BANANA_PUBLIC_ORIGIN=http://localhost:8080 -e BANANA_INSECURE_COOKIES=on \
  banana-hosting
```

Open [http://localhost:8080](http://localhost:8080). `BANANA_INSECURE_COOKIES=on` is for trying it on `localhost` only; a
real deployment sits behind HTTPS, with `BANANA_PUBLIC_ORIGIN` set to the https address. `compose.yaml` is an example
that also drops privileges and makes the file system read-only. The container refuses to start with a clear message when
its environment is wrong, and it logs what it checked in Fusion. What it proxies, the variables it reads and the security
trade-offs are in [docs/adr/0003-standalone-hosting-same-origin-proxy.md](docs/adr/0003-standalone-hosting-same-origin-proxy.md)
and [docs/adr/0023-docker-image.md](docs/adr/0023-docker-image.md).

The step-by-step guide is [docs/hosting-docker.md](docs/hosting-docker.md); read [docs/security.md](docs/security.md) before
putting it in front of real users.

### Storing Dashboards in Solr
If you want to save and load dashboards from Solr, then you need to create a collection called `banana-int` first. For Solr 6, here are the steps:

        cd $SOLR_HOME/bin
        ./solr create -c banana-int

For Solr 5 and 4, you have to create the `banana-int` collection using the configuration files provided in either
the _resources/banana-int-solr-5.0_ (for Solr 5) directory or the _resources/banana-int-solr-4.5_ directory
(for Solr 4.5). If you are using SolrCloud, you will need to upload the configuration into
[ZooKeeper](https://zookeeper.apache.org) and then create the collection using that configuration.

The Solr server configured in config.js will serve as the default node for each dashboard; you can configure each
dashboard to point to a different Solr endpoint as long as your webserver and Solr put out the correct CORS headers.
See the README file under the  _resources/enable-cors_ directory for a guide.

### Changes to your dashboards
If you created dashboards for Banana 1.0.0, you did not have a global filtering panel. In some cases, these filter
values can be implicitly set to defaults that may lead to strange search results. We recommend updating your old
dashboards by adding a filtering panel. A good way to do it visually is to put the filtering panel on its own row and
hide it when it is not needed.

## FAQ

__Q__: How do I secure my Solr endpoint so that users do not have access to it?  
__A__: The simplest solution is to use an [Apache](http://projects.apache.org/projects/http_server.html) or
[nginx](http://nginx.org) reverse proxy (See for example https://groups.google.com/forum/#!topic/ajax-solr/pLtYfm83I98).

__Q__: Can I use banana for non-time series data?  
__A__: Yes, from version 1.3 onwards, non-time series data are also supported.

## Resources

1.	Lucidworks SILK: http://www.lucidworks.com/lucidworks-silk/
2.	Webinar on Lucidworks SILK: http://programs.lucidworks.com/SiLK-introduction_Register.html.
3.	Logstash: http://logstash.net/
4.	SILK Use Cases: https://github.com/LucidWorks/silkusecases. Provides example configuration files, schemas and
dashboards required to build applications that use Solr and Banana.

## Support and contributing

Banana is a community-maintained project. For questions, bug reports and feature requests, please open an issue at
[GitHub Issues](https://github.com/lucidworks/banana/issues). See [CONTRIBUTING.md](CONTRIBUTING.md) if you would like
to contribute a change, and [SECURITY.md](SECURITY.md) to report a security vulnerability.

## Trademarks

Kibana is a trademark of Elasticsearch BV  
Logstash is a trademark of Elasticsearch BV
