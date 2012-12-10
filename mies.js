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
	templateSettings	: {
		evaluate		: /\{\{([\s\S]+?)\}\}/g,
		interpolate		: /\{\{=([\s\S]+?)\}\}/g,
		encode			: /\{\{!([\s\S]+?)\}\}/g,
		use				: /\{\{#([\s\S]+?)\}\}/g,
		define			: /\{\{##\s*([\w\.$]+)\s*(\:|=)([\s\S]+?)#\}\}/g,
		conditional		: /\{\{\?(\?)?\s*([\s\S]*?)\s*\}\}/g,
		iterate			: /\{\{~\s*(?:\}\}|([\s\S]+?)\s*\:\s*([\w$]+)\s*(?:\:\s*([\w$]+))?\s*\}\})/g,
		varname			: 'binding',
		strip			: true,
		append			: true,
		selfcontained	: false
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

//	@see	#join
//
var SESSION_ID;
var IS_SOCK;

//	Adjustment for trim methods.
//
//	See http://forum.jquery.com/topic/faster-jquery-trim.
//	See: http://code.google.com/p/chromium/issues/detail?id=5206
//	Below is a fix for browsers which do not recognize &nbsp; as a whitespace character.
//
//	@see		#trim
//	@see		#trimLeft
//	@see		#trimRight
//
var TRIM_LEFT	= /^\s+/;
var TRIM_RIGHT	= /\s+$/;

if(!/\s/.test("\xA0")) {
	TRIM_LEFT 	= /^[\s\xA0]+/;
	TRIM_RIGHT 	= /[\s\xA0]+$/;
}

//	Whether #trim is a native String method.
//
var NATIVE_TRIM	= !!("".trim);

var PING_CHECK;
var LAST_CALL_ID;

//	@see	#nextId
//
var COUNTER			= 1969;

//	The events which can create a UI action (which will be routed).
//
//	@see	#mies#bindUI
//
var BOUND_UI_EVENTS = "abort change click dblclick error mouseup mousedown mouseout mouseover mouseenter mouseleave keydown keyup keypress focus blur focusin focusout load unload submit reset resize select scroll";

//	To enable a UI element to fire actions you would so something like:
//
//	<div data-action="click/run/this/route/">ROUTE!</div>
//
var ACTION_SELECTOR	= "[data-action]";

//	These are exposed via #mies#setOption
//
var OPTIONS = {
	maxRetries 	: 3,
	callTimeout	: 5000
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

	if(mies.is(Array, targ)) {
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
//	Find nodes in an object.
//
//	@see	#find
//
var FIND 	= function(key, val, path, obj, acc, curKey) {

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

	var node = obj;
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

	//	##_callObj
	//
	//	An internal method, a constructor, which creates a call object suitable
	//	for existence on the #CALLS stack.
	//
	_callObj : function(opts) {
		opts = opts || {};

		this.result	= opts.result || {};
		this.time	= new Date().getTime();
		this.tries	= 0;
		this._tries	= 0;
		this.retry	= opts.args ? function() {
			++this._tries;
			if(this._tries < this.tries) {
				mies.publish.apply(mies, this.args);
				return true;
			}
			return false;
		} : $.noop;

		this.args 	= opts.args 	|| [];
		this.route	= opts.route 	|| "";
		this.passed	= opts.passed 	|| "";
	},

	//	##set
	//
	//	Set a value at key.
	//
	//	If you would like to have the value you've just set returned, use #setget.
	//	Otherwise, `this` (Mies) is returned.
	//
	set : function(key, value, obj) {
		(obj || STORE)[key] = value;
		return this;
	},

	//	##setnx
	//
	//	Set only if the value of key is undefined.
	//
	setnx : function(key, value, obj) {
		obj = obj || STORE;
		if(typeof obj[key] === void 0) {
			this.set(key, value, obj);
		}

		return this;
	},

	//	##getset
	//
	//	Set a value at key AND return the value set.
	//
	getset : function(key, value, obj) {
		this.set(key, value, obj);
		return this.get(key, obj);
	},

	//	##get
	//
	//	Get value at key.
	//
	get : function(key, obj) {
		return (obj || STORE)[key];
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

	//	##each
	//
    each : function(targ, fn, acc, scope) {
        return ITERATOR(targ, function(elem, idx, targ) {
        	fn.call(scope, elem, idx, targ);
        }, acc);
    },

	//	##map
	//
	map : function(targ, fn, acc, scope) {
		return ITERATOR(targ, function(elem, idx, targ, acc) {
            acc[idx] = fn.call(scope, elem, idx, targ);
            return acc;
        }, acc);
   	},

	//	##filter
	//
	filter : function(targ, fn, acc, scope) {
        return ITERATOR(targ, function(elem, idx, targ, acc) {
            fn.call(scope, elem, idx, targ) && acc.push(elem);
        	return acc;
        }, acc);
    },

	//	##all
	//
    all : function(targ, fn, acc, scope) {
    	var hit = true;
        ITERATOR(targ, function(elem, idx, targ, acc) {
            if(!fn.call(scope, elem, idx, targ)) {
            	hit = false;
            	return true;
            }
        });

        return hit;
    },

	//	##any
	//
	any : function(targ, fn, acc, scope) {
		var hit = false;
        ITERATOR(targ, function(elem, idx, targ, acc) {
            if(fn.call(scope, elem, idx, targ)) {
            	hit = true;
            	return true;
            }
        });

        return hit;
    },

	//	##pluck
	//
    pluck : function(targ, targAtt) {
        return ITERATOR(targ, function(elem, idx, targ, acc) {
            elem.hasOwnProperty(targAtt) && acc.push(elem[targAtt]);
        	return acc;
        }, []);
    },

	//	##leftTrim
	//
	//	Removes whitespace from beginning of a string.
	//
	//	@param		{String}	t	The string to trim.
	//
	leftTrim : function(t) {
		return t.replace(TRIM_LEFT, "");
	},

	//	##rightTrim
	//
	//	Removes whitespace from end of a string.
	//
	//	@param		{String}	t	The string to trim.
	//
	rightTrim : function(t) {
		return t.replace(TRIM_RIGHT, "");
	},

	//	##trim
	//
	//	Removes whitespace from beginning and end of a string.
	//
	//	@param		{String}	[t]	The string to trim.
	//
	trim : function(t) {
		return 	NATIVE_TRIM
					? t.trim()
					: t.replace(TRIM_LEFT, "").replace(TRIM_RIGHT, "");
	},

    //	##nextId
    //
    //	Increments and returns the counter.
    //
    nextId : function(pref) {
    	COUNTER += 1;
    	return pref ? pref + COUNTER : COUNTER;
    },

	// 	##is
	//
	//	@param		{Mixed}		type		An object type.
	// 	@param		{Mixed}		val			The value to check.
	//	@type		{Boolean}
	//
	// Checks whether `val` is of requested `type`.
	//
	is : function(type, val) {

		//	Here we're allowing for a check of undefined:
		//	mies.is(undefined, [some undefined var]) // true
		//
		//	Otherwise, we throw an error (rare case
		//
		if(type === void 0) {
			return val === type;
		}

		if(val === void 0) {
			return false;
		}

		var p;

		switch(type) {
			case Array:
				return OP_TO_STRING.call(val) === '[object Array]';
			break;

			case Object:
				return OP_TO_STRING.call(val) === '[object Object]';
			break;

			case "numeric":
				return !isNaN(parseFloat(val)) && isFinite(val);
			break;

			case "emptyObject":
				for(p in val) {
					return false;
				}
				return true;
			break;

			default:
				return val.constructor === type;
			break;
		}
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

	//	##extend
	//
	//	Adds a method to Mies. Simply does some checking to ensure validity.
	//
	//	@param	{Mixed}		name	The name of the method. You may send multiple
	//								meth/func pairs by passing a map as #name.
	//	@param	{Function}	[func]	If sending a {String} #name, the method.
	//
	extend	: function(name, func) {
		if(mies.is(Object, name)) {
			var p;
			for(p in name) {
				mies.extend(n, name[p]);
			}
		} else if(!mies.hasOwnProperty(name) && typeof func === "function") {
			mies[name] = func;
		}

		return this;
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
	//	@param	{Mixed}		Either a route, or an Array of routes.
	//	@param	{Object}	[postdata]	This is always a POST.
	//	@param	{Mixed}		[passed]	Data to be passed along to any handlers.
	//	@param	{Boolean}	[bType]		Whether to do a mass broadcast.
	//	@param	{Boolean}	[idem]		Whether
	//
	//	@see	#massPublish
	//
	publish : function(route, postdata, passed, bType, idem) {
		postdata = postdata || {};

		//	Using arguments if idem, arguments + random if not.
		//
		LAST_CALL_ID = this.murmurhash(JSON.stringify(arguments) + (idem ? "" : Math.random()), MURMUR_SEED);

		var callObj = CALLS[LAST_CALL_ID];

		if(callObj && idem) {
			mies.route.call(callObj, callObj.route, "broadcast", callObj.result, callObj.passed);
			return this;
		}

		CALLS[LAST_CALL_ID] = new mies._callObj({
			args		: AP_SLICE.call(arguments),
			route		: route,
			passed		: passed,
			idem		: idem
		});

		//	Of note:
		//
		//	The -callid header is echoed by the server on an event, sent
		//	as the value of #callId when returned. On mass publish
		//	we are sending the route (as the specific details of the individual client
		//	call objects have no relevance across n clients).
		//
		//	@see 	#join
		//
		$.ajax({
			type		: "POST",
			url			: route,
			data		: postdata,
			dataType	: "json",
			headers		: {
				"x-mies-sessid"		: SESSION_ID,
				"x-mies-callid"		: bType ? route : LAST_CALL_ID,
				"x-mies-broadcast"	: bType || 1
			},
			timeout		: OPTIONS.callTimeout
		});

		return this;
	},

	//	##massPublish
	//
	//	A shortcut bridge to #publish, passing correct broadcast type.
	//	Recommended for code clarity.
	//
	//	@see	#publish
	//
	massPublish : function(route, postdata, passed, idem) {
		return mies.publish(route, postdata, passed, 2, idem);
	},

	//	##nearPublish
	//
	//	A shortcut bridge to #publish, passing correct broadcast type.
	//	Recommended for code clarity.
	//
	//	@see	#publish
	//
	nearPublish : function(route, postdata, passed, idem) {
		return mies.publish(route, postdata, passed, 3, idem);
	},

	//	If the route result, given identical arguments, is 
	publishCache : function(route, postdata, passed, bType) {
		return mies.publish(route, postdata, passed, bType, 1);
	},

	massPublishCache : function(route, postdata, passed) {
		return mies.publish(route, postdata, passed, 2, 1);
	},

	nearPublishCache : function(route, postdata, passed) {
		return mies.publish(route, postdata, passed, 3, 1);
	},
	
	//	##subscribe
	//
	//	Register a route for this interface which can now be published to.
	//
	//	@param	{String}	route
	//
	subscribe : function(route, times) {
		var p = this.parseRoute(route);

		//	Note that no checking is done for duplicate route subscription. This
		//	may or may not be what you want. To avoid duplicate subscriptions,
		//	use #subscribenx
		//
		if(typeof p === "object" && p.compiled) {
			LAST_SUBSCRIBE = ROUTES[ROUTES.push({
				regex	: p.compiled,
				times	: times
			}) -1];
		}

		return this;
	},

	//	##subscribenx
	//
	//	Only subscribe if this route has no other subscribers.
	//
	subscribenx : function(route, handler, times) {
		var p = this.parseRoute(route);
		var i = ROUTES.length;
		//	An identical route has already been registered. Exit.
		//
		while(i--) {
			if(ROUTES[i].regex === p.compiled) {
				return this;
			}
		}

		return subscribe(route, handler, times);
	},

	//	##unsubscribe
	//
	unsubscribe : function(route, handler) {
		var len = ROUTES.length;
		while(len--) {
			if(ROUTES[len].handler === handler) {
				delete ROUTES[len];
			}
		}

		return this;
	},

	//	##retry
	//
	retry : function(r) {
		CALLS[LAST_CALL_ID].tries = Math.min(OPTIONS.maxRetries, 1*r);
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
	//	@see	#join
	//	@see	#publish
	//
	route : function(r, action, result, passed) {
		var i 	= ROUTES.length;
		var m;
		var rob;
		var args;

		while(i--) {
			rob = ROUTES[i];

			//	If the regex matches (not null) will receive an array, whose first argument
			//	is the full route, and subsequent args will be any :part matches on
			//	the route. The first arg is shifted out, below, leaving only :part matches,
			//	which come to form the first arguments sent to route event handlers.
			//
			//	@example	route: "/foo/bar/:baz" < "foo/bar/something"
			//				m = ["foo/bar/something","something"]
			//
			if(m = r.match(rob.regex)) {
				//	This is the full route, first arg of successful match.
				//
				r = m.shift();

				//	Either a client action (action) or a socket action (broadcast).
				//	All subscribe handlers receive three arguments:
				//
				//	1. 	The action. This is only relevant on client actions, where
				//		it will be something like "click" or "mouseup". Socket push is
				//		always of action type "broadcast".
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
					//	Note how we shift the actual error message onto the front of args
					//
					rob.error && rob.error.apply(this, [result.error].concat(args));
				} else {
					if(action === "broadcast") {
						rob.broadcast && rob.broadcast.apply(result, args);
					} else {
						//	General .action binding
						//
						rob.action && rob.action.apply(result, args);
						//	Specific (.click, .mousedown) binding.
						//
						rob[action] && rob[action].apply(result, args);
					}
				}

				rob.always && rob.always.apply(result, args);

				//	For routes with a limit on call # remove if we've reached it.
				//
				if(rob.times) {
					rob.times--;
					if(rob.times < 1) {
						ROUTES.splice(i, 1);
					}
				}
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
	//
	routeBroadcast : function(id, result) {

		var callObj = CALLS[id];
		if(!callObj) {
			return this;
		}

		callObj.result 	= result;

		var cleanup = function() {
			mies.route.call(callObj, callObj.route, "broadcast", result, callObj.passed);
			delete CALLS[id];
		}

		//	If in an error state and a retry was requested, run #retry.
		//	Otherwise route, then destroy the call object.
		//	Note that when the retries have finished (#retry returns false) we
		//	ultimately route the last result.
		//
		if(callObj.tries > 0 && result.error) {
			if(!callObj.retry()) {
				cleanup();
			}
		} else {
			cleanup();
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

		//	Replace
		//	1. All splats with a all-inclusive match (capture all that remains in the route).
		//	2. All :key tokens with a group which captures all characters until first slash.
		//
		//	Note as well that the "intra-slash" matcher ([^/]*) will match any non-slash
		//	character between 0(zero) and N times -- which means that a route like
		//	/foo/:bar/:baz will be matched given foo/// or foo/23// or foo/23/
		//	(but not foo/23).
		//
		ret.serialized	= new String('^/?' + route + '/?$').replace(/\*/g, function() {
			return "(.*)";
		}).replace(/:([\w]+)/g, function(token, key, idx, orig) {
			return "([^/]*)";
		})

		ret.compiled = new RegExp(ret.serialized);

		return ret;
	},
	
	//	##addRouteEvent
	//
	//	Add a named method bindable within a #subscribe block.
	//
	//	@example	mies.addRouteEvent("foo")
	//				mies.subscribe("/some/route")
	//				mies.foo(function() {
	//					// This can now be fired with mies.route("/some/route", "foo", {data: "here"})
	//				})
	//
	//	This is the method used to bind #action, #broadcast, and the other core subscribe methods.
	//
	//	@param	{String}	ev		A string name for this event.
	//
	addRouteEvent : function(ev) {
		mies[ev] = function(fn) {
			if(LAST_SUBSCRIBE) {
				LAST_SUBSCRIBE[ev] = fn;
			}
			return mies;
		}
		return this;
	},

	//////////////////////////////////////////////////////////////////////////////////////
	//																					//
	//							Communication layer setup								//
	//																					//
	//////////////////////////////////////////////////////////////////////////////////////

	//	##join
	//
	join : function(groupId, sessId, transport, callback) {
		
		SESSION_ID = sessId || SESSION_ID;
		
		if(typeof transport === "function") {
			callback 	= transport;
			transport 	= null; 
		}
		
		IS_SOCK = transport === "socket";

		$.get([
			"js/eventsource.js", 
			"/socket.io/socket.io.js"
		][IS_SOCK ? 1 : 0], function(scr) {
		
			$.globalEval(scr);
			
			var onMessage = function(data) {

				var id 	= data.id;
				
				if(CALLS[id]) {
					return mies.routeBroadcast(id, data);
				}
			};

			if(IS_SOCK) {
				var socket = io.connect('/?sessId=' + SESSION_ID + '&groupId=' + groupId);
			
				socket.on('connect', function() {
					socket.on('message', onMessage);
					
					callback && callback(SESSION_ID, groupId);
				});
				
				return;
			}

			var source = new EventSource('/system/receive/' + groupId + '/' + SESSION_ID);

			//	Should only fire once
			//
			source.addEventListener('open', function() {
	
				//	All eventsource broadcasts will be to this channel. #lastEventId will be
				//	an id (as per CALLS), or a route. #data is always sent as a JSON string.
				//
				source.addEventListener('message', function(msg) {
					onMessage({
						data	: JSON.parse(msg.data).data,
						id		: msg.lastEventId
					});
					
				}, false);
				
				callback && callback(SESSION_ID, groupId);
	
			}, false);
		});
		
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
	//	NOTE: you may set any number of space-separated routes.
	//
	//	@example	If I want a <div> to publish to a route when it is clicked:
	//				<div data-action="click/some/route/here">clickme</div>, where
	//				`click` indicates the action to bind, and `some/route/here`
	//				being the actual route published to.
	//
	//				Also: <div data-action="click/foo mouseover/bar mouseout/baz">
	//
	//	@see	#route
	//
	bindUI : function() {
		$(document.body).on(BOUND_UI_EVENTS, ACTION_SELECTOR, function(event) {

			var $target 	= $(event.currentTarget);
			var actionRoute	= $target.attr("data-action").split(" ");
			var pass		= {};
			var readfrom	= $target.attr("readfrom");
			var form;
			var parent;

			mies.each(actionRoute, function(ar) {

				var rData 	= ar.match(/(\w+)\/(.+)([\/]?.*)/);
				var type	= event.type;

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
				if(CURRENT_HASH && window.location.hash !== hashedRoute) {
					mies.updateHash(hashedRoute);
				}

				//	If not a broadcast, it is an action. If the action is anything other
				//	than a `mousemove`, fetch and pass some useful target and event data.
				//	(`mousemove` is unlikely to be the active interaction for a form change,
				//	and as such the expense of seeking unnecessary form references on
				//	invocations  with potential microsecond periodicity is too great. Note
				//	handlers are called within the scope of the $target, so the handler
				//	is free to replicate the given seek).
				//
				if(type !== "broadcast" && type !== "mousemove") {

					//	Fetch any related forms.
					//
					if(readfrom && (form = $("#" + readfrom)).length) {}
					else if(!(form = (parent = $target.parent()).find("form")).length) {
						form = parent.parent().find("form");
					}

					if(form.length) {
						form.find('input[type="text"]').each(function() {
							var $t = $(this);
							$t.val(mies.trim($t.val()));
						});
						pass.$form		= form;
						pass.formData	= form.length ? form.serialize() : null;
					}
				}

				mies.route.call($target, route, type, event, pass);
			});
		});

		return this;
	},

	unbindUI : function() {
		$(document.body).off(BOUND_UI_EVENTS, ACTION_SELECTION);

		return this;
	},
	
	loadModules : function(cb) {
		var $mods = $(".module[name]");
		
		cb = cb || $.noop;		

		if(!$mods.length) {
			return cb();
		}
		
		$mods.each(function() {
			var $this 	= $(this);
			var name	= $this.attr("name");
			var auth	= $this.attr("data-auth") || "";
			
			//	Load once, avoiding future loads. To reload, $this.addClass("module").
			//	Add identifying class selector, mainly for css.
			//
			$this
			.removeClass("module")
			.addClass("module-" + name);
					
			$.getJSON("/module/" + name + "/" + auth, function(data) {
				data.css && $("<style type=\"text/css\">" + data.css + "</style>").appendTo(document.head);
				data.html && $this.html(data.html);
				data.js && $.globalEval(data.js);
				cb();
			});
		});
		
		return this;
	}
};

//	Add the #subscribe block handlers (all ui events [click, mousedown, etc] + internals)
//
mies.each(BOUND_UI_EVENTS.split(" ").concat("action","broadcast","error","always"), function(e) {
	mies.addRouteEvent(e);
})

mies
	.set("timezoneOffset", new Date().getTimezoneOffset() /60)
	.loadModules(mies.bindUI);

(typeof exports === 'object' ? exports : window)["mies"] = mies;

});