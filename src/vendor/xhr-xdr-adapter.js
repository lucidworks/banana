/*

 xhr-xdr-adapter

 Use XDomainRequest on IE 8 and IE 9 for cross-origin requests only.
 Default to standard XMLHttpRequest otherwise.

 Include this file on IE 8 & 9 before making cross-origin ajax requests
 using libraries or frameworks such as jQuery or AngularJS.  This will allow
 you to do things like AJAX GET templates/assets from a CDN at run time using
 the standard XMLHttpRequest API on IE 8/9, or do simple cross-domain POSTs.

 But it doesn't get around the basic limitations of IE 8 & 9's XDomainRequest:
 * No authentication or cookies can be sent
 * POST or GET only
 * No custom headers can be sent
 * text/plain contentType only


 The MIT License (MIT)

 Copyright (c) 2014 Intuit Inc.

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in all
 copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 SOFTWARE.
 */

(function () {
    "use strict";
    // Ignore everything below if not on IE 8 or IE 9.
    if (!window.XDomainRequest) {  // typeof XDomainRequest is 'object' in IE 8, 'function' in IE 9
        return;
    }
    if ('withCredentials' in new window.XMLHttpRequest()) {
        return;
    }
    if (window.XMLHttpRequest.supportsXDR === true) {
        // already set up
        return;
    }

    var OriginalXMLHttpRequest = window.XMLHttpRequest;
    var urlRegEx = /^([\w.+-]+:)(?:\/\/([^\/?#:]*)(?::(\d+)|)|)/;
    var httpRegEx = /^https?:\/\//i;
    var getOrPostRegEx = /^get|post$/i;
    var sameSchemeRegEx = new RegExp('^' + location.protocol, 'i');

    // Determine whether XDomainRequest should be used for a given request
    var useXDR = function (method, url, async) {
        var remoteUrl = url;
        var baseHref;
        var myLocationParts;
        var remoteLocationParts;
        var crossDomain;
		
		
        try {
            // account for the possibility of a <base href="..."> setting, which could make a URL that looks relative actually be cross-domain
            if ((remoteUrl && remoteUrl.indexOf("://") < 0) && document.getElementsByTagName('base').length > 0) {
                baseHref = document.getElementsByTagName('base')[0].href;
                if (baseHref) {
                    remoteUrl = baseHref + remoteUrl;
                }
            }

            myLocationParts = urlRegEx.exec(location.href);
            remoteLocationParts = urlRegEx.exec(remoteUrl);
            crossDomain = (myLocationParts[2].toLowerCase() !== remoteLocationParts[2].toLowerCase());

            // XDomainRequest can only be used for async get/post requests across same scheme, which must be http: or https:
            return crossDomain && async && getOrPostRegEx.test(method) && httpRegEx.test(remoteUrl) && sameSchemeRegEx.test(remoteUrl);
        }
        catch (ex) {
			//console.log("Exception in useXDR dump: ");
			//console.log (crossDomain && async && getOrPostRegEx.test(method) && httpRegEx.test(remoteUrl) && sameSchemeRegEx.test(remoteUrl));
			//console.log("end useXDR dump");
            return false;
        }
    };

    window.XMLHttpRequest = function () {
        var self = this;
        this._setReadyState = function (readyState) {
            if (self.readyState !== readyState) {
                self.readyState = readyState;
                if (typeof self.onreadystatechange === "function") {
                    self.onreadystatechange();
                }
            }
        };
        this.readyState = 0;
        this.responseText = "";
        this.status = 0;
        this.statusText = "";
        this.withCredentials = false;
    };

    window.XMLHttpRequest.prototype.open = function (method, url, async) {
        var self = this;
        var request;

        if (useXDR(method, url, async)) {
            // Use XDR
            request = new XDomainRequest();
            request._xdr = true;
            request.onerror = function () {
                self.status = 400;
                self.statusText = "Error";
                self._setReadyState(0);
                if (self.onerror) {
                    self.onerror();
                }
            };
            request.ontimeout = function () {
                self.status = 408;
                self.statusText = "Timeout";
                self._setReadyState(2);
                if (self.ontimeout) {
                    self.ontimeout();
                }
            };
            request.onload = function () {
                self.responseText = request.responseText;
                self.status = 200;
                self.statusText = "OK";
                self._setReadyState(4);
                if (self.onload) {
                    self.onload();
                }
            };
            request.onprogress = function () {
                if (self.onprogress) {
                    self.onprogress.apply(self, arguments);
                }
            };
			//console.log("Using XDR");
        }

        else {
            // Use standard XHR
            request = new OriginalXMLHttpRequest();
			
            request.withCredentials = this.withCredentials;
            request.onreadystatechange = function () {
                if (request.readyState === 4) {
                    self.status = request.status;
                    self.statusText = request.statusText;
                    self.responseText = request.responseText;
                    self.responseXML = request.responseXML;
                }
                self._setReadyState(request.readyState);
            };
            request.onabort = function () {
                if (self.onabort) {
                    self.onabort.apply(self, arguments);
                }
            };
            request.onerror = function () {
                if (self.onerror) {
                    self.onerror.apply(self, arguments);
                }
            };
            request.onload = function () {
                if (self.onload) {
                    self.onload.apply(self, arguments);
                }
            };
            request.onloadend = function () {
                if (self.onloadend) {
                    self.onloadend.apply(self, arguments);
                }
            };
            request.onloadstart = function () {
                if (self.onloadstart) {
                    self.onloadstart.apply(self, arguments);
                }
            };
            request.onprogress = function () {
                if (self.onprogress) {
                    self.onprogress.apply(self, arguments);
                }
            };
			//console.log("using XHR");
        }

        this._request = request;
        request.open.apply(request, arguments);
	
        this._setReadyState(1);
    };

    window.XMLHttpRequest.prototype.abort = function () {
        this._request.abort();
        this._setReadyState(0);
        this.onreadystatechange = null;
    };

    window.XMLHttpRequest.prototype.send = function (body) {
        var self = this;
        this._request.withCredentials = this.withCredentials;

        if (this._request._xdr) {
            setTimeout(function () {
                self._request.send(body);
            }, 0);
        }
        else {
            this._request.send(body);
        }

        if (this._request.readyState === 4) {
            // when async==false the browser is blocked until the transfer is complete and readyState becomes 4
            // onreadystatechange should not get called in this case
            this.status = this._request.status;
            this.statusText = this._request.statusText;
            this.responseText = this._request.responseText;
            this.readyState = this._request.readyState;
        }
        else {
            this._setReadyState(2);
        }
    };

    window.XMLHttpRequest.prototype.setRequestHeader = function () {
        if (this._request.setRequestHeader) {
            this._request.setRequestHeader.apply(this._request, arguments);
        }
    };

    window.XMLHttpRequest.prototype.getAllResponseHeaders = function () {
        if (this._request.getAllResponseHeaders) {
            return this._request.getAllResponseHeaders();
        }
        else {
            return ("Content-Length: " + this.responseText.length +
                "\r\nContent-Type:" + this._request.contentType);
        }
    };

    window.XMLHttpRequest.prototype.getResponseHeader = function (header) {
        if (this._request.getResponseHeader) {
            return this._request.getResponseHeader.apply(this._request, arguments);
        }
        if (typeof  header !== "string") {
            return;
        }
        header = header.toLowerCase();
        if (header === "content-type") {
            return this._request.contentType;
        }
        else if (header === "content-length") {
            return this.responseText.length;
        }
    };

    window.XMLHttpRequest.supportsXDR = true;
})();
