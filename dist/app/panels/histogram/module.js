/*! banana-fusion - v1.6.28 - 2020-12-09
 * https://github.com/LucidWorks/banana/wiki
 * Copyright (c) 2020 Andrew Thanalertvisuti; Licensed Apache-2.0 */

define("panels/histogram/interval",["kbn"],function(a){"use strict";function b(b){this.string=b;var c=a.describe_interval(b);this.type=c.type,this.ms=1e3*c.sec*c.count,"y"===this.type||"M"===this.type?(this.get=this.get_complex,this.date=new Date(0)):this.get=this.get_simple}return b.prototype={toString:function(){return this.string},after:function(a){return this.get(a,1)},before:function(a){return this.get(a,-1)},get_complex:function(a,b){switch(this.date.setTime(a),this.type){case"M":this.date.setUTCMonth(this.date.getUTCMonth()+b);break;case"y":this.date.setUTCFullYear(this.date.getUTCFullYear()+b)}return this.date.getTime()},get_simple:function(a,b){return a+b*this.ms}},b}),define("panels/histogram/timeSeries",["underscore","./interval"],function(a,b){"use strict";function c(a){return parseInt(a,10)}function d(a){return 1e3*Math.floor(a.getTime()/1e3)}var e={};return e.ZeroFilled=function(c){c=a.defaults(c,{interval:"10m",start_date:null,end_date:null,fill_style:"minimal"}),this.interval=new b(c.interval),this._data={},this.start_time=c.start_date&&d(c.start_date),this.end_time=c.end_date&&d(c.end_date),this.opts=c},e.ZeroFilled.prototype.addValue=function(b,e){b=b instanceof Date?d(b):c(b),isNaN(b)||(this._data[b]=a.isUndefined(e)?0:e),this._cached_times=null},e.ZeroFilled.prototype.sumValue=function(b,e){if(b=b instanceof Date?d(b):c(b),!isNaN(b)){var f=0;isNaN(this._data[b])||(f=this._data[b]),this._data[b]=f+(a.isUndefined(e)?0:e)}this._cached_times=null},e.ZeroFilled.prototype.getOrderedTimes=function(b){var d=a.map(a.keys(this._data),c);return a.isArray(b)&&(d=d.concat(b)),a.uniq(d.sort(function(a,b){return a-b}),!0)},e.ZeroFilled.prototype.getFlotPairs=function(b){var c,d,e=this.getOrderedTimes(b);return c="all"===this.opts.fill_style?this._getAllFlotPairs:this._getMinFlotPairs,d=a.reduce(e,c,[],this),this.start_time&&(0===d.length||d[0][0]>this.start_time)&&d.unshift([this.start_time,null]),this.end_time&&(0===d.length||d[d.length-1][0]<this.end_time)&&d.push([this.end_time,null]),d},e.ZeroFilled.prototype._getMinFlotPairs=function(a,b,c,d){var e,f,g,h;return c>0&&(g=d[c-1],h=this.interval.before(b),g<h&&a.push([h,0])),a.push([b,this._data[b]||0]),d.length>c&&(e=d[c+1],f=this.interval.after(b),e>f&&a.push([f,0])),a},e.ZeroFilled.prototype._getAllFlotPairs=function(a,b,c,d){var e,f;for(a.push([d[c],this._data[d[c]]||0]),e=d[c+1],f=this.interval.after(b);d.length>c&&e>f;f=this.interval.after(f))a.push([f,0]);return a},e}),function(a){function b(b){function c(a){o.active&&(j(a),b.getPlaceholder().trigger("plotselecting",[f()]))}function d(b){1==b.which&&(document.body.focus(),void 0!==document.onselectstart&&null==p.onselectstart&&(p.onselectstart=document.onselectstart,document.onselectstart=function(){return!1}),void 0!==document.ondrag&&null==p.ondrag&&(p.ondrag=document.ondrag,document.ondrag=function(){return!1}),i(o.first,b),o.active=!0,q=function(a){e(a)},a(document).one("mouseup",q))}function e(a){return q=null,void 0!==document.onselectstart&&(document.onselectstart=p.onselectstart),void 0!==document.ondrag&&(document.ondrag=p.ondrag),o.active=!1,j(a),n()?g():(b.getPlaceholder().trigger("plotunselected",[]),b.getPlaceholder().trigger("plotselecting",[null])),!1}function f(){if(!n())return null;if(!o.show)return null;var c={},d=o.first,e=o.second;return a.each(b.getAxes(),function(a,b){if(b.used){var f=b.c2p(d[b.direction]),g=b.c2p(e[b.direction]);c[a]={from:Math.min(f,g),to:Math.max(f,g)}}}),c}function g(){var a=f();b.getPlaceholder().trigger("plotselected",[a]),a.xaxis&&a.yaxis&&b.getPlaceholder().trigger("selected",[{x1:a.xaxis.from,y1:a.yaxis.from,x2:a.xaxis.to,y2:a.yaxis.to}])}function h(a,b,c){return b<a?a:b>c?c:b}function i(a,c){var d=b.getOptions(),e=b.getPlaceholder().offset(),f=b.getPlotOffset();a.x=h(0,c.pageX-e.left-f.left,b.width()),a.y=h(0,c.pageY-e.top-f.top,b.height()),"y"==d.selection.mode&&(a.x=a==o.first?0:b.width()),"x"==d.selection.mode&&(a.y=a==o.first?0:b.height())}function j(a){null!=a.pageX&&(i(o.second,a),n()?(o.show=!0,b.triggerRedrawOverlay()):k(!0))}function k(a){o.show&&(o.show=!1,b.triggerRedrawOverlay(),a||b.getPlaceholder().trigger("plotunselected",[]))}function l(a,c){var d,e,f,g,h=b.getAxes();for(var i in h)if(d=h[i],d.direction==c&&(g=c+d.n+"axis",a[g]||1!=d.n||(g=c+"axis"),a[g])){e=a[g].from,f=a[g].to;break}if(a[g]||(d="x"==c?b.getXAxes()[0]:b.getYAxes()[0],e=a[c+"1"],f=a[c+"2"]),null!=e&&null!=f&&e>f){var j=e;e=f,f=j}return{from:e,to:f,axis:d}}function m(a,c){var d,e=b.getOptions();"y"==e.selection.mode?(o.first.x=0,o.second.x=b.width()):(d=l(a,"x"),o.first.x=d.axis.p2c(d.from),o.second.x=d.axis.p2c(d.to)),"x"==e.selection.mode?(o.first.y=0,o.second.y=b.height()):(d=l(a,"y"),o.first.y=d.axis.p2c(d.from),o.second.y=d.axis.p2c(d.to)),o.show=!0,b.triggerRedrawOverlay(),!c&&n()&&g()}function n(){var a=b.getOptions().selection.minSize;return Math.abs(o.second.x-o.first.x)>=a&&Math.abs(o.second.y-o.first.y)>=a}var o={first:{x:-1,y:-1},second:{x:-1,y:-1},show:!1,active:!1},p={},q=null;b.clearSelection=k,b.setSelection=m,b.getSelection=f,b.hooks.bindEvents.push(function(a,b){var e=a.getOptions();null!=e.selection.mode&&(b.mousemove(c),b.mousedown(d))}),b.hooks.drawOverlay.push(function(b,c){if(o.show&&n()){var d=b.getPlotOffset(),e=b.getOptions();c.save(),c.translate(d.left,d.top);var f=a.color.parse(e.selection.color);c.strokeStyle=f.scale("a",.8).toString(),c.lineWidth=1,c.lineJoin=e.selection.shape,c.fillStyle=f.scale("a",.4).toString();var g=Math.min(o.first.x,o.second.x)+.5,h=Math.min(o.first.y,o.second.y)+.5,i=Math.abs(o.second.x-o.first.x)-1,j=Math.abs(o.second.y-o.first.y)-1;c.fillRect(g,h,i,j),c.strokeRect(g,h,i,j),c.restore()}}),b.hooks.shutdown.push(function(b,e){e.unbind("mousemove",c),e.unbind("mousedown",d),q&&a(document).unbind("mouseup",q)})}a.plot.plugins.push({init:b,options:{selection:{mode:null,color:"#e8cfac",shape:"round",minSize:5}},name:"selection",version:"1.1"})}(jQuery),define("jquery.flot.selection",["jquery","jquery.flot"],function(){}),function(a){function b(a,b){return b*Math.floor(a/b)}function c(a,b,c,d){if("function"==typeof a.strftime)return a.strftime(b);var e=function(a,b){return a=""+a,b=""+(null==b?"0":b),1==a.length?b+a:a},f=[],g=!1,h=a.getHours(),i=h<12;null==c&&(c=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]),null==d&&(d=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]);var j;j=h>12?h-12:0==h?12:h;for(var k=0;k<b.length;++k){var l=b.charAt(k);if(g){switch(l){case"a":l=""+d[a.getDay()];break;case"b":l=""+c[a.getMonth()];break;case"d":l=e(a.getDate());break;case"e":l=e(a.getDate()," ");break;case"h":case"H":l=e(h);break;case"I":l=e(j);break;case"l":l=e(j," ");break;case"m":l=e(a.getMonth()+1);break;case"M":l=e(a.getMinutes());break;case"q":l=""+(Math.floor(a.getMonth()/3)+1);break;case"S":l=e(a.getSeconds());break;case"y":l=e(a.getFullYear()%100);break;case"Y":l=""+a.getFullYear();break;case"p":l=i?"am":"pm";break;case"P":l=i?"AM":"PM";break;case"w":l=""+a.getDay()}f.push(l),g=!1}else"%"==l?g=!0:f.push(l)}return f.join("")}function d(a){function b(a,b,c,d){a[b]=function(){return c[d].apply(c,arguments)}}var c={date:a};void 0!=a.strftime&&b(c,"strftime",a,"strftime"),b(c,"getTime",a,"getTime"),b(c,"setTime",a,"setTime");for(var d=["Date","Day","FullYear","Hours","Milliseconds","Minutes","Month","Seconds"],e=0;e<d.length;e++)b(c,"get"+d[e],a,"getUTC"+d[e]),b(c,"set"+d[e],a,"setUTC"+d[e]);return c}function e(a,b){if("browser"==b.timezone)return new Date(a);if(b.timezone&&"utc"!=b.timezone){if("undefined"!=typeof timezoneJS&&"undefined"!=typeof timezoneJS.Date){var c=new timezoneJS.Date;return c.setTimezone(b.timezone),c.setTime(a),c}return d(new Date(a))}return d(new Date(a))}function f(d){d.hooks.processOptions.push(function(d,f){a.each(d.getAxes(),function(a,d){var f=d.options;"time"==f.mode&&(d.tickGenerator=function(a){var c=[],d=e(a.min,f),g=0,i=f.tickSize&&"quarter"===f.tickSize[1]||f.minTickSize&&"quarter"===f.minTickSize[1]?k:j;null!=f.minTickSize&&(g="number"==typeof f.tickSize?f.tickSize:f.minTickSize[0]*h[f.minTickSize[1]]);for(var l=0;l<i.length-1&&!(a.delta<(i[l][0]*h[i[l][1]]+i[l+1][0]*h[i[l+1][1]])/2&&i[l][0]*h[i[l][1]]>=g);++l);var m=i[l][0],n=i[l][1];if("year"==n){if(null!=f.minTickSize&&"year"==f.minTickSize[1])m=Math.floor(f.minTickSize[0]);else{var o=Math.pow(10,Math.floor(Math.log(a.delta/h.year)/Math.LN10)),p=a.delta/h.year/o;m=p<1.5?1:p<3?2:p<7.5?5:10,m*=o}m<1&&(m=1)}a.tickSize=f.tickSize||[m,n];var q=a.tickSize[0];n=a.tickSize[1];var r=q*h[n];"second"==n?d.setSeconds(b(d.getSeconds(),q)):"minute"==n?d.setMinutes(b(d.getMinutes(),q)):"hour"==n?d.setHours(b(d.getHours(),q)):"month"==n?d.setMonth(b(d.getMonth(),q)):"quarter"==n?d.setMonth(3*b(d.getMonth()/3,q)):"year"==n&&d.setFullYear(b(d.getFullYear(),q)),d.setMilliseconds(0),r>=h.minute&&d.setSeconds(0),r>=h.hour&&d.setMinutes(0),r>=h.day&&d.setHours(0),r>=4*h.day&&d.setDate(1),r>=2*h.month&&d.setMonth(b(d.getMonth(),3)),r>=2*h.quarter&&d.setMonth(b(d.getMonth(),6)),r>=h.year&&d.setMonth(0);var s,t=0,u=Number.NaN;do if(s=u,u=d.getTime(),c.push(u),"month"==n||"quarter"==n)if(q<1){d.setDate(1);var v=d.getTime();d.setMonth(d.getMonth()+("quarter"==n?3:1));var w=d.getTime();d.setTime(u+t*h.hour+(w-v)*q),t=d.getHours(),d.setHours(0)}else d.setMonth(d.getMonth()+q*("quarter"==n?3:1));else"year"==n?d.setFullYear(d.getFullYear()+q):d.setTime(u+r);while(u<a.max&&u!=s);return c},d.tickFormatter=function(a,b){var d=e(a,b.options);if(null!=f.timeformat)return c(d,f.timeformat,f.monthNames,f.dayNames);var g,i=b.options.tickSize&&"quarter"==b.options.tickSize[1]||b.options.minTickSize&&"quarter"==b.options.minTickSize[1],j=b.tickSize[0]*h[b.tickSize[1]],k=b.max-b.min,l=f.twelveHourClock?" %p":"",m=f.twelveHourClock?"%I":"%H";g=j<h.minute?m+":%M:%S"+l:j<h.day?k<2*h.day?m+":%M"+l:"%b %d "+m+":%M"+l:j<h.month?"%b %d":i&&j<h.quarter||!i&&j<h.year?k<h.year?"%b":"%b %Y":i&&j<h.year?k<h.year?"Q%q":"Q%q %Y":"%Y";var n=c(d,g,f.monthNames,f.dayNames);return n})})})}var g={xaxis:{timezone:null,timeformat:null,twelveHourClock:!1,monthNames:null}},h={second:1e3,minute:6e4,hour:36e5,day:864e5,month:2592e6,quarter:7776e6,year:525949.2*60*1e3},i=[[1,"second"],[2,"second"],[5,"second"],[10,"second"],[30,"second"],[1,"minute"],[2,"minute"],[5,"minute"],[10,"minute"],[30,"minute"],[1,"hour"],[2,"hour"],[4,"hour"],[8,"hour"],[12,"hour"],[1,"day"],[2,"day"],[3,"day"],[.25,"month"],[.5,"month"],[1,"month"],[2,"month"]],j=i.concat([[3,"month"],[6,"month"],[1,"year"]]),k=i.concat([[1,"quarter"],[2,"quarter"],[1,"year"]]);a.plot.plugins.push({init:f,options:g,name:"time",version:"1.0"}),a.plot.formatDate=c}(jQuery),define("jquery.flot.time",["jquery","jquery.flot"],function(){}),function(a){function b(a){function b(a,b){for(var c=null,d=0;d<b.length&&a!=b[d];++d)b[d].stack==a.stack&&(c=b[d]);return c}function c(a,c,d){if(null!=c.stack&&c.stack!==!1){var e=b(c,a.getData());if(e){for(var f,g,h,i,j,k,l,m,n=d.pointsize,o=d.points,p=e.datapoints.pointsize,q=e.datapoints.points,r=[],s=c.lines.show,t=c.bars.horizontal,u=n>2&&(t?d.format[2].x:d.format[2].y),v=s&&c.lines.steps,w=!0,x=t?1:0,y=t?0:1,z=0,A=0;;){if(z>=o.length)break;if(l=r.length,null==o[z]){for(m=0;m<n;++m)r.push(o[z+m]);z+=n}else if(A>=q.length){if(!s)for(m=0;m<n;++m)r.push(o[z+m]);z+=n}else if(null==q[A]){for(m=0;m<n;++m)r.push(null);w=!0,A+=p}else{if(f=o[z+x],g=o[z+y],i=q[A+x],j=q[A+y],k=0,f==i){for(m=0;m<n;++m)r.push(o[z+m]);r[l+y]+=j,k=j,z+=n,A+=p}else if(f>i){if(s&&z>0&&null!=o[z-n]){for(h=g+(o[z-n+y]-g)*(i-f)/(o[z-n+x]-f),r.push(i),r.push(h+j),m=2;m<n;++m)r.push(o[z+m]);k=j}A+=p}else{if(w&&s){z+=n;continue}for(m=0;m<n;++m)r.push(o[z+m]);s&&A>0&&null!=q[A-p]&&(k=j+(q[A-p+y]-j)*(f-i)/(q[A-p+x]-i)),r[l+y]+=k,z+=n}w=!1,l!=r.length&&u&&(r[l+2]+=k)}if(v&&l!=r.length&&l>0&&null!=r[l]&&r[l]!=r[l-n]&&r[l+1]!=r[l-n+1]){for(m=0;m<n;++m)r[l+n+m]=r[l+m];r[l+1]=r[l-n+1]}}d.points=r}}}a.hooks.processDatapoints.push(c)}var c={series:{stack:null}};a.plot.plugins.push({init:b,options:c,name:"stack",version:"1.2"})}(jQuery),define("jquery.flot.stack",["jquery","jquery.flot"],function(){}),function(a){function b(a){function b(a,b,d,e){if(f||(f=!0,g=c(a.getData())),1==b.stackpercent){var h=d.length;b.percents=[];var i=0,j=1;b.bars&&b.bars.horizontal&&b.bars.horizontal===!0&&(i=1,j=0);for(var k=0;k<h;k++){var l=g[d[k][i]+""];l>0?b.percents.push(100*d[k][j]/l):b.percents.push(0)}}}function c(a){var b=a.length,c={};if(b>0)for(var d=0;d<b;d++)if(a[d].stackpercent){var e=0,f=1;a[d].bars&&a[d].bars.horizontal&&a[d].bars.horizontal===!0&&(e=1,f=0);for(var g=a[d].data.length,h=0;h<g;h++){var i=0;null!=a[d].data[h][1]&&(i=a[d].data[h][f]),c[a[d].data[h][e]+""]?c[a[d].data[h][e]+""]+=i:c[a[d].data[h][e]+""]=i}}return c}function d(a,b,d){if(b.stackpercent){f||(g=c(a.getData()));var h=[],i=0,j=1;b.bars&&b.bars.horizontal&&b.bars.horizontal===!0&&(i=1,j=0);for(var k=0;k<d.points.length;k+=3)e[d.points[k+i]]||(e[d.points[k+i]]=0),h[k+i]=d.points[k+i],h[k+j]=d.points[k+j]+e[d.points[k+i]],h[k+2]=e[d.points[k+i]],e[d.points[k+i]]+=d.points[k+j],g[h[k+i]+""]>0?(h[k+j]=100*h[k+j]/g[h[k+i]+""],h[k+2]=100*h[k+2]/g[h[k+i]+""]):(h[k+j]=0,h[k+2]=0);d.points=h}}var e={},f=!1,g={};a.hooks.processRawData.push(b),a.hooks.processDatapoints.push(d)}var c={series:{stackpercent:null}};a.plot.plugins.push({init:b,options:c,name:"stackpercent",version:"0.1"})}(jQuery),define("jquery.flot.stackpercent",["jquery","jquery.flot"],function(){}),function(a){function b(){return!!document.createElement("canvas").getContext}function c(){if(!b())return!1;var a=document.createElement("canvas"),c=a.getContext("2d");return"function"==typeof c.fillText}function d(){var a=document.createElement("div");return"undefined"!=typeof a.style.MozTransition||"undefined"!=typeof a.style.OTransition||"undefined"!=typeof a.style.webkitTransition||"undefined"!=typeof a.style.transition}function e(a,b,c,d,e){this.axisName=a,this.position=b,this.padding=c,this.plot=d,this.opts=e,this.width=0,this.height=0}function f(a,b,c,d,f){e.prototype.constructor.call(this,a,b,c,d,f)}function g(a,b,c,d,f){e.prototype.constructor.call(this,a,b,c,d,f),this.elem=null}function h(a,b,c,d,e){g.prototype.constructor.call(this,a,b,c,d,e)}function i(a,b,c,d,e){h.prototype.constructor.call(this,a,b,c,d,e),this.requiresResize=!1}function j(b){b.hooks.processOptions.push(function(b,e){if(e.axisLabels.show){var j=!1,k={},l=2;b.hooks.draw.push(function(b,e){var m=!1;j?(j=!1,a.each(b.getAxes(),function(a,c){var d=c.options||b.getOptions()[a];d&&d.axisLabel&&c.show&&k[a].draw(c.box)})):(a.each(b.getAxes(),function(a,e){var j=e.options||b.getOptions()[a];if(a in k&&(e.labelHeight=e.labelHeight-k[a].height,e.labelWidth=e.labelWidth-k[a].width,j.labelHeight=e.labelHeight,j.labelWidth=e.labelWidth,k[a].cleanup(),delete k[a]),j&&j.axisLabel&&e.show){m=!0;var n=null;if(j.axisLabelUseHtml||"Microsoft Internet Explorer"!=navigator.appName)n=j.axisLabelUseHtml||!d()&&!c()&&!j.axisLabelUseCanvas?g:j.axisLabelUseCanvas||!d()?f:h;else{var o=navigator.userAgent,p=new RegExp("MSIE ([0-9]{1,}[.0-9]{0,})");null!=p.exec(o)&&(rv=parseFloat(RegExp.$1)),n=rv>=9&&!j.axisLabelUseCanvas&&!j.axisLabelUseHtml?h:j.axisLabelUseCanvas||j.axisLabelUseHtml?j.axisLabelUseCanvas?f:g:i}var q=void 0===j.axisLabelPadding?l:j.axisLabelPadding;k[a]=new n(a,e.position,q,b,j),k[a].calculateSize(),j.labelHeight=e.labelHeight+k[a].height,j.labelWidth=e.labelWidth+k[a].width}}),m&&(j=!0,b.setupGrid(),b.draw()))})}})}var k={axisLabels:{show:!0}};e.prototype.cleanup=function(){},f.prototype=new e,f.prototype.constructor=f,f.prototype.calculateSize=function(){this.opts.axisLabelFontSizePixels||(this.opts.axisLabelFontSizePixels=14),this.opts.axisLabelFontFamily||(this.opts.axisLabelFontFamily="sans-serif");this.opts.axisLabelFontSizePixels+this.padding,this.opts.axisLabelFontSizePixels+this.padding;"left"==this.position||"right"==this.position?(this.width=this.opts.axisLabelFontSizePixels+this.padding,this.height=0):(this.width=0,this.height=this.opts.axisLabelFontSizePixels+this.padding)},f.prototype.draw=function(a){this.opts.axisLabelColour||(this.opts.axisLabelColour="black");var b=this.plot.getCanvas().getContext("2d");b.save(),b.font=this.opts.axisLabelFontSizePixels+"px "+this.opts.axisLabelFontFamily,b.fillStyle=this.opts.axisLabelColour;var c,d,e=b.measureText(this.opts.axisLabel).width,f=this.opts.axisLabelFontSizePixels,g=0;"top"==this.position?(c=a.left+a.width/2-e/2,d=a.top+.72*f):"bottom"==this.position?(c=a.left+a.width/2-e/2,d=a.top+a.height-.72*f):"left"==this.position?(c=a.left+.72*f,d=a.height/2+a.top+e/2,g=-Math.PI/2):"right"==this.position&&(c=a.left+a.width-.72*f,d=a.height/2+a.top-e/2,g=Math.PI/2),b.translate(c,d),b.rotate(g),b.fillText(this.opts.axisLabel,0,0),b.restore()},g.prototype=new e,g.prototype.constructor=g,g.prototype.calculateSize=function(){var b=a('<div class="axisLabels" style="position:absolute;">'+this.opts.axisLabel+"</div>");this.plot.getPlaceholder().append(b),this.labelWidth=b.outerWidth(!0),this.labelHeight=b.outerHeight(!0),b.remove(),this.width=this.height=0,"left"==this.position||"right"==this.position?this.width=this.labelWidth+this.padding:this.height=this.labelHeight+this.padding},g.prototype.cleanup=function(){this.elem&&this.elem.remove()},g.prototype.draw=function(b){this.plot.getPlaceholder().find("#"+this.axisName+"Label").remove(),this.elem=a('<div id="'+this.axisName+'Label" " class="axisLabels" style="position:absolute;">'+this.opts.axisLabel+"</div>"),this.plot.getPlaceholder().append(this.elem),"top"==this.position?(this.elem.css("left",b.left+b.width/2-this.labelWidth/2+"px"),this.elem.css("top",b.top+"px")):"bottom"==this.position?(this.elem.css("left",b.left+b.width/2-this.labelWidth/2+"px"),this.elem.css("top",b.top+b.height-this.labelHeight+"px")):"left"==this.position?(this.elem.css("top",b.top+b.height/2-this.labelHeight/2+"px"),this.elem.css("left",b.left+"px")):"right"==this.position&&(this.elem.css("top",b.top+b.height/2-this.labelHeight/2+"px"),this.elem.css("left",b.left+b.width-this.labelWidth+"px"))},h.prototype=new g,h.prototype.constructor=h,h.prototype.calculateSize=function(){g.prototype.calculateSize.call(this),this.width=this.height=0,"left"==this.position||"right"==this.position?this.width=this.labelHeight+this.padding:this.height=this.labelHeight+this.padding},h.prototype.transforms=function(a,b,c){var d={"-moz-transform":"","-webkit-transform":"","-o-transform":"","-ms-transform":""};if(0!=b||0!=c){var e=" translate("+b+"px, "+c+"px)";d["-moz-transform"]+=e,d["-webkit-transform"]+=e,d["-o-transform"]+=e,d["-ms-transform"]+=e}if(0!=a){var f=" rotate("+a+"deg)";d["-moz-transform"]+=f,d["-webkit-transform"]+=f,d["-o-transform"]+=f,d["-ms-transform"]+=f}var g="top: 0; left: 0; ";for(var h in d)d[h]&&(g+=h+":"+d[h]+";");return g+=";"},h.prototype.calculateOffsets=function(a){var b={x:0,y:0,degrees:0};return"bottom"==this.position?(b.x=a.left+a.width/2-this.labelWidth/2,b.y=a.top+a.height-this.labelHeight):"top"==this.position?(b.x=a.left+a.width/2-this.labelWidth/2,b.y=a.top):"left"==this.position?(b.degrees=-90,b.x=a.left-this.labelWidth/2+this.labelHeight/2,b.y=a.height/2+a.top):"right"==this.position&&(b.degrees=90,b.x=a.left+a.width-this.labelWidth/2-this.labelHeight/2,b.y=a.height/2+a.top),b.x=Math.round(b.x),b.y=Math.round(b.y),b},h.prototype.draw=function(b){this.plot.getPlaceholder().find("."+this.axisName+"Label").remove();var c=this.calculateOffsets(b);this.elem=a('<div class="axisLabels '+this.axisName+'Label" style="position:absolute; '+this.transforms(c.degrees,c.x,c.y)+'">'+this.opts.axisLabel+"</div>"),this.plot.getPlaceholder().append(this.elem)},i.prototype=new h,i.prototype.constructor=i,i.prototype.transforms=function(a,b,c){var d="";if(0!=a){for(var e=a/90;e<0;)e+=4;d+=" filter: progid:DXImageTransform.Microsoft.BasicImage(rotation="+e+"); ",this.requiresResize="right"==this.position}return 0!=b&&(d+="left: "+b+"px; "),0!=c&&(d+="top: "+c+"px; "),d},i.prototype.calculateOffsets=function(a){var b=h.prototype.calculateOffsets.call(this,a);return"top"==this.position?b.y=a.top+1:"left"==this.position?(b.x=a.left,b.y=a.height/2+a.top-this.labelWidth/2):"right"==this.position&&(b.x=a.left+a.width-this.labelHeight,b.y=a.height/2+a.top-this.labelWidth/2),b},i.prototype.draw=function(a){h.prototype.draw.call(this,a),this.requiresResize&&(this.elem=this.plot.getPlaceholder().find("."+this.axisName+"Label"),this.elem.css("width",this.labelWidth),this.elem.css("height",this.labelHeight))},a.plot.plugins.push({init:j,options:k,name:"axisLabels",version:"2.0"})}(jQuery),define("jquery.flot.axislabels",["jquery","jquery.flot"],function(){}),define("panels/histogram/module",["angular","app","jquery","underscore","kbn","moment","./timeSeries","jquery.flot","jquery.flot.pie","jquery.flot.selection","jquery.flot.time","jquery.flot.stack","jquery.flot.stackpercent","jquery.flot.axislabels"],function(a,b,c,d,e,f,g){"use strict";var h=a.module("kibana.panels.histogram",[]);b.useModule(h),h.controller("histogram",["$scope","$q","$timeout","timer","querySrv","dashboard","filterSrv",function(b,c,h,i,j,k,l){b.panelMeta={modals:[{description:"Inspect",icon:"icon-info-sign",partial:"app/partials/inspector.html",show:b.panel.spyable}],editorTabs:[{title:"Queries",src:"app/partials/querySelect.html"}],status:"Stable",description:"A bucketed time series chart of the current query, including all applied time and non-time filters, when used in <i>count</i> mode. Uses Solr’s facet.range query parameters. In <i>values</i> mode, it plots the value of a specific field over time, and allows the user to group field values by a second field."};var m={mode:"count",queries:{mode:"all",ids:[],query:"*:*",custom:""},max_rows:1e5,value_field:null,group_field:null,sum_value:!1,auto_int:!0,resolution:100,interval:"5m",intervals:["auto","1s","1m","5m","10m","30m","1h","3h","12h","1d","1w","1M","1y"],fill:0,linewidth:3,timezone:"browser",spyable:!0,zoomlinks:!0,bars:!0,stack:!0,points:!1,lines:!1,lines_smooth:!1,legend:!0,"x-axis":!0,"y-axis":!0,percentage:!1,interactive:!0,options:!0,show_queries:!0,tooltip:{value_type:"cumulative",query_as_alias:!1},refresh:{enable:!1,interval:2}};d.defaults(b.panel,m),b.init=function(){b.options=!1,b.panel.refresh.enable&&b.set_timer(b.panel.refresh.interval),b.$on("refresh",function(){b.get_data()}),b.get_data()},b.set_timer=function(a){b.panel.refresh.interval=a,d.isNumber(b.panel.refresh.interval)?(i.cancel(b.refresh_timer),b.realtime()):i.cancel(b.refresh_timer)},b.realtime=function(){b.panel.refresh.enable?(i.cancel(b.refresh_timer),b.refresh_timer=i.register(h(function(){b.realtime(),b.get_data()},1e3*b.panel.refresh.interval))):i.cancel(b.refresh_timer)},b.set_interval=function(a){"auto"!==a?(b.panel.auto_int=!1,b.panel.interval=a):b.panel.auto_int=!0},b.interval_label=function(a){return b.panel.auto_int&&a===b.panel.interval?a+" (auto)":a},b.get_time_range=function(){var a=b.range=l.timeRange("min");return a},b.get_interval=function(){var a,c=b.panel.interval;return b.panel.auto_int&&(a=b.get_time_range(),a&&(c=e.secondsToHms(e.calculate_interval(a.from,a.to,b.panel.resolution,0)/1e3))),b.panel.interval=c||"10m",b.panel.interval},b.get_data=function(a,f){if(d.isUndefined(a)&&(a=0),delete b.panel.error,0!==k.indices.length){var h=b.get_time_range(),i=b.get_interval(h);b.panel.auto_int&&(b.panel.interval=e.secondsToHms(e.calculate_interval(h.from,h.to,b.panel.resolution,0)/1e3)),b.panelMeta.loading=!0,b.sjs.client.server(k.current.solr.server+k.current.solr.core_name);var m=b.sjs.Request().indices(k.indices[a]);b.panel.queries.ids=j.idsByMode(b.panel.queries),b.panel.queries.query="",d.each(b.panel.queries.ids,function(a){var c=b.sjs.FilteredQuery(j.getEjsObj(a),l.getBoolFilter(l.ids)),e=b.sjs.DateHistogramFacet(a);if("count"===b.panel.mode)e=e.field(l.getTimeField());else{if(d.isNull(b.panel.value_field))return void(b.panel.error="In "+b.panel.mode+" mode a field must be specified");e=e.keyField(l.getTimeField()).valueField(b.panel.value_field)}e=e.interval(i).facetFilter(b.sjs.QueryFilter(c)),m=m.facet(e).size(0)}),b.populate_modal(m);var n="";l.getSolrFq()&&(n="&"+l.getSolrFq());var o=l.getTimeField(),p=l.getStartTime(),q=l.getEndTime();"*"===q&&(q="NOW");var r="&wt=json",s="&rows=0",t=b.sjs.convertFacetGap(b.panel.interval),u="&facet=true&facet.range="+o+"&facet.range.start="+p+"&facet.range.end="+q+"&facet.range.gap="+t,v="";if("values"===b.panel.mode){if(!b.panel.value_field)return void(b.panel.error="In "+b.panel.mode+" mode a field must be specified");v="&fl="+o+" "+b.panel.value_field,s="&rows="+b.panel.max_rows,u="",b.panel.group_field&&(v+="&group=true&group.field="+b.panel.group_field+"&group.limit="+b.panel.max_rows)}var w=[];d.each(b.panel.queries.ids,function(a){var c=j.getQuery(a)+r+s+n+u+v;b.panel.queries.query+=c+"\n",m=null!==b.panel.queries.custom?m.setQuery(c+b.panel.queries.custom):m.setQuery(c),w.push(m.doSearch())}),k.current.services.query.ids.length>=1&&c.all(w).then(function(c){b.panelMeta.loading=!1,0===a&&(b.hits=0,b.data=[],f=b.query_id=(new Date).getTime());var e,k,l=0;d.each(b.panel.queries.ids,function(f,m){if(!d.isUndefined(c[m].error))return void(b.panel.error=b.parse_error(c[m].error.msg));d.isUndefined(b.data[l])||0===a?(e=new g.ZeroFilled({interval:i,start_date:h&&h.from,end_date:h&&h.to,fill_style:"minimal"}),k=0):(e=b.data[l].time_series,k=0,b.hits=0);var n,p,q;if("count"===b.panel.mode){p=c[m].facet_counts.facet_ranges[o].counts;for(var r=0;r<p.length;r++){n=new Date(p[r]).getTime(),r++;var s=p[r];e.addValue(n,s),k+=s,b.hits+=s}}else if("values"===b.panel.mode)if(b.panel.group_field)for(var t=c[m].grouped[b.panel.group_field].groups,r=0;r<t.length;r++){var u=t[r].doclist.docs,v=new g.ZeroFilled({interval:i,start_date:h&&h.from,end_date:h&&h.to,fill_style:"minimal"});k=0;for(var w=0;w<u.length;w++)n=new Date(u[w][o]).getTime(),q=u[w][b.panel.value_field],b.panel.sum_value?v.sumValue(n,q):v.addValue(n,q),k+=1,b.hits+=1;b.data[r]={info:{alias:t[r].groupValue,color:j.colors[r]},time_series:v,hits:k}}else{p=c[m].response.docs;for(var r=0;r<p.length;r++)n=new Date(p[r][o]).getTime(),q=p[r][b.panel.value_field],e.addValue(n,q),k+=1,b.hits+=1;b.data[l]={info:j.list[f],time_series:e,hits:k}}"values"!==b.panel.mode&&(b.data[l]={info:j.list[f],time_series:e,hits:k}),l++}),b.$emit("render")})}},b.zoom=function(a){var b=l.timeRange("min"),c=b.to.valueOf()-b.from.valueOf(),d=b.to.valueOf()-c/2,e=d+c*a/2,g=d-c*a/2;if(e>Date.now()&&b.to<Date.now()){var h=e-Date.now();g-=h,e=Date.now()}var i=l.getTimeField();a>1&&l.removeByType("time"),l.set({type:"time",from:f.utc(g).toDate(),to:f.utc(e).toDate(),field:i}),k.refresh()},b.populate_modal=function(c){b.inspector=a.toJson(JSON.parse(c.toString()),!0)},b.set_refresh=function(a){b.refresh=a},b.close_edit=function(){b.panel.refresh.enable&&b.set_timer(b.panel.refresh.interval),b.refresh&&b.get_data(),b.refresh=!1,b.$emit("render")},b.render=function(){b.$emit("render")}}]),h.directive("histogramChart",["dashboard","filterSrv",function(b,g){return{restrict:"A",template:"<div></div>",link:function(h,i){function j(){i.css({height:h.panel.height||h.row.height});try{d.each(h.data,function(a){a.label=a.info.alias,a.color=a.info.color})}catch(a){return}var b=e.interval_to_ms(h.panel.interval),f=!!h.panel.stack||null;try{var j={legend:{show:!1},series:{stackpercent:!!h.panel.stack&&h.panel.percentage,stack:h.panel.percentage?null:f,lines:{show:h.panel.lines,fill:0===h.panel.fill?.001:h.panel.fill/10,lineWidth:h.panel.linewidth,steps:!1},bars:{show:h.panel.bars,fill:1,barWidth:b/1.8,zero:!1,lineWidth:0},points:{show:h.panel.points,fill:1,fillColor:!1,radius:5},shadowSize:1},axisLabels:{show:!0},yaxis:{show:h.panel["y-axis"],min:null,max:h.panel.percentage&&h.panel.stack?100:null,axisLabel:h.panel.mode},xaxis:{timezone:h.panel.timezone,show:h.panel["x-axis"],mode:"time",min:d.isUndefined(h.range.from)?null:h.range.from.getTime(),max:d.isUndefined(h.range.to)?null:h.range.to.getTime(),timeformat:k(h.panel.interval),label:"Datetime",axisLabel:g.getTimeField()},grid:{backgroundColor:null,borderWidth:0,hoverable:!0,color:"#c8c8c8"}};h.panel.interactive&&(j.selection={mode:"x",color:"#666"});var l=[];h.data.length>1&&(l=Array.prototype.concat.apply([],d.map(h.data,function(a){return a.time_series.getOrderedTimes()})),l=d.uniq(l.sort(function(a,b){return a-b}),!0));for(var m=0;m<h.data.length;m++)h.data[m].data=h.data[m].time_series.getFlotPairs(l);if(h.panel.lines_smooth)for(var m=0;m<h.data.length;m++){for(var n=[],o=0;o<h.data[m].data.length;o++)0!==h.data[m].data[o][1]&&n.push(h.data[m].data[o]);h.data[m].data=n}h.plot=c.plot(i,h.data,j)}catch(a){console.log(a)}}function k(a){var b=e.interval_to_seconds(a);return b>=2628e3?"%m/%y":b>=86400?"%m/%d/%y":b>=60?"%H:%M<br>%m/%d":"%H:%M:%S"}h.$on("render",function(){j()}),a.element(window).bind("resize",function(){j()});var l=c("<div>");i.bind("plothover",function(a,c,d){var g,i;if(d){g=d.series.info.alias||h.panel.tooltip.query_as_alias?'<small style="font-size:0.9em;"><i class="icon-circle" style="color:'+d.series.color+';"></i> '+(d.series.info.alias||d.series.info.query)+"</small><br>":e.query_color_dot(d.series.color,15)+" ",i=h.panel.stack&&"individual"===h.panel.tooltip.value_type?d.datapoint[1]-d.datapoint[2]:d.datapoint[1];for(var j=i,k=j>0,m=g+b.numberWithCommas(i)+" @ "+("utc"===h.panel.timezone?f.utc(d.datapoint[0]).format("MM/DD HH:mm:ss"):f(d.datapoint[0]).format("MM/DD HH:mm:ss")),n=d.series,o=d.datapoint[0],p=m,q=h.plot.getData(),r=-1,s=q.length-1;s>=0&&(!h.panel.stack||!k);s--){var t=q[s];if(s=parseInt(s),t===n&&(r=s),!(s>=r))for(var u=0;u<t.data.length;u++){var v=t.data[u];if(v[0]===o){if(i=h.panel.stack&&"individual"===h.panel.tooltip.value_type&&!isNaN(v[2])?v[1]-v[2]:v[1],k=i>0,!h.panel.stack&&i!==j)break;r=s,j=i,g=t.info.alias||h.panel.tooltip.query_as_alias?'<small style="font-size:0.9em;"><i class="icon-circle" style="color:'+t.color+';"></i> '+(t.info.alias||t.info.query)+"</small><br>":e.query_color_dot(t.color,15)+" ",m=g+b.numberWithCommas(i)+" @ "+("utc"===h.panel.timezone?f.utc(v[0]).format("MM/DD HH:mm:ss"):f(v[0]).format("MM/DD HH:mm:ss")),p=p+"</br>"+m;break}}}l.html(p).place_tt(c.pageX,c.pageY)}else l.detach()}),i.bind("plotselected",function(a,c){g.set({type:"time",from:f.utc(c.xaxis.from).toDate(),to:f.utc(c.xaxis.to).toDate(),field:g.getTimeField()}),b.refresh()})}}}])});