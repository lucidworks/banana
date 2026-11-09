# Allowing Banana to call a Solr server on another origin (CORS)

Banana runs in the browser. When the page is served from one origin (scheme, host and port) and Solr from another,
the browser only lets Banana read Solr's answers if Solr sends
[CORS](https://developer.mozilla.org/docs/Web/HTTP/CORS) headers that allow the page's origin.

**Prefer not to need this.** Serving Banana and Solr from the same origin, for example behind a reverse proxy that
forwards `/solr` to Solr, needs no CORS configuration and keeps Solr off the open network. Use CORS only when that is
not possible.

> **Warning: list the exact origins, and never use `*` together with credentials.**
> A filter that allows every origin (`*`) lets any web page a user visits read from your Solr server using the
> user's network position, which can expose a Solr instance that is only reachable from inside your network. Never
> combine `*` with `allowCredentials` set to `true`. Allow only the origin of the page that serves Banana, for example
> `https://banana.example.com`, and set `allowCredentials` to `false` explicitly unless Solr sits behind authentication
> that really needs credentials. **Jetty's `CrossOriginFilter` treats a missing `allowCredentials` parameter as `true`**
> (see the Jetty documentation under References), so leaving the parameter out turns credentials on. Do not copy configuration from old blog posts or earlier versions of this guide that used a wildcard.

This guide does not ship any jar files. It describes the configuration for Solr's bundled Jetty; the file locations and
the Jetty version depend on your Solr release, so check the Solr and Jetty documentation for your version
(see References) before you edit anything.

## Steps

1. Make sure your Solr installation has Jetty's `CrossOriginFilter` class
   (`org.eclipse.jetty.servlets.CrossOriginFilter`, in the `jetty-servlets` jar). Many Solr releases include it in the
   `server/lib` directory; if yours does not, obtain the jar that matches the Jetty version of your Solr from the Jetty
   project. Do not mix Jetty versions.

2. Find the default web descriptor of the web application Solr runs in. In a standard Solr install this is
   usually `server/etc/webdefault.xml`. Back the file up first.

3. Insert a filter like the one below right after the opening `<web-app>` element and before any other `<filter>`
   element, so that it runs first. Replace the origin with the origin that serves Banana. Several origins are
   separated by commas.

   ```xml
   <!-- Allow Banana, served from https://banana.example.com, to call this Solr server -->
   <filter>
     <filter-name>cross-origin</filter-name>
     <filter-class>org.eclipse.jetty.servlets.CrossOriginFilter</filter-class>
     <init-param>
       <param-name>allowedOrigins</param-name>
       <param-value>https://banana.example.com</param-value>
     </init-param>
     <init-param>
       <param-name>allowedMethods</param-name>
       <param-value>GET,POST,OPTIONS,HEAD</param-value>
     </init-param>
     <init-param>
       <param-name>allowedHeaders</param-name>
       <param-value>origin,content-type,accept</param-value>
     </init-param>
     <!-- The filter's default is true. Set it explicitly. -->
     <init-param>
       <param-name>allowCredentials</param-name>
       <param-value>false</param-value>
     </init-param>
   </filter>

   <filter-mapping>
     <filter-name>cross-origin</filter-name>
     <url-pattern>/*</url-pattern>
   </filter-mapping>
   ```

   Add `PUT` and `DELETE` to `allowedMethods` only if you need Banana to save and delete dashboards in a Solr
   collection from the browser. Keep `allowCredentials` at `false` unless you must send credentials cross-origin, and then
   only with an explicit origin list as above, never `*`.

4. Restart Solr, open Banana from the allowed origin, and check in the browser's developer tools that Solr's
   responses carry an `Access-Control-Allow-Origin` header with your origin, and that a request from any other origin
   does not get one.

The change applies to every path of the web application Solr serves, including its admin and API endpoints. Keep the
origin list short, and keep Solr itself behind your network controls and authentication.

## References

1. Jetty documentation for the CrossOriginFilter (its init parameters and their defaults, including `allowCredentials`), for the Jetty version in your Solr release: https://eclipse.dev/jetty/documentation/
2. Solr Reference Guide for your version (web server configuration and security): https://solr.apache.org/guide/
