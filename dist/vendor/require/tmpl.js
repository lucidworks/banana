/*! banana-fusion - v1.6.18 - 2017-12-19
 * https://github.com/LucidWorks/banana/wiki
 * Copyright (c) 2017 Andrew Thanalertvisuti; Licensed Apache-2.0 */

define(["module"],function(a){"use strict";var b=a.config&&a.config()||{};return{load:function(a,c,d,e){var f=c.toUrl(a);c(["text!"+a],function(a){b.registerTemplate&&b.registerTemplate(f,a),d(a)})}}});