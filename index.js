/*
 * ========================================================================
 * WARNING: 本服务运行高度混淆的第三方脚本，存在安全风险。
 * ========================================================================
 * 1. 部署时必须与 CF Worker 后端、B 接口 Flask、数据库运行在完全不同
 *    的用户/容器/虚拟机下。严禁共享网络命名空间、共享文件系统权限。
 * 2. 禁止以 root 用户运行；禁止挂载 /root 或 home 目录；禁止有读取
 *    其他服务数据目录的权限。
 * 3. 建议使用 Docker 或 systemd DynamicUser 进行严格隔离。
 *    推荐使用 seccomp / AppArmor 限制系统调用。
 * 4. 日志默认打印所有 request，严禁在生产环境把 stdout/stderr
 *    写入长期保存的日志文件，避免泄漏敏感 token、Cookie、用户查询。
 * 5. 音源脚本是社区贡献的高度混淆代码，可能包含任意网络请求、
 *    本地文件读取、反沙箱探测等行为。请务必自行审计。
 * 6. 生产部署强烈建议直接使用洛雪官方 any-listen / lx-music-api-server
 *    独立仓库，而非此最小骨架。
 * ========================================================================
 */

const express = require('express');
const path = require('path');

const app = express();
const port = parseInt(process.env.PORT || '7979', 10);
const sourceScriptDir = path.resolve(process.env.SOURCE_SCRIPT_DIR || './sources');

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  console.log(`[REQ] ${req.method} ${req.url}`);
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => {
  res.json({ ok: true, name: '扩展音源代理服务骨架' });
});

app.use('/source-proxy', require('./routes/sourceProxy'));

app.listen(port, () => {
  console.log(`listening on :${port}`);
  console.log(`[INFO] SOURCE_SCRIPT_DIR = ${sourceScriptDir}`);
});

module.exports = app;
