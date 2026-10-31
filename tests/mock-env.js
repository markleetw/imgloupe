const fs = require("fs");
const vm = require("vm");
const { webcrypto } = require('node:crypto');
const { createGetMessage } = require('./i18n-mock.cjs');

function createMockEnv(url = "https://docs.google.com/document/d/123/edit") {
  const elements = new Map();
  const listeners = { doc: {}, win: {} };

  class MockElement {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.classList = {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); },
        toggle(c, force) {
          const on = force === undefined ? !this._classes.has(c) : !!force;
          if (on) this._classes.add(c); else this._classes.delete(c);
          return on;
        }
      };
      this.style = {
        _props: {},
        animationName: "initial",
        setProperty(k, v) { this._props[k] = v; },
        getPropertyValue(k) { return this._props[k] || ""; },
        removeProperty(k) { delete this._props[k]; }
      };
      this.attributes = {};
      this._className = "";
      this.parentElement = null;
    }
    set src(val) { this.attributes["src"] = val; this._src = val; }
    get src() { return this.attributes["src"] || this._src || ""; }
    set href(val) { this.attributes["href"] = val; this._href = val; }
    get href() { return this.attributes["href"] || this._href || ""; }
    async decode() { return Promise.resolve(); }
    set className(val) {
      this._className = val || "";
      this._className.split(/\s+/).forEach(c => c && this.classList.add(c));
    }
    get className() {
      return this._className;
    }
    setAttribute(k, v) { this.attributes[k] = v; if (k === "id") this.id = v; }
    getAttribute(k) { return this.attributes[k] || null; }
    appendChild(el) {
      if (el) {
        el.parentElement = this;
        this.children.push(el);
      }
      return el;
    }
    append(...els) {
      for (const el of els) this.appendChild(el);
    }
    remove() {
      this.isConnected = false;
      if (this.parentElement) {
        this.parentElement.children = this.parentElement.children.filter(c => c !== this);
      }
    }
    replaceChildren(...els) {
      this.children = [];
      for (const el of els) this.appendChild(el);
    }
    getBoundingClientRect() { return { left: 10, top: 20, right: 110, bottom: 120, width: 100, height: 100 }; }
    getContext(type) {
      if (this.tagName === "CANVAS") {
        return {
          canvas: this,
          drawImage: () => {},
          getImageData: (x, y, w, h) => ({
            width: w || this.width || 100,
            height: h || this.height || 100,
            data: new Uint8ClampedArray((w || 100) * (h || 100) * 4)
          }),
          createImageData: (w, h) => ({
            width: w,
            height: h,
            data: new Uint8ClampedArray(w * h * 4)
          }),
          putImageData: () => {}
        };
      }
      return null;
    }
    toDataURL() {
      return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    }
    matches(sel) { return matchesSelector(this, sel); }
    closest(sel) {
      let cur = this;
      while (cur) {
        if (matchesSelector(cur, sel)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    querySelector(sel) {
      const search = (node) => {
        for (const child of node.children || []) {
          if (matchesSelector(child, sel)) return child;
          const found = search(child);
          if (found) return found;
        }
        return null;
      };
      return search(this);
    }
    querySelectorAll(sel) {
      const res = [];
      const search = (node) => {
        for (const child of node.children || []) {
          if (matchesSelector(child, sel)) res.push(child);
          search(child);
        }
      };
      search(this);
      return res;
    }
    addEventListener(type, fn) {
      this._listeners = this._listeners || {};
      this._listeners[type] = this._listeners[type] || [];
      this._listeners[type].push(fn);
    }
    removeEventListener(type, fn) {
      if (this._listeners && this._listeners[type]) {
        this._listeners[type] = this._listeners[type].filter(f => f !== fn);
      }
    }
    dispatchEvent(ev) {
      const type = ev.type || ev;
      if (this._listeners && this._listeners[type]) {
        this._listeners[type].forEach(fn => fn(ev));
      }
      return true;
    }
    click() {
      this.clicked = true;
      if (this.onclick) this.onclick({ target: this, type: "click" });
      this.dispatchEvent({ target: this, type: "click" });
    }
  }

  function matchesSelector(el, sel) {
    if (!el || !sel) return false;
    const parts = sel.split(",").map(s => s.trim());
    for (const part of parts) {
      if (part.startsWith(".")) {
        const cls = part.slice(1);
        if (el.classList && el.classList.contains(cls)) return true;
      } else if (part.startsWith("#")) {
        const id = part.slice(1);
        if (el.id === id || el.getAttribute("id") === id) return true;
      } else if (part.startsWith("[") && part.endsWith("]")) {
        const clean = part.slice(1, -1);
        if (clean.includes("*=")) {
          const [attr, rawVal] = clean.split("*=");
          const val = rawVal.replace(/\s+i$/i, "");
          const matchVal = val.replace(/["']/g, "").trim().toLowerCase();
          const attrVal = (el.getAttribute(attr.trim()) || "").toLowerCase();
          if (attrVal.includes(matchVal)) return true;
        } else if (clean.includes("=")) {
          const [attr, rawVal] = clean.split("=");
          const val = rawVal.replace(/\s+i$/i, "");
          const matchVal = val.replace(/["']/g, "").trim();
          if (el.getAttribute(attr.trim()) === matchVal) return true;
        } else {
          if (el.getAttribute(clean) != null) return true;
        }
      } else if (part.includes(" ")) {
        const subParts = part.split(/\s+/).filter(Boolean);
        const last = subParts[subParts.length - 1];
        if (matchesSelector(el, last)) {
          let cur = el.parentElement;
          while (cur) {
            if (matchesSelector(cur, subParts[0])) return true;
            cur = cur.parentElement;
          }
        }
      } else if (el.tagName && el.tagName.toLowerCase() === part.toLowerCase()) {
        return true;
      }
    }
    return false;
  }

  const docBody = new MockElement("body");
  const docHead = new MockElement("head");

  const win = {
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener(type, fn, opts) {
      listeners.win[type] = listeners.win[type] || [];
      listeners.win[type].push(fn);
    },
    removeEventListener(type, fn) {
      if (listeners.win[type]) listeners.win[type] = listeners.win[type].filter(f => f !== fn);
    },
    setTimeout(fn, ms) {
      const t = setTimeout(fn, ms);
      if (t && typeof t.unref === "function") t.unref();
      return t;
    },
    clearTimeout(id) { clearTimeout(id); },
    requestAnimationFrame(cb) {
      const t = setTimeout(cb, 16);
      if (t && typeof t.unref === "function") t.unref();
      return t;
    },
    cancelAnimationFrame(id) { clearTimeout(id); },
    navigator: {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      clipboard: {
        write: async () => {},
        writeText: async () => {}
      }
    }
  };

  const doc = {
    title: "測試文件 - Google 文件",
    location: { href: url },
    head: docHead,
    body: docBody,
    createElement(tag) {
      return new MockElement(tag);
    },
    getElementById(id) {
      const find = (el) => {
        if (el.id === id) return el;
        for (const c of el.children) {
          const res = find(c);
          if (res) return res;
        }
        return null;
      };
      return find(docBody) || find(docHead);
    },
    querySelector(sel) {
      if (matchesSelector(docBody, sel)) return docBody;
      const bFound = docBody.querySelector(sel);
      if (bFound) return bFound;
      if (matchesSelector(docHead, sel)) return docHead;
      return docHead.querySelector(sel);
    },
    getElementsByClassName(cls) { return this.querySelectorAll("." + cls); },
    querySelectorAll(sel) {
      const res = [];
      const search = (node) => {
        if (!node) return;
        for (const child of node.children || []) {
          if (matchesSelector(child, sel)) res.push(child);
          search(child);
        }
      };
      search(docBody);
      search(docHead);
      return res;
    },
    addEventListener(type, fn, opts) {
      listeners.doc[type] = listeners.doc[type] || [];
      listeners.doc[type].push(fn);
    },
    removeEventListener(type, fn) {
      if (listeners.doc[type]) listeners.doc[type] = listeners.doc[type].filter(f => f !== fn);
    }
  };

  const chromeMock = {
    runtime: {
      id: "imgloupe-extension-id",
      sendMessage: (msg, ...args) => {
        const cb = typeof args[args.length - 1] === "function" ? args[args.length - 1] : null;
        const res = null;
        if (cb) cb(res);
        return Promise.resolve(res);
      },
      onMessage: {
        _listeners: [],
        addListener(fn) { this._listeners.push(fn); }
      },
      getURL: (path) => "chrome-extension://dummy-id/" + path
    },
    i18n: { getMessage: createGetMessage("zh_TW"), getUILanguage: () => "zh-TW" },
    offscreen: {
      hasDocument: async () => false,
      createDocument: async () => {},
      closeDocument: async () => {}
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => ({})
      },
      onChanged: {
        _listeners: [],
        addListener(fn) { this._listeners.push(fn); }
      }
    }
  };

  const context = {
    window: win,
    document: doc,
    navigator: win.navigator,
    chrome: chromeMock,
    crypto: webcrypto,
    console: console,
    Date: Date,
    Math: Math,
    Map: Map,
    Set: Set,
    Array: Array,
    Object: Object,
    Promise: Promise,
    String: String,
    Number: Number,
    Boolean: Boolean,
    Error: Error,
    TypeError: TypeError,
    RangeError: RangeError,
    Element: MockElement,
    HTMLElement: MockElement,
    Image: class Image {
      constructor() {
        this.width = 100;
        this.height = 100;
        this.onload = null;
        this.onerror = null;
        this._src = "";
      }
      set src(val) {
        this._src = val;
        if (this.onload) setTimeout(() => this.onload(), 0);
      }
      get src() {
        return this._src;
      }
    },
    Blob: globalThis.Blob,
    URL: class URLMock extends globalThis.URL {
      static createObjectURL(blob) { return "blob:mock-blob-" + Math.random(); }
      static revokeObjectURL(url) {}
    },
    Uint8Array: Uint8Array,
    Uint8ClampedArray: Uint8ClampedArray,
    Uint16Array: Uint16Array,
    Uint32Array: Uint32Array,
    ArrayBuffer: ArrayBuffer,
    fetch: async (url) => ({
      ok: true,
      status: 200,
      blob: async () => new globalThis.Blob(["dummy-image-data"], { type: "image/png" }),
      arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer
    }),
    FileReader: class FileReaderMock {
      readAsArrayBuffer(blob) {
        Promise.resolve(blob.arrayBuffer()).then(buf => {
          this.result = buf;
          this.onload && this.onload({ target: this });
        }).catch(err => {
          this.error = err;
          this.onerror && this.onerror({ target: this });
        });
      }
    },
    performance: { now: () => Date.now(), getEntriesByType: () => [] },
    PerformanceObserver: class PerformanceObserver { observe() {} disconnect() {} },
    MutationObserver: class MutationObserver { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} },
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t && typeof t.unref === "function") t.unref();
      return t;
    },
    clearTimeout: (id) => clearTimeout(id),
    setImmediate: (fn, ...args) => setImmediate(fn, ...args),
    clearImmediate: (id) => clearImmediate(id),
    requestAnimationFrame: (cb) => {
      const t = setTimeout(cb, 16);
      if (t && typeof t.unref === "function") t.unref();
      return t;
    },
    cancelAnimationFrame: (id) => clearTimeout(id)
  };

  class MockClipboardItem {
    constructor(items) {
      this.types = Object.keys(items);
      this._items = items;
    }
    async getType(type) {
      const val = this._items[type];
      return typeof val?.then === "function" ? await val : val;
    }
  }

  const loc = new context.URL(url);
  doc.location = loc;
  win.location = loc;
  context.location = loc;
  win.document = doc;
  win.window = win;
  win.globalThis = win;
  win.chrome = chromeMock;
  win.performance = { now: () => Date.now() };
  const mockCreateImageBitmap = async (src) => ({
    width: 100,
    height: 100,
    close() {}
  });

  win.ClipboardItem = MockClipboardItem;
  context.ClipboardItem = MockClipboardItem;
  win.createImageBitmap = mockCreateImageBitmap;
  context.createImageBitmap = mockCreateImageBitmap;
  context.globalThis = win;

  return { context, listeners, doc, win, chromeMock };
}

module.exports = { createMockEnv };
