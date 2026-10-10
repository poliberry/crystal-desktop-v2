/**
 * The `crystal` SDK, as the JavaScript that runs inside the sandbox before an
 * extension's own code.
 *
 * It is the extension's only way out. Everything it does is a message to the host,
 * as JSON text, through two functions the host defines: `__send` for things that
 * need no answer and `__call` for things that do. The host checks every one of them
 * against what the person agreed to — this file is a convenience for authors, not a
 * security boundary, and nothing here is trusted by the host.
 *
 * Written without backticks or `${` so it can live in a template string.
 */
export const SDK_PRELUDE = String.raw`
(function () {
  'use strict';
  var g = globalThis;
  var handlers = Object.create(null);
  var pending = new Map();
  var timers = new Map();
  var nextTimer = 1;
  // The two doors to the host, and the manifest, are taken into this closure and then removed
  // from the global scope, so the extension's own code (which runs after this) can't name them.
  // The SDK below is what talks to the host; the host checks everything it is sent regardless.
  var hostSend = g.__send;
  var hostCall = g.__call;
  var manifest = JSON.parse(g.__manifest);
  delete g.__send;
  delete g.__call;
  delete g.__manifest;

  function log(level, args) {
    var parts = [];
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      try { parts.push(typeof a === 'string' ? a : JSON.stringify(a)); } catch (e) { parts.push(String(a)); }
    }
    hostSend('log', JSON.stringify([level, parts.join(' ')]));
  }

  function call(op, args) {
    return new Promise(function (resolve, reject) {
      var id = hostCall(op, JSON.stringify(args === undefined ? null : args));
      pending.set(id, { resolve: resolve, reject: reject });
    });
  }

  g.__resolve = function (id, ok, json) {
    var p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(json === undefined ? undefined : JSON.parse(json));
    else p.reject(new Error(String(json)));
  };

  g.__dispatch = function (name, json) {
    var data = json === undefined ? undefined : JSON.parse(json);
    if (name === 'timer') {
      var t = timers.get(data && data.id);
      if (!t) return;
      if (!t.repeat) timers.delete(data.id);
      try { t.fn(); } catch (e) { log('error', [String((e && e.message) || e)]); }
      return;
    }
    var list = handlers[name];
    if (!list) return;
    var copy = list.slice();
    for (var i = 0; i < copy.length; i++) {
      try {
        var r = copy[i](data);
        if (r && typeof r.then === 'function') r.then(undefined, function (e) { log('error', [String((e && e.message) || e)]); });
      } catch (e) { log('error', [String((e && e.message) || e)]); }
    }
  };

  function setT(fn, ms, repeat) {
    if (typeof fn !== 'function') throw new TypeError('A timer needs a function.');
    var id = nextTimer++;
    timers.set(id, { fn: fn, repeat: repeat });
    call('timer.set', { id: id, ms: Number(ms) || 0, repeat: repeat }).then(undefined, function (e) {
      timers.delete(id);
      log('error', [String((e && e.message) || e)]);
    });
    return id;
  }
  g.setTimeout = function (fn, ms) { return setT(fn, ms, false); };
  g.setInterval = function (fn, ms) { return setT(fn, ms, true); };
  g.clearTimeout = g.clearInterval = function (id) {
    if (timers.delete(id)) call('timer.clear', { id: id }).then(undefined, function () {});
  };

  g.console = {
    log: function () { log('log', arguments); },
    info: function () { log('info', arguments); },
    warn: function () { log('warn', arguments); },
    error: function () { log('error', arguments); }
  };

  function merge(base, extra) {
    var o = {};
    for (var k in base) o[k] = base[k];
    if (extra) for (var j in extra) o[j] = extra[j];
    return o;
  }

  var ui = {
    render: function (tree) { hostSend('ui', JSON.stringify(tree)); },
    stack: function (children, o) { return merge({ type: 'stack', children: children || [] }, o); },
    row: function (children, o) { return merge({ type: 'stack', direction: 'row', children: children || [] }, o); },
    column: function (children, o) { return merge({ type: 'stack', direction: 'column', children: children || [] }, o); },
    card: function (title, children) { return { type: 'card', title: title, children: children || [] }; },
    divider: function () { return { type: 'divider' }; },
    text: function (text, o) { return merge({ type: 'text', text: String(text) }, o); },
    heading: function (text) { return { type: 'text', text: String(text), variant: 'heading' }; },
    title: function (text) { return { type: 'text', text: String(text), variant: 'title' }; },
    muted: function (text) { return { type: 'text', text: String(text), variant: 'muted' }; },
    mono: function (text) { return { type: 'text', text: String(text), variant: 'mono' }; },
    badge: function (text, tone) { return { type: 'badge', text: String(text), tone: tone || 'neutral' }; },
    image: function (src, alt, size) { return { type: 'image', src: src, alt: alt || '', size: size || 'md' }; },
    progress: function (value, label) { return { type: 'progress', value: value, label: label }; },
    list: function (items) { return { type: 'list', items: items || [] }; },
    button: function (label, action, o) { return merge({ type: 'button', label: String(label), action: action }, o); },
    input: function (name, value, o) { return merge({ type: 'input', name: name, value: value == null ? '' : String(value) }, o); },
    toggle: function (name, checked, label, o) { return merge({ type: 'toggle', name: name, checked: !!checked, label: label }, o); },
    select: function (name, value, options, o) { return merge({ type: 'select', name: name, value: value, options: options || [] }, o); }
  };

  var storage = {
    get: function (key) { return call('storage.get', { key: String(key) }).then(function (v) { return v == null ? undefined : JSON.parse(v); }); },
    set: function (key, value) { return call('storage.set', { key: String(key), value: value === undefined ? 'null' : JSON.stringify(value) }); },
    delete: function (key) { return call('storage.delete', { key: String(key) }); },
    list: function () { return call('storage.list', {}); }
  };

  var http = {
    fetch: function (url, opts) {
      opts = opts || {};
      var headers = merge({}, opts.headers);
      var body = opts.body;
      if (body !== undefined && typeof body !== 'string') {
        body = JSON.stringify(body);
        if (!headers['content-type'] && !headers['Content-Type']) headers['content-type'] = 'application/json';
      }
      return call('http.fetch', { url: String(url), method: opts.method, headers: headers, body: body }).then(function (r) {
        return { status: r.status, ok: r.status >= 200 && r.status < 300, contentType: r.contentType, text: r.body, json: function () { return JSON.parse(r.body); } };
      });
    }
  };

  var crystal = {
    manifest: Object.freeze({ name: manifest.name, version: manifest.version, capabilities: Object.freeze(manifest.capabilities.slice()), network: Object.freeze(manifest.network.slice()) }),
    on: function (name, fn) {
      if (typeof fn !== 'function') throw new TypeError('A handler needs to be a function.');
      (handlers[name] = handlers[name] || []).push(fn);
    },
    ui: Object.freeze(ui),
    storage: Object.freeze(storage),
    http: Object.freeze(http),
    notify: function (text) { return call('notify', { text: String(text) }).then(undefined, function (e) { log('error', [String((e && e.message) || e)]); }); }
  };
  Object.defineProperty(g, 'crystal', { value: Object.freeze(crystal), writable: false, configurable: false });
})();
`;
