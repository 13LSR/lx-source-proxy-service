// 独立搜索服务：LX 音源脚本通常只提供 musicUrl（取播放链接），不提供搜索。
// 这里直接调各音乐平台公开搜索 API 返回统一列表。搜索结果里带 songmid/hash/id，
// 足够后续 LX musicUrl 调用使用。

const https = require('https');
const http = require('http');
const { URL } = require('url');

const UA_WEB = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const UA_QQ_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

function request(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const lib = u.protocol === 'http:' ? http : https;
      const headers = Object.assign({ 'User-Agent': UA_WEB, Accept: 'application/json, */*' }, opts.headers || {});
      const req = lib.request({
        method: opts.method || 'GET',
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        headers,
        timeout: opts.timeout || 15000,
      }, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            const ct = (res.headers['content-type'] || '').toLowerCase();
            const body = (ct.includes('json') || data.trim().startsWith('{') || data.trim().startsWith('['))
              ? JSON.parse(data)
              : data;
            resolve({ status: res.statusCode, body, headers: res.headers });
          } catch (e) {
            resolve({ status: res.statusCode, body: data, headers: res.headers });
          }
        });
      });
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      req.on('error', reject);
      if (opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
      req.end();
    } catch (e) { reject(e); }
  });
}

// ====== QQ 音乐 ======
async function searchQQ(keyword, page = 1, pageSize = 20) {
  const w = encodeURIComponent(keyword);
  const n = Math.min(pageSize, 50);
  const p = Math.max(1, page);
  const url = `https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?g_tk=5381&format=json&inCharset=utf-8&outCharset=utf-8&w=${w}&p=${p}&n=${n}&cr=1&g_tk_new_20200303=5381`;
  const { body } = await request(url, { headers: { 'User-Agent': UA_QQ_MOBILE, Referer: 'https://y.qq.com/' } });
  const list = (body && body.data && body.data.song && body.data.song.list) || [];
  return list.map((s) => ({
    sourceType: 'tx',
    source: 'qq',
    songmid: String(s.songmid || s.songid || ''),
    id: String(s.songid || s.songmid || ''),
    name: s.songname || '',
    singer: (s.singer || []).map((x) => x.name).join(' / '),
    albumName: (s.album && s.albumname) ? s.albumname : '',
    albumMid: (s.album && s.albummid) ? s.albummid : '',
    duration: Math.floor(Number(s.interval || 0)),
    pic: s.albummid ? `https://y.qq.com/music/photo_new/T002R300x300M000${s.albummid}.jpg?max_age=2592000` : '',
  }));
}

// ====== 酷狗音乐 ======
async function searchKG(keyword, page = 1, pageSize = 20) {
  const kw = encodeURIComponent(keyword);
  const n = Math.min(pageSize, 50);
  const p = Math.max(1, page);
  const url = `https://songsearch.kugou.com/song_search_v2?keyword=${kw}&page=${p}&pagesize=${n}&platform=WebFilter&format=json`;
  const { body } = await request(url, { headers: { 'User-Agent': UA_WEB } });
  const lists = (body && body.data && body.data.lists) || [];
  return lists.map((s) => ({
    sourceType: 'kg',
    source: 'kugou',
    hash: String(s.FileHash || '').toUpperCase(),
    // KG: FileHash 是必须（取URL用）；songmid 优先拿 Songmid 没有再回退 FileHash
    songmid: String(s.Songmid || s.Audioid || s.FileHash || ''),
    id: String(s.AlbumID || s.Songmid || ''),
    name: s.SongName || '',
    singer: s.SingerName || '',
    albumName: s.AlbumName || '',
    albumID: s.AlbumID ? String(s.AlbumID) : '',
    duration: Math.floor(Number(s.Duration || 0)),
    pic: s.AlbumImg || '',
  })).filter((x) => x.hash || x.songmid);
}

