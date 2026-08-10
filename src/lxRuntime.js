'use strict';

/**
 * lxRuntime.js —— 给单个音源脚本建立 vm 沙箱 + 生命周期
 */
const vm = require('vm');
const fetch = require('node-fetch');
const L = require('./lxPrelude.js');

class LxRuntime {
  constructor(opts) {
    opts = opts || {};
    this.scriptUrl = opts.scriptUrl || '';
    this.scriptName = opts.scriptName || 'unknown';
    this.id = opts.id || this.scriptUrl || ('src_' + Math.random().toString(36).slice(2, 10));
    this.enabled = true;
    this.initialized = false;
    this.initError = null;
    this.supportedQualities = ['128k','320k','flac','master'];
    this.supportedPlatforms = ['netease','qq','kugou','kuwo','migu'];
    this.lastUsedAt = 0;
    this._moduleExports = null;
    this._handlers = null;
  }

  async loadFromCode(codeString) {
    try {
      // 捕获脚本加载期间的 unhandledRejection（防止脚本异步请求失败炸掉进程）
      const origUnhandled = process.listeners('unhandledRejection').slice();
      const handler = (reason) => {
        console.warn('[lx] VM 内未处理的 Promise rejection（已吞掉防止炸进程）:', reason && reason.message ? reason.message : String(reason).slice(0, 120));
      };
      process.on('unhandledRejection', handler);
      try {
        this._buildSandbox(codeString);
        this._extractHandlers();
        this.initialized = true;
        this.initError = null;
        return true;
      } finally {
        process.removeListener('unhandledRejection', handler);
      }
    } catch (e) {
      this.initialized = false;
      this.initError = (e && e.stack) ? e.stack : ((e && e.message) || String(e));
      return false;
    }
  }

