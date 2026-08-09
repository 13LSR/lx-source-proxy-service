/*
 * ========================================================================
 * WARNING: 本文件仅为骨架示例，把音源脚本运行调用转发给官方运行器。
 * ========================================================================
 * 1. 严禁自行手搓沙箱：不能写 new Function / eval / vm.Script
 *    再加上手搓 EVENT_NAMES 常量、手搓 MD5/AES 工具等——否则必然
 *    字节级不兼容，稳定性极差，踩 lx-music 生态的大坑。
 * 2. 生产部署必须使用官方 any-listen / lx-music-api-server 包
 *    import 进来的 run 函数，直接调用其标准 API。
 * 3. any-listen 是洛雪音乐官方维护的沙箱运行器，封装了 lx 全局对象、
 *    EVENT_NAMES、request/on/send、加解密 utils、版本探测等所有
 *    运行时细节，保证音源脚本在 Node 侧的行为与客户端一致。
 * 4. 如果 npm 上找不到 any-listen，可以把 package.json 中的依赖
 *    换成 "@lx-music/server-source": "latest" 或用户实际用的
 *    any-listen 仓库名（如 git+https://...）。
 * 5. 再次强调：不要手搓！不要手搓！不要手搓！
 *    直接用官方包才是唯一正解。
 * ========================================================================
 */

let anyListen = null;
let loadError = null;

try {
  anyListen = require('any-listen');
} catch (e) {
  loadError = e;
  console.warn('[WARN] any-listen 未安装，请先 npm install any-listen 或替换为官方包名。');
}

const sources = {};

async function run(sourceName) {
  if (!anyListen) return null;
  if (sources[sourceName]) return sources[sourceName];
  const fs = require('fs');
  const path = require('path');
  const sourcesDir = path.resolve(process.env.SOURCE_SCRIPT_DIR || './sources');
  const scriptPath = path.join(sourcesDir, `${sourceName}.js`);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`source script not found: ${sourceName}`);
  }
  const rawScript = fs.readFileSync(scriptPath, 'utf-8');
  if (typeof anyListen.run === 'function') {
    const result = await anyListen.run(sourceName, rawScript);
    sources[sourceName] = result || {};
    return sources[sourceName];
  }
  sources[sourceName] = { name: sourceName };
  return sources[sourceName];
}

async function search(source, keywords, limit) {
  if (!anyListen) return { list: [] };
  await run(source);
  if (typeof anyListen.search === 'function') {
    return anyListen.search(source, keywords, limit);
  }
  return { list: [] };
}

async function getUrl(source, id, quality) {
  if (!anyListen) return { url: '', quality: quality || '', size: 0 };
  await run(source);
  if (typeof anyListen.getUrl === 'function') {
    return anyListen.getUrl(source, id, quality);
  }
  return { url: '', quality: quality || '', size: 0 };
}

async function getLyric(source, id) {
  if (!anyListen) return { lyric: '', tlyric: '' };
  await run(source);
  if (typeof anyListen.getLyric === 'function') {
    return anyListen.getLyric(source, id);
  }
  return { lyric: '', tlyric: '' };
}

async function getPic(source, id) {
  if (!anyListen) return null;
  await run(source);
  if (typeof anyListen.getPic === 'function') {
    return anyListen.getPic(source, id);
  }
  return null;
}

async function getPlaylist(source, id) {
  if (!anyListen) return null;
  await run(source);
  if (typeof anyListen.getPlaylist === 'function') {
    return anyListen.getPlaylist(source, id);
  }
  return null;
}

const lxSandbox = {
  run,
  sources,
  search,
  getUrl,
  getLyric,
  getPic,
  getPlaylist,
};

module.exports = lxSandbox;