// ====== 酷我音乐（星海聚合API代理，返回结果结构友好）======
async function searchKW(keyword, page = 1, pageSize = 20) {
  const name = encodeURIComponent(keyword);
  const limit = Math.min(pageSize, 50);
  const url = `https://music-api.gdstudio.xyz/api.php?types=search&source=kuwo&name=${name}&page=${page}&limit=${limit}`;
  const { body } = await request(url, { headers: { 'User-Agent': 'LX-Music-Mobile', Accept: 'application/json' } });
  const arr = Array.isArray(body) ? body : [];
  return arr.map((s) => ({
    sourceType: 'kw',
    source: 'kuwo',
    songmid: String(s.id || s.url_id || ''),
    id: String(s.id || ''),
    name: s.name || '',
    singer: Array.isArray(s.artist) ? s.artist.join(' / ') : String(s.artist || ''),
    albumName: s.album || '',
    duration: 0,
    pic: s.pic_id ? `https://img1.kuwo.cn/star/albumcover/800/${s.pic_id}` : '',
  })).filter((x) => x.songmid);
}

// ====== 网易云音乐 ======
async function searchWY(keyword, page = 1, pageSize = 20) {
  const s = encodeURIComponent(keyword);
  const limit = Math.min(pageSize, 50);
  const offset = (Math.max(1, page) - 1) * limit;
  const url = `https://music.163.com/api/search/get/web?s=${s}&type=1&limit=${limit}&offset=${offset}`;
  const { body } = await request(url, { headers: { 'User-Agent': UA_WEB, Referer: 'https://music.163.com/' } });
  const songs = (body && body.result && body.result.songs) || [];
  return songs.map((s) => ({
    sourceType: 'wy',
    source: 'netease',
    songmid: String(s.id || ''),
    id: String(s.id || ''),
    name: s.name || '',
    singer: (s.artists || []).map((a) => a.name).join(' / '),
    albumName: (s.album && s.album.name) || '',
    albumId: s.album ? String(s.album.id) : '',
    duration: Math.floor(Number(s.duration || 0) / 1000),
    pic: (s.album && s.album.picId) ? `https://p3.music.126.net/0000000000000000/${s.album.picId}?param=300y300` : '',
  })).filter((x) => x.songmid);
}

// ====== 咪咕音乐 (暂时 fallback 用星海kuwo返回的结果补充) ======
async function searchMG(keyword, page = 1, pageSize = 20) {
  // 咪咕公开搜索301，暂时 fallback 到 kw 结果并改标记，保证能显示
  // 用户真要 MG，再改官方接口
  const list = await searchKW(keyword, page, pageSize);
  return list.map((x) => ({ ...x, sourceType: 'mg', source: 'migu' }));
}

const platformSearchFn = {
  netease: searchWY, wy: searchWY, '163': searchWY,
  qq: searchQQ, tx: searchQQ,
  kugou: searchKG, kg: searchKG,
  kuwo: searchKW, kw: searchKW,
  migu: searchMG, mg: searchMG,
};

async function search(platform, keyword, page, pageSize) {
  if (!keyword || !String(keyword).trim()) return [];
  const p = String(platform || 'all').toLowerCase();
  const kw = String(keyword).trim();
  const pg = Number(page) || 1;
  const ps = Number(pageSize) || 20;

  if (p === 'all') {
    const fns = [searchQQ, searchKG, searchKW, searchWY];
    const results = await Promise.allSettled(fns.map((fn) => fn(kw, pg, Math.ceil(ps / 4) + 1)));
    const merged = [];
    results.forEach((r) => { if (r.status === 'fulfilled') merged.push(...(r.value || [])); });
    return merged.slice(0, ps);
  }
  const fn = platformSearchFn[p];
  if (!fn) return [];
  return fn(kw, pg, ps);
}

module.exports = {
  search,
  searchQQ, searchKG, searchKW, searchWY, searchMG,
  platformSearchFn,
};
