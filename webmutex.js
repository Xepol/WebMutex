/* Copyright (C) 2020 Clinton R. Johnson
 *
 * Licensed under MPL 2.0, see:
 * http://www.mozilla.org/MPL/2.0/
 *
 * @version 0.9
 * @author xepol
 *
 */

"use strict"

function MutexFactory() {

    const oldestTouch = 2000;
    const intervalAcquire = 1;
    const intervalTouch = 5;

	this.isIE = function () {
		let ua = navigator.userAgent;
		return (ua.indexOf("MSIE ") > -1 || ua.indexOf("Trident/") > -1);
    };

    this.supportsWeblockMutex = function () {
        return (!this.isIE()) && (typeof Promise !== "undefined") && (typeof navigator !== 'undefined') && (typeof LockManager !== 'undefined') && (typeof navigator.locks !== 'undefined');
    };

    this.supportsLocalStorageMutex = function () {
        return (!this.isIE()) && (typeof Promise !== "undefined") && (typeof Storage !== 'undefined') && (window.hasOwnProperty('localStorage'));
    };

    this.supportsCookieStorageMutex = function () {
        return (typeof Promise !== "undefined") && (typeof document.cookie !== 'undefined');
    };

    this.supported = function () {
        return this.supportsLocalStorageMutex() || this.supportsWeblockMutex() || this.supportsCookieStorageMutex();
    };

    this.supportedBy = function () {
        return this.supportsWeblockMutex()
            ? "web locks"
            : this.supportsLocalStorageMutex()
                ? "local storage"
                : this.supportsCookieStorageMutex()
                    ? "cookie storage"
                    : "unsupported";
    };

    function generateUUID() {
        let d = new Date().getTime();

        if (Date.now) {
            d = Date.now(); //high-precision timer
        }

        let uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            let r = (d + Math.random() * 16) % 16 | 0;
            d = Math.floor(d / 16);
            return (c == 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
        return uuid;
    };

    function mutexContext(mutexName, onAcquire, onComplete, onTimeout, timeout) {
        return {
            name: mutexName,
            locked: false,
            mutexId: generateUUID(),
            onAcquire: onAcquire,
            onComplete: onComplete,
            onTimeout: onTimeout,
            timeout: timeout,
            storageDevice: null,
            releaseMutex: function () { console.log("default releaseMutex called") }
        };
    };

    var cookieStorageDevice = function (context) {
        let name = "mutex_" + context.name;
        let id = context.id;
        let value = {};

        this.get = function () {
            let data = decodeURIComponent(
                document.cookie.split(';')
                    .map(function (item) { return item.trim() })
                    .filter(function (item) { return item.indexOf(name + "=") === 0 })
                    .map(function (item) { return item.substring(name.length + 1) })
                    .join("")
                    .trim() || "{}");
            ;
            try {
                data = JSON.parse(data) || {};
            } catch (e) {
                data = {};
            }
            if (typeof data !== "object") data = {};
            if (typeof data.id !== "string") data.id = "";
            if (typeof data.when !== "number") data.when = Date.now() - oldestTouch * 2;

            return data;
        };

        this.set = function (value) {
            let data = name + '=' + encodeURIComponent(JSON.stringify(value)) + '';
            document.cookie = data;
            return true;
        };

        this.touch = function (id) {
            this.set({ id: id, when: Date.now() });
        }

        this.clear = function () {
            document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 UTC';
            return true;
        }
    };

    var localStorageDevice = function (context) {
        let name = "__mutex" + context.name;
        let id = context.mutexId;

        this.get = function () {
            let data = localStorage.getItem(name) || "{}";
            try {
                data = JSON.parse(data) || {};
            } catch (e) {
                data = {};
            }
            if (typeof data !== "object") data = {};
            if (typeof data.id !== "string") data.id = "";
            if (typeof data.when !== "number") data.when = Date.now() - oldestTouch * 2;

            return data;
        };

        this.set = function (value) {
            localStorage.setItem(name, JSON.stringify(value));
            return true;
        };

        this.touch = function (id) {
            this.set({ id: id, when: Date.now() });
        }

        this.clear = function () {
            localStorage.removeItem(name);
            return true;
        };
    };

    function acquireStorageDeviceMutex(context) {

        context.tmrWait = null;
        context.tmrTouch = null;

        context.releaseMutex = function () {
            if (!!context.locked) {
                context.locked = false;

                if (context.tmrWait) {
                    clearInterval(context.tmrWait);
                    context.tmrWait = null;
                }
            }

            if (context.tmrTouch) {
                clearInterval(context.tmrTouch);
                context.tmrTouch = null;
            }

            if (context.hasOwnProperty("tmrExpires")) {
                clearTimeout(tmrExpires);
                delete context.tmrExpires;
            }

            // Release the global storage mutex
            let currentMutex = context.storageDevice.get();
            if (currentMutex.id === context.mutexId) {
                context.storageDevice.clear();
            }

            // make it clear this is done
            if (typeof context.onComplete === 'function') {
                context.onComplete(context);
            }
        };

        context.startAt = Date.now();

        context.tmrWait = setInterval(
            function () {
                let currentMutex = context.storageDevice.get();

                // if the mutex is blank, or
                if (currentMutex.id === context.mutexId) {
                    // Hey, hey, we got control.
                    context.locked = true;
                    if (context.tmrWait) {
                        clearInterval(context.tmrWait);
                        context.tmrWait = null;
                    }

                    context.tmrTouch = setInterval(
                        function () {
                            // update our time stamp and re-assert ownership.
                            context.storageDevice.touch(context.mutexId);
                        },
                        intervalTouch
                    );
                    if (typeof context.onAcquire === 'function') {
                        context.onAcquire(context);
                    }
                } else if ((currentMutex.id === '') || (Date.now() - currentMutex.when) > oldestTouch) {
                    context.storageDevice.touch(context.mutexId);
                } else if ((context.timeout > 0) && (Date.now() - context.startAt > context.timeout)) {
                    if (context.tmrWait) {
                        clearInterval(context.tmrWait);
                        context.tmrWait = null;
                    }
                    if (typeof context.onTimeout === 'function') {
                        context.onTimeout(context);
                    }
                }
            },
            intervalAcquire
        );

        return context;
    };

    function acquireWeblockMutex(context) {

        context.mutexPromiseResolve = null;
        context.mutexPromiseReject = null;
        context.mutexAbortController = new AbortController();

        context.releaseMutex = function () {
            if (!!this.locked) {
                this.locked = false;
                if (this.hasOwnProperty("tmrExpires")) {
                    clearTimeout(this.tmrExpires);
                    delete this.tmrExpires;
                }
                if (typeof context.mutexPromiseResolve === "function") {
                    context.mutexPromiseResolve(context);
                }
            }
        };

        let mutexPromise = new Promise(function (resolve, reject) { context.mutexPromiseResolve = resolve; context.mutexPromiseReject = reject; })
            .then(function () { }, function () { })
            .finally(function () { if (typeof context.onComplete === 'function') context.onComplete(context); })
            .catch(function (e) { })
            ;

        context.startAt = Date.now();

        context.tmrWait = setInterval(function () {
            if (context.locked) {
                if (context.tmrWait) {
                    clearInterval(context.tmrWait);
                    context.tmrWait = null;
                }
                if (typeof context.onAcquire === 'function') {
                    context.onAcquire(context);
                }
            } else if ((context.timeout > 0) && (Date.now() - context.startAt > context.timeout)) {
                if (context.tmrWait) {
                    clearInterval(context.tmrWait);
                    context.tmrWait = null;
                }
                if (context.mutexAbortController) {
                    context.mutexAbortController.abort();
                }
            }
        }, 10);

        navigator.locks.request(context.name, { mode: 'exclusive', signal: context.mutexAbortController.signal },
            function (lock) {
                if (lock) {
                    // lock will be held until promise.resolve() is called.  This is exposed by context.releaseMutex
                    context.locked = true;
                    return mutexPromise;
                }
            })
            .catch(function (ex) { if ((ex.name === 'AbortError') && (typeof context.onTimeout === 'function')) context.onTimeout(context); })
            ;
        return context;
    };


    this.get = function (mutexName, options) {

        options = options || {};
        options.timeout = options.timeout || 0;
        options.expires = options.expires || 0;
        options.onAcquire = options.onAcquire || null;
        options.onComplete = options.onComplete || null;
        options.onTimeout = options.onTimeout || null;
        options.OnExpire = options.onExpire || null;

        let doResolve = function () { };
        let doReject = function () { };

        let context = mutexContext(mutexName,
            function () { console.log("debug onAcquire ", context) },
            function () { console.log("debug onComplete ", context) },
            function () { console.log("debug onTimeout ", context) },
            options.timeout);

        context.onAcquire = function (aContext) {
            if (options.expires !== 0) {
                context.tmrExpires = setTimeout(function () {
                    if (context.locked) {
                        if (typeof context.releaseMutex === 'function') {
                            context.releaseMutex();
                        }
                        if (typeof options.onExpire === 'function') {
                            options.onExpire(context);
                        }
                    }
                },
                    options.expires);
            }
            if (typeof options.onAcquire === 'function') {
                options.onAcquire(context);
            }
            doResolve(context);
        };
        context.onComplete = function (aContext) {
            if (typeof options.onComplete === 'function') {
                options.onComplete(context);
            }
        };
        context.onTimeout = function (aContext) {
            if (typeof options.onTimeout === 'function') {
                options.onTimeout(context);
            }
            doReject({ context: context, message: "timeout" });
        };

        if (this.supportsWeblockMutex()) {
            return new Promise(function (resolve, reject) {
                doResolve = resolve;
                doReject = reject;
                acquireWeblockMutex(context);
            });

        } else if (this.supportsLocalStorageMutex()) {
            return new Promise(function (resolve, reject) {
                doResolve = resolve;
                doReject = reject;
                context.storageDevice = new localStorageDevice(context);
                acquireStorageDeviceMutex(context);
            });
        } else if (this.supportsCookieStorageMutex()) {
            return new Promise(function (resolve, reject) {
                doResolve = resolve;
                doReject = reject;
                context.storageDevice = new cookieStorageDevice(context);
                acquireStorageDeviceMutex(context);
            });
        } else {
            throw "Webmutex found no supportable interfaces";
        }

    };
}

var Mutex = new MutexFactory();