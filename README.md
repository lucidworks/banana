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
`fusion` branch is used for Lucidworks Fusion release. The code base and features are the same as `develop`. The main difference
is in the configuration. 

## Banana 1.6.24

This release includes the following bug fixes and improvement:
1. Fix the filter panel where we cannot add more than one filer when clicking on the plus icon.
1. Fix the Sankey panel. [#338](https://github.com/lucidworks/banana/pull/338)
1. Allow the Terms panel to have a horizontal bar chart. [#338](https://github.com/lucidworks/banana/pull/338)
1. Add Sankey hover/highlight effect. [#340](https://github.com/lucidworks/banana/pull/340)
1. Force diagram numerical node names fix. [#340](https://github.com/lucidworks/banana/pull/340)

## Older Release Notes

You can find all previous [Release Notes](https://github.com/LucidWorks/banana/wiki/Release-Notes) on our wiki page.

## Installation and Quick Start
### Requirements
* A modern web browser. The latest version of [Chrome](http://www.google.com/chrome/) and
[Firefox](https://www.mozilla.org/en-US/firefox/new/) have been tested to work. [Safari](http://www.apple.com/safari/)
also works, except for the "Export to File" feature for saving dashboards. We recommend that you use Chrome or Firefox
while building dashboards.
* Solr 6.x or at least 4.4+ (Solr server's endpoint must be open, or a proxy configured to allow access to it).
* A webserver (optional).

### Installation Options
#### Option 1: Run Banana webapp within your existing Solr instance
##### Solr 5+ Instructions
1. Run Solr at least once to create the webapp directory (this step might be unnecessary for Solr 6):

        cd $SOLR_HOME/bin
        ./solr start

2. Copy banana folder to `$SOLR_HOME/server/solr-webapp/webapp/`

        cd $SOLR_HOME/server/solr-webapp/webapp
        cp -R $BANANA_HOME/src ./banana

    NOTES: For production, you should run `grunt build` command to generate the optimized code in `dist` directory. And then copy the `dist` directory to the production web server. For example:

        cd $BANANA_HOME
        npm install
        bower install
        grunt build
        cp -R ./dist $SOLR_HOME/server/solr-webapp/webapp/banana

3. Browse to [http://localhost:8983/solr/banana/index.html](http://localhost:8983/solr/banana/index.html)

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
_NOTES: This option is only applicable to Solr 5 or 4. Solr 6 has a different architecture._
1. Pull the source code of Banana version that you want from the
[release](https://github.com/LucidWorks/banana/tree/release) branch in the repo;
For example, version *x.y.z* will be tagged as `x.y.z`.

2. Run a command line `ant` from within the banana directory to build the war file:

    ```bash
        cd $BANANA_HOME
        ant
    ```
3. The war file will be called *banana-\<buildnumber\>.war* and will be located in $BANANA_HOME/build.
Copy the war file and banana's jetty context file to Solr directories:
  * For Solr 5:

    ```bash
        cp $BANANA_HOME/build/banana-<buildnumber>.war $SOLR_HOME/server/webapps/banana.war
        cp $BANANA_HOME/jetty-contexts/banana-context.xml $SOLR_HOME/server/contexts/
    ```
  * For Solr 4:

    ```bash
        cp $BANANA_HOME/build/banana-<buildnumber>.war $SOLR_HOME/example/webapps/banana.war
        cp $BANANA_HOME/jetty-contexts/banana-context.xml $SOLR_HOME/example/contexts/
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
