Zookeeper Rest Server and JSONP support
==================================================
[Zookeeper Rest Server](https://github.com/apache/zookeeper/tree/trunk/src/contrib/rest)
supports [JSONP](http://en.wikipedia.org/wiki/JSONP) by default, but 
due to the preference order of return types, it will always return 
JSON unless 
    {Accept: "application/javascript"} 
header is not present in the request made. Since, the browser always 
adds Accept:*/* header for scripts(JSONP uses script tag), we need to 
change the preference order of return types in Zookeeper Rest server 
to get proper JSONP.

How to enable JSONP access in Zookeeper Rest server
===================================================
1.  Before compiling and running [Zookeeper Rest Server](https://github.com/apache/zookeeper/tree/trunk/src/contrib/rest)
    apply the patch file zookeeper-3.4.6.patch to the zookeeper project.
    To apply the patch, issue the following command:
    ```
    cd zookeeper-3.4.6
    patch -p1 < /path/to/patch/file(zookeeper.3.4.6.patch)
    ```

2.  Now compile and run Zookeeper rest server as mentioned [here](https://github.com/apache/zookeeper/tree/trunk/src/contrib/rest) 
