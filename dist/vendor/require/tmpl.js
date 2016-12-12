/*! banana-fusion - v1.6.15 - 2016-12-12
 * https://github.com/LucidWorks/banana/wiki
 * Copyright (c) 2016 Andrew Thanalertvisuti; Licensed Apache License */

define(["module"],function(a){"use strict";var b=a.config&&a.config()||{};return{load:function(a,c,d,e){var f=c.toUrl(a);c(["text!"+a],function(a){b.registerTemplate&&b.registerTemplate(f,a),d(a)})}}});