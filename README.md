# Banana

The Banana project was forked from Kibana, and works with all kinds of time series (and non-time series) data stored in Apache Solr. It uses Kibana's powerful dashboard configuration capabilities, ports key panels to work with Solr, and provides significant additional capabilities, including new panels that leverage D3.js. 

The goal is to create a rich and flexible UI, enabling users to rapidly develop end-to-end applications that leverage the power of Apache Solr. Data can be ingested into Solr through a variety of ways, including LogStash, Flume and other connectors.

 
## IMPORTANT

Pull the repo from the "release" branch; version 1.3 will be tagged as banana-1.3.

## Banana 1.3: Released on 10 June 2014

Banana 1.3 improves on its already powerful capability to visualize and interpret generalized time series data (banana is not only used to search log files, but also visualize social media streams, call center logs, medical records, and etc.). It starts leveraging the power of D3.js (data-driven documents) and provides new panels and enhancements, while also allowing visualization of non-time series data. Key new features include:

1. Stats and aggregations are now available in the _Terms_ and _Map_ panels. In addition to count mode, you can now visualize stats such as mean, max, min, sum, etc.
2. A new _Range Facet_ panel allows you to visualize and graphically explore distributions on numeric fields, with selections being reflected across the entire dashboard.
3. A new _Heatmap_ panel provides for visualization of the powerful pivot faceting capability of Solr.
4. A new _Ticker_ panel provides a stock ticker like representation of trends in your time series data.
5. The _Export_ functionality in the the _Table Module_ has been optimized for vastly improved performance and now allows you to export only a subset of the fields in the returned documents.
6. Previous versions required a _Timepicker_ and time fields set in all panels for them to work. We have cleaned up the code so that it will now work without a _Timepicker_ and a time filter, which will help visualize non-time series data. The time field provided in the _Timepicker_ is used by all panels.
7. General improvements in the UI and in-product help documentation makes Banana 1.3 easier to use.
8. The directory structure is now cleaned up and legacy files have been removed. Instructions for enabling CORS in Solr and for setting the schema/config for banana's internal collections are now  contained in the _resources_ directory. 

## Banana 1.2: Released on 11 May 2014

Following release 1.1, we have addressed a number of user requests, including:

1.	This release provides panels for representing geo-spatial data—a _map_ module that provides a heat map-style representation based on two-letter country codes or US state codes, and a _bettermap_ module that provides a clustered representation of location (_LatLonType_) data.
2.	The _Table Module_ now has a Save button that enables you to save to csv, JSON or XML formats so that you can use other tools like MS Excel for further analysis. The number of rows downloaded will be equal to number of “pageable” hits configured in the _Paging_ tab within the _Table Panel Configuration Menu_ (accessed by clicking on the cog wheel icon near the top right of the table panel).
3.	You can now control whether a dashboard can be saved and/or edited from the _Editable_ checkbox in the _General_ tab, and the _Controls_ tab, both within the _Dashboard Configurator_ (accessed from the cog-wheel icon to very top and right of dashboard).
4.	We have added a _hits_ panel that provides you with the number of matching results returned while using the global query parameters. This is useful if you want to make the number prominent or if you are not using the histogram panel prominently.
5.	You can now provide additional _Global Query Parameters_ that apply to all panels of the dashboard from the _Solr_ tab in the _Dashboard Configurator_. Among other uses, this feature is invaluable for:
    *	Specifying a custom query parser (Solr query parameter: &defType) or search handler (&qt)
    *	Specifying a user type for use in custom business rules at the Solr server.
    *	Specifying default search fields (&df)
