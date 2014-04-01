# Banana

__NOTE__: You have reached the Banana repository. 
The Banana project is a fork of Kibana 3, which can be found at [http://three.kibana.org](http://three.kibana.org)
The goal is to port the code to work with time series data stored in Apache Solr. 
 
## IMPORTANT

Pull the repo from the "release" branch; version 1.1 will be tagged as banana-1.1.

## Banana 1.1 is here!

We have added a number of exciting new features and fixed key issues, including:
* You can now add a Filtering panel that supports global filter queries (fq's). Now, if you click on a facet in the terms panel, the results will be filtered for that particular value.
* The terms, histogram and table modules allow you to specify a panel-specific filter query (within the Query Tab while configuring the panel) allowing greater flexibility in designing dashboards.
* The inspector icon on these panels shows the Solr query, which is very useful for debugging dashboards.
* The Histogram module allows you to plot values in addition to counts. It also allows you to group values by another field. This would be useful if for example you plot CPU utilization over time and want to group by hostname.
* The sort operation in the Table module is now fixed and works correctly on single-valued fields.
* We have refactored the code to enable easier addition of new modules and fixes to existing modules.

### Changes to your dashboards
If you created dashboards for Banana 1.0, you did not have a global filtering panel. In some cases, these filter values can be implicitly set to defaults that may lead to strange search results. We recommend updating your old dashboards by adding a filtering panel. A good way to do it visually is to put the filtering panel on its own row and hide it when it is not needed.

## Overview

Banana is Apache Licensed and serves as a visualizer and search interface to timestamped data sets stored in Solr, such as log files, Twitter streams, etc. Banana is designed to be easy to start-up with (just like Kibana from which it is forked). Data can be ingested into Solr through a variety of ways, including Solr Output Plug-in for LogStash, Flume and other connectors.


### Requirements
* A modern web browser. The latest version of Chrome, Safari and Firefox have been tested to work.
* A webserver. 
* A browser reachable Solr server. The Solr endpoint must be open, or a proxy configured to allow access to it.

### Installation and QuickStart


#### Run Banana Web App within your existing Solr instance
Run Solr at least once to create the webapp directories  

		cd $SOLR_HOME/example  
		java -jar start.jar
		
Copy banana folder to $SOLR_HOME/example/solr-webapp/webapp/
 
Browse to http://localhost:8983/solr/banana/src/index.html#/dashboard


If your Solr port is different, edit banana/src/config.js and enter the port you are using.

If you have not created the data collections and ingested data into Solr, you will see an error message saying "Collection not found at .." Go to the Solr Output Plug-in for LogStash  Page (https://github.com/LucidWorks/solrlogmanager) to learn how to import data into your Solr instance using LogStash

If you want to save and load dashboards from Solr, copy either solr-4.4.0/kibana-int (for Solr 4.4) or solr-4.5.0/kibana-int (for Solr 4.5 and above) directories (as appropriate) into $SOLR_HOME/example/solr in order to setup the required core. Then restart Solr, and if it is not loaded already, load the core from Solr Admin (if you are using Solr Cloud, you will need to upload the 


#### QuickStart for Complete SLK Stack

We have packaged Solr, the open Source LogStash with Solr Output Plug-in and Banana, along with example collections and dashboards to make it easy for you to get started. The package is available here at http://www.lucidworks.com/lucidworks-silk/. Unzip the package and:  
1. Run Solr  

    cd slk4.7.0/solr-4.7.0/example-logs
    java -jar start.jar  
     
Browse to http://localhost:8983/banana 
 
You will see example dashboards which you can use as a starting point for your applications.
Once again, if you choose to run Solr on a different port, please edit the config.js file.

THAT'S IT! Now you have a baseline that you can use to build your own applications.


#### Running from a war file
Pull the repo from the "release" branch; version 1.1 will be tagged as banana-1.1.  Run "ant" from within the banana directory to build the war file.

    cd $BANANA_REPO_HOME  
    ant 
     
The war file will be called banana-buildnumber.war and will be located in $BANANA_REPO_HOME/build  


Copy $BANANA_REPO_HOME/build/banana-buildnumber.war to $SOLR_HOME/example/webapps/banana.war   
Copy $BANANA_REPO_HOME/jetty/banana-context.xml  to $SOLR_HOME/example/contexts/      
Run Solr:

    cd $SOLR_HOME/example/
    java -jar start.jar    
    
Browse to http://localhost:8983/banana  

	
#### Banana Web App run in a WebServer

Edit config.js to point to the Solr server that will store the Banana dashboards. You will need to make sure that a collection is created with the appropriate conf directory and schema.xml. Conf directories are available at banana/solr-4.4.0	(for Solr 4.4) and banana/solr-4.5.0 (for 4.5 and later).

The Solr server configured in config.js will serve as the default node for each dashboard; you can configure each dashboard to point to a different Solr endpoint as long as your webserver and Solr put out the correct CORS headers. See the README file under the directory fix_cors_issue for a guide.

Point your browser at your installation based on the contexts you have configured.



## FAQ

__Q__: How do I secure my solr endpoint so that users do not have access to it?   
__A__: The simplest solution is to use a nginx reverse proxy (See for example https://groups.google.com/forum/#!topic/ajax-solr/pLtYfm83I98).


_Q_: The timestamp field in my data is different from "event_timestamp". How do I modify my dashboards to account for this?   
_A_: By default, Banana assumes that the time field is "event_timestamp" If your time field is different you will just need to manually change it in ALL panels. We are reviewing this design (of allowing different time fields for different panels) and may move to one time field for all panels, based on user feedback.

_Q_ : Can I use banana for non-time series data?
_A_: Currently, we are focused on time series data and the dashboards will nto work correctly without a time picker and without configuring the time field in the terms, histogram and table panles. However, in many cases you can use the following workaround, if you are at least storing a timestamp indicating the indexing time of the document:
Create a time picker panel in its own row and move the row to the bottom. Select the time field and then set the date range to be "Since 01/01/2000" (or starting even earlier if necessary). Use the same time field in the other terms panels, and you can get beautiful visualizations of facets.

### Support

Banana preserves most of the features of Kibana (from which it is forked). If you have any questions, please contact Andrew Thanalertvisuti (andrew.thanalertvisuti@lucidworks.com) or Ravi Krishnamurthy (ravi.krishnamurthy@lucidworks.com).


###Trademarks

Kibana is a trademark of Elasticsearch BV  
Logstash is a trademark of Elasticsearch BV



