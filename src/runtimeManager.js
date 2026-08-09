'use strict';

/**
 * runtimeManager.js —— 多音源并行执行 + 音质 fallback + 健康管理
 */
const LxRuntime = require('./lxRuntime.js');
const fetch = require('node-fetch');

class RuntimeManager {
  constructor(opts) {
    opts = opts || {};
    this.runtimes = new Map(); // id -> LxRuntime
    this.loadingPromise = null;
    this.startedAt = Date.now();
    this.ready = false;
    this.readyError = null;
    this._defaultSources = Array.isArray(opts.defaultSources) ? opts.defaultSources.filter(Boolean) : [];
    this._initialLoadTimeout = Number(opts.initialLoadTimeout) || 60000;
    this._maxRuntimes = 20;
  }

  // 给定一个音源脚本 URL 列表，初始化全部
  async loadAll(sourceList) {
    const urls = (sourceList && sourceList.length) ? sourceList : (this._defaultSources || []);
    if (this.loadingPromise) return this.loadingPromise;
    this.loadingPromise = (async () => {
      const tasks = urls.map(u => this.addByUrl(String(u)));
      await Promise.allSettled(tasks);
      this.ready = true;
      return true;
    })();
    try {
      await Promise.race([
        this.loadingPromise,
        new Promise((_, r) => setTimeout(() => r(new Error('初次加载超时')), this._initialLoadTimeout))
      ]);
    } catch(e) {
      this.readyError = e && e.message ? e.message : String(e);
    }
    return this.ready;
  }

  // 友好 id：取 URL 文件名去掉扩展名（如 https://x/src/kg.js → "kg"）
  static friendlyIdFromUrl(url) {
    try {
      const raw = String(url || '').split('/').pop().split('?')[0];
      const noExt = raw.replace(/\.(js|ts|mjs|cjs)$/i, '').trim();
      return noExt || ('src_' + Math.random().toString(36).slice(2, 8));
    } catch (_) { return 'src_' + Math.random().toString(36).slice(2, 8); }
  }

  // 友好中文 name：按文件名 id 映射到常见音乐源中文名
  static friendlyNameFromId(id, fallbackName) {
    const i = String(id || '').toLowerCase();
    const MAP = {
      'kg': '酷狗(LX)', 'kugou': '酷狗(LX)',
      'tx': 'QQ(LX)', 'qq': 'QQ(LX)', 'qqmusic': 'QQ(LX)',
      'kw': '酷我(LX)', 'kuwo': '酷我(LX)',
      'mg': '咪咕(LX)', 'migu': '咪咕(LX)',
      'wy': '网易云(LX)', 'netease': '网易云(LX)', 'wangyi': '网易云(LX)', 'cloudmusic': '网易云(LX)',
      'bd': '百度(LX)', 'baidu': '百度(LX)',
      'joox': 'JOOX(LX)',
      'yt': 'YouTube(LX)', 'youtube': 'YouTube(LX)',
      'spotify': 'Spotify(LX)',
      'pync': '南瓜(LX)', 'ng': '南瓜(LX)', 'nangua': '南瓜(LX)',
      'feiyue': '飞跃(LX)', 'fy': '飞跃(LX)',
      'hc': '花城(LX)', 'huacheng': '花城(LX)',
      'ymkg': '秒开酷狗(LX)',
      'ymkw': '秒开酷我(LX)',
      'ymtx': '秒开QQ(LX)',
    };
    if (MAP[i]) return MAP[i];
    if (fallbackName && String(fallbackName).trim()) {
      const fn = String(fallbackName).trim();
      // 如果 fallbackName 是 xx.js 就去掉扩展名再返回
      return fn.replace(/\.(js|ts|mjs|cjs)$/i, '');
    }
    return id || '扩展音源';
  }

