/**
 * Polyfills for maximum browser compatibility
 * This file should be imported at the very top of the app
 */

// Core-js for JavaScript polyfills
import "core-js/stable";

// Polyfill for Promises
import "core-js/stable/promise";

// Polyfill for fetch
import "core-js/stable/fetch";

// Polyfill for URL and URLSearchParams
import "core-js/stable/url";
import "core-js/stable/url-search-params";

// Polyfill for Symbol
import "core-js/stable/symbol";

// Polyfill for Array methods
import "core-js/stable/array";

// Polyfill for Object methods
import "core-js/stable/object";

// Polyfill for String methods
import "core-js/stable/string";

// Polyfill for Number methods
import "core-js/stable/number";

// Polyfill for Date methods
import "core-js/stable/date";

// Polyfill for Map, Set, WeakMap, WeakSet
import "core-js/stable/map";
import "core-js/stable/set";
import "core-js/stable/weak-map";
import "core-js/stable/weak-set";

// Polyfill for Math methods
import "core-js/stable/math";

// Polyfill for Reflect
import "core-js/stable/reflect";

// Polyfill for structuredClone
import "core-js/stable/structured-clone";

// Polyfill for AbortController and AbortSignal
import "core-js/stable/abort-controller";
import "core-js/stable/abort-signal";

// Intl polyfills for internationalization
import "core-js/stable/intl";
import "core-js/stable/intl/list-format";
import "core-js/stable/intl/date-time-format";
import "core-js/stable/intl/number-format";

// Whatwg-fetch for older browsers
import "whatwg-fetch";

// ResizeObserver polyfill
import "resize-observer-polyfill";

// MatchMedia polyfill for older browsers
if (typeof window !== "undefined") {
  if (!window.matchMedia) {
    window.matchMedia = function (query) {
      return {
        matches: false,
        media: query,
        onchange: null,
        addListener: function () {},
        removeListener: function () {},
        addEventListener: function () {},
        removeEventListener: function () {},
        dispatchEvent: function () {
          return false;
        },
      };
    };
  }
}

// CustomEvent polyfill for IE11
if (typeof window !== "undefined" && typeof window.CustomEvent !== "function") {
  window.CustomEvent = function (event, params) {
    params = params || { bubbles: false, cancelable: false, detail: null };
    const evt = document.createEvent("CustomEvent");
    evt.initCustomEvent(
      event,
      params.bubbles,
      params.cancelable,
      params.detail,
    );
    return evt;
  };
}

// Element.prototype.closest polyfill
if (!Element.prototype.closest) {
  Element.prototype.closest = function (s) {
    let el = this;
    do {
      if (el.matches(s)) return el;
      el = el.parentElement || el.parentNode;
    } while (el !== null && el.nodeType === 1);
    return null;
  };
}

// Element.prototype.matches polyfill
if (!Element.prototype.matches) {
  Element.prototype.matches =
    Element.prototype.matchesSelector ||
    Element.prototype.mozMatchesSelector ||
    Element.prototype.msMatchesSelector ||
    Element.prototype.oMatchesSelector ||
    Element.prototype.webkitMatchesSelector ||
    function (s) {
      const matches = (this.document || this.ownerDocument).querySelectorAll(s);
      let i = matches.length;
      while (--i >= 0 && matches.item(i) !== this) {}
      return i > -1;
    };
}

// Object.assign polyfill
if (typeof Object.assign !== "function") {
  Object.assign = function (target) {
    if (target === null || target === undefined) {
      throw new TypeError("Cannot convert undefined or null to object");
    }
    const to = Object(target);
    for (let index = 1; index < arguments.length; index++) {
      const nextSource = arguments[index];
      if (nextSource !== null && nextSource !== undefined) {
        for (const nextKey in nextSource) {
          if (Object.prototype.hasOwnProperty.call(nextSource, nextKey)) {
            to[nextKey] = nextSource[nextKey];
          }
        }
      }
    }
    return to;
  };
}

