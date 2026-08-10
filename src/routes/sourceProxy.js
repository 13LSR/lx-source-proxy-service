'use strict';

/**
 * routes/sourceProxy.js —— Express 路由：any-listen 协议的 HTTP 网关
 *   GET  /api/source/status
 *   GET  /api/source/list
 *   GET  /api/source/search
 *   GET  /api/source/song-url
 *   GET  /api/source/lyric
 */
const express = require('express');
const SourceManager = require('../sourceManager.js');

const L = require('../lxPrelude.js');

function buildRouter(sourceMgr) {
  const router = express.Router();

  const ensure = (req, res, next) => {
    if (!sourceMgr || !sourceMgr.manager) {
      res.status(503).json({ code: 503, msg: '音源系统未初始化' });
      return;
    }
    next();
  };

  router.get('/api/source/status', async (req, res) => {
    // 最多等待 12 秒让首次加载结束（冷启动阶段网络慢但会成功）
    const waitMs = Number(req.query.wait) || 12000;
    if (sourceMgr && typeof sourceMgr.waitReady === 'function') {
      try { await sourceMgr.waitReady(waitMs); } catch(_) {}
    }
    const started = sourceMgr && sourceMgr.manager ? (sourceMgr.manager.startedAt || Date.now()) : Date.now();
    const ok = sourceMgr && sourceMgr.isReady();
    const count = sourceMgr ? sourceMgr.size() : 0;
    const listRaw = (sourceMgr && sourceMgr.list) ? sourceMgr.list() : [];
    const validCount = listRaw.filter(x => x && x.enabled && !x.error).length;
    const failedCount = listRaw.filter(x => x && x.error).length;
    const ready = ok && validCount > 0;
    const err = sourceMgr ? sourceMgr.readyError() : '';
    const firstError = listRaw.find(x => x && x.error);
    res.json({
      code: 200,
      data: {
        ready,
        sourceCount: validCount,              // 前端展示"音源数量"：只算成功启用的
        totalRuntimes: count,                 // 实际 runtimes.size（含失败占位）
        failedRuntimes: failedCount,
        initializedRuntimes: validCount,
        uptimeMs: Date.now() - started,
        message: err
          || (ready ? 'ok' : (firstError && firstError.error ? String(firstError.error).slice(0, 120) : (sourceMgr ? '音源加载中或全部加载失败' : '未启动'))),
        errors: listRaw.filter(x => x && x.error).map(x => ({ id: x.id, name: x.name, error: String(x.error || '').slice(0, 200) })),
        ok: ready
      }
    });
  });

  router.get('/api/source/list', ensure, async (req, res) => {
    // 最多等待 3 秒（冷启动时让 runtimes 先写入）
    if (typeof sourceMgr.waitReady === 'function') try { await sourceMgr.waitReady(3000); } catch(_) {}
    const list = sourceMgr.list();
    res.json({
      code: 200,
      data: {
        list,
        count: list.length
      }
    });
  });

  // 重新加载：POST /api/source/reload   body { sources?: string[] }
  // - sources 不传：重新加载默认列表（_builtInSources 或 LX_SOURCES env）
  // - sources 传：覆盖成用户自定义列表（管理后台"预置音源脚本 URL"）
  router.post('/api/source/reload', ensure, express.json({ limit: '64kb' }), async (req, res) => {
    try {
      const body = req.body || {};
      const sourceList = Array.isArray(body.sources) ? body.sources.map(x => String(x || '').trim()).filter(Boolean) : null;
      const ok = await sourceMgr.reload(sourceList || undefined);
      if (typeof sourceMgr.waitReady === 'function') try { await sourceMgr.waitReady(15000); } catch(_) {}
      const list = sourceMgr.list();
      const validCount = list.filter(x => x && x.enabled && !x.error).length;
      const failed = list.filter(x => x && x.error).length;
      res.json({
        code: 200,
        data: {
          ok: !!ok,
          sourceCount: validCount,
          failedCount: failed,
          list,
          message: ok
            ? (validCount > 0 ? `ok · ${validCount} loaded · ${failed} failed` : 'loaded but all sources failed')
            : 'reload rejected'
        }
      });
    } catch (e) {
      res.status(500).json({ code: 500, msg: e && e.message ? e.message : String(e) });
    }
  });

  router.get('/api/source/debug/:id?', ensure, async (req, res) => {
    try {
      const id = req.params.id;
      if (id) {
        const rt = sourceMgr.getRuntime(id);
        if (!rt) { res.json({ code: 404, msg: '音源不存在' }); return; }
        // 确保已初始化
        try { await rt.ensureInit && rt.ensureInit(); } catch(_) {}
        const eh = (rt._lxApi && rt._lxApi._eventHandlers) || {};
        const h = rt._handlers || {};
        res.json({
          code: 200,
          data: {
            id: rt.id,
            scriptName: rt.scriptName,
            initialized: rt.initialized,
            handlers: {
              init: typeof h.init,
              search: typeof h.search,
              getSongUrl: typeof h.getSongUrl,
              getMusicUrl: typeof h.getMusicUrl,
            },
            eventHandlers: Object.keys(eh).map(k => ({
              event: k,
              count: Array.isArray(eh[k]) ? eh[k].length : 0,
              sample: Array.isArray(eh[k]) && eh[k].length > 0 ? (typeof eh[k][0] === 'function' ? eh[k][0].toString().slice(0, 200) : null) : null
            })),
            searchMethodExists: typeof h.search === 'function',
          }
        });
      } else {
        // 列出所有 runtimes 的摘要
        const list = sourceMgr.list();
        const summary = list.map(x => ({
          id: x.id,
          name: x.name,
          enabled: x.enabled,
          error: x.error,
          initialized: x.initialized,
          hasSearch: x._handlers && typeof x._handlers.search === 'function',
          requestHandlers: x._lxApi && x._lxApi._eventHandlers && x._lxApi._eventHandlers.request ? x._lxApi._eventHandlers.request.length : 0,
        }));
        res.json({ code: 200, data: summary });
      }
    } catch(e) {
      res.status(500).json({ code: 500, msg: e.message || String(e) });
    }
  });

  // 调试端点：把 server-side 搜索诊断日志直接塞进响应
  router.get('/api/source/testsearch', ensure, async (req, res) => {
    try {
      const keyword = String(req.query.keyword || '').trim();
      const source = String(req.query.source || 'ikun_latest').trim();
      const quality = String(req.query.quality || '320k').trim();
      if (!keyword) { res.json({ code: 400, msg: '缺 keyword' }); return; }
      const rt = sourceMgr.getRuntime(source);
      if (!rt) { res.json({ code: 404, msg: '音源 ' + source + ' 不存在' }); return; }
      await rt.ensureInit();

      const eh = (rt._lxApi && rt._lxApi._eventHandlers) || {};
      const handlersSummary = {};
      for (const k of Object.keys(eh)) {
        const arr = Array.isArray(eh[k]) ? eh[k] : [];
        handlersSummary[k] = {
          count: arr.length,
          types: arr.map((f,i) => {
            const t = typeof f;
            if (t !== 'function') return t;
            const code = f.toString().slice(0, 180).replace(/\s+/g,' ');
            return { i, mode: code.includes('switch(action)') || code.includes('switch (action)') ? 'switch-action' : (code.includes('ctx.action') ? 'ctx-action' : (code.includes('sourceType') ? 'sourceType' : 'other')) };
          })
        };
      }

      // 直接触发 request 事件（绕过包装器的所有 fallback 逻辑，模拟真实调用）
      const diags = [];
      const candidates = [
        { actionSrc: 'qq', infoSrcType: 'qq', label: 'qq-full' },
        { actionSrc: 'netease', infoSrcType: 'netease', label: 'netease-full' },
        { actionSrc: 'kugou', infoSrcType: 'kugou', label: 'kugou-full' },
        { actionSrc: 'kuwo', infoSrcType: 'kuwo', label: 'kuwo-full' },
        { actionSrc: 'migu', infoSrcType: 'migu', label: 'migu-full' },
        { actionSrc: 'all', infoSrcType: 'all', label: 'all-all' },
        { actionSrc: 'tx', infoSrcType: 'tx', label: 'tx-abbr' },
        { actionSrc: 'wy', infoSrcType: 'wy', label: 'wy-abbr' },
        { actionSrc: 'kg', infoSrcType: 'kg', label: 'kg-abbr' },
        { actionSrc: 'kw', infoSrcType: 'kw', label: 'kw-abbr' },
        { actionSrc: 'mg', infoSrcType: 'mg', label: 'mg-abbr' },
      ];
      const reqHandlers = eh['request'] || [];
      for (let i = 0; i < reqHandlers.length; i++) {
        const h = reqHandlers[i];
        if (typeof h !== 'function') continue;
        for (const c of candidates) {
          const ctx = { action: 'search', source: c.actionSrc, info: { keyword, sourceType: c.infoSrcType, quality } };
          try {
            const t0 = Date.now();
            const ret = h(ctx);
            let val;
            if (ret && typeof ret.then === 'function') {
              try { val = await Promise.race([ret, new Promise((_, rj) => setTimeout(() => rj(new Error('timeout-15s')), 15000))]); }
              catch (e) { val = { __error: String(e && e.message || e) }; }
            } else { val = ret; }
            const ms = Date.now() - t0;
            let summary;
            if (val === null || val === undefined) summary = typeof val;
            else if (typeof val === 'string') summary = 'str len=' + val.length;
            else if (Array.isArray(val)) summary = 'array len=' + val.length + (val.length ? ' sampleKeys=' + (Object.keys(val[0]||{}).slice(0,5).join(',')) : '');
            else if (typeof val === 'object') {
              if (val.__error) { summary = 'ERROR: ' + String(val.__error).slice(0, 500); }
              else {
                const keys = Object.keys(val).slice(0, 10);
                const arrLike = keys.filter(k => Array.isArray(val[k])).map(k => `${k}[${val[k].length}]`).join(' ');
                summary = 'obj{'+keys.join(',')+'}' + (arrLike ? ' arrays:' + arrLike : '') + (val.data ? ' typeof(data)='+typeof val.data : '');
              }
            } else summary = typeof val;
            const hit = Array.isArray(val) && val.length > 0;
            diags.push({ hIdx: i, label: c.label, ms, summary, hit });
            if (hit) break;
          } catch(e) {
            diags.push({ hIdx: i, label: c.label, error: String(e && e.message || e).slice(0, 300) });
          }
        }
      }

      // 走正式包装器也测一下
      let wrapResult = null;
      try {
        const wrapRet = await rt.search(keyword, 'all', quality);
        wrapResult = Array.isArray(wrapRet) ? ('array len=' + wrapRet.length) : (typeof wrapRet);
      } catch(e) {
        wrapResult = 'error: ' + String(e && e.message || e).slice(0, 300);
      }

      res.json({
        code: 200,
        source,
        keyword,
        quality,
        runtime: {
          id: rt.id,
          scriptName: rt.scriptName,
          initialized: rt.initialized,
          handlers: {
            init: typeof (rt._handlers && rt._handlers.init),
            search: typeof (rt._handlers && rt._handlers.search),
            getSongUrl: typeof (rt._handlers && rt._handlers.getSongUrl),
          },
          wrapSearchResult: wrapResult,
        },
        eventHandlersSummary: handlersSummary,
        diags,
        msg: diags.some(d => d.hit) ? '🎉 至少有一个组合命中了！' : '⚠️ 所有组合均空'
      });
    } catch(e) {
      res.status(500).json({ code: 500, msg: e.message || String(e), stack: e && e.stack ? String(e.stack).slice(0, 2000) : undefined });
    }
  });

  router.get('/api/source/search', ensure, async (req, res) => {
    try {
      const keyword = String(req.query.keyword || '').trim();
      const source = String(req.query.source || 'all').trim();
      const sourceType = String(req.query.sourceType || req.query.platform || 'all').trim();
      const quality = L.resolveQuality(req.query.quality || '320k');
      const page = Number(req.query.page || 1) || 1;
      const pageSize = Number(req.query.pageSize || 20) || 20;
      console.log(`[sourceProxy.search] keyword="${keyword}" source="${source}" sourceType="${sourceType}" quality="${quality}" page=${page} pageSize=${pageSize}`);
      if (!keyword) { res.json({ code: 200, data: [] }); return; }

      let list;
      if (source && source !== 'all') {
        const rt = sourceMgr.getRuntime(source);
        if (!rt) { res.json({ code: 404, msg: '音源 ' + source + ' 不存在' }); return; }
        try {
          list = await rt.search(keyword, sourceType, quality);
          console.log(`[sourceProxy.search] rt.search() 返回: ${Array.isArray(list) ? 'array len=' + list.length : typeof list}`);
        } catch(e) {
          console.log(`[sourceProxy.search] rt.search() 抛异常: ${e && e.message || e}`);
          list = [];
        }
      } else {
        list = await sourceMgr.searchAll(keyword, sourceType, quality, { max: Math.min(60, page * pageSize + 20) });
      }
      const start = (page - 1) * pageSize;
      const end = start + pageSize;
      const paged = (list || []).slice(start, end);
      res.json({
        code: 200,
        data: paged,
        meta: {
          total: (list || []).length,
          page,
          pageSize
        }
      });
    } catch(e) {
      res.status(500).json({ code: 500, msg: e.message || String(e) });
    }
  });

  router.get('/api/source/song-url', ensure, async (req, res) => {
    try {
      const source = String(req.query.source || '').trim();
      if (!source) { res.status(400).json({ code: 400, msg: '缺少 source' }); return; }
      const quality = L.resolveQuality(req.query.quality || '320k');
      const song = {
        id: req.query.songId || req.query.hash || req.query.id || '',
        songId: req.query.songId || req.query.id || '',
        hash: req.query.hash || '',
        name: req.query.name || '',
        singer: req.query.singer || req.query.artist || '',
        albumName: req.query.albumName || req.query.album || '',
        albumId: req.query.albumId || '',
        cover: req.query.cover || '',
        sourceType: req.query.sourceType || '',
        platform: req.query.platform || ''
      };
      const chain = [
        quality,
        (quality === 'master' ? 'flac' : (quality === 'flac' ? 'master' : 'flac')),
        '320k',
        '128k'
      ].filter((v, i, a) => a.indexOf(v) === i);
      const r = await sourceMgr.getSongUrlFallback(source, song, quality, chain);
      res.json({ code: 200, data: r });
    } catch(e) {
      res.status(200).json({ code: 500, msg: e.message || String(e), data: null });
    }
  });

  router.get('/api/source/lyric', ensure, async (req, res) => {
    try {
      const source = String(req.query.source || '').trim();
      if (!source) { res.status(400).json({ code: 400, msg: '缺少 source' }); return; }
      const rt = sourceMgr.getRuntime(source);
      if (!rt) { res.status(404).json({ code: 404, msg: '音源不存在' }); return; }
      const song = {
        id: req.query.songId || req.query.hash || req.query.id || '',
        songId: req.query.songId || req.query.id || '',
        hash: req.query.hash || '',
        name: req.query.name || ''
      };
      const lyric = await rt.getLyric(song);
      res.json({ code: 200, data: lyric });
    } catch(e) {
      res.status(200).json({ code: 500, msg: e.message || String(e), data: null });
    }
  });

  // 简化的健康探针（Render 常用）
  router.get('/healthz', (req, res) => {
    const ok = sourceMgr && sourceMgr.manager;
    res.status(ok ? 200 : 503).json({ ok: !!ok, ready: sourceMgr ? sourceMgr.isReady() : false, count: sourceMgr ? sourceMgr.size() : 0 });
  });

  // 调试端点：暴露 RuntimeManager 内部状态（不需要 token，方便排查）
  router.get('/api/source/debug', (req, res) => {
    try {
      const mgr = sourceMgr && sourceMgr.manager;
      if (!mgr) { res.json({ code: 200, data: { error: 'no manager' } }); return; }
      const runtimes = [];
      for (const [id, rt] of mgr.runtimes.entries()) {
        runtimes.push({
          id,
          scriptName: rt.scriptName,
          enabled: rt.enabled,
          initialized: rt.initialized,
          initError: rt.initError ? String(rt.initError).slice(0, 200) : null,
          hasHandlers: !!(rt._handlers && Object.keys(rt._handlers).length),
          scriptUrl: rt.scriptUrl
        });
      }
      res.json({
        code: 200,
        data: {
          ready: mgr.ready,
          readyError: mgr.readyError,
          loadingPromiseResolved: !!(mgr.loadingPromise && mgr.loadingPromise.isFulfilled),
          defaultSources: mgr._defaultSources,
          runtimesSize: mgr.runtimes.size,
          runtimes,
          nodeVersion: process.version,
          fetchAvailable: typeof fetch === 'function',
          startedAt: new Date(mgr.startedAt).toISOString()
        }
      });
    } catch(e) {
      res.status(500).json({ code: 500, msg: e && e.message ? e.message : String(e) });
    }
  });

  return router;
}

module.exports = buildRouter;