  async addByUrl(url) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => { try { controller.abort(); } catch(_) {} }, 15000);
      let code = '';
      try {
        const resp = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        code = await resp.text();
      } finally { clearTimeout(t); }
      if (!code) throw new Error('脚本内容为空');
      const friendlyId = RuntimeManager.friendlyIdFromUrl(url);
      const rawName = url.split('/').pop().split('?')[0] || url;
      const rt = new LxRuntime({ scriptUrl: url, scriptName: RuntimeManager.friendlyNameFromId(friendlyId, rawName), id: friendlyId });
      const ok = await rt.loadFromCode(code);
      if (!ok) return false;
      // 成功加载后，强制显式打开 enabled + initialized（constructor 默认 enabled=true，但这里做二次保险）
      rt.enabled = true;
      rt.initialized = true;
      rt.initError = null;
      // 若脚本里提供了 L.song.meta / L.song.name 等元数据，覆盖默认 name（优先脚本自报名字）
      try {
        const h = rt._handlers || null;
        if (h && h.name && typeof h.name === 'string') rt.scriptName = h.name;
        else if (h && h.meta && typeof h.meta.name === 'string') rt.scriptName = h.meta.name;
        else if (h && typeof h.getQualities === 'function') { /* noop */ }
      } catch(_) {}
      // 友好 name 映射兜底：如果脚本自报名字还是 "kg.js" 这种，换成中文名
      if (rt.scriptName && /\.(js|ts|mjs|cjs)$/i.test(rt.scriptName)) {
        rt.scriptName = RuntimeManager.friendlyNameFromId(rt.id, rt.scriptName);
      }
      // 达到上限时，淘汰最久未用的
      if (this.runtimes.size >= this._maxRuntimes) {
        let oldestKey = null; let oldestTs = Infinity;
        for (const [k, v] of this.runtimes.entries()) { if (v.lastUsedAt < oldestTs) { oldestTs = v.lastUsedAt; oldestKey = k; } }
        if (oldestKey) this.runtimes.delete(oldestKey);
      }
      this.runtimes.set(rt.id, rt);
      return true;
    } catch(e) {
      // 记录失败，写一个占位 runtime，status 会把它当错误显示
      const friendlyId = RuntimeManager.friendlyIdFromUrl(url);
      const rawName = url.split('/').pop().split('?')[0] || url;
      const rt = new LxRuntime({ scriptUrl: url, scriptName: RuntimeManager.friendlyNameFromId(friendlyId, rawName), id: friendlyId });
      rt.initialized = false;
      rt.initError = (e && e.message) || String(e);
      rt.enabled = false;
      this.runtimes.set(rt.id, rt);
      return false;
    }
  }

  getRuntime(id) {
    if (!id) return null;
    // 精确 id 匹配（友好短名）
    const r = this.runtimes.get(id);
    if (r) return r;
    // 兼容旧查找：按完整 URL（scriptUrl）匹配
    const s = String(id);
    for (const v of this.runtimes.values()) {
      if (v.scriptUrl && v.scriptUrl === s) return v;
      // 兼容：传的是 "kg.js" 这种 filename
      const vBasename = (v.scriptUrl || '').split('/').pop().split('?')[0];
      if (vBasename && vBasename === s) return v;
    }
    // 回退到第一个可用
    for (const v of this.runtimes.values()) if (v.initialized && v.enabled) return v;
    return null;
  }

  // 并行搜索所有音源，合并结果（最多 max 条）
  async searchAll(keyword, sourceType, quality, opts) {
    opts = opts || {};
    const max = Number(opts.max) || 30;
    const active = [];
    for (const rt of this.runtimes.values()) {
      if (rt.initialized && rt.enabled && typeof rt._handlers.search === 'function') active.push(rt);
    }
    if (!active.length) return [];
    const tasks = active.map(async (rt) => {
      try {
        const rows = await Promise.race([
          rt.search(keyword, sourceType, quality),
          new Promise((_, r) => setTimeout(() => r(new Error('search timeout')), 12000))
        ]);
        return rows;
      } catch(e) { return []; }
    });
    const allRes = await Promise.all(tasks);
    const merged = [];
    const seen = new Set();
    for (let i = 0; i < allRes.length; i++) {
      const arr = allRes[i] || [];
      for (const item of arr) {
        if (!item || !item.name) continue;
        const key = [item.name || '', item.singer || '', item.albumName || '', item.hash || item.id || ''].join('||');
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
        if (merged.length >= max) return merged;
      }
    }
    return merged;
  }

  async getSongUrlFallback(rt, song, quality, fallbackChain) {
    if (!rt) throw new Error('音源不存在');
    const qu = (fallbackChain && fallbackChain.length) ? fallbackChain : [quality, 'flac', '320k', '128k'];
    let lastErr = null;
    for (const q of qu) {
      try {
        const r = await Promise.race([
          rt.getSongUrl(song, q),
          new Promise((_, r) => setTimeout(() => r(new Error('get url timeout')), 15000))
        ]);
        if (r && r.url) return Object.assign({ quality: q }, r);
      } catch(e) { lastErr = e; }
    }
    throw lastErr || new Error('获取播放链接失败');
  }

  // 列出所有音源（status/list）
  listSourceInfo() {
    const arr = [];
    for (const [id, rt] of this.runtimes.entries()) {
      arr.push({
        id: rt.id,
        name: rt.scriptName || id,
        enabled: !!rt.enabled,
        initialized: !!rt.initialized,
        error: rt.initError || '',
        supportedQualities: rt.supportedQualities,
        supportedPlatforms: rt.supportedPlatforms,
        scriptUrl: rt.scriptUrl || '',
        lastUsedAt: rt.lastUsedAt || 0
      });
    }
    return arr;
  }

  size() { return this.runtimes.size; }
}

module.exports = RuntimeManager;
