process.env.LX_TOKEN = 'TUY2F1aDY_5SEmmg-ZIavdA3scxSxiqs';
process.on('unhandledRejection', (r) => console.warn('[吞掉]', r && r.message ? r.message.slice(0, 120) : String(r).slice(0, 120)));
process.on('uncaughtException', (e) => console.warn('[吞掉exc]', e.message.slice(0, 120)));
const GLOBAL_TIMEOUT = setTimeout(() => { console.log('[!] 90s 到点，强制输出状态并退出'); process.exit(0); }, 90000);
const SourceManager = require('./src/sourceManager.js');
const mgr = new SourceManager();
(async () => {
  await mgr.start({ initialLoadTimeout: 90000 });
  await new Promise(r => setTimeout(r, 3000));
  await mgr.waitReady(60000);
  console.log('sources count:', mgr.size());
  const list = mgr.list();
  for (const s of list) console.log('  src:', s.id, 'name=', s.name, 'enabled=', s.enabled, 'err=', String(s.error || '').slice(0, 60));
  const searchService = require('./src/searchService.js');
  const items = await searchService.search('all', '告白气球', 1, 5);
  console.log('search fallback items:', items.length);
  if (!items.length) { clearTimeout(GLOBAL_TIMEOUT); process.exit(0); }
  const srcId = (list.find(s => s.enabled) || list[0] || {}).id;
  console.log('using srcId=', srcId);
  for (let i = 0; i < Math.min(3, items.length); i++) {
    const first = items[i];
    const song = {
      name: first.name, singer: first.singer, albumName: first.albumName,
      sourceType: first.sourceType || first.platform,
      platform: first.platform || first.sourceType,
      songmid: first.songmid, id: first.id, hash: first.hash, songId: first.songmid || first.id,
    };
    try {
      const r = await mgr.getSongUrlFallback(srcId, song, '320k', ['320k','flac','128k']);
      console.log('[' + i + '] ' + song.sourceType + ' ' + first.name + ' ' + first.singer + ' ✓ origin=' + r._origin + ' q=' + r.quality + ' url=' + (r.url || '').slice(0, 100));
    } catch (e) {
      console.log('[' + i + '] ' + song.sourceType + ' ' + first.name + ' ' + first.singer + ' ✗ ' + e.message.slice(0, 200));
    }
  }
  clearTimeout(GLOBAL_TIMEOUT);
  console.log('✓ ALL DONE');
  process.exit(0);
})();