  _buildSandbox(code) {
    // 构造 globalThis.lx —— 洛雪音源脚本 API（事件驱动模式）
    const self = this;
    const eventHandlers = {}; // eventName -> [handler1, handler2, ...]
    const initedData = { status: false, sources: {}, openDevTools: false };
    let metaFromInited = null;

    const lxApi = {
      EVENT_NAMES: {
        APP_READY: 'appReady',
        APP_CLOSE: 'appClose',
        PLAY_START: 'playStart',
        PLAY_STOP: 'playStop',
        PLAY_NEXT: 'playNext',
        PLAY_PREV: 'playPrev',
        LYRIC_UPDATE: 'lyricUpdate',
        SOURCE_CHANGE: 'sourceChange',
        QUALITY_CHANGE: 'qualityChange',
        SEARCH_RESULT: 'searchResult',
        SONG_DETAIL: 'songDetail',
        SONG_URL: 'songUrl',
        REQUEST: 'request',
        INITED: 'inited',
        UPDATE_ALERT: 'updateAlert',
        MUSIC_URL: 'musicUrl',
        // 小写别名（ikun/flower/sixyin 脚本用小写）
        request: 'request',
        inited: 'inited',
        updateAlert: 'updateAlert',
        musicUrl: 'musicUrl',
        searchResult: 'searchResult',
        songDetail: 'songDetail',
        songUrl: 'songUrl',
        appReady: 'appReady',
        appClose: 'appClose',
        playStart: 'playStart',
        playStop: 'playStop',
        playNext: 'playNext',
        playPrev: 'playPrev',
        lyricUpdate: 'lyricUpdate',
        sourceChange: 'sourceChange',
        qualityChange: 'qualityChange'
      },
      on: function(event, handler) {
        if (!event || typeof handler !== 'function') return;
        if (!eventHandlers[event]) eventHandlers[event] = [];
        eventHandlers[event].push(handler);
      },
      off: function(event, handler) {
        if (!eventHandlers[event]) return;
        eventHandlers[event] = eventHandlers[event].filter(h => h !== handler);
      },
      send: function(event, data) {
        if (event === 'inited' && data) {
          metaFromInited = data;
          if (data.sources && typeof data.sources === 'object') {
            // 脚本自报的源元数据
            for (const [key, val] of Object.entries(data.sources)) {
              if (val && val.name === key) {
                // 记录支持的源
              }
            }
          }
        }
        if (!eventHandlers[event]) return;
        for (const h of eventHandlers[event]) {
          try { h(data); } catch(_) {}
        }
      },
      request: function(url, options, callback) {
        if (typeof options === 'function') { callback = options; options = {}; }
        const opts = options || {};
        const method = (opts.method || 'GET').toUpperCase();
        const headers = Object.assign({
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }, opts.headers || {});
        const timeout = Math.min(Number(opts.timeout) || 30000, 60000);
        let ctl; let tm;
        if (typeof global.AbortController !== 'undefined') {
          ctl = new global.AbortController();
          tm = setTimeout(() => { try { ctl.abort(); } catch(_) {} }, timeout);
        }
        const fetchFn = fetch;
        const body = (method !== 'GET' && method !== 'HEAD') ? opts.body : undefined;
        fetchFn(url, { method, headers, body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined, signal: ctl ? ctl.signal : undefined, redirect: 'follow' })
          .then(async function(resp) {
            const txt = await resp.text();
            const resObj = {
              body: txt,
              status: resp.status,
              statusCode: resp.status,
              ok: resp.ok,
              headers: {},
              contentType: resp.headers ? (resp.headers.get('content-type') || '') : ''
            };
            try {
              if (resp.headers && typeof resp.headers.forEach === 'function') {
                resp.headers.forEach((v, k) => { resObj.headers[k.toLowerCase()] = v; });
              }
              if (resObj.contentType && /json/i.test(resObj.contentType) || /^\s*[\[{]/.test(txt)) {
                try { resObj.data = JSON.parse(txt); } catch(_) {}
              }
            } catch(_) {}
            if (!resp.ok) {
              const err = new Error('HTTP ' + resp.status);
              err.response = resObj;
              if (callback) callback(err, null);
            } else {
              if (callback) callback(null, resObj);
            }
          })
          .catch(function(err) {
            if (callback) callback(err, null);
          })
          .finally(function() { if (tm) clearTimeout(tm); });
      },
      utils: {
        MD5: L.crypto && L.crypto.MD5 ? L.crypto.MD5 : function(s) { return String(s); },
        quality: L.resolveQuality,
        http: L.http,
        fetch: fetch
      },
      env: 'desktop',
      version: '1.0.0',
      currentScriptInfo: {
        version: '1.0.0',
        updateUrl: '',
        checkUpdate: ''
      },
      _eventHandlers: eventHandlers,
      _initedData: initedData,
      _metaFromInited: metaFromInited
    };
    // 保存引用供 _extractHandlers 使用
    self._lxApi = lxApi;

    const sandbox = {
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Date,
      Math,
      JSON,
      Object,
      Array,
      Number,
      String,
      Boolean,
      RegExp,
      Buffer,
      encodeURIComponent,
      decodeURIComponent,
      encodeURI,
      decodeURI,
      escape,
      unescape,
      btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
      atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
      fetch: fetch,
      AbortController: global.AbortController,
      Headers: fetch.Headers,
      // 补全 ES6+ 全局对象（混淆/webpack 脚本依赖）
      Promise: global.Promise,
      Symbol: global.Symbol,
      Map: global.Map,
      Set: global.Set,
      WeakMap: global.WeakMap,
      WeakSet: global.WeakSet,
      Reflect: global.Reflect,
      Proxy: global.Proxy,
      Error: global.Error,
      TypeError: global.TypeError,
      RangeError: global.RangeError,
      SyntaxError: global.SyntaxError,
      ReferenceError: global.ReferenceError,
      ArrayBuffer: global.ArrayBuffer,
      Uint8Array: global.Uint8Array,
      Uint16Array: global.Uint16Array,
      Uint32Array: global.Uint32Array,
      Int8Array: global.Int8Array,
      Int16Array: global.Int16Array,
      Int32Array: global.Int32Array,
      Float32Array: global.Float32Array,
      Float64Array: global.Float64Array,
      DataView: global.DataView,
      Function: global.Function,
      EvalError: global.EvalError,
      TextEncoder: global.TextEncoder || require('util').TextEncoder,
      TextDecoder: global.TextDecoder || require('util').TextDecoder,
      URL: global.URL,
      URLSearchParams: global.URLSearchParams,
      navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) lx-music-desktop/1.0.0' },
      location: { href: 'https://localhost', origin: 'https://localhost' },
      L: L,
      QUALITY: L.QUALITY,
      lx: lxApi,
      require: (name) => {
        const allowed = ['url','querystring','path','crypto','buffer'];
        if (allowed.indexOf(name) !== -1) return require(name);
        throw new Error('禁用 require(' + name + ')');
      },
      module: { exports: {} },
      exports: undefined
    };
    sandbox.globalThis = sandbox;
    sandbox.global = sandbox;
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.__m__ = sandbox.module;
    sandbox.exports = sandbox.module.exports;
    sandbox.module = sandbox.module;
    sandbox.exports = sandbox.module.exports;
    vm.createContext(sandbox, { name: 'lx-' + this.id, codeGeneration: { strings: true, wasm: false } });
    const wrapped = '(function(){ "use strict"; var module = __m__, exports = module.exports; ' + code + '\n; return module.exports; }).call(this);';
    const res = vm.runInContext(wrapped, sandbox, {
      timeout: 15000,
      displayErrors: true,
      filename: this.scriptName + '.vm.js'
    });
    this._moduleExports = res && typeof res === 'object' ? res : sandbox.module.exports;
  }

  _extractHandlers() {
    const exp = this._moduleExports || {};
    let target = null;
    if (typeof exp.default === 'object' && exp.default) target = exp.default;
    else if (typeof exp === 'object') target = exp;
    else if (typeof exp === 'function') target = { init: exp };
    if (!target) target = {};

    // 基础 handlers（直接导出模式）
    this._handlers = Object.assign({
      init: null,
      support: null,
      search: null,
      getSongUrl: null,
      getSongDetail: null,
      getLyric: null,
      getTopLists: null,
      getHotSearch: null,
      getMusicUrl: null
    }, target);

    // 平台名 → LX 音源脚本 source 标识映射
    // 注意：IKun/Flower/全豆要 等现代脚本使用全名（netease/qq/kugou/kuwo/migu），
    //       老脚本可能用两字母缩写（wy/tx/kg/kw/mg），所以 srcCandidates 会同时放两种格式做 fallback
    const platformToLxSource = {
      'qq': 'tx', 'tx': 'tx',
      'kg': 'kg', 'kugou': 'kg',
      'kw': 'kw', 'kuwo': 'kw',
      'wy': 'wy', 'netease': 'wy', '163': 'wy',
      'mg': 'mg', 'migu': 'mg',
      'all': 'all'
    };
    // LX 标准 2 字母 → 社区脚本常用 全名
    const lxSourceToFull = {
      'wy': 'netease', 'tx': 'qq',
      'kg': 'kugou', 'kw': 'kuwo', 'mg': 'migu'
    };
    const fullSourceForms = (s) => {
      // 返回给定 source 的所有可能格式（去重）
      const forms = new Set();
      if (!s) return forms;
      const x = String(s).toLowerCase();
      forms.add(x);
      if (platformToLxSource[x]) forms.add(platformToLxSource[x]);
      if (lxSourceToFull[x]) forms.add(lxSourceToFull[x]);
      // 反向：如果 x 是全名，也加入缩写
      for (const [full, abbr] of Object.entries(lxSourceToFull)) {
        if (x === abbr) forms.add(full);
      }
      return forms;
    };
    const normalizeSource = (s) => {
      const k = String(s || '').trim().toLowerCase();
      return platformToLxSource[k] || k || 'all';
    };

    // 事件驱动模式：脚本通过 lx.on(...) 注册各种事件处理器
    // 支持两种模式：
    //   1) lx.on('request', (ctx) => { if(ctx.action==='search')... })  — 统一入口
    //   2) lx.on('search', handler) / lx.on('musicUrl', handler)      — 分事件注册
    const lxApi = this._lxApi;
    if (lxApi && lxApi._eventHandlers) {
      const eh = lxApi._eventHandlers;
      this._eventHandlers = eh;

      // 收集所有可用 handler（兼容两种注册模式）
      const requestHandlers = eh['request'] || [];          // 统一入口模式
      const directSearchHandlers = eh['search'] || [];     // 直接 search
      const directMusicUrlHandlers = eh['musicUrl'] || eh['songUrl'] || eh['getSongUrl'] || []; // 直接 musicUrl

      console.log(`[lx-init] 事件处理器: request=${requestHandlers.length} search=${directSearchHandlers.length} musicUrl=${directMusicUrlHandlers.length}`);

      const anyHandlers = requestHandlers.length + directSearchHandlers.length + directMusicUrlHandlers.length;
      if (anyHandlers > 0) {
        const self = this;
        const hasValidUrl = (r) => {
          if (!r) return false;
          if (typeof r === 'string') return !!r;
          if (typeof r !== 'object') return false;
          if (r.url && typeof r.url === 'string' && r.url.length > 0) return true;
          if (r.url_redirect && typeof r.url_redirect === 'string' && r.url_redirect.length > 0) return true;
          if (r.fileUrl && typeof r.fileUrl === 'string' && r.fileUrl.length > 0) return true;
          if (r.data && typeof r.data === 'object') {
            if (r.data.url && typeof r.data.url === 'string' && r.data.url.length > 0) return true;
          }
          return false;
        };

        // 包装成 getSongUrl
        if (!this._handlers.getSongUrl) {
          this._handlers.getSongUrl = function(song, quality) {
            return new Promise((resolve, reject) => {
              const songLike = self._songToLx(song);
              const rawSrc = songLike.sourceType || songLike.platform || '';
              const lxSource = normalizeSource(rawSrc);
              // 双格式候选：先全名（IKun/Flower 用 netease/qq 等），再缩写（老脚本 wy/tx 等）
              const formSet = new Set();
              const addForm = (s) => { for (const f of fullSourceForms(s)) formSet.add(f); };
              addForm(lxSource);
              ['qq', 'netease', 'kugou', 'kuwo', 'migu', 'all', 'git'].forEach(addForm);
              const srcCandidates = Array.from(formSet);

              const info = (src) => {
                // info.sourceType 也要放匹配当前 src 的格式（IKun/Flower 常用全名）
                return { musicInfo: songLike, type: quality, sourceType: src };
              };

              // 合并两种 handler：直接 musicUrl handler + request 模式 handler
              const allHandlers = [
                ...directMusicUrlHandlers.map(h => ({ h, mode: 'direct' })),
                ...requestHandlers.map(h => ({ h, mode: 'request' })),
              ];
              let hIdx = 0, sIdx = 0;

              const tryNext = () => {
                if (hIdx >= allHandlers.length) { reject(new Error('无可用 musicUrl handler')); return; }
                if (sIdx >= srcCandidates.length) { hIdx++; sIdx = 0; tryNext(); return; }
                const { h, mode } = allHandlers[hIdx];
                const src = srcCandidates[sIdx++];
                const myInfo = info(src);
                const ctx = mode === 'direct'
                  ? { ...myInfo, source: src }
                  : { action: 'musicUrl', source: src, info: myInfo };
                try {
                  const ret = h(ctx);
                  const finish = (r) => { if (hasValidUrl(r)) resolve(r); else tryNext(); };
                  if (ret && typeof ret.then === 'function') ret.then(finish, () => tryNext());
                  else finish(ret);
                } catch(e) { tryNext(); }
              };
              tryNext();
            });
          };
        }

        // 包装成 search
        if (!this._handlers.search) {
          this._handlers.search = function(keyword, sourceType, quality) {
            return new Promise((resolve, reject) => {
              const lxSource = normalizeSource(sourceType);
              // 双格式候选：先全名（IKun/Flower 用 netease/qq 等），再缩写（老脚本 wy/tx 等）
              const formSet = new Set();
              const addForm = (s) => { for (const f of fullSourceForms(s)) formSet.add(f); };
              addForm(lxSource);
              ['qq', 'netease', 'kugou', 'kuwo', 'migu', 'all'].forEach(addForm);
              const srcCandidates = Array.from(formSet);

              const makeInfo = (src) => {
                // info.sourceType 也用当前候选格式（IKun/Flower 认全名）
                return { keyword, sourceType: src, quality };
              };

              // 合并两种 handler：直接 search handler + request 模式 handler
              const allHandlers = [
                ...directSearchHandlers.map(h => ({ h, mode: 'direct' })),
                ...requestHandlers.map(h => ({ h, mode: 'request' })),
              ];
              console.log(`[lx-search-wrap] keyword="${keyword}" lxSource="${lxSource}" quality="${quality}" totalHandlers=${allHandlers.length} (direct=${directSearchHandlers.length} request=${requestHandlers.length}) srcCandidates=${JSON.stringify(srcCandidates)}`);

              let hIdx = 0, sIdx = 0;
              let totalAttempts = 0;

              const isSearchResult = (r) => {
                if (Array.isArray(r) && r.length > 0) return true;
                if (!r || typeof r !== 'object') return false;
                if (Array.isArray(r.data) && r.data.length > 0) return true;
                if (Array.isArray(r.list) && r.list.length > 0) return true;
                if (r.data && typeof r.data === 'object') {
                  if (Array.isArray(r.data.list) && r.data.list.length > 0) return true;
                  if (Array.isArray(r.data.songs) && r.data.songs.length > 0) return true;
                }
                return false;
              };
              const extractSearchList = (r) => {
                if (Array.isArray(r)) return r;
                if (Array.isArray(r && r.data)) return r.data;
                if (Array.isArray(r && r.list)) return r.list;
                if (r && r.data && Array.isArray(r.data.list)) return r.data.list;
                if (r && r.data && Array.isArray(r.data.songs)) return r.data.songs;
                if (r && Array.isArray(r.result)) return r.result;
                return [];
              };

              const tryNext = () => {
                if (hIdx >= allHandlers.length) {
                  console.log(`[lx-search-wrap] ❌ 所有 ${allHandlers.length} 个 handler 均已尝试（共 ${totalAttempts} 次尝试），返回空`);
                  resolve([]);
                  return;
                }
                if (sIdx >= srcCandidates.length) { hIdx++; sIdx = 0; tryNext(); return; }
                const { h, mode } = allHandlers[hIdx];
                const trySrc = srcCandidates[sIdx++];
                const myInfo = makeInfo(trySrc);
                const ctx = mode === 'direct'
                  ? { ...myInfo, source: trySrc }
                  : { action: 'search', source: trySrc, info: myInfo };
                totalAttempts++;
                console.log(`[lx-search-wrap] → [${mode}] handler#${hIdx} source="${trySrc}" info.sourceType="${myInfo.sourceType}"`);
                try {
                  const ret = h(ctx);
                  const finish = (r) => {
                    const isArr = Array.isArray(r);
                    const isObj = r && typeof r === 'object';
                    const summary = isArr ? `array[${r.length}]` : (isObj ? `obj{${Object.keys(r).join(',')}}` : typeof r);
                    const ok = isSearchResult(r);
                    console.log(`[lx-search-wrap] [${mode}] handler#${hIdx} source="${trySrc}" → ${summary} → ${ok ? '✅命中' : '❌空'}`);
                    if (ok) {
                      const arr = extractSearchList(r);
                      if (arr.length > 0) { console.log(`[lx-search-wrap] 🎯 成功: ${arr.length} 条`); resolve(arr); return; }
                      else tryNext();
                    } else tryNext();
                  };
                  if (ret && typeof ret.then === 'function') {
                    ret.then(finish, () => { console.log(`[lx-search-wrap] [${mode}] handler#${hIdx} source="${trySrc}" 被reject`); tryNext(); });
                  } else finish(ret);
                } catch(e) {
                  console.log(`[lx-search-wrap] [${mode}] handler#${hIdx} source="${trySrc}" 抛异常: ${e && e.message || e}`);
                  tryNext();
                }
              };
              tryNext();
            });
          };
        }
      } else {
        console.log(`[lx-init] ⚠️ 无任何事件处理器！request=${requestHandlers.length} search=${directSearchHandlers.length} musicUrl=${directMusicUrlHandlers.length}。脚本可能不支持事件驱动模式。`);
      }
    }

    // 尝试读取 metadata
    if (Array.isArray(target.supportedQualities) && target.supportedQualities.length) this.supportedQualities = target.supportedQualities.slice();
    if (Array.isArray(target.supportedPlatforms) && target.supportedPlatforms.length) this.supportedPlatforms = target.supportedPlatforms.slice();
    if (typeof target.id === 'string' && target.id) this.id = target.id;
    if (typeof target.name === 'string' && target.name) this.scriptName = target.name;
  }

  async ensureInit() {
    if (this.initialized && this._handlers && typeof this._handlers.init === 'function') {
      try {
        await this._handlers.init({ fetch: fetch });
      } catch(_) { /* 失败不致命 */ }
      // 避免反复 init
      this._handlers.init = null;
    }
    this.lastUsedAt = Date.now();
  }

  async search(keyword, sourceType, quality) {
    await this.ensureInit();
    console.log(`[lx-search-runtime] search() called: keyword="${keyword}" sourceType="${sourceType}" quality="${quality}" id="${this.id}" handlers.search=${typeof (this._handlers && this._handlers.search)} eventHandlers.request=${(this._lxApi && this._lxApi._eventHandlers && this._lxApi._eventHandlers.request && this._lxApi._eventHandlers.request.length) || 0}`);
    if (!this._handlers || typeof this._handlers.search !== 'function') {
      console.log('[lx-search-runtime] ❌ handlers.search 不存在，返回空');
      return [];
    }
    const q = L.resolveQuality(quality);
    const ret = await this._handlers.search(keyword || '', sourceType || 'all', q);
    console.log(`[lx-search-runtime] handlers.search 返回: ${Array.isArray(ret) ? 'array len=' + ret.length : (ret && typeof ret === 'object' ? 'object keys=' + Object.keys(ret).join(',') : typeof ret)}`);
    if (!ret) return [];
    const arr = Array.isArray(ret) ? ret : (Array.isArray(ret.data) ? ret.data : (Array.isArray(ret.list) ? ret.list : []));
    return this._normalizeSearchResult(arr, sourceType || 'all');
  }

  _normalizeSearchResult(arr, sourceType) {
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const x = arr[i] || {};
      out.push({
        id: x.id || x.songId || x.hash || ('s_' + i),
        hash: x.hash || x.id || x.songId || '',
        songId: x.songId || x.id || '',
        name: x.name || x.songName || '',
        singer: x.singer || x.artist || x.artists || x.author || '',
        albumName: x.albumName || x.album || '',
        albumId: x.albumId || '',
        duration: Number(x.duration || x.dt || 0) || 0,
        cover: x.cover || x.img || x.picUrl || x.albumPic || '',
        sourceType: x.sourceType || sourceType,
        qualities: Array.isArray(x.qualities) ? x.qualities : (Array.isArray(x.types) ? x.types : null),
        _raw: x
      });
    }
    return out;
  }

  async getSongUrl(song, quality) {
    await this.ensureInit();
    const q = L.resolveQuality(quality);
    const h = this._handlers;
    const songLike = this._songToLx(song);
    if (h && typeof h.getMusicUrl === 'function') {
      try {
        const r = await h.getMusicUrl(songLike, q);
        if (r) return this._normalizeUrl(r);
      } catch(_) {}
    }
    if (h && typeof h.getSongUrl === 'function') {
      const r = await h.getSongUrl(songLike, q);
      return this._normalizeUrl(r);
    }
    throw new Error('当前音源不支持 getSongUrl');
  }

  async getLyric(song) {
    await this.ensureInit();
    const h = this._handlers;
    const songLike = this._songToLx(song);
    if (h && typeof h.getLyric === 'function') {
      const r = await h.getLyric(songLike);
      return this._normalizeLyric(r);
    }
    return { lrc: '', tlrc: '' };
  }

  async getSongDetail(song) {
    await this.ensureInit();
    const h = this._handlers;
    if (h && typeof h.getSongDetail === 'function') {
      const songLike = this._songToLx(song);
      try {
        const r = await h.getSongDetail(songLike);
        if (r && typeof r === 'object') {
          if (Array.isArray(r)) return r[0] || r;
          if (Array.isArray(r.data)) return r.data[0] || r.data;
          if (r.data && typeof r.data === 'object') return r.data;
          return r;
        }
      } catch(_) {}
    }
    return song;
  }

  _songToLx(song) {
    song = song || {};
    // 把业务端的 songId/name/singer 适配到 LX 脚本需要的字段
    const id = song.id || song.songId || song.hash || '';
    return {
      id: id,
      songmid: id,
      hash: song.hash || song.id || '',
      songId: song.songId || song.id || '',
      name: song.name || song.songName || '',
      singer: song.singer || song.artist || song.ar_name || '',
      artists: song.artists || [],
      albumName: song.albumName || song.album || song.al_name || '',
      albumId: song.albumId || '',
      cover: song.cover || song.picUrl || song.img || '',
      duration: Number(song.duration || song.dt || 0) || 0,
      sourceType: song.sourceType || 'all',
      platform: song.platform || song.sourceType || '',
      quality: song.quality || null,
      interval: song.interval || null,
      _raw: song._raw || song
    };
  }

  _normalizeUrl(r) {
    if (r === null || r === undefined) return null;
    if (typeof r === 'string') return { url: r };
    const out = {};
    // any-listen 兼容：data.url 或 r.url
    let src = r;
    if (r && typeof r === 'object' && r.data) src = r.data;
    if (src && typeof src === 'object') {
      out.url = src.url || src.url_redirect || src.fileUrl || '';
      out.size = Number(src.size || src.sizeBytes || 0) || 0;
      out.br = Number(src.br || src.bitRate || 0) || 0;
      out.headers = src.headers || src.requestHeaders || null;
      out.quality = src.quality || '';
    } else if (typeof src === 'string') {
      out.url = src;
    }
    return out;
  }

  _normalizeLyric(r) {
    if (!r) return { lrc: '', tlrc: '' };
    if (typeof r === 'string') return { lrc: r, tlrc: '' };
    const src = (r && typeof r === 'object' && r.data) ? r.data : r;
    if (typeof src === 'string') return { lrc: src, tlrc: '' };
    return {
      lrc: String(src.lrc || src.lyric || src.nolyric || ''),
      tlrc: String(src.tlyric || src.tlrc || src.translation || '')
    };
  }
}

module.exports = LxRuntime;
