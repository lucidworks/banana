/*! banana-fusion - v1.6.11 - 2016-10-07
 * https://github.com/LucidWorks/banana/wiki
 * Copyright (c) 2016 Andrew Thanalertvisuti; Licensed Apache License */

define(["module"],function(a){"use strict";var b=a.config&&a.config()||{};return{load:function(a,c,d,e){var f=c.toUrl(a);c(["text!"+a],function(a){b.registerTemplate&&b.registerTemplate(f,a),d(a)})}}});