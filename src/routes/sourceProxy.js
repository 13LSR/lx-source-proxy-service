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

  router.get('/api/source/status', (req, res) => {
    const ok = sourceMgr && sourceMgr.isReady();
    const count = sourceMgr ? sourceMgr.size() : 0;
    const ready = ok && count > 0;
    const err = sourceMgr ? sourceMgr.readyError() : '';
    const startedMs = sourceMgr && sourceMgr.manager ? sourceMgr.manager.startedAt : Date.now();
    res.json({
      code: 200,
      data: {
        ready,
        sourceCount: count,
        initializedRuntimes: count,
        uptimeMs: Date.now() - startedMs,
        message: err || (ready ? 'ok' : (sourceMgr ? '音源加载中' : '未启动')),
        ok: ready
      }
    });
  });

  router.get('/api/source/list', ensure, (req, res) => {
    const list = sourceMgr.list();
    res.json({
      code: 200,
      data: {
        list,
        count: list.length
      }
    });
  });

  router.get('/api/source/search', ensure, async (req, res) => {
    try {
      const keyword = String(req.query.keyword || '').trim();
      const source = String(req.query.source || 'all').trim();
      const sourceType = String(req.query.sourceType || req.query.platform || 'all').trim();
      const quality = L.resolveQuality(req.query.quality || '320k');
      const page = Number(req.query.page || 1) || 1;
      const pageSize = Number(req.query.pageSize || 20) || 20;
      if (!keyword) { res.json({ code: 200, data: [] }); return; }

      let list;
      // 如果指定具体 source id，单源；否则并行全部
      if (source && source !== 'all') {
        const rt = sourceMgr.getRuntime(source);
        if (!rt) { res.json({ code: 404, msg: '音源 ' + source + ' 不存在' }); return; }
        try {
          list = await rt.search(keyword, sourceType, quality);
        } catch(e) { list = []; }
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
        cover: req.query.cover || ''
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

  return router;
}

module.exports = buildRouter;