6.	We fixed a bug in the _values_ mode within the _histogram_ module, where missing values were previously assumed to be zero. This led to jagged graphs when the “group by” option was used. We no longer set them to zero but rather have the individual lines skip the missing values.
7.	In the _Absolute Time_ and _Since_ modes, the _timepicker_ used to skip back one day if your browser time was behind UTC. This issue has now been fixed.
8.	Banana 1.1 hardcoded certain default search fields (df's) to work with our LogStash output writer. Specifically, it hardcoded a df=message. This means that your old dashboards may not be fetching query results with Banana 1.2, though they were doing so with 1.1. To fix this, add a _Global Query Parameter_ &df=message (or whatever field you want to search on) within the _Dashboard Configurator._ Alternately, you can set the default search field in your solrconfig (recommended).  


## Banana 1.1 is here!

We have added a number of exciting new features and fixed key issues, including:

1. You can now add a _Filtering panel_ that supports global filter queries (fq's). Now, if you click on a facet in the terms panel, the results will be filtered for that particular value.
2. The _terms_, _histogram_ and _table_ modules allow you to specify a panel-specific filter query (within the _Query Tab_ while configuring the panel) allowing greater flexibility in designing dashboards.
3. The _inspector_ icon on these panels shows the Solr query, which is very useful for debugging dashboards.
4. The _Histogram_ module allows you to plot values in addition to counts. It also allows you to group values by another field. This would be useful if for example you plot CPU utilization over time and want to group by hostname.
5. The sort operation in the _Table_ module is now fixed and works correctly on single-valued fields.
6. We have refactored the code to enable easier addition of new modules and fixes to existing modules.

### Changes to your dashboards
If you created dashboards for Banana 1.0, you did not have a global filtering panel. In some cases, these filter values can be implicitly set to defaults that may lead to strange search results. We recommend updating your old dashboards by adding a filtering panel. A good way to do it visually is to put the filtering panel on its own row and hide it when it is not needed.

## Installation and QuickStart

### Requirements
* A modern web browser. The latest version of Chrome and Firefox have been tested to work. Safari also works, except for the "Export to File" feature for saving dashboards. We recommend that you use Chrome or Firefox while building dashboards.
* A webserver. 
* A browser reachable Solr server. The Solr endpoint must be open, or a proxy configured to allow access to it.


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
Pull the repo from the "release" branch; versions 1.3, 1.2 and 1.1 will be tagged as banana-1.3, banana-1.2 and banana-1.1 respectively.  Run "ant" from within the banana directory to build the war file.

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

Banana is a an Angular.JS app and can be run in any webserver that has access to Solr. You will need to enable CORS on the Solr instances that you query, or configure a proxy that makes requests to banana and Solr as same-origin. We typically recommend the latter approach.


#### Storing Dashboards in Solr

If you want to save and load dashboards from Solr, create a collection using the configuration files provided in either resources/banana-int-solr-4.4 (for Solr 4.4) or resources/banana-int-solr-4.5 (for Solr 4.5 and above). If you are using Solr Cloud, you will need to upload the configuration into ZooKeeper and then create the collection using that configuration.

The Solr server configured in config.js will serve as the default node for each dashboard; you can configure each dashboard to point to a different Solr endpoint as long as your webserver and Solr put out the correct CORS headers. See the README file under the directory resources/enable-cors for a guide.

## FAQ

__Q__: How do I secure my solr endpoint so that users do not have access to it?   
__A__: The simplest solution is to use a Apache or nginx reverse proxy (See for example https://groups.google.com/forum/#!topic/ajax-solr/pLtYfm83I98).


__Q__ : Can I use banana for non-time series data?  
__A__:  Yes, from version 1.3 onwards, non-time series data are also supported.


### Support

Banana uses the dashboard configuration capabilities of Kibana (from which it is forked) and ports key panels to work with Solr; it provides many additional capabilities like heatmaps, range facets, panel specific filters, global parameters, and visualization of "group-by" style queries. We are in the continuing to add many new panels that go well beyond what is available in Kibana, helping users build complete applications that leverage the data stored in Apache Solr and HDFS. 

If you have any questions, please contact Andrew Thanalertvisuti (andrew.thanalertvisuti@lucidworks.com) or Ravi Krishnamurthy (ravi.krishnamurthy@lucidworks.com).


###Trademarks

Kibana is a trademark of Elasticsearch BV  
Logstash is a trademark of Elasticsearch BV