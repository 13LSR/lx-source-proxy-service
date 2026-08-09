const express = require('express');
const fs = require('fs');
const path = require('path');
const lxSandbox = require('../utils/lxSandbox');

const router = express.Router();

const TIMEOUT_MS = 8000;

function withTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)
    ),
  ]);
}

function errorHandler(err, req, res, next) {
  console.error(`[ERR] ${req.method} ${req.url}:`, err?.message || err);
  res.status(502).json({ code: 502, msg: '扩展音源代理服务内部错误' });
}

router.get('/status', async (req, res, next) => {
  try {
    const sourcesDir = path.resolve(process.env.SOURCE_SCRIPT_DIR || './sources');
    const files = fs.existsSync(sourcesDir)
      ? fs.readdirSync(sourcesDir).filter(f => f.endsWith('.js'))
      : [];
    const result = [];
    for (const file of files) {
      const key = file.replace(/\.js$/, '');
      let alive = false;
      let latency = null;
      try {
        await withTimeout(lxSandbox.run(key));
        const src = lxSandbox.sources[key];
        const start = Date.now();
        if (src && typeof src.probe === 'function') {
          await withTimeout(Promise.resolve(src.probe()));
          latency = Date.now() - start;
          alive = true;
        } else if (src) {
          alive = true;
        }
      } catch (_) {
        alive = false;
        latency = null;
      }
      const src = lxSandbox.sources[key];
      result.push({
        key,
        name: src?.name || key,
        alive,
        latency,
      });
    }
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/list', async (req, res, next) => {
  try {
    const list = Object.entries(lxSandbox.sources || {}).map(([key, src]) => ({
      key,
      name: src?.name || key,
      supportedQualities: src?.supportedQualities || [],
      supportedPlatforms: src?.supportedPlatforms || [],
    }));
    res.json(list);
  } catch (err) { next(err); }
});

router.get('/search', async (req, res, next) => {
  try {
    const { source, keywords, limit } = req.query;
    const limitNum = parseInt(limit || '10', 10);
    const data = await withTimeout(lxSandbox.search(source, keywords, limitNum));
    res.json({ list: data?.list || [] });
  } catch (err) { next(err); }
});

router.get('/song-url', async (req, res, next) => {
  try {
    const { source, id, quality } = req.query;
    const data = await withTimeout(lxSandbox.getUrl(source, id, quality));
    res.json({ url: data?.url || '', quality: data?.quality || quality, size: data?.size || 0 });
  } catch (err) { next(err); }
});

router.get('/lyric', async (req, res, next) => {
  try {
    const { source, id } = req.query;
    const data = await withTimeout(lxSandbox.getLyric(source, id));
    res.json({ lyric: data?.lyric || '', tlyric: data?.tlyric || '' });
  } catch (err) { next(err); }
});

router.get('/pic', async (req, res, next) => {
  try {
    const { source, id } = req.query;
    if (typeof lxSandbox.getPic !== 'function') {
      return res.status(501).json({ msg: '该能力暂未开放' });
    }
    const data = await withTimeout(lxSandbox.getPic(source, id));
    if (!data) return res.status(501).json({ msg: '该能力暂未开放' });
    res.json({ url: data?.url || '' });
  } catch (err) { next(err); }
});

router.get('/playlist', async (req, res, next) => {
  try {
    const { source, id } = req.query;
    if (typeof lxSandbox.getPlaylist !== 'function') {
      return res.status(501).json({ msg: '该能力暂未开放' });
    }
    const data = await withTimeout(lxSandbox.getPlaylist(source, id));
    if (!data) return res.status(501).json({ msg: '该能力暂未开放' });
    res.json(data);
  } catch (err) { next(err); }
});

router.use(errorHandler);

module.exports = router;
