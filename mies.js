//	Event source client.
//
//	https://github.com/Yaffle/EventSource
//	http://www.w3.org/TR/eventsource/
//
(function (global) {

  function EventTarget() {
    return this;
  }

  EventTarget.prototype = {
    nextListener: null,
    throwError: function (e) {
      setTimeout(function () {
        throw e;
      }, 0);
    },
    invokeEvent: function (event) {
      var type = String(event.type),
        i = this.nextListener,
        phase = event.eventPhase;
      while (i) {
        if (i.type === type && !(!i.capture && phase === 1) && !(i.capture && phase === 3)) {
          event.currentTarget = this;
          try {
            i.callback.call(this, event);
          } catch (e) {
            this.throwError(e);
          }
          event.currentTarget = null;
        }
        i = i.nextListener;
      }
    },
    dispatchEvent: function (event) {
      event.eventPhase = 2;
      this.invokeEvent(event);
    },
    addEventListener: function (type, callback, capture) {
      type = String(type);
      capture = Boolean(capture);
      var listener = this,
        i = listener.nextListener;
      while (i) {
        if (i.type === type && i.callback === callback && i.capture === capture) {
          return;
        }
        listener = i;
        i = i.nextListener;
      }
      listener.nextListener = {
        nextListener: null,
        type: type,
        callback: callback,
        capture: capture
      };
    },
    removeEventListener: function (type, callback, capture) {
      type = String(type);
      capture = Boolean(capture);
      var listener = this,
        i = listener.nextListener,
        tmp;
      while (i) {
        if (i.type === type && i.callback === callback && i.capture === capture) {
          listener.nextListener = i.nextListener;
          break;
        } else {
          tmp = {
            nextListener: null,
            type: i.type,
            callback: i.callback,
            capture: i.capture
          };
          listener.nextListener = tmp;
          listener = tmp;
        }
        i = i.nextListener;
      }
    }
  };

  // http://blogs.msdn.com/b/ieinternals/archive/2010/04/06/comet-streaming-in-internet-explorer-with-xmlhttprequest-and-xdomainrequest.aspx?PageIndex=1#comments
  // XDomainRequest does not have a binary interface. To use with non-text, first base64 to string.
  // http://cometdaily.com/2008/page/3/

  var XHR = global.XMLHttpRequest,
    xhr2 = XHR && global.ProgressEvent && ((new XHR()).withCredentials !== undefined),
    Transport = xhr2 ? XHR : global.XDomainRequest,
    CONNECTING = 0,
    OPEN = 1,
    CLOSED = 2,
    proto;

  function empty() {}

  function EventSource(url, options) {
    url = String(url);

    var that = this,
      retry = 1000,
      retry2 = retry,
      heartbeatTimeout = 45000,
      xhrTimeout = null,
      wasActivity = false,
      lastEventId = '',
      xhr = new Transport(),
      reconnectTimeout = null,
      withCredentials = Boolean(xhr2 && options && options.withCredentials),
      offset,
      charOffset,
      opened,
      buffer = {
        data: '',
        lastEventId: '',
        name: ''
      },
      tail = {
        next: null,
        event: null,
        readyState: null
      },
      head = tail,
      channel = null;

    options = null;
    that.url = url;

    that.readyState = CONNECTING;
    that.withCredentials = withCredentials;

    // Queue a task which, if the readyState is set to a value other than CLOSED,
    // sets the readyState to ... and fires event

    function onTimeout() {
      var event = head.event,
        readyState = head.readyState,
        type = String(event.type);
      head = head.next;

      if (that.readyState !== CLOSED) { // http://www.w3.org/Bugs/Public/show_bug.cgi?id=14331
        if (readyState !== null) {
          that.readyState = readyState;
        }

        if (readyState === CONNECTING) {
          // setTimeout will wait before previous setTimeout(0) have completed
          retry2 = Math.min(retry2, 86400000);
          reconnectTimeout = setTimeout(openConnection, retry2);
          retry2 = retry2 * 2 + 1;
        }

        event.target = that;
        that.dispatchEvent(event);

        if (/^(message|error|open)$/.test(type) && typeof that['on' + type] === 'function') {
          // as IE 8 doesn't support getters/setters, we can't implement 'onmessage' via addEventListener/removeEventListener
          that['on' + type](event);
        }
      }
    }

    // MessageChannel support: IE 10, Opera 11.6x?, Chrome ?, Safari ?
    if (global.MessageChannel) {
      channel = new global.MessageChannel();
      channel.port1.onmessage = onTimeout;
    }

    function queue(event, readyState) {
      tail.event = event;
      tail.readyState = readyState;
      tail = tail.next = {
        next: null,
        event: null,
        readyState: null
      };
      if (channel) {
        channel.port2.postMessage('');
      } else {
        setTimeout(onTimeout, 0);
      }
    }

    function close() {
      // http://dev.w3.org/html5/eventsource/ The close() method must close the connection, if any; must abort any instances of the fetch algorithm started for this EventSource object; and must set the readyState attribute to CLOSED.
      if (xhr !== null) {
        xhr.onload = xhr.onerror = xhr.onprogress = xhr.onreadystatechange = empty;
        xhr.abort();
        xhr = null;
      }
      if (reconnectTimeout !== null) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      if (xhrTimeout !== null) {
        clearTimeout(xhrTimeout);
        xhrTimeout = null;
      }
      that.readyState = CLOSED;
    }

    that.close = close;

    EventTarget.call(that);

    function onXHRTimeout() {
      xhrTimeout = null;
      if (wasActivity) {
        wasActivity = false;
        xhrTimeout = setTimeout(onXHRTimeout, heartbeatTimeout);
      } else {
        xhr.onload = xhr.onerror = xhr.onprogress = empty;
        xhr.abort();
        onError.call(xhr);
      }
    }

    function onProgress() {
      var responseText = xhr.responseText || '',
        contentType,
        i,
        j,
        part,
        stream,
        field,
        value;

      wasActivity = true;

      if (!opened) {
        try {
          contentType = xhr.getResponseHeader ? xhr.getResponseHeader('Content-Type') : xhr.contentType;
        } catch (error) {
          // invalid state error when xhr.getResponseHeader called after xhr.abort in Chrome 18
          setTimeout(function () {
            throw error;
          }, 0);
        }
        if (contentType && (/^text\/event\-stream/i).test(contentType)) {
          queue({type: 'open'}, OPEN);
          opened = true;
          retry2 = retry;
        }
      }

      if (opened && (/\r|\n/).test(responseText.slice(charOffset))) {
        part = responseText.slice(offset);
        stream = part.replace(/\r\n?/g, '\n').split('\n');

        offset += part.length - stream[stream.length - 1].length;
        for (i = 0; i < stream.length - 1; i += 1) {
          field = stream[i];
          value = '';
          j = field.indexOf(':');
          if (j !== -1) {
            value = field.slice(j + (field.charAt(j + 1) === ' ' ? 2 : 1));
            field = field.slice(0, j);
          }

          if (!stream[i]) {
            // dispatch the event
            if (buffer.data) {
              lastEventId = buffer.lastEventId;
              queue({
                type: buffer.name || 'message',
                lastEventId: lastEventId,
                data: buffer.data.replace(/\n$/, '')
              }, null);
            }
            // Set the data buffer and the event name buffer to the empty string.
            buffer.data = '';
            buffer.name = '';
          }

          if (field === 'event') {
            buffer.name = value;
          }

          if (field === 'id') {
            buffer.lastEventId = value; // see http://www.w3.org/Bugs/Public/show_bug.cgi?id=13761
          }

          if (field === 'retry') {
            if (/^\d+$/.test(value)) {
              retry = Number(value);
              retry2 = retry;
            }
          }

          if (field === 'heartbeatTimeout') {//!
            heartbeatTimeout = Math.min(Math.max(1, Number(value) || 0), 86400000);
            if (xhrTimeout !== null) {
              clearTimeout(xhrTimeout);
              xhrTimeout = setTimeout(onXHRTimeout, heartbeatTimeout);
            }
          }

          if (field === 'data') {
            buffer.data += value + '\n';
          }
        }
      }
      charOffset = responseText.length;
    }

    function onError() {
      onProgress();
      //if (opened) {
        // reestablishes the connection
      queue({type: 'error'}, CONNECTING);
      //} else {
        // fail the connection
      //  queue({type: 'error'}, CLOSED);
      //}
      if (xhrTimeout !== null) {
        clearTimeout(xhrTimeout);
        xhrTimeout = null;
      }
    }

    function onReadyStateChange() {
      if (xhr.readyState === 3) {
        onProgress();
      }
    }

    function openConnection() {
      // XDomainRequest#abort removes onprogress, onerror, onload

      xhr.onload = xhr.onerror = onError;

      // onprogress fires multiple times while readyState === 3
      // onprogress should be setted before calling "open" for Firefox 3.6
      xhr.onprogress = onProgress;

      // Firefox 3.6
      xhr.onreadystatechange = onReadyStateChange;

      reconnectTimeout = null;
      wasActivity = false;
      xhrTimeout = setTimeout(onXHRTimeout, heartbeatTimeout);

      offset = 0;
      charOffset = 0;
      opened = false;
      buffer.data = '';
      buffer.name = '';
      buffer.lastEventId = lastEventId;//resets to last successful

      // with GET method in FF xhr.onreadystatechange with readyState === 3 doesn't work + POST = no-cache
      xhr.open('POST', url, true);

      // withCredentials should be setted after "open" for Safari and Chrome (< 19 ?)
      xhr.withCredentials = withCredentials;

      if (xhr.setRequestHeader) { // !XDomainRequest
        // http://dvcs.w3.org/hg/cors/raw-file/tip/Overview.html
        // Cache-Control is not a simple header
        // Request header field Cache-Control is not allowed by Access-Control-Allow-Headers.
        //xhr.setRequestHeader('Cache-Control', 'no-cache');

        // Chrome bug:
        // http://code.google.com/p/chromium/issues/detail?id=71694
        // If you force Chrome to have a whitelisted content-type, either explicitly with setRequestHeader(), or implicitly by sending a FormData, then no preflight is done.
        xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
        xhr.setRequestHeader('Accept', 'text/event-stream');

        // Request header field Last-Event-ID is not allowed by Access-Control-Allow-Headers.
        // +setRequestHeader shouldn't be used to avoid preflight requests
        //if (lastEventId !== '') {
        //  xhr.setRequestHeader('Last-Event-ID', lastEventId);
        //}
      }
      xhr.send(lastEventId !== '' ? 'Last-Event-ID=' + encodeURIComponent(lastEventId) : '');
    }

    openConnection();

    return that;
  }

  proto = new EventTarget();
  proto.CONNECTING = CONNECTING;
  proto.OPEN = OPEN;
  proto.CLOSED = CLOSED;

  EventSource.prototype = proto;
  EventSource.CONNECTING = CONNECTING;
  EventSource.OPEN = OPEN;
  EventSource.CLOSED = CLOSED;
  proto = null;

  //if (!('withCredentials' in global.EventSource.prototype)) { // to detect CORS in FF 11
  if (Transport) {
    global.EventSource = EventSource;
  }
  //}

}(this));


