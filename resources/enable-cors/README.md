# How to Fix CORS issue for Solr
## Solr 6
1. Edit `$SOLR_HOME/server/etc/webdefault.xml` by inserting the following `<filter>` configuration right after `<web-app>` and before the other `<filter>`, OR you can just use the `webdefault.xml` file in this directory.

    **Note**: The order of `<filter>` does matter!

        <!-- =================================== -->
        <!--      Enable CORS for Banana         -->
        <!-- =================================== -->
        <filter>
          <filter-name>cross-origin</filter-name>
          <filter-class>org.eclipse.jetty.servlets.CrossOriginFilter</filter-class>
          <init-param>
            <param-name>allowedOrigins</param-name>
            <param-value>*</param-value>
          </init-param>
          <init-param>
            <param-name>allowedMethods</param-name>
            <param-value>GET,POST,OPTIONS,DELETE,PUT,HEAD</param-value>
          </init-param>
          <init-param>
            <param-name>allowedHeaders</param-name>
            <param-value>origin, content-type, accept</param-value>
          </init-param>
        </filter>
      
        <filter-mapping>
          <filter-name>cross-origin</filter-name>
          <url-pattern>/*</url-pattern>
        </filter-mapping>

2. That's it. Restart Solr and it should work!

## Solr 5
1. Copy two jar files into `$SOLR_HOME/server/lib/`:
      - jetty-servlets-8.1.10.v20130312.jar
      - jetty-util-8.1.10.v20130312.jar
      
      **Note**:  Jetty files v9.x.x do not work.

2. Edit `$SOLR_HOME/server/etc/webdefault.xml` by inserting the `<filter>` configuration from step #1 for Solr 6. Put it right after `<web-app>` and before the other `<filter>`, OR you can just use the web.xml file in this directory.

3. That's it. Restart Solr and it should work!

## Solr 4
1. Copy two jar files into `$SOLR_HOME/example/solr-webapp/webapp/WEB-INF/lib/`:
      - jetty-servlets-8.1.14.v20131031.jar
      - jetty-util-8.1.14.v20131031.jar
      
      **Note**:  Jetty files v9.x.x do not work.

2. Edit `$SOLR_HOME/example/solr-webapp/webapp/WEB-INF/web.xml` by inserting the `<filter>` configuration from step #1 for Solr 6. Put it right after `<web-app>` and before the other `<filter>`, OR you can just use the web.xml file in this directory.

3. That's it. Restart Solr and it should work!

## References:
1. https://www.eclipse.org/jetty/documentation/9.4.x/cross-origin-filter.html
