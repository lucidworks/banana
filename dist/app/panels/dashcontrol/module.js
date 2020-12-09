/*! banana-fusion - v1.6.28 - 2020-12-09
 * https://github.com/LucidWorks/banana/wiki
 * Copyright (c) 2020 Andrew Thanalertvisuti; Licensed Apache-2.0 */

define("panels/dashcontrol/module",["angular","app","underscore"],function(a,b,c){"use strict";var d=!1,e=a.module("kibana.panels.dashcontrol",[]);b.useModule(e),e.controller("dashcontrol",["$scope","$http","timer","dashboard","alertSrv",function(a,b,e,f,g){a.panelMeta={status:"Deprecated",description:"This panel has been moved to the navigation bar. See the dashboard setting editor to configure it."},a.panel=a.panel||{};var h={save:{gist:!1,elasticsearch:!0,local:!0,"default":!0},load:{gist:!0,elasticsearch:!0,local:!0},hide_control:!1,elasticsearch_size:20,temp:!0,ttl_enable:!0,temp_ttl:"30d"};c.defaults(a.panel,h),a.init=function(){a.gist_pattern=/(^\d{5,}$)|(^[a-z0-9]{10,}$)|(gist.github.com(\/*.*)\/[a-z0-9]{5,}\/*$)/,a.gist={},a.elasticsearch={}},a.set_default=function(){f.set_default()?g.set("Local Default Set",f.current.title+" has been set as your local default","success",5e3):g.set("Incompatible Browser","Sorry, your browser is too old for this feature","error",5e3)},a.purge_default=function(){f.purge_default()?g.set("Local Default Clear","Your local default dashboard has been cleared","success",5e3):g.set("Incompatible Browser","Sorry, your browser is too old for this feature","error",5e3)},a.elasticsearch_save=function(b,e){f.elasticsearch_save(b,a.elasticsearch.title||f.current.title,!!a.panel.ttl_enable&&e).then(function(e){d&&console.log("result = ",e),c.isUndefined(e.id)?g.set("Save failed","Dashboard could not be saved to Solr","error",5e3):(g.set("Dashboard Saved",'This dashboard has been saved to Solr as "'+e.id+'"',"success",5e3),"temp"===b&&(a.share=f.share_link(f.current.title,"temp",e.id)))})},a.elasticsearch_delete=function(b){f.elasticsearch_delete(b).then(function(d){if(c.isUndefined(d))g.set("Dashboard Not Deleted","An error occurred deleting the dashboard","error",5e3);else if(d.found){g.set("Dashboard Deleted",b+" has been deleted","success",5e3);var e=c.where(a.elasticsearch.dashboards,{_id:b})[0];a.elasticsearch.dashboards=c.without(a.elasticsearch.dashboards,e)}else g.set("Dashboard Not Found","Could not find "+b+" in Solr","warning",5e3)})},a.elasticsearch_dblist=function(b){f.elasticsearch_list(b,a.panel.elasticsearch_size).then(function(b){console.log("result = "+b),console.log(b),c.isUndefined(b.response.docs)||(a.panel.error=!1,a.hits=b.response.numFound,a.elasticsearch.dashboards=b.response.docs)})},a.save_gist=function(){f.save_gist(a.gist.title).then(function(b){c.isUndefined(b)?g.set("Save failed","Gist could not be saved","error",5e3):(a.gist.last=b,g.set("Gist saved",'You will be able to access your exported dashboard file at <a href="'+b+'">'+b+"</a> in a moment","success"))})},a.gist_dblist=function(b){f.gist_list(b).then(function(b){b&&b.length>0?a.gist.files=b:g.set("Gist Failed","Could not retrieve dashboard list from gist","error",5e3)})}}]),e.directive("dashUpload",["timer","dashboard","alertSrv",function(a,b,c){return{restrict:"A",link:function(a){function d(c){for(var d,e=c.target.files,f=function(){return function(c){b.dash_load(JSON.parse(c.target.result)),a.$apply()}},g=0;d=e[g];g++){var h=new FileReader;h.onload=f(d),h.readAsText(d)}}window.File&&window.FileReader&&window.FileList&&window.Blob?document.getElementById("dashupload").addEventListener("change",d,!1):c.set("Oops","Sorry, the HTML5 File APIs are not fully supported in this browser.","error")}}}]),e.filter("gistid",function(){var a=/(\d{5,})|([a-z0-9]{10,})|(gist.github.com(\/*.*)\/[a-z0-9]{5,}\/*$)/;return function(b){if(!c.isUndefined(b)){var d=b.match(a);if(!c.isNull(d)&&!c.isUndefined(d))return d[0].replace(/.*\//,"")}}})});