$(function() {

"use strict";

//////////////////////////////////////////////////////////////////////////////////////////
//																						//
//					Begin Template engine. You can easily swap it.						//
//																						//
//////////////////////////////////////////////////////////////////////////////////////////

// doT.js
// 2011, Laura Doktorova, https://github.com/olado/doT
//
// doT.js is an open source component of http://bebedo.com
// Licensed under the MIT license.
//
var doT = {
	version: '0.2.0',
	templateSettings: {
		evaluate:    /\{\{([\s\S]+?)\}\}/g,
		interpolate: /\{\{=([\s\S]+?)\}\}/g,
		encode:      /\{\{!([\s\S]+?)\}\}/g,
		use:         /\{\{#([\s\S]+?)\}\}/g,
		define:      /\{\{##\s*([\w\.$]+)\s*(\:|=)([\s\S]+?)#\}\}/g,
		conditional: /\{\{\?(\?)?\s*([\s\S]*?)\s*\}\}/g,
		iterate:     /\{\{~\s*(?:\}\}|([\s\S]+?)\s*\:\s*([\w$]+)\s*(?:\:\s*([\w$]+))?\s*\}\})/g,
		varname: 'binding',
		strip: true,
		append: true,
		selfcontained: false
	},
	template: undefined, //fn, compile template
	compile:  undefined  //fn, for express
};

var global = (function(){ return this || (0,eval)('this'); }());

//	spasquali@gmail.com : We don't want (need) these in the global.
//
//if (typeof module !== 'undefined' && module.exports) {
//	//module.exports = doT;
//} else if (typeof define === 'function' && define.amd) {
//	//define(function(){return doT;});
//} else {
//	//global.doT = doT;
//}

function encodeHTMLSource() {
	var encodeHTMLRules = { "&": "&#38;", "<": "&#60;", ">": "&#62;", '"': '&#34;', "'": '&#39;', "/": '&#47;' },
		matchHTML = /&(?!\\w+;)|<|>|"|'|\//g;
	return function(code) {
		return code ? code.toString().replace(matchHTML, function(m) {return encodeHTMLRules[m] || m;}) : code;
	};
}
global.encodeHTML = encodeHTMLSource();

var startend = {
	append: { start: "'+(",      end: ")+'",      startencode: "'+encodeHTML(" },
	split:  { start: "';out+=(", end: ");out+='", startencode: "';out+=encodeHTML("}
}, skip = /$^/;

function resolveDefs(c, block, def) {
	return ((typeof block === 'string') ? block : block.toString())
	.replace(c.define || skip, function(m, code, assign, value) {
		if (code.indexOf('def.') === 0) {
			code = code.substring(4);
		}
		if (!(code in def)) {
			if (assign === ':') {
				def[code]= value;
			} else {
				eval("def['"+code+"']=" + value);
			}
		}
		return '';
	})
	.replace(c.use || skip, function(m, code) {
		var v = eval(code);
		return v ? resolveDefs(c, v, def) : v;
	});
}

function unescape(code) {
	return code.replace(/\\('|\\)/g, "$1").replace(/[\r\t\n]/g, ' ');
}

doT.template = function(tmpl, c, def) {
	c = c || doT.templateSettings;
	var cse = c.append ? startend.append : startend.split, str, needhtmlencode, sid=0, indv;

	if (c.use || c.define) {
		var olddef = global.def; global.def = def || {}; // workaround minifiers
		str = resolveDefs(c, tmpl, global.def);
		global.def = olddef;
	} else str = tmpl;

	str = ("var out='" + (c.strip ? str.replace(/(^|\r|\n)\t* +| +\t*(\r|\n|$)/g,' ')
				.replace(/\r|\n|\t|\/\*[\s\S]*?\*\//g,''): str)
		.replace(/'|\\/g, '\\$&')
		.replace(c.interpolate || skip, function(m, code) {
			return cse.start + unescape(code) + cse.end;
		})
		.replace(c.encode || skip, function(m, code) {
			needhtmlencode = true;
			return cse.startencode + unescape(code) + cse.end;
		})
		.replace(c.conditional || skip, function(m, elsecase, code) {
			return elsecase ?
				(code ? "';}else if(" + unescape(code) + "){out+='" : "';}else{out+='") :
				(code ? "';if(" + unescape(code) + "){out+='" : "';}out+='");
		})
		.replace(c.iterate || skip, function(m, iterate, vname, iname) {
			if (!iterate) return "';} } out+='";
			sid+=1; indv=iname || "i"+sid; iterate=unescape(iterate);
			return "';var arr"+sid+"="+iterate+";if(arr"+sid+"){var "+vname+","+indv+"=-1,l"+sid+"=arr"+sid+".length-1;while("+indv+"<l"+sid+"){"
				+vname+"=arr"+sid+"["+indv+"+=1];out+='";
		})
		.replace(c.evaluate || skip, function(m, code) {
			return "';" + unescape(code) + "out+='";
		})
		+ "';return out;")
		.replace(/\n/g, '\\n').replace(/\t/g, '\\t').replace(/\r/g, '\\r')
		.replace(/(\s|;|}|^|{)out\+='';/g, '$1').replace(/\+''/g, '')
		.replace(/(\s|;|}|^|{)out\+=''\+/g,'$1out+=');

	if (needhtmlencode && c.selfcontained) {
		str = "var encodeHTML=(" + encodeHTMLSource.toString() + "());" + str;
	}
	try {
		return new Function(c.varname, str);
	} catch (e) {
		if (typeof console !== 'undefined') console.log("Could not create a template function: " + str);
		throw e;
	}
};

doT.compile = function(tmpl, def) {
	return doT.template(tmpl, null, def);
};

//////////////////////////////////////////////////////////////////////////////////////////
//																						//
//						Override jQuery #data methods and init templates				//
//																						//
//////////////////////////////////////////////////////////////////////////////////////////

//	Override jQuery#data,#removeData methods, watching for changes (two arguments, remove),
//	updating template if changes occur. No
//
//	Normal #data behavior persists, with no modification, first.
//
//	Errors should be noisy if you don't properly bind a template, etc.
//
var _data 		= $.fn.data;
var _removeData	= $.fn.removeData;

var update	= function(args, _this, force) {

	var $target	= $(_this);

	if(force || args.length === 2 || $.isPlainObject(args[0])) {
		var boundTemplateId = $target.attr("data-template");
		if(boundTemplateId) {
			$target.html(doT.template($("#" + boundTemplateId).text())($target.data()));
		}
	}
};

$.fn.data = function(key, value) {
	var methRes	= _data.apply(this, arguments);
	update(arguments, this);
	return methRes;
};

$.fn.removeData = function() {
	var methRes	= _removeData.apply(this, arguments);
	update(arguments, this, 1);
	return methRes;
};

//	Ask the template to re-render for this target. No changes are made to the data.
//
$.fn.replayData = function() {
	update(null, this, 1);
	return this;
};

//////////////////////////////////////////////////////////////////////////////////////////
//																						//
//									Create mies api										//
//																						//
//////////////////////////////////////////////////////////////////////////////////////////

var	AP_SLICE		= Array.prototype.slice;
var	OP_TO_STRING	= Object.prototype.toString;

var HASH_WATCHERS	= [];
var CURRENT_HASH	= null;
var WATCHING_HASH	= false;
var ROUTES			= [];
var STORE			= {};
var READY			= [];
var CALLS			= {};
var SUBSCRIPTIONS	= {};
var LAST_SUBSCRIBE	= null;
var MURMUR_SEED		= parseInt(Math.random() * 10000);
var PING_CHECK;

//	@see	#nextId
//
var COUNTER			= 1969;

//	The events which can create a UI action (which will be routed).
//
//	@see	#mies#bindUI
//
var BOUND_UI_EVENTS = "click mousedown mouseup mouseover mouseout mouseenter mouseleave mousemove focus blur focusin focusout hover keyup keydown keypress";

//	To enable a UI element to fire actions you would so something like:
//
//	<div data-action="click/run/this/route/">ROUTE!</div>
//
var ACTION_SELECTOR	= "[data-action]";

//	These are exposed via #mies#setOption
//
var OPTIONS = {
	maxRetries 	: 5,
	callTimeout	: 5000
};

//	@see	#mies#subscribe
//	@see	#mies#error
//	@see	#mies#done
//	@see	#mies#always
//
var ADD_SUB_HANDLER = function(meth, fn) {
	if(LAST_SUBSCRIBE && typeof fn === "function") {
		LAST_SUBSCRIBE[meth] = fn;
	}
};

//	##ITERATOR
//
//	Returns accumulator as modified by passed selective function.
//	This is used by #arrayMethod in cases where there is not a native implementation
//  for a given array method (#map, #filter, etc). It's a fallback, in other words,
//  and hopefully will go vestigial over time.
//
//	Also used by #iterate, being a general iterator over either objects or arrays.
//	NOTE: It is usually more efficient to write your own loop.
//
//	You may break the iteration by returning Boolean `true` from your selective function.
//
//	@param		{Function}		fn		The selective function.
//	@param		{Object}		[targ]	The object to work against. If not sent
//										the default becomes Subject.
//	@param		{Mixed}			[acc]	An accumulator, which is set to result of selective
//										function on each interation through target.
//  @param      {Object}        [ctxt]  A context to run the iterator in.
//	@see	#arrayMethod
//	@see	#iterate
//
var	ITERATOR = function(targ, fn, acc, ctxt) {

	ctxt    = ctxt || targ;
	acc		= acc || [];
	var x = 0;
	var len;
	var n;

	if($.isArray(targ)) {
		len = targ.length;
		while(x < len) {
			acc = fn.call(ctxt, targ[x], x, targ, acc);
			if(acc === true) {
				break;
			}
			x++;
		}
	} else {
		for(n in targ) {
			if(targ.hasOwnProperty(n)) {
				acc = fn.call(ctxt, targ[n], n, targ, acc);
				if(acc === true) {
					break;
				}
			}
		}
	}

	return acc;
};

//	##FIND
//
//	Find a value in the store.
//
//	@see	#find
//
var FIND 	= function(key, val, path, t, acc, curKey) {

    //  Keep @path a string
    //
    path = !!path ? path : "";
	acc	= acc || {
		first	: null,
		last	: null,
		node	: null,
		nodes	: [],
		paths	: [],
		key		: key,
		value	: val
	};

	var node = t;
	var p;

	//	Accumulate info on any hits against this node.
	//
	if(typeof val === "function" ? val(curKey, val, key, node) : node[key] === val) {
		if(!acc.first) {
			acc.first = path;
		}
		acc.last = path;
		acc.node = node;
		acc.nodes.push(node);
		acc.paths.push(path);
	}

	//	Recurse if children.
	//
	if(typeof node === "object") {
		for(p in node) {
			if(node[p]) {
				FIND(key, val, path + (path ? "." : "") + p, node[p], acc, p);
			}
		}
	}

	return acc;
};

var mies = {

	//	##set
	//
	//	Set a value at key.
	//
	//	If you would like to have the value you've just set returned, use #setget.
	//	Otherwise, `this` (Mies) is returned.
	//
	set : function(key, value) {
		STORE[key] = value;
		return this;
	},

	//	##setnx
	//
	//	Set only if the value of key is undefined.
	//
	setnx : function(key, value) {
		if(typeof STORE[key] === void 0) {
			this.set(key, value);
		}

		return this;
	},

	//	##getset
	//
	//	Set a value at key AND return the value set.
	//
	getset : function(key, value) {
		this.set(key, value);
		return this.get(key);
	},

	//	##get
	//
	//	Get value at key.
	//
	get : function(key) {
		return STORE[key];
	},

	//  ##find
	//
	//	Returns dot-delimited paths to nodes in an object, as strings.
	//
	//	@param	{String}	key		The key to check.
	//	@param	{Mixed}		val		The sought value of key.
	//	@param	{String}	[path]	A base path to start from. Useful to avoid searching the
	//								entire tree if we know value is in a given branch.
	//	@param	{Object}	[t]		An object to search in. Defaults to STORE.
	//
	find : function(key, val, path, t) {
		return FIND(key, val, path, t || STORE);
	},

    each : function(targ, fn, acc, scope) {
        return ITERATOR(targ, function(elem, idx, targ) {
        	fn.call(scope, elem, idx, targ);
        }, acc);
    },

	map : function(targ, fn, acc, scope) {
		return ITERATOR(targ, function(elem, idx, targ, acc) {
            acc[idx] = fn.call(scope, elem, idx, targ);
            return acc;
        }, acc);
   	},

	filter : function(targ, fn, acc, scope) {
        return ITERATOR(targ, function(elem, idx, targ, acc) {
            fn.call(scope, elem, idx, targ) && acc.push(elem);
        	return acc;
        }, acc);
    },

    all : function(targ, fn, acc, scope) {
        return ITERATOR(targ, function(elem, idx, targ, acc) {
            fn.call(scope, elem, idx, targ) && acc.push(1);
            return acc;
        }, acc).length === targ.length;
    },

	any : function(targ, fn, acc, scope) {
        return ITERATOR(targ, function(elem, idx, targ, acc) {
            fn.call(scope, elem, idx, targ) && acc.push(1);
            return acc;
        }, acc).length > 0;
    },

    //	##nextId
    //
    //	Increments and returns the counter.
    //
    nextId : function(pref) {
    	COUNTER += 1;
    	return pref ? pref + COUNTER : COUNTER;
    },

    //	##murmurhash
    //
	//	JS Implementation of MurmurHash3 (r136) (as of May 20, 2011)
	//
	//	@author <a href="mailto:gary.court@gmail.com">Gary Court</a>
	//	@see http://github.com/garycourt/murmurhash-js
	//	@author <a href="mailto:aappleby@gmail.com">Austin Appleby</a>
	//	@see http://sites.google.com/site/murmurhash/
	//
	//	@param {string} key ASCII only
	//	@param {number} seed Positive integer only
	//	@return {number} 32-bit positive integer hash
	//
	murmurhash : function(key, seed) {
		var remainder, bytes, h1, h1b, c1, c1b, c2, c2b, k1, i;

		remainder = key.length & 3; // key.length % 4
		bytes = key.length - remainder;
		h1 = seed;
		c1 = 0xcc9e2d51;
		c2 = 0x1b873593;
		i = 0;

		while (i < bytes) {
			k1 =
			  ((key.charCodeAt(i) & 0xff)) |
			  ((key.charCodeAt(++i) & 0xff) << 8) |
			  ((key.charCodeAt(++i) & 0xff) << 16) |
			  ((key.charCodeAt(++i) & 0xff) << 24);
			++i;

			k1 = ((((k1 & 0xffff) * c1) + ((((k1 >>> 16) * c1) & 0xffff) << 16))) & 0xffffffff;
			k1 = (k1 << 15) | (k1 >>> 17);
			k1 = ((((k1 & 0xffff) * c2) + ((((k1 >>> 16) * c2) & 0xffff) << 16))) & 0xffffffff;

			h1 ^= k1;
			h1 = (h1 << 13) | (h1 >>> 19);
			h1b = ((((h1 & 0xffff) * 5) + ((((h1 >>> 16) * 5) & 0xffff) << 16))) & 0xffffffff;
			h1 = (((h1b & 0xffff) + 0x6b64) + ((((h1b >>> 16) + 0xe654) & 0xffff) << 16));
		}

		k1 = 0;

		switch (remainder) {
			case 3: k1 ^= (key.charCodeAt(i + 2) & 0xff) << 16;
			case 2: k1 ^= (key.charCodeAt(i + 1) & 0xff) << 8;
			case 1: k1 ^= (key.charCodeAt(i) & 0xff);

			k1 = (((k1 & 0xffff) * c1) + ((((k1 >>> 16) * c1) & 0xffff) << 16)) & 0xffffffff;
			k1 = (k1 << 15) | (k1 >>> 17);
			k1 = (((k1 & 0xffff) * c2) + ((((k1 >>> 16) * c2) & 0xffff) << 16)) & 0xffffffff;
			h1 ^= k1;
		}

		h1 ^= key.length;

		h1 ^= h1 >>> 16;
		h1 = (((h1 & 0xffff) * 0x85ebca6b) + ((((h1 >>> 16) * 0x85ebca6b) & 0xffff) << 16)) & 0xffffffff;
		h1 ^= h1 >>> 13;
		h1 = ((((h1 & 0xffff) * 0xc2b2ae35) + ((((h1 >>> 16) * 0xc2b2ae35) & 0xffff) << 16))) & 0xffffffff;
		h1 ^= h1 >>> 16;

		return h1 >>> 0;
	},

	//	##setOption
	//
	//	Set a Mies option.
	//
	setOption : function(k, v) {
		if(arguments.length === 2 && OPTIONS[k]) {
			OPTIONS[k] = v;
		}
	},

	//////////////////////////////////////////////////////////////////////////////////////
	//																					//
	//									URL Hash Methods								//
	//																					//
	//////////////////////////////////////////////////////////////////////////////////////

	//	##watchHash
	//
	//	Enables the binding of handlers to hash change events.
	//
	//	@param	{Function}	[handler]	Shortcut, equivalent to:
	//									watchHash().addHashHandler(handler)
	//
	//	@see	#unwatchHash
	//	@see	#addHashHandler
	//	@see	#removeHashHandler
	//	@see	#updateHash
	//
	watchHash : function(handler) {

		this.addHashHandler(handler);
		this.updateHash(this.getHash());

		var runHandlers = function(hash) {
			mies.each(HASH_WATCHERS, function(w) {
				var h = hash.substring(1, Infinity);
				h && w(h);
			});
		}

		if("onhashchange" in window) {
			window.onhashchange = function() {
				runHandlers(mies.getHash());
			};

			//	#onhashchange waits for subsequent change. When hash watching
			//	starts we want to execute any url fragment in the current location (as
			//	would happen with fallback method below).
			//
			runHandlers(this.getHash());
		}
		else {
			window.setInterval(function() {
				var ch = mies.getHash();
				if(ch !== CURRENT_HASH) {
					mies.updateHash(ch)
					runHandlers(CURRENT_HASH);
				}
			}, 200);
		}

		WATCHING_HASH = handler;

		return this;
	},

	unwatchHash : function() {
		WATCHING_HASH = false;

		return this;
	},

	addHashHandler : function(fn) {
		if(typeof fn === "function") {
			this.removeHashHandler(fn);
			HASH_WATCHERS.push(fn);
		}

		return this;
	},

	removeHashHandler : function(fn) {
		HASH_WATCHERS = mies.filter(HASH_WATCHERS, function(f) {
			return f !== fn;
		});

		return this;
	},

	updateHash : function(hash) {
		CURRENT_HASH = window.location.hash = encodeURIComponent(hash);

		return this;
	},

	getHash : function() {
		return decodeURIComponent(window.location.hash);
	},

	//////////////////////////////////////////////////////////////////////////////////////
	//																					//
	//								pub/sub/route methods								//
	//																					//
	//////////////////////////////////////////////////////////////////////////////////////

	//	##publish
	//
	//	Will Publish to a route, causing a broadcast from the server which can
	//	be subscribed to (on same route).
	//
	//	@param	{String}	route
	//	@param	{Object}	[postdata]	This is always a POST.
	//	@param	{Mixed}		[passed]	Data to be passed along to any handlers.
	//	@param	{Boolean}	[mass]		Whether to do a mass broadcast.
	//
	//	@see	#massPublish
	//
	publish : function(route, postdata, passed, mass) {

		postdata = postdata || {};

		//	Create a unique hash of sent arguments, which allows us
		//	to cache results.
		var id = this.murmurhash(JSON.stringify(arguments), MURMUR_SEED);

		//	If there is a cached result, return that. Otherwise, refresh call.
		//
		if(CALLS[id]) {

			this.routeBroadcast(id, CALLS[id].result, 1);

		} else {

			CALLS[id] = {
				args		: AP_SLICE.call(arguments),
				route		: route,
				passed		: passed,
				result		: {},
				time		: new Date().getTime(),
				tries		: 1,
				retry		: function() {
					if(++this.tries < OPTIONS.maxRetries) {
						mies.publish.apply(mies, this.args);
					}
				}
			};

			$.ajax({
				type		: "POST",
				url			: route,
				data		: postdata,
				dataType	: "json",
				headers		: {
					"x-mies-callid"		: id,
					"x-mies-broadcast"	: mass ? 2 : 1
				},
				timeout		: OPTIONS.callTimeout
			});
		}

		return this;
	},

	//	##massPublish
	//
	//	A shortcut bridge to #publish, letting you mass publish by only setting
	//	@route and @postdata. Also recommended for code clarity.
	//
	//	@see	#publish
	//
	massPublish : function(route, postdata, passed) {
		return publish(route, postdata, passed, 1);
	},

	//	Register a route for this interface which can now be published to.
	//
	//	@param	{String}	route	You subscribe to routes.
	//	@param	{Function}	handler	The method to call when route is published to.
	//								Recieves args [action, passed, route], and is
	//								called in the context of the published data.
	//
	subscribe : function(route, handler) {
		var p = this.parseRoute(route);

		//	Note that no checking is done for duplicate route subscription. This
		//	may or may not be what you want. To avoid duplicate subscriptions,
		//	use #subscribenx
		//
		if(typeof p === "object" && p.compiled) {
			LAST_SUBSCRIBE = ROUTES[ROUTES.push({
				regex	: p.compiled,
				handler	: handler
			}) -1];
		}

		return this;
	},

	//	#subscribenx
	//
	//	Only subscribe if this route has no other subscribers.
	//
	subscribenx : function(route, handler) {
		var p = this.parseRoute(route);
		var i = ROUTES.length;
		//	An identical route has already been registered. Exit.
		//
		while(i--) {
			if(ROUTES[i].regex === p.compiled) {
				return this;
			}
		}

		return subscribe(route, handler);
	},

	//	##action
	//
	action : function(fn) {

		ADD_SUB_HANDLER("action", fn);

		return this;
	},

	//	##broadcast
	//
	broadcast : function(fn) {

		ADD_SUB_HANDLER("broadcast", fn);

		return this;
	},

	//	##error
	//
	error	: function(fn) {

		ADD_SUB_HANDLER("error", fn);

		return this;
	},

	//	##always
	//
	always : function(fn) {

		ADD_SUB_HANDLER("always", fn);

		return this;
	},

	//	##route
	//
	//	Routes an action. There are two types of action: [A]UI Action (click, etc), and
	//	[B]S.S.E. (Server-Sent-Event). Called in one of two contexts (value of `this`):
	//
	//	[A]	: The event target (equiv. to $(event.currentTarget)).
	//	[B] : The Call Object (CALLS[id] -- see #publish)
	//
	//	@param	{String}	r			The route.
	//	@param	{String}	action		The action which caused this routing. In the case of a
	//									client action, this is an event, like "click"
	//									or "mousedown". In the case of a server-sent-event it
	//									will always be "broadcast".
	//	@param	{Object}	result		The action result. In the case of a client action, this
	//									is a jQuery event object. In the case of a S.S.E. this
	//									will be the response data.
	//	@param	{Mixed}		[passed]	Any data passed by the original call.
	//
	//	@see	#bindUI
	//	@see	#bindEventSource
	//	@see	#publish
	//
	route : function(r, action, result, passed) {

		var i 	= ROUTES.length;
		var m;
		var rob;
		var args;

		while(i--) {
			rob = ROUTES[i];
			m 	= r.match(rob.regex);
			if(m) {
				//	This is the full route, first arg of successful match.
				//
				r = m.shift();

				//	Either a client action (action) or a S.S.E. (broadcast).
				//	All subscribe handlers receive three arguments:
				//
				//	1. 	The action. This is only relevant on client actions, where
				//		it will be something like "click" or "mouseup". S.S.E.
				//		will always be of action type "broadcast".
				//	2.	Passed object. Client actions may pass along values (sent
				//		when #publish is called. Broadcasts never have passed arguments,
				//		so this will always be an empty object.
				//	3. 	The route. Both types receive this.
				//
				//	#always is (ahem) always called, regardless of whether action or
				//	broadcast, receiving the same arguments.
				//
				//	#error is only called if the #result#error is not undefined.
				//
				//	All methods except for #error are called in the scope of the #result.
				//	#error is called within the #callObject scope, which is the scope
				//	this method (#route) is called within.  The call object, usefully for
				//	#error, has a #retry method.  See #publish.
				//
				//	@see	#publish
				//
				args = m.concat(action, passed, r);

				if(result.error) {
					rob.error && rob.error.apply(this, args);
				} else {
					if(action === "broadcast") {
						rob.broadcast && rob.broadcast.apply(result, args);
					} else {
						rob.action && rob.action.apply(result, args);
					}
				}

				rob.always && rob.always.apply(result, args);
			}
		}

		return this;
	},

	//	##routeBroadcast
	//
	//	Pre-process "broadcast" (vs. "event") publications. All server-sent events so routed
	//	should have been "published" by *this* client, which would create a CALLS entry.
	//
	//	@param	{String}	id		The call id.
	//	@param	{Object}	result	The server response.
	//	@param	{Boolean}	keep	Whether or not to cache results.
	//
	routeBroadcast : function(id, result, keep) {
		var callObj = CALLS[id];
		if(!callObj) {
			return this;
		}

		callObj.result 	= result;
		callObj.keep	= keep;

		this.route.call(callObj, callObj.route, "broadcast", result, callObj.passed);

		//	If event #id starts with bang(!) we are being told to cache
		//	results. Don't delete if so.
		//
		if(!keep) {
			delete CALLS[id];
		}

		return this;
	},

	//	##parseRoute
	//
	//	Accepts a route (eg. /users/:userid/:type) and returns an object containing:
	//
	//	#serialized	: A regular expression matching the route, as a string.
	//	#compiled	: A regular expression matching the route.
	//
	//	Also accepts RegExp objects as a route.
	//
	//	@param	{Mixed}	route	The route. Either a string to be converted to a regex,
	//							or a regex.
	//
	parseRoute : function(route) {

		var ret = {};

		if(route.constructor === RegExp) {
			ret.serialized 	= new String(route);
			ret.compiled	= route;

			return ret;
		}

		//	Leading and trailing slashes are optional. We remove these from the
		//	route and bracket all route regexes with `/?`.
		//
		if(route.charAt(route.length -1) === "/") {
			route = route.substring(0, route.length -1);
		};
		if(route.charAt(0) === "/") {
			route = route.substring(1, Infinity);
		};

		//	Replace all :key tokens with a group which captures any string of characters
		//	not containing a slash.
		//
		//	Note as well that the "intra-slash" matcher ([^/]*) will match any non-slash
		//	character between 0(zero) and N times -- which means that a route like
		//	/foo/:bar/:baz will be matched given foo/// or foo/23// or foo/23/
		//	(but not foo/23).
		//
		ret.serialized	= new String('^/?' + route + '/?$').replace(/:([\w]+)/g, function(token, key, idx, orig) {
			return "([^/]*)";
		})

		ret.compiled = new RegExp(ret.serialized);

		return ret;
	},

	//////////////////////////////////////////////////////////////////////////////////////
	//																					//
	//							Communication layer setup								//
	//																					//
	//////////////////////////////////////////////////////////////////////////////////////

	//	##bindEventSource
	//
	//	Set up the #error, #open, and #message event handlers for the eventsource binding.
	//	If the eventsource #id is registered in the CALLS lookup this is a
	//	broadcast, which is routed as such. NOTE check for "!" prefix.
	//
	bindEventSource : function(meetingId) {
		var source = new EventSource('/receiveBroadcasts/' + (meetingId || "*"));

		//	When the eventsource client receives an error it will re-publish to
		//	the server (which can log, etc).
		//
		source.addEventListener('error',  function(){
			mies.publish("eventsource/error")
		}, false);

		//	Whenever client successfully opens a connection to eventsource. There is no
		//	handling here, as the relevant "opening" occurs when the server broadcasts to
		//	the `firstcontact` route.
		//
		source.addEventListener('open', function(){}, false);

		//	All eventsource broadcasts will be to this channel. #lastEventId will be
		//	an id (as per CALLS), or a route. #data is always sent as a JSON string.
		//
		source.addEventListener('message', function(msg) {

			var data 	= JSON.parse(msg.data);
			var id 		= msg.lastEventId;
			var keep	= false;

			if(CALLS[id]) {
				if(id.charAt(0) === "!") {
					keep = true;
					id = id.substring(1, Infinity);
				}
				return mies.routeBroadcast(id, data, keep);
			}

			//	Otherwise, we should be receiving a route as an id.  Routes are sent
			//	either by the server directly (server broadcasting its own info), or
			//	are derived from a call the server received for a wide broadcast (in
			//	which case a client one->many call cannot expect to have the source
			//	context, such as the #callId, or of course the client call object itself).
			//
			return mies.route.call({}, id, "broadcast", data, {});

		}, false);

		return this;
	},

	//////////////////////////////////////////////////////////////////////////////////////
	//																					//
	//										UI Binding									//
	//																					//
	//////////////////////////////////////////////////////////////////////////////////////

	//	##bindUI
	//
	//	Route all events originating on elements with a `data-action` attribute.
	//
	//	@example	If I want a <div> to publish to a route when it is clicked:
	//				<div data-action="click/some/route/here">clickme</div>, where
	//				`click` indicates the action to bind, and `some/route/here`
	//				being the actual route published to.
	//
	//	@see	#route
	//
	bindUI : function() {
		$(document.body).on(BOUND_UI_EVENTS, ACTION_SELECTOR, function(event) {

			var target 		= $(event.currentTarget);
			var actionRoute	= target.attr("data-action");
			var rData 		= (actionRoute || "").match(/(\w+)\/(.+)([\/]?.*)/);
			var type		= event.type;

			//	No match, no command, or action doesn't match
			//
			//	[1]	: The user action (click, mouseup, etc).
			//	[2] : The custom command (openMyUIFeature).
			//	[3] : The rest of the route.
			//
			if(!rData || !rData[1] || !rData[2] || rData[1] !== type) {
				return this;
			}

			var route 		= rData[2] + rData[3];
			var hashedRoute	= "#" + route;

			//	Mainly to prevent href actions from firing.
			//
			event.preventDefault();

			//	When we have a new route request with the ! directive (update hash), and the
			//	current hash differs, update the hash.
			//
			if(actionRoute.indexOf("!") === 0 && window.location.hash !== hashedRoute) {
				mies.updateHash(hashedRoute);
			}

			mies.route.call(target, route, type, event);
			return this;
		});

		return this;
	},

	unbindUI : function() {
		$(document.body).off(BOUND_UI_EVENTS, ACTION_SELECTION);

		return this;
	}
};

mies
	.set("timezoneOffset", new Date().getTimezoneOffset() /60)
	.bindUI();

(typeof exports === 'object' ? exports : window)["mies"] = mies;

});