// Array.prototype.find polyfill
if (!Array.prototype.find) {
  Object.defineProperty(Array.prototype, "find", {
    value: function (predicate) {
      if (this === null || this === undefined) {
        throw TypeError("Array.prototype.find called on null or undefined");
      }
      if (typeof predicate !== "function") {
        throw TypeError("predicate must be a function");
      }
      const list = Object(this);
      const length = list.length >>> 0;
      const thisArg = arguments[1];
      for (let i = 0; i < length; i++) {
        const value = list[i];
        if (predicate.call(thisArg, value, i, list)) {
          return value;
        }
      }
      return undefined;
    },
    configurable: true,
    writable: true,
  });
}

// Array.prototype.findIndex polyfill
if (!Array.prototype.findIndex) {
  Object.defineProperty(Array.prototype, "findIndex", {
    value: function (predicate) {
      if (this === null || this === undefined) {
        throw TypeError(
          "Array.prototype.findIndex called on null or undefined",
        );
      }
      if (typeof predicate !== "function") {
        throw TypeError("predicate must be a function");
      }
      const list = Object(this);
      const length = list.length >>> 0;
      const thisArg = arguments[1];
      for (let i = 0; i < length; i++) {
        if (predicate.call(thisArg, list[i], i, list)) {
          return i;
        }
      }
      return -1;
    },
    configurable: true,
    writable: true,
  });
}

// Array.prototype.includes polyfill
if (!Array.prototype.includes) {
  Object.defineProperty(Array.prototype, "includes", {
    value: function (searchElement, fromIndex) {
      if (this === null || this === undefined) {
        throw TypeError("Array.prototype.includes called on null or undefined");
      }
      const O = Object(this);
      const len = parseInt(O.length) || 0;
      if (len === 0) {
        return false;
      }
      const n = fromIndex | 0;
      let k = Math.max(n >= 0 ? n : len - Math.abs(n), 0);
      while (k < len) {
        if (O[k] === searchElement) {
          return true;
        }
        k++;
      }
      return false;
    },
    configurable: true,
    writable: true,
  });
}

// String.prototype.includes polyfill
if (!String.prototype.includes) {
  String.prototype.includes = function (search, start) {
    if (typeof start !== "number") {
      start = 0;
    }
    if (start + search.length > this.length) {
      return false;
    }
    return this.indexOf(search, start) !== -1;
  };
}

// String.prototype.startsWith polyfill
if (!String.prototype.startsWith) {
  String.prototype.startsWith = function (search, pos) {
    return this.slice(pos || 0, search.length) === search;
  };
}

// String.prototype.endsWith polyfill
if (!String.prototype.endsWith) {
  String.prototype.endsWith = function (search, this_len) {
    if (this_len === undefined || this_len > this.length) {
      this_len = this.length;
    }
    return this.substring(this_len - search.length, this_len) === search;
  };
}

// Object.entries polyfill
if (!Object.entries) {
  Object.entries = function (obj) {
    const ownProps = Object.keys(obj);
    let i = ownProps.length;
    const resArray = new Array(i);
    while (i--) {
      resArray[i] = [ownProps[i], obj[ownProps[i]]];
    }
    return resArray;
  };
}

// Object.values polyfill
if (!Object.values) {
  Object.values = function (obj) {
    const keys = Object.keys(obj);
    let i = keys.length;
    const resArray = new Array(i);
    while (i--) {
      resArray[i] = obj[keys[i]];
    }
    return resArray;
  };
}

// console methods for older browsers
if (typeof console !== "undefined") {
  if (!console.error) {
    console.error = function () {};
  }
  if (!console.warn) {
    console.warn = function () {};
  }
  if (!console.info) {
    console.info = function () {};
  }
  if (!console.debug) {
    console.debug = function () {};
  }
  if (!console.log) {
    console.log = function () {};
  }
}

console.log("[FuelPro] Polyfills loaded for maximum browser compatibility");
