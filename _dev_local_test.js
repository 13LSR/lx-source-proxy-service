// 本地 node 端直接测试：sourceMgr.start -> search -> songUrl fallback 全链路
const LX_TOKEN = 'TUY2F1aDY_5SEmmg-ZIavdA3scxSxiqs';
process.env.LX_TOKEN = LX_TOKEN;
process.on('unhandledRejection', (r, p) => {
  console.warn('[全局] unhandledRejection 吞掉:', r && r.message ? r.message.slice(0,150) : String(r).slice(0,150));
});
process.on('uncaughtException', (e) => {
  console.warn('[全局] uncaughtException 吞掉:', e.message.slice(0,150));
});

const SourceManager = require('./src/sourceManager.js');
const mgr = new SourceManager();

(async () => {
  console.log('start...');
  await mgr.start({ initialLoadTimeout: 60000 });
  await new Promise(r => setTimeout(r, 5000));
  await mgr.waitReady(60000);

  console.log('sources:', mgr.list().map(s => ({ id:s.id, name:s.name, enabled:s.enabled, err:String(s.error||'').slice(0,80) })));
  const srcId = (mgr.list()[0] && mgr.list()[0].id) || 'ikun_6';
  console.log('pick srcId=', srcId);

  // 2) 搜索
  const searchData = await mgr.searchAll('告白气球', 'all', '320k');
  console.log('search raw count=', searchData.length);
  // 搜索 fallback：走 searchService（独立搜索 API）
  let items = searchData;
  if (!items || !items.length) {
    const searchService = require('./src/searchService.js');
    items = await searchService.search('all', '告白气球', 1, 10);
    console.log('fallback search items=', items.length);
  }
  if (!items.length) { console.log('没搜到'); process.exit(0); }
  const first = items[0];
  console.log('first song = ', first.name, first.singer, 'st=', first.sourceType || first.platform, 'mid=', first.songmid, 'id=', first.id, 'hash=', first.hash);

  // 3) getSongUrlFallback (LX 不行就 urlService)
  const song = {
    name: first.name,
    singer: first.singer,
    albumName: first.albumName,
    sourceType: first.sourceType || first.platform,
    platform: first.platform || first.sourceType,
    songmid: first.songmid,
    id: first.id,
    hash: first.hash,
    songId: first.songmid || first.id,
  };
  try {
    const r = await mgr.getSongUrlFallback(srcId, song, '320k', ['320k', 'flac', '128k']);
    console.log('✓ got url:', r._origin, r.quality, (r.url||'').slice(0,150));
    if (r._lastLxErr) console.log('  (LX 最终错误):', r._lastLxErr.slice(0, 200));
  } catch (e) {
    console.log('✗ 全部失败:', e.message);
  }
})();
