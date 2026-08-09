'use strict';

/**
 * sourceManager.js —— 负责音源持久化（从 URL 列表 + 环境变量启动）、后台初始化
 */
const RuntimeManager = require('./runtimeManager.js');

function parseSourceList(s) {
  if (!s) return [];
  if (Array.isArray(s)) return s.map(x => String(x || '').trim()).filter(Boolean);
  const str = String(s);
  const parts = str.split(/[,\n]+/).map(x => x.trim()).filter(Boolean);
  return parts;
}

class SourceManager {
  constructor() {
    this.manager = null;
    this.initPromise = null;
    this._builtInSources = [
      // 洛雪音乐社区聚合音源：每个脚本都支持多平台
      // 仓库：https://github.com/pdone/lx-music-source（README 里的公开源）
      'https://cdn.jsdelivr.net/gh/pdone/lx-music-source@main/ikun/latest.js',
      'https://cdn.jsdelivr.net/gh/pdone/lx-music-source@main/sixyin/latest.js',
      'https://cdn.jsdelivr.net/gh/pdone/lx-music-source@main/qdy/latest.js',
      'https://cdn.jsdelivr.net/gh/pdone/lx-music-source@main/flower/latest.js'
    ];
  }

  async start(config) {
    config = config || {};
    const rawSources = (config.sources && config.sources.length) ? config.sources : parseSourceList(process.env.LX_SOURCES || '');
    const sources = rawSources && rawSources.length ? rawSources : this._builtInSources;
    const mgr = new RuntimeManager({
      defaultSources: sources,
      initialLoadTimeout: Number(config.initialLoadTimeout || process.env.LX_INIT_TIMEOUT || 60000) || 60000
    });
    this.manager = mgr;
    this.initPromise = mgr.loadAll(sources);
    // 后台完成即可
    this.initPromise.catch(() => {});
    return true;
  }

  getRuntime(id) { return this.manager ? this.manager.getRuntime(id) : null; }
  list() { return this.manager ? this.manager.listSourceInfo() : []; }
  searchAll(keyword, sourceType, quality, opts) {
    if (!this.manager) return Promise.resolve([]);
    return this.manager.searchAll(keyword, sourceType, quality, opts);
  }
  async getSongUrlFallback(id, song, quality, chain) {
    if (!this.manager) throw new Error('系统未就绪');
    const rt = this.manager.getRuntime(id);
    return this.manager.getSongUrlFallback(rt, song, quality, chain);
  }
  size() { return this.manager ? this.manager.size() : 0; }
  isReady() { return !!(this.manager && this.manager.ready); }
  readyError() { return this.manager ? (this.manager.readyError || '') : '未初始化'; }
  waitReady(timeoutMs) {
    const t = timeoutMs || 5000;
    return Promise.race([
      this.initPromise || Promise.resolve(false),
      new Promise(resolve => setTimeout(() => resolve(false), t))
    ]);
  }
}

module.exports = SourceManager;
