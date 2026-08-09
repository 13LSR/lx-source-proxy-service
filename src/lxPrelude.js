/**
 * lxPrelude.js
 *
 * 给洛雪音源脚本运行时提供全局环境（Node.js shim + any-listen 协议）。
 * 思路来源于 songloft-plugin-lxbridge 的 lx_prelude.ts，但直接用纯 JS 编写，
 * 目标是可在 Node.js 18+ 的 vm 沙箱中执行。
 */
'use strict';

const L = {};

// ---------- 常量 ----------
L.QUALITY = {
  low: '128k',
  standard: '128k',
  high: '320k',
  super: '320k',
  lossless: 'flac',
  flac: 'flac',
  hq: 'flac',
  hi: 'flac',
  hires: 'hires',
  jymaster: 'master',
  master: 'master',
  sky: 'master',
  jyeffect: 'master'
};

// 兼容多种写法的音质映射，统一到洛雪标准 128k / 320k / flac / master
L.resolveQuality = function(q) {
  if (!q) return '320k';
  switch (String(q).toLowerCase()) {
    case 'low': case '128': case '128k': return '128k';
    case 'high': case '320': case '320k': case 'exhigh': case 'standard': case 'super': return '320k';
    case 'flac': case 'lossless': case 'losslessflac': case 'hires': case 'sq': return 'flac';
    case 'jymaster': case 'master': case 'sky': case 'jyeffect': case '24bit': case 'mqs': case 'dsd': case 'atmos': return 'master';
    default:
      if (/^[0-9]+k?$/.test(q)) {
        const n = parseInt(q, 10);
        if (n >= 4000) return 'master';
        if (n >= 700) return 'flac';
        if (n >= 192) return '320k';
        return '128k';
      }
      return '320k';
  }
};

// ---------- 工具函数 ----------
L.crypto = {
  MD5: function(str) {
    // 简单的 md5.js（无依赖，MIT 许可的公共实现片段）
    // 来源：blueimp-md5 简化版（适用于音源脚本做 sign 用）
    function md5cycle(x, k) {
      let a = x[0], b = x[1], c = x[2], d = x[3];
      a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586); c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
      a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426); c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
      a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417); c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
      a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101); c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
      a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632); c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
      a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083); c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
      a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690); c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
      a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784); c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);
      a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463); c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
      a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353); c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
      a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222); c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
      a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835); c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);
      a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415); c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
      a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606); c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
      a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744); c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
      a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379); c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);
      x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
    }
    function cmn(q, a, b, x, s, t) {
      a = add32(add32(a, q), add32(x, t));
      return add32((a << s) | (a >>> (32 - s)), b);
    }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
    function add32(a, b) { return (a + b) & 0xFFFFFFFF; }
    function md51(s) {
      let n = s.length;
      const state = [1732584193, -271733879, -1732584194, 271733878];
      let i;
      for (i = 64; i <= s.length; i += 64) md5cycle(state, md5blk(s.substring(i - 64, i)));
      s = s.substring(i - 64);
      const tail = [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0];
      for (let j = 0; j < s.length; j++) tail[j >> 2] |= s.charCodeAt(j) << ((j % 4) << 3);
      tail[i >> 2] |= 0x80 << ((i % 4) << 3);
      if (i > 55) { md5cycle(state, tail); for (let k = 0; k < 16; k++) tail[k] = 0; }
      tail[14] = i * 8;
      md5cycle(state, tail);
      return state;
    }
    function md5blk(s) {
      const md5blks = [];
      for (let i = 0; i < 64; i += 4) md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
      return md5blks;
    }
    const hexChr = '0123456789abcdef'.split('');
    function rhex(n) {
      let s = '', j = 0;
      for (; j < 4; j++) s += hexChr[(n >> (j * 8 + 4)) & 0x0F] + hexChr[(n >> (j * 8)) & 0x0F];
      return s;
    }
    function hex(x) {
      let res = [];
      for (let i = 0; i < 4; i++) res.push(rhex(x[i]));
      return res.join('');
    }
    function toUtf8(str) {
      try { return unescape(encodeURIComponent(String(str || ''))); }
      catch(_) { return String(str || ''); }
    }
    return hex(md51(toUtf8(str)));
  }
};

// ---------- http 封装 ----------
L.http = function(options, context) {
  return new Promise((resolve, reject) => {
    try {
      const fn = (context && context.fetch) || fetch;
      if (!fn) return reject(new Error('fetch 不可用'));
      const method = (options.method || 'GET').toUpperCase();
      let url = options.url;
      if (!url) return reject(new Error('缺少 url'));
      if (options.params && typeof options.params === 'object') {
        const usp = new URLSearchParams();
        for (const k of Object.keys(options.params)) {
          const v = options.params[k];
          if (v !== undefined && v !== null) usp.append(k, String(v));
        }
        const qs = usp.toString();
        if (qs) url += (url.indexOf('?') >= 0 ? '&' : '?') + qs;
      }
      const headers = Object.assign({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }, options.headers || {});
      const body = options.body;
      let reqBody = undefined;
      if (method !== 'GET' && method !== 'HEAD' && body !== undefined && body !== null) {
        if (typeof body === 'string' || Buffer.isBuffer(body)) reqBody = body;
        else try { reqBody = JSON.stringify(body); if (!headers['Content-Type']) headers['Content-Type'] = 'application/json'; } catch(_) { reqBody = String(body); }
      }
      const timeout = Math.min(Number(options.timeout) || 30000, 60000);
      let ctl;
      let tm;
      if (typeof AbortController !== 'undefined') {
        ctl = new AbortController();
        tm = setTimeout(() => { try { ctl.abort(); } catch(_) {} }, timeout);
      }
      fn(url, { method, headers, body: reqBody, signal: ctl ? ctl.signal : undefined, redirect: 'follow' })
        .then(async function(resp) {
          const txt = await resp.text();
          const resObj = {
            body: txt,
            status: resp.status,
            statusCode: resp.status,
            ok: resp.ok,
            headers: {},
            contentType: resp.headers ? resp.headers.get('content-type') || '' : ''
          };
          try {
            if (resp.headers && typeof resp.headers.forEach === 'function') resp.headers.forEach((v, k) => resObj.headers[k.toLowerCase()] = v);
            else if (resp.headers && resp.headers.entries) for (const [k, v] of resp.headers.entries()) resObj.headers[k.toLowerCase()] = v;
          } catch(_) {}
          // 如果 body 看起来是 JSON，顺带挂 data 属性
          try {
            if (resObj.contentType && /json/i.test(resObj.contentType) || /^\s*[\[{]/.test(txt)) resObj.data = JSON.parse(txt);
          } catch(_) {}
          if (!resp.ok) {
            const err = new Error('HTTP ' + resp.status);
            err.response = resObj;
            reject(err);
          } else resolve(resObj);
        })
        .catch(err => {
          if (err && err.name === 'AbortError') reject(new Error('请求超时 ' + timeout + 'ms'));
          else reject(err);
        })
        .finally(() => { if (tm) clearTimeout(tm); });
    } catch (e) { reject(e); }
  });
};

// ---------- 平台 ----------
L.platforms = ['netease','qq','kugou','kuwo','migu'];

module.exports = L;
