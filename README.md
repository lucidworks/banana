# Banana

The Banana project was forked from Kibana, and works with all kinds of time series (and non-time series) data stored in Apache Solr. It uses Kibana's powerful dashboard configuration capabilities, ports key panels to work with Solr, and provides significant additional capabilities, including new panels that leverage D3.js. 

The goal is to create a rich and flexible UI, enabling users to rapidly develop end-to-end applications that leverage the power of Apache Solr. Data can be ingested into Solr through a variety of ways, including LogStash, Flume and other connectors.

 
## IMPORTANT

Pull the repo from the "release" branch; version 1.5.0 will be tagged as v1.5.0

## Banana 1.5.0: Released on 2 January 2015

Banana 1.5.0 contains many new features, new panels, enhancements and bug fixes to improve the overall user experience and stability. Thank you to our growing community for your suggestions and contributions! Please continue sending us your feedback, so that we can further extend and improve Banana!

This release includes the following key new features and improvements:

1. _Multi queries support_ for all panels.
2. A new _Multi-series panel_ based on D3.js provides a way to visualize more complex datasets, such as stock prices.
3. A new _Tag Cloud panel_ helps you to easily create a tag or word cloud from your data using facet count.
4. Various bug fixes and improvements:
    - Fix warnings and errors with grunt jshint. [PR #47](https://github.com/LucidWorks/banana/pull/47)
    - Support log axis for _Terms panel_ panel. [PR #56](https://github.com/LucidWorks/banana/pull/56)
    - Added 'Info' tab to panels that displays rich and customized help messages. [PR #57](https://github.com/LucidWorks/banana/pull/57)
    - Remove "Missing" and "Other" as default options in _Terms panel_.
    - Edit regex in urlLink filter to allow * (ampersand) [Issue #64](https://github.com/LucidWorks/banana/issues/64)
    - Fix individual tooltip in _Range Facet panel_.
    - Fix issue when exporting dashboard to file in Safari.

## Older Release Notes

You can find all previous [Release Notes](https://github.com/LucidWorks/banana/wiki/Release-Notes) on our wiki page.


### Changes to your dashboards
If you created dashboards for Banana 1.0.0, you did not have a global filtering panel. In some cases, these filter values can be implicitly set to defaults that may lead to strange search results. We recommend updating your old dashboards by adding a filtering panel. A good way to do it visually is to put the filtering panel on its own row and hide it when it is not needed.

## Installation and QuickStart

### Requirements
* A modern web browser. The latest version of Chrome and Firefox have been tested to work. Safari also works, except for the "Export to File" feature for saving dashboards. We recommend that you use Chrome or Firefox while building dashboards.
* A webserver. 
* A browser reachable Solr server. The Solr endpoint must be open, or a proxy configured to allow access to it.

### Installation Options

#### Run Banana Web App within your existing Solr instance
Run Solr at least once to create the webapp directories  

		cd $SOLR_HOME/example  
		java -jar start.jar
		
Copy banana folder to $SOLR_HOME/example/solr-webapp/webapp/
 
Browse to http://\<solr\_server\>:\<port\_number\>/solr/banana/src/index.html#/dashboard

If your Solr server/port is different from localhost:8983, edit banana/src/config.js and banana/src/app/dashboards/default.json to enter the hostname and port that you are using. Remember that banana runs within the client browser, so provide a fully qualified domain name (FQDN), because the hostname and port number you provide should be resolvable from the client machines.

If you have not created the data collections and ingested data into Solr, you will see an error message saying "Collection not found at .." You can use any connector to get data into Solr. If you want to use LogStash, please go to the Solr Output Plug-in for LogStash Page (https://github.com/LucidWorks/solrlogmanager) for code, documentation and examples.


#### Complete SLK Stack

LucidWorks has packaged Solr, LogStash (with a Solr Output Plug-in), and Banana (the Solr port of Kibana), along with example collections and dashboards in order to rapidly enable proof-of-concepts and initial development/testing. See http://www.lucidworks.com/lucidworks-silk/. 


#### Building and installing from a war file
Pull the repo from the "release" branch; versions 1.3.0, 1.2.0 and 1.1.0 will be tagged as v1.3.0, v1.2.0 and v1.1.0 respectively.  Run "ant" from within the banana directory to build the war file.

    cd $BANANA_REPO_HOME  
    ant 
     
The war file will be called banana-buildnumber.war and will be located in $BANANA\_REPO\_HOME/build  

    cp $BANANA_REPO_HOME/build/banana-buildnumber.war $SOLR_HOME/example/webapps/banana.war   
    cp $BANANA_REPO_HOME/jetty/banana-context.xml $SOLR_HOME/example/contexts/      

Run Solr:

    cd $SOLR_HOME/example/
    java -jar start.jar    
    
Browse to http://localhost:8983/banana  (or the FQDN of your solr server).

	
#### Banana Web App run in a WebServer

Banana is an AngularJS app and can be run in any webserver that has access to Solr. You will need to enable CORS on the Solr instances that you query, or configure a proxy that makes requests to banana and Solr as same-origin. We typically recommend the latter approach.


#### Storing Dashboards in Solr

If you want to save and load dashboards from Solr, create a collection using the configuration files provided in either the _resources/banana-int-solr-4.4_ (for Solr 4.4) directory or the _resources/banana-int-solr-4.5_ directory (for Solr 4.5 and above). If you are using Solr Cloud, you will need to upload the configuration into ZooKeeper and then create the collection using that configuration.

The Solr server configured in config.js will serve as the default node for each dashboard; you can configure each dashboard to point to a different Solr endpoint as long as your webserver and Solr put out the correct CORS headers. See the README file under the  _resources/enable-cors_ directory for a guide.

## FAQ

__Q__: How do I secure my solr endpoint so that users do not have access to it?   
__A__: The simplest solution is to use a Apache or nginx reverse proxy (See for example https://groups.google.com/forum/#!topic/ajax-solr/pLtYfm83I98).


__Q__: Can I use banana for non-time series data?  
__A__: Yes, from version 1.3 onwards, non-time series data are also supported.


## Resources


1.	LucidWorks SILK: http://www.lucidworks.com/lucidworks-silk/
2.	Webinar on LucidWorks SILK: http://programs.lucidworks.com/SiLK-introduction_Register.html.
3.	LogStash: http://logstash.net/
4.	SILK Use Cases: https://github.com/LucidWorks/silkusecases. Provides example configuration files, schemas and dashboards required to build applications that use Solr and Banana.



## Support

Banana uses the dashboard configuration capabilities of Kibana (from which it is forked) and ports key panels to work with Solr. Moreover, it provides many additional capabilities like heatmaps, range facets, panel specific filters, global parameters, and visualization of "group-by" style queries. We are continuing to add many new panels that go well beyond what is available in Kibana, helping users build complete applications that leverage the data stored in Apache Solr, HDFS and a variety of sources in the enterprise. 

If you have any questions, please contact Andrew Thanalertvisuti (andrew.thanalertvisuti@lucidworks.com) or Ravi Krishnamurthy (ravi.krishnamurthy@lucidworks.com).


## Trademarks

Kibana is a trademark of Elasticsearch BV  
Logstash is a trademark of Elasticsearch BV
