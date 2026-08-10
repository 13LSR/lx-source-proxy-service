'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const SourceManager = require('./sourceManager.js');
const buildRouter = require('./routes/sourceProxy.js');

function main() {
  // 防止 VM 音源脚本里的异步请求失败（如自更新 API 不可达）炸掉整个进程
  process.on('unhandledRejection', (reason, promise) => {
    console.warn('[全局] 未处理的 Promise rejection（已吞掉）:', reason && reason.message ? reason.message.slice(0, 120) : String(reason).slice(0, 120));
  });

  const PORT = Number(process.env.PORT) || 3000;
  const LX_TOKEN = process.env.LX_TOKEN || '';

  const app = express();
  app.enable('trust proxy');
  app.use(cors({
    origin: true,
    credentials: false,
    maxAge: 86400
  }));
  app.use(express.json({ limit: '512kb' }));
  app.use(express.urlencoded({ extended: false, limit: '128kb' }));

  // 访问控制：若环境变量设置 LX_TOKEN，则必须携带 Authorization: Bearer <token>
  // Worker 端调用时走此机制；同时兼容两种旧写法（X-Source-Proxy-Token / x-lx-token）
  app.use((req, res, next) => {
    if (req.path === '/healthz') return next();
    if (req.path === '/') { res.type('text/plain; charset=utf-8'); res.send('lx-source-proxy-service running\n部署说明请查看项目 README.md\n'); return; }
    if (!LX_TOKEN) return next();
    const auth = req.headers['authorization'] || req.headers['x-lx-token'] || req.headers['x-source-proxy-token'] || '';
    let token = '';
    if (auth && /^Bearer\s+/i.test(String(auth))) token = String(auth).replace(/^Bearer\s+/i, '').trim();
    else token = String(auth || '').trim();
    if (token && token === LX_TOKEN) return next();
    res.status(401).json({ code: 401, msg: 'Unauthorized' });
  });

  const sourceMgr = new SourceManager();
  sourceMgr.start({
    initialLoadTimeout: Number(process.env.LX_INIT_TIMEOUT) || 60000
  });

  const router = buildRouter(sourceMgr);
  app.use(router);

  // 兜底
  app.use((req, res) => {
    res.status(404).json({ code: 404, msg: 'Not Found' });
  });

  app.use((err, req, res, next) => {
    console.error('[ERR]', err && err.message || err);
    res.status(500).json({ code: 500, msg: (err && err.message) || 'Internal Server Error' });
  });

  const server = app.listen(PORT, () => {
    console.log('[lx-proxy] listening on port', PORT, '| token=', LX_TOKEN ? 'SET' : 'OFF', '| sources=', sourceMgr.size());
  });

  // Render 免费版 15 分钟超时后会休眠；这里设置连接保活
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
}

if (require.main === module) {
  main();
}

module.exports = main;
