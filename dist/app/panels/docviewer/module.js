/*! banana-fusion - v1.6.28 - 2020-12-09
 * https://github.com/LucidWorks/banana/wiki
 * Copyright (c) 2020 Andrew Thanalertvisuti; Licensed Apache-2.0 */

define("panels/docviewer/module",["angular","app","kbn","underscore"],function(a,b,c,d){"use strict";var e=a.module("kibana.panels.docviewer",[]);b.useModule(e),e.controller("docviewer",["$scope","dashboard","fields","querySrv","filterSrv","$http",function(a,b,c,e,f,g){a.panelMeta={modals:[{description:"Inspect",icon:"icon-info-sign",partial:"app/partials/inspector.html",show:a.panel.spyable}],editorTabs:[{title:"Queries",src:"app/partials/querySelect.html"}],status:"Experimental",description:"Docviewer panel for displaying search results in a document viewer style."},a.docIndex=0,a.data=[];var h={queries:{mode:"all",query:"*:*",custom:""},titleField:"",contentField:"",uniqueKey:"id",max_rows:20,fragsize:0,simplePre:"<mark>",simplePost:"</mark>",spyable:!0,show_queries:!0};d.defaults(a.panel,h),a.init=function(){a.$on("refresh",function(){a.get_data()}),a.get_data();var c=b.current.solr.server+b.current.solr.core_name+"/schema/uniquekey?wt=json&omitHeader=true";g.get(c).then(function(b){a.panel.uniqueKey=b.data.uniqueKey})},a.set_refresh=function(b){a.refresh=b},a.close_edit=function(){a.refresh&&a.get_data(),a.refresh=!1,a.$emit("render")},a.render=function(){a.$emit("render")},a.get_data=function(){a.panelMeta.loading=!0,a.sjs.client.server(b.current.solr.server+b.current.solr.core_name);var c=a.sjs.Request(),d="";f.getSolrFq()&&(d="&"+f.getSolrFq());var g="&wt=json",h="&fl="+a.panel.titleField+" "+a.panel.contentField+" "+a.panel.uniqueKey,i="&rows="+a.panel.max_rows,j="&hl=true&hl.fl="+a.panel.titleField+" "+a.panel.contentField;j+="&hl.fragsize="+a.panel.fragsize,j+="&hl.simple.pre="+a.panel.simplePre+"&hl.simple.post="+a.panel.simplePost,a.panel.queries.query=e.getQuery(0)+d+h+g+i+j,c=null!=a.panel.queries.custom?c.setQuery(a.panel.queries.query+a.panel.queries.custom):c.setQuery(a.panel.queries.query);var k=c.doSearch();k.then(function(b){if(0===b.response.docs.length)return a.data=[],a.docIndex=-1,a.panel.docTitle="",a.panel.docContent="",!1;a.data=b.response.docs,a.highlighting=b.highlighting,a.docIndex=0;var c=a.data[a.docIndex][a.panel.uniqueKey];a.highlighting[c][a.panel.titleField]?a.panel.docTitle=a.highlighting[c][a.panel.titleField]:a.panel.docTitle=a.data[a.docIndex][a.panel.titleField],a.highlighting[c][a.panel.contentField]?a.panel.docContent=a.highlighting[c][a.panel.contentField]:a.panel.docContent=a.data[a.docIndex][a.panel.contentField],a.render()}),a.panelMeta.loading=!1},a.nextDoc=function(){if(a.docIndex<a.data.length-1){a.docIndex++;var b=a.data[a.docIndex][a.panel.uniqueKey];a.highlighting[b][a.panel.titleField]?a.panel.docTitle=a.highlighting[b][a.panel.titleField]:a.panel.docTitle=a.data[a.docIndex][a.panel.titleField],a.highlighting[b][a.panel.contentField]?a.panel.docContent=a.highlighting[b][a.panel.contentField]:a.panel.docContent=a.data[a.docIndex][a.panel.contentField]}},a.prevDoc=function(){if(a.docIndex>0){a.docIndex--;var b=a.data[a.docIndex][a.panel.uniqueKey];a.highlighting[b][a.panel.titleField]?a.panel.docTitle=a.highlighting[b][a.panel.titleField]:a.panel.docTitle=a.data[a.docIndex][a.panel.titleField],a.highlighting[b][a.panel.contentField]?a.panel.docContent=a.highlighting[b][a.panel.contentField]:a.panel.docContent=a.data[a.docIndex][a.panel.contentField]}}}])});