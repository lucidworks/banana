# Banana

__NOTE__: You have reached the Banana repository. 
The Banana project is a fork of Kibana 3, which can be found at [http://three.kibana.org](http://three.kibana.org)
The goal is to port the code to work with Apache Solr as a backend storage. 
 

## Overview

Banana is Apache Licensed and serves as a visualizer and search interface to timestamped data sets stored in Solr, such as log files, Twitter streams, etc. Banana is designed to be easy to start-up with (just like Kibana from which it is forked). Data can be ingested into Solr through a variety of ways, including Solr Output Plug-in for LogStash, Flume and other connectors.



### Requirements
* A modern web browser. The latest version of Chrome, Safari and Firefox have all been tested to 
work.
* A webserver. So far, we have tested it with Jetty embedded with Solr, but it should work with other webservers.
* A browser reachable Solr server. The Solr endpoint must be open, or a proxy configured to allow 
access to it.

### Installation

#### Complete SLK Stack

We have packaged Solr, the open Source LogStash with Solr Output Plug-in and Banana, along with default collections and dashboards to make it easy for you to get started. The package is available here along with setup instructions (Link to be added)

#### Banana Web App run in a WebServer
1. Pull the develop or release1.0 branch and copy the entire Banana directory to your webserver (if you wish to build a war file first, you simply need to run "ant" from within the banana directory after which you can deploy the war). 
2. Edit config.js to point to the Solr server that will store the Kibana dashboards. You will need to make sure that a collection is created with the appropriate conf directory and schema.xml. Conf directories are available at banana/solr-4.4.0	(for Solr 4.4) and banana/solr-4.5.0 (for 4.5 and later).
3. The Solr server configured in config.js will serve as the default node for each dashboard; you can configure each dashboard to point to a different Solr endpoint as long as your webserver puts out the correct CORS headers.
3. Point your browser at your installation.

#### Banana Web App run within existing Solr instance
1. If this is a fresh install of Solr, start it once from <SOLR_HOME>/example directory using the command "java - jar start.jar" This will deploy the Solr webapp and create the appropriate directories.
2. Deploying from a war file: 
	a. Put banana.war in the 


### FAQ

__Q__: How do I secure my solr endpoint so that users do not have access to it? 
__A__: The simplest solution is to use a nginx reverse proxy (See for example https://groups.google.com/forum/#!topic/ajax-solr/pLtYfm83I98).

### Support

Banana preserves most of the features of Kibana (from which it is forked).

Introduction videos on Kibana can be found at [http://three.kibana.org/about.html](http://three.kibana.org/about.html)  


###Trademarks

Kibana is a trademark of Elasticsearch BV
Logstash is a trademark of Elasticsearch BV



