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
		var boundTemplate = $target.data("__BOUND_TEMPLATE__");
		if(boundTemplate) {
			$target.html(doT.template(boundTemplate.text())($target.data()));
		}
	}
};

$.fn.data = function() {
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

//	Find all the template bindings, set bound template ref (which also forces an update, doing
//	the initial template bind).
//
$("[data-template]").each(function(i, e) {
	var $t = $(this);
	$t.data("__BOUND_TEMPLATE__", $("#" + $t.attr("data-template")));
});

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

var BOUND_UI_EVENTS = "click mousedown mouseup mouseover mouseout mouseenter mouseleave mousemove focus blur focusin focusout hover keyup keydown keypress";
var ACTION_SELECTOR	= "[data-action]";


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


(typeof exports === 'object' ? exports : window)["mies"] = ({

	set : function(k, v) {
		STORE[k] = v;
		return v;
	},

	get : function(k) {
		return STORE[k];
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

	//	##parseRoute
	//
	//	Accepts a route (eg. /users/:userid/:type) and returns an object containing:
	//
	//	#serialized	: {String} A regular expression to match the route.
	//	#compiled	: {RegExp}
	//
	//	Also accepts RegExp objects as a route.
	//
	parseRoute : function(route) {

		var ret = {};

		if(route.constructor === RegExp) {
			ret.serialized 	= new String(route);
			ret.compiled	= route;

			return ret;
		}

		//	Lose unnecessary trailing slashes
		//
		if(route.charAt(route.length -1) === "/") {
			route = route.substring(0, route.length -1);
		};

		//	Replace all :key tokens with a group which captures any string of characters
		//	not containing a slash.  Note that trailing slash is optional.
		//
		ret.serialized	= new String('^' + route + '/?$').replace(/:([\w]+)/g, function(token, key, idx, orig) {
			return "([^/]*)";
		})

		ret.compiled = new RegExp(ret.serialized);

		return ret;
	},

	//	Register a route for this interface.
	//
	//	@param	{
	addRoute : function(route, handler) {

		var p = this.parseRoute(route);
		var i = ROUTES.length;

		if(typeof p === "object" && p.compiled) {

			//	An identical route has already been registered. Exit.
			//
			while(i--) {
				if(ROUTES[i].regex === p.compiled) {
					return this;
				}
			}

			ROUTES.push({
				regex	: p.compiled,
				handler	: handler
			});
		}

		return this;
	},

	route : function(r, action, event) {
		var i 	= ROUTES.length;
		var m;
		var r;
		while(i--) {
			m = r.match(ROUTES[i].regex);
			if(m) {

				//	This is the full route, first arg of successful match.
				//
				r = m.shift();

				//	Build info object, and concat to arguments.
				//
				m = m.concat({
					action 	: action,
					route	: r,
					event	: event,
					$target	: $(event.currentTarget)
				});

				ROUTES[i].handler.apply(ROUTES[i], m);
			}
		}

		return this;
	},

	bindUI : function() {
		//	We're going to listen for all events originating from .user-action elements and acting
		//	on those which have a #rel attribute set.
		//
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

			//	Mainly to prevent href action from firing.
			//
			event.preventDefault();

			//	When we have a new route request with the ! directive (update hash), and the
			//	current hash differs, update the hash.
			//
			if(actionRoute.indexOf("!") === 0 && window.location.hash !== hashedRoute) {
				mies.updateHash(hashedRoute);
			}

			mies.route(route, type, event);
			return this;
		});

		return this;
	},

	unbindUI : function() {
		$(document.body).off(BOUND_UI_EVENTS, ACTION_SELECTION);

		return this;
	}
}).bindUI();


});