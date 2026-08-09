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
      this._buildSandbox(codeString);
      this._extractHandlers();
      this.initialized = true;
      this.initError = null;
      return true;
    } catch (e) {
      this.initialized = false;
      this.initError = (e && e.message) || String(e);
      return false;
    }
  }

  _buildSandbox(code) {
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
      L: L,
      QUALITY: L.QUALITY,
      require: (name) => {
        // 只允许引入极少用到且安全的 node 模块
        const allowed = ['url','querystring','path','crypto','buffer'];
        if (allowed.indexOf(name) !== -1) return require(name);
        throw new Error('禁用 require(' + name + ')');
      },
      module: { exports: {} },
      exports: undefined
    };
    sandbox.exports = sandbox.module.exports;
    vm.createContext(sandbox, { name: 'lx-' + this.id, codeGeneration: { strings: false, wasm: false } });
    const wrapped = '(function(){ "use strict"; var module = __m__, exports = module.exports; ' + code + '\n; return module.exports; }).call(this);';
    // 使用 runInContext 执行
    const res = vm.runInContext(wrapped, sandbox, {
      timeout: 15000,
      displayErrors: true,
      filename: this.scriptName + '.vm.js'
    });
    // 兼容写法：有些脚本直接 module.exports = {} ，有些返回对象
    this._moduleExports = res && typeof res === 'object' ? res : sandbox.module.exports;
  }

  _extractHandlers() {
    const exp = this._moduleExports || {};
    // any-listen 协议：
    //   init(ctx)
    //   support(url)
    //   search(keyword, sourceType, quality)
    //   getSongDetail(song) / getSongUrl(song, quality)
    //   getLyric(song) / getMusicUrl(...)
    // 同时兼容老版本 script.xxx 和直接 function 导出
    let target = null;
    if (typeof exp.default === 'object' && exp.default) target = exp.default;
    else if (typeof exp === 'object') target = exp;
    else if (typeof exp === 'function') target = { init: exp };
    if (!target) target = {};

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
    if (!this._handlers || typeof this._handlers.search !== 'function') return [];
    const q = L.resolveQuality(quality);
    const ret = await this._handlers.search(keyword || '', sourceType || 'all', q);
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
    return {
      id: song.id || song.songId || song.hash || '',
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
