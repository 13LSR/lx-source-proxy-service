// urlService.js —— 独立的「播放链接服务」
// 当 LX 音源脚本（IKun/QDY/Flower/Sixyin）的 API 挂了时，用这些公开 API 兜底。
// 每个平台有多个 fallback 源，按顺序并发+顺序尝试，直到拿到 URL。

const https = require('https');
const http = require('http');
const { URL } = require('url');

const UA_WEB = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function requestJson(method, urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const lib = u.protocol === 'http:' ? http : https;
      const headers = Object.assign({ 'User-Agent': UA_WEB, Accept: 'application/json, */*' }, opts.headers || {});
      const req = lib.request({
        method: method || 'GET',
        hostname: u.hostname, port: u.port,
        path: u.pathname + u.search,
        headers, timeout: opts.timeout || 15000,
      }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            const ct = (res.headers['content-type'] || '').toLowerCase();
            let body;
            const trimmed = data.trim();
            if ((ct.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('['))) {
              try { body = JSON.parse(data); } catch(_) { body = data; }
            } else body = data;
            resolve({ status: res.statusCode, body, headers: res.headers });
          } catch (e) { reject(e); }
        });
      });
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      req.on('error', reject);
      if (opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
      req.end();
    } catch (e) { reject(e); }
  });
}

// ---- 音质映射 ----
// LX quality -> 各种码率等级
const QUALITY_TO_KW_BR = {
  '128k': 2, '192k': 2, 'standard': 2,
  '320k': 5, 'exhigh': 5, 'standardex': 5,
  'flac': 4, 'lossless': 4, 'flac24bit': 4, '24bit': 4,
  'hires': 3, 'atmos': 3, 'master': 1, 'jymaster': 1,
};
function pickKwBr(q) { return QUALITY_TO_KW_BR[String(q||'').toLowerCase()] || 5; }

// 取字符串（用于 message 里 "音乐链接：xxx" 解析）
function extractLinkFromMsg(msg, prefix) {
  if (!msg) return null;
  const pattern = new RegExp((prefix || '音乐链接') + '[：:]\\s*(\\S+)', 'i');
  const m = String(msg).match(pattern);
  return m ? m[1].trim() : null;
}

// ========== 各平台 URL 获取 ==========

/**
 * 溯音酷我：msg=歌名+歌手 n=1 br=5
 * 结果：code=1 -> data.url 或 message 里的 音乐链接：xxx
 */
async function suyinKuwoGetLink(keyword, quality) {
  if (!keyword) return null;
  const br = pickKwBr(quality);
  const qmsg = encodeURIComponent(String(keyword).slice(0, 80));
  const url = `https://oiapi.net/api/Kuwo?msg=${qmsg}&n=1&br=${br}`;
  try {
    const { body } = await requestJson('GET', url);
    if (!body || typeof body !== 'object') return null;
    const directUrl = body.data && body.data.url ? String(body.data.url) : null;
    if (directUrl && /^https?:\/\//i.test(directUrl)) return directUrl;
    const msgLink = extractLinkFromMsg(body.message);
    if (msgLink && /^https?:\/\//i.test(msgLink)) return msgLink;
  } catch(_) {}
  return null;
}

/**
 * 长青/念心 SVIP URL 模板（有些源挂了，但 kw/tx 的长青偶尔会 302 跳转就是可用链接）
 */
async function templateGet(sourceType, songInfo, quality) {
  // 候选模板：长青 TX、长青 KW
  const id = songInfo && (songInfo.songmid || songInfo.hash || songInfo.id || '');
  if (!id) return null;
  const txTemplates = [
    // 长青 TX (ip 有时候不稳定，先放着)
    'http://175.27.166.236/kgqq/qq.php?type=mp3&id={id}&level=5',
  ];
  const kwTemplates = [
    'https://musicapi.haitangw.net/music/kw.php?type=mp3&id={id}&level=5',
    'http://175.27.166.236/wy/wy.php?type=mp3&id={id}&level=5',
  ];
  const templates = sourceType === 'tx' || sourceType === 'qq' ? txTemplates
    : sourceType === 'kw' || sourceType === 'kuwo' ? kwTemplates
    : [];
  // 发 GET，看 status 2xx/3xx 且有 body.url 或有 Location
  for (const t of templates) {
    try {
      const url = t.replace('{id}', encodeURIComponent(String(id)));
      const res = await requestJson('GET', url, { timeout: 8000 });
      const loc = res.headers && res.headers.location ? String(res.headers.location) : '';
      const b = res.body;
      if (typeof b === 'object') {
        if (b.url && /^https?:\/\//i.test(b.url)) return String(b.url);
        if (b.data && b.data.url && /^https?:\/\//i.test(b.data.url)) return String(b.data.url);
      }
      if (loc && /^https?:\/\//i.test(loc) && !loc.includes('redirect=1') && !loc.includes('/&')) {
        // 有效跳转链接（过滤掉明显错误的跳转）
        return loc;
      }
    } catch(_) {}
  }
  return null;
}

// ========== 主入口：按平台尝试多个源 ==========
/**
 * 取播放链接
 * @param {string} sourceType  tx/qq/kg/kugou/kw/kuwo/wy/netease/mg/migu
 * @param {object} songInfo   { name, singer, albumName, songmid, hash, id, sourceType }
 * @param {string} quality    320k/flac/...
 */
async function getMusicUrl(sourceType, songInfo, quality) {
  const st = String(sourceType || '').toLowerCase();
  const name = String((songInfo && songInfo.name) || '').trim();
  const singer = String((songInfo && (songInfo.singer || songInfo.artist)) || '').trim();
  const fuzzyKeyword = [name, singer].filter(Boolean).join(' ').trim() || null;

  // 每个平台的源链：并发前3个，失败后顺序剩余
  const chain = [];
  // KW 搜索（最稳定，任何平台只要关键字对了都能出 URL，最多模糊匹配）
  if (fuzzyKeyword) {
    chain.push({ name: 'suyinKW', fn: () => suyinKuwoGetLink(fuzzyKeyword, quality) });
  }
  // TX/KW 的 SVIP 模板
  if (st === 'tx' || st === 'qq') {
    chain.push({ name: 'tpl-tx', fn: () => templateGet('tx', songInfo, quality) });
  } else if (st === 'kw' || st === 'kuwo') {
    chain.push({ name: 'tpl-kw', fn: () => templateGet('kw', songInfo, quality) });
  }

  const errors = [];
  // 并发前 2 个
  const firstBatch = chain.slice(0, 2);
  if (firstBatch.length) {
    const results = await Promise.allSettled(firstBatch.map(h => h.fn()));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) return String(r.value);
      if (r.status === 'rejected') errors.push(r.reason && r.reason.message || 'rejected');
    }
  }
  // 顺序剩余
  for (const h of chain.slice(2)) {
    try {
      const url = await h.fn();
      if (url) return String(url);
    } catch (e) {
      errors.push(`${h.name}: ${e.message}`);
    }
  }
  throw new Error(errors.length ? `所有URL源失败: ${errors.join('; ')}` : '未找到可用播放链接');
}

module.exports = {
  getMusicUrl,
  suyinKuwoGetLink,
  templateGet,
};
