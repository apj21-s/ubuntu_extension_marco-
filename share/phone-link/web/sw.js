// Phone Link service worker: the app opens instantly (even with the laptop asleep), and
// "Share to Laptop" lands here first so nothing is lost if the laptop is not reachable yet.
const SHELL = 'shell-v22';
const FILES = ['/app', '/app.css', '/app.js', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)));
});

self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== SHELL && k !== 'shared') await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (e.request.method === 'POST' && url.pathname === '/share') return e.respondWith(takeShare(e.request));
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  // network first, so updates arrive at once; the cache covers a sleeping laptop
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && FILES.includes(url.pathname)) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});

// Files shared from other apps: park them in the "shared" cache, then open the app, which uploads them.
async function takeShare(req) {
  const form = await req.formData();
  const cache = await caches.open('shared');
  const stamp = Date.now();
  let n = 0;
  for (const f of form.getAll('files')) {
    if (!(f instanceof File)) continue;
    await cache.put(`/shared/${stamp}-${n++}`, new Response(f, { headers: {
      'content-type': f.type || 'application/octet-stream', 'x-name': encodeURIComponent(f.name || 'file'),
      'x-mtime': String(f.lastModified || 0) } }));
  }
  const text = [form.get('title'), form.get('text'), form.get('url')].filter(Boolean).join('\n').trim();
  if (text) await cache.put(`/shared/${stamp}-text`, new Response(text, { headers: { 'x-text': '1' } }));
  return Response.redirect('/app?shared=' + stamp, 303);
}
