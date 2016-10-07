# Banana

The Banana project was forked from [Kibana](https://github.com/elastic/kibana), and works with all kinds of time series
(and non-time series) data stored in [Apache Solr](https://lucene.apache.org/solr/). It uses Kibana's powerful dashboard
configuration capabilities, ports key panels to work with Solr, and provides significant additional capabilities,
including new panels that leverage [D3.js](http://d3js.org).

The goal is to create a rich and flexible UI, enabling users to rapidly develop end-to-end applications that leverage
the power of Apache Solr. Data can be ingested into Solr through a variety of ways, including
[Logstash](https://www.elastic.co/products/logstash), [Flume](https://flume.apache.org) and other connectors.
 
## IMPORTANT

Pull the repo from the `release` branch for production deployment; version x.y.z will be tagged as x.y.z

`develop` branch is used for active development and cutting edge features.

## Banana 1.6.12

NOTES about the skipped version numbers: we want to synchronize the code base between the two branches: _develop_ and _fusion_.
Previously the _develop_ branch was used by the community to contribute code, while the _fusion_ branch was used for Lucidworks
Fusion. There were some conflicting codes between the two branches, which now have been resolved in this version. That is
the reason why we have to skip the version numbers, so that both branches are in sync. The only different between
them now are _config.js_ (which contain the app settings) and the dashboard _default.json_ (which is the first sample dashboard
shown after installing the app).  

This release includes the following key new features and improvements:

1.  Unify the code base between _develop_ branch and _fusion_ branch.
2.  Fix multiple hosts issue [#279](https://github.com/lucidworks/banana/pull/279)
3.  Add countDistinct and cardinality for hits stats [#269](https://github.com/lucidworks/banana/pull/269)
4.  Add SUM aggregate function to Histogram panel [#252](https://github.com/lucidworks/banana/pull/252)
5.  Query panel / Add reset action to set filter to *:* [#183](https://github.com/lucidworks/banana/pull/183)
6.  Better map auto fit option / icon [#242](https://github.com/lucidworks/banana/pull/242)
7.  Fix JS minify (grunt task) error in RangeFacet panel.
8.  Fix bug in RangeFacet panel: sometimes auto-interval will return facet.range.gap = 0
9.  Fix all jshint errors.
10. Improved Scatterplot panel, now we can add bubble and colors.
11. Improved Hits panel, now we can include more than one metric like avg, min, max, in addition to count.
12. Add sorting to dashboard drop-down collections picker
13. Add pagination to Load Dashboard menu.

## Older Release Notes

You can find all previous [Release Notes](https://github.com/LucidWorks/banana/wiki/Release-Notes) on our wiki page.

### Changes to your dashboards
If you created dashboards for Banana 1.0.0, you did not have a global filtering panel. In some cases, these filter
values can be implicitly set to defaults that may lead to strange search results. We recommend updating your old
dashboards by adding a filtering panel. A good way to do it visually is to put the filtering panel on its own row and
hide it when it is not needed.

## Installation and Quick Start
### Requirements
* A modern web browser. The latest version of [Chrome](http://www.google.com/chrome/) and
[Firefox](https://www.mozilla.org/en-US/firefox/new/) have been tested to work. [Safari](http://www.apple.com/safari/)
also works, except for the "Export to File" feature for saving dashboards. We recommend that you use Chrome or Firefox
while building dashboards.
* Solr 5 or 4.4+ (Solr server's endpoint must be open, or a proxy configured to allow access to it).
* A webserver (optional).

### Installation Options
#### Option 1: Run Banana webapp within your existing Solr instance
##### Solr 5 Instructions
1. Run Solr at least once to create the webapp directory:

        cd $SOLR_HOME/bin/
        ./solr start

2. Copy banana folder to $SOLR_HOME/server/solr-webapp/webapp/
3. Browse to [http://localhost:8983/solr/banana/src/index.html](http://localhost:8983/solr/banana/src/index.html)

##### Solr 4 Instructions
1. Run Solr at least once to create the webapp directories:

        cd $SOLR_HOME/example
        java -jar start.jar
    
2. Copy banana folder to $SOLR_HOME/example/solr-webapp/webapp/
3. Browse to [http://localhost:8983/solr/banana/src/index.html](http://localhost:8983/solr/banana/src/index.html)

_**NOTES:**_ If your Solr server/port is different from [localhost:8983](http://localhost:8983), edit
banana/src/config.js and banana/src/app/dashboards/default.json to enter the hostname and port that you are using.
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

#### Option 3: Building and installing from a WAR file
1. Pull the source code of Banana version that you want from the
[release](https://github.com/LucidWorks/banana/tree/release) branch in the repo;
For example, version *x.y.z* will be tagged as `x.y.z`.

2. Run a command line "ant" from within the banana directory to build the war file:

    ```bash
        cd $BANANA_REPO_HOME
        ant
    ```
3. The war file will be called *banana-\<buildnumber\>.war* and will be located in $BANANA\_REPO\_HOME/build.
Copy the war file and banana's jetty context file to Solr directories:
  * For Solr 5:

    ```bash
        cp $BANANA_REPO_HOME/build/banana-<buildnumber>.war $SOLR_HOME/server/webapps/banana.war
        cp $BANANA_REPO_HOME/jetty-contexts/banana-context.xml $SOLR_HOME/server/contexts/
    ```
  * For Solr 4:

    ```bash
        cp $BANANA_REPO_HOME/build/banana-<buildnumber>.war $SOLR_HOME/example/webapps/banana.war
        cp $BANANA_REPO_HOME/jetty-contexts/banana-context.xml $SOLR_HOME/example/contexts/
    ```
4. Run Solr:
  * For Solr 5:

    ```bash
        cd $SOLR_HOME/bin/
        ./solr start
    ```
  * For Solr 4:

    ```bash
        cd $SOLR_HOME/example/
        java -jar start.jar
    ```
5. Browse to [http://localhost:8983/banana](http://localhost:8983/banana) (or the FQDN of your Solr server).
    
#### Option 4: Run Banana webapp in a web server
Banana is an [AngularJS app](https://angularjs.org) and can be run in any webserver that has access to Solr.
You will need to enable [CORS](https://en.wikipedia.org/wiki/Cross-origin_resource_sharing) on the Solr instances that
you query, or configure a proxy that makes requests to banana and Solr as same-origin. We typically recommend the
latter approach.

#### Storing Dashboards in Solr

If you want to save and load dashboards from Solr, create a collection using the configuration files provided in either
the _resources/banana-int-solr-5.0_ (for Solr 5) directory or the _resources/banana-int-solr-4.5_ directory
(for Solr 4.5). If you are using SolrCloud, you will need to upload the configuration into
[ZooKeeper](https://zookeeper.apache.org) and then create the collection using that configuration.

The Solr server configured in config.js will serve as the default node for each dashboard; you can configure each
dashboard to point to a different Solr endpoint as long as your webserver and Solr put out the correct CORS headers.
See the README file under the  _resources/enable-cors_ directory for a guide.

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

## Publishing WAR Artifacts to Maven Central

1. 	Get hold of
[maven-ant-tasks-X.X.X.jar](http://search.maven.org/#search|gav|1|g%3A%22org.apache.maven%22%20AND%20a%3A%22maven-ant-tasks%22)
and put it in this directory
2. 	Execute *ant -lib . deploy* from this directory, this will sign the Maven artifacts (currently just .war) and send
them to a [Sonatype OSSRH](https://oss.sonatype.org/) staging repository. Details of how to set this up can be found
[here](http://central.sonatype.org/pages/ossrh-guide.html). N.B. Ensure that you have an *release* profile contained
within ~/.m2/settings.xml
3.	Once you've read, and are happy with the staging repos, close it. 

## Support

Banana uses the dashboard configuration capabilities of Kibana (from which it is forked) and ports key panels to work
with Solr. Moreover, it provides many additional capabilities like heatmaps, range facets, panel specific filters,
global parameters, and visualization of "group-by" style queries. We are continuing to add many new panels that go well
beyond what is available in Kibana, helping users build complete applications that leverage the data stored in
Apache Solr, HDFS and a variety of sources in the enterprise.

If you have any questions, please email banana-support@lucidworks.com

## Trademarks

Kibana is a trademark of Elasticsearch BV  
Logstash is a trademark of Elasticsearch BV
