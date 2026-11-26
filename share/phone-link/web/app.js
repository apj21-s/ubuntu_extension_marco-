// Dropline (Phone Link service), phone side.
'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const size = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB';
const ext = n => (n.match(/\.([a-z0-9]{1,4})$/i) || [, 'file'])[1];
const IMG = /\.(jpe?g|png|gif|webp|heic|avif|bmp)$/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UP = '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
const DOWN = '<svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6"/></svg>';

let CHUNK = 8 * 1024 * 1024;
if (sessionStorage.getItem('splashed')) $('splash').classList.add('skip');
else { sessionStorage.setItem('splashed', '1'); setTimeout(() => $('splash').remove(), 3000); }
let linked = false;

function toast(t, undo) {
  const e = $('toast'); $('toastText').textContent = t;
  $('undo').hidden = !undo; $('undo').onclick = () => { clearTimeout(e.t); e.classList.remove('on'); undo(); };
  e.classList.add('on'); clearTimeout(e.t); e.t = setTimeout(() => e.classList.remove('on'), undo ? 4000 : 2400);
}
let via = '';
function setLinked(on) {
  linked = on;
  $('status').className = 'status ' + (on ? 'on' : 'off');
  $('state').textContent = on ? (via ? `Connected · ${via}` : 'Connected') : 'Not reachable · sends when back';
  $('hero').classList.toggle('on', on);
}

// ---------- the recent list (both directions, newest first) ----------
const dayOf = t => { const d = new Date(t * 1000), n = new Date(); const y = new Date(n); y.setDate(n.getDate() - 1);
  return d.toDateString() === n.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday'
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
function dayHeader(label, append) {
  const list = $('list');
  const edge = append ? [...list.querySelectorAll('.day')].pop() : list.querySelector('.day');
  if (edge && edge.textContent === label) return;
  const h = document.createElement('li'); h.className = 'day'; h.textContent = label;
  if (append) list.append(h); else list.prepend(h);
}
function row({ dir, name, sub, thumb, append, t }) {
  if (append) dayHeader(dayOf(t || Date.now() / 1000), true);
  const li = document.createElement('li');
  li.className = 'item ' + dir;
  li.innerHTML = `<div class="thumb">${thumb || esc(ext(name))}<span class="dir">${dir === 'up' ? UP : DOWN}</span></div>
    <div class="info"><div class="name">${esc(name)}</div><div class="sub">${esc(sub)}</div><div class="bar2" hidden><i></i></div></div>`;
  if (append) $('list').append(li);
  else {
    const first = $('list').querySelector('.day');
    if (!first || first.textContent !== 'Today') dayHeader('Today', false);
    $('list').querySelector('.day').after(li);
  }
  $('recentH').hidden = false;
  $('empty').hidden = true;
  return {
    li,
    sub: (t, err) => { const s = li.querySelector('.sub'); s.textContent = t; s.classList.toggle('err', !!err); },
    bar: p => { const b = li.querySelector('.bar2'); b.hidden = p === null; if (p !== null) b.firstElementChild.style.width = p + '%'; },
  };
}

// ---------- who am I ----------
async function me() {
  try {
    const r = await fetch('/api/me', { cache: 'no-store' });
    if (r.status === 401) {
      $('unpaired').hidden = false; $('actions').setAttribute('data-off', '');
      $('state').textContent = 'Not paired'; return false;
    }
    const m = await r.json();
    CHUNK = m.chunk || CHUNK;
    $('laptop').textContent = m.laptop;
    document.title = 'Dropline';
    return true;
  } catch (e) { setLinked(false); return null; }
}

// ---------- live link ----------
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('hello', e => {
    const d = JSON.parse(e.data); via = d.via || ''; setLinked(true); $('laptop').textContent = d.laptop;
    history(); inbound(d.out); battery(); shared(); capturePhoneClip();
  });
  es.addEventListener('history', e => historyLive(JSON.parse(e.data)));

  es.addEventListener('out', e => { const items = JSON.parse(e.data); const fresh = items.filter(i => !rowsIn.has(i.id)); inbound(items); notifyIncoming(fresh); });
  es.onerror = () => setLinked(false); // EventSource reconnects by itself
}

// ---------- laptop -> phone ----------
const started = new Set();   // in memory only: after a reload, anything still queued on the laptop is tried again
const rowsIn = new Map();
function inbound(items) {
  const ids = new Set(items.map(i => i.id));
  for (const [id, r] of rowsIn) if (!ids.has(id) && !r.done) { r.done = true; r.bar(null); if (!r.text) r.sub(r.size + (folder && !folderBroken ? ` · Saved to ${folder.name}` : ' · Saved to Downloads')); if (waiting.delete(id)) showSaveBar(); }
  for (const it of items) {
    if (rowsIn.has(it.id)) continue;
    if (it.kind === 'text') {
      const r = row({ dir: 'down', name: 'Text from laptop', sub: '', thumb: 'Text' });
      r.text = true;
      r.li.querySelector('.sub').outerHTML = `<div class="snippet">${esc(it.text)}</div>`;
      const b = document.createElement('button'); b.className = 'text'; b.textContent = 'Copy'; r.li.append(b);
      b.onclick = async () => {
        try { await navigator.clipboard.writeText(it.text); toast('Copied'); b.textContent = 'Copied'; } catch (e) { toast("Couldn't copy"); }
        fetch(`/api/f/${it.id}/done`, { method: 'POST' });
      };
      rowsIn.set(it.id, r);
      continue;
    }
    const r = row({ dir: 'down', name: it.name, sub: size(it.size) + ' · Downloading' });
    r.size = size(it.size);
    rowsIn.set(it.id, r);
    if (!started.has(it.id)) {
      started.add(it.id);
      receive(it, r);
    }
  }
}

// ---------- where laptop files land on the phone: a "Dropline" folder you pick once ----------
// (File System Access; without it, or before a folder is picked, Chrome's Downloads is used)
const canPick = 'showDirectoryPicker' in window;
let folder = null;
const db = () => new Promise((ok, bad) => {
  const q = indexedDB.open('dropline', 1);
  q.onupgradeneeded = () => q.result.createObjectStore('kv');
  q.onsuccess = () => ok(q.result); q.onerror = () => bad(q.error);
});
async function kv(key, value) {
  const d = await db();
  return new Promise((ok, bad) => {
    const t = d.transaction('kv', value === undefined ? 'readonly' : 'readwrite').objectStore('kv');
    const q = value === undefined ? t.get(key) : t.put(value, key);
    q.onsuccess = () => ok(q.result); q.onerror = () => bad(q.error);
  });
}
let folderReady = null;   // queued files wait for this (at most 1.5 s), so a fresh launch doesn't fall back to Downloads by mistake
let folderBroken = false;   // this phone never answers folder permission questions: use Downloads instead
async function loadFolder() {
  if (!canPick) return;
  try { folder = await kv('folder') || null; folderBroken = !!(await kv('folderBroken')); } catch (e) { folder = null; }
  showFolder();
}
function markFolderBroken() {
  if (folderBroken) return;
  folderBroken = true; kv('folderBroken', true).catch(() => {}); showFolder();
  diag('folder-broken');
}
function showFolder() {
  $('folderBanner').hidden = !canPick;
  $('folderText').textContent = folder && !folderBroken ? folder.name
    : folder ? 'Downloads · this phone can\'t give folder access' : 'Downloads · pick a Dropline folder';
  $('folderBtn').textContent = folder ? (folderBroken ? 'Try again' : 'Change') : 'Choose';
}
$('folderBtn').onclick = async () => {
  try {
    const h = await showDirectoryPicker({ id: 'dropline', mode: 'readwrite', startIn: 'downloads' });
    folder = h; folderBroken = false; await kv('folder', h); await kv('folderBroken', false); showFolder();
    toast(`Saving to “${h.name}”`);
    retryWaiting();
  } catch (e) { if (e.name !== 'AbortError') toast("Couldn't use that folder"); }
};
// Android can leave these permission questions unanswered forever, so never wait long for one
const within = (p, ms, fallback) => Promise.race([p, new Promise(r => setTimeout(() => r(fallback), ms))]);
async function permission(ask) {
  if (!folder) return 'none';
  try { return await within(ask ? folder.requestPermission({ mode: 'readwrite' }) : folder.queryPermission({ mode: 'readwrite' }),
    ask ? 4000 : 1200, 'no answer'); }
  catch (e) { return 'error'; }
}
async function writable() { return (await permission(false)) === 'granted'; }
async function freeName(name) {
  const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 0; ; n++) {
    const candidate = n ? `${stem} (${n})${ext}` : name;
    try { await folder.getFileHandle(candidate); } catch (e) { return candidate; }   // NotFound: free
  }
}
const waiting = new Map();   // id -> [item, row] needing a tap (folder permission, or Chrome wants a tap first)
const tapped = () => !navigator.userActivation || navigator.userActivation.hasBeenActive;
function needTap(it, r, why) {
  waiting.set(it.id, [it, r]);
  r.bar(null); r.sub(`${size(it.size)} · ${why}`);
  r.li.onclick = () => retryWaiting();
  showSaveBar();
}
function showSaveBar() {
  const n = waiting.size;
  $('saveAll').hidden = !n;
  if (n) $('saveAllText').textContent = `${n === 1 ? 'A file' : n + ' files'} from ${$('laptop').textContent}`;
}
$('saveAllBtn').onclick = () => retryWaiting();
const APP_VERSION = 'q3';
async function diag(stage, extra) {
  let perm = 'n/a';
  perm = await permission(false);
  fetch('/api/diag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({
    v: APP_VERSION, stage, canPick, folder: folder ? folder.name : null, perm, tapped: tapped(),
    visible: !document.hidden, standalone: matchMedia('(display-mode: standalone)').matches }, extra || {})) }).catch(() => {});
}
async function receive(it, r) {
  if (folderReady) await folderReady;
  if (!r.li.isConnected || r.done) return;
  if (folder && !folderBroken) {
    const p = await permission(false);
    if (p === 'no answer' || p === 'error') markFolderBroken();   // fall through to Downloads
  }
  if (!canPick || !folder || folderBroken) {   // Chrome's download manager takes it (and resumes if cut)
    if (!tapped()) return needTap(it, r, 'Waiting for one tap');   // Chrome ignores downloads before the first tap
    const a = document.createElement('a'); a.href = `/api/f/${it.id}`; a.download = it.name; a.click();
    r.sub(size(it.size) + ' · Saving to Downloads');
    // the laptop drops the item from the queue once the last byte went out; if that never happens,
    // Chrome blocked or lost it: ask for a tap instead of showing "Downloading" forever
    setTimeout(() => { if (!r.done && rowsIn.get(it.id) === r && !waiting.has(it.id)) needTap(it, r, 'Didn\'t save · tap Save all'); }, 20000 + it.size / 2e6 * 1000);
    return;
  }
  if (!(await writable())) {
    waiting.set(it.id, [it, r]);
    r.bar(null); r.sub(size(it.size) + ' · Tap to save');
    r.li.onclick = async () => {
      const a = document.createElement('a'); a.href = `/api/f/${it.id}`; a.download = it.name;   // made now, inside the tap
      const p = await permission(true);
      diag('tap-permission', { file: it.name, answer: p });
      if (p === 'granted') return retryWaiting();
      waiting.delete(it.id); r.li.onclick = null; showSaveBar();
      markFolderBroken();
      a.click();   // folder access isn't available: Chrome's Downloads, so the file still arrives
      r.sub(size(it.size) + ' · Saving to Downloads');
    };
    showSaveBar();
    return;
  }
  try {
    const name = await freeName(it.name);
    const res = await fetch(`/api/f/${it.id}`);
    if (!res.ok) throw new Error(res.status);
    const out = await (await folder.getFileHandle(name, { create: true })).createWritable();
    let got = 0;
    const count = new TransformStream({ transform(chunk, c) { got += chunk.byteLength; r.bar(it.size ? 100 * got / it.size : 100); c.enqueue(chunk); } });
    await res.body.pipeThrough(count).pipeTo(out);
    r.bar(null); r.sub(`${size(it.size)} · Saved to ${folder.name}`); r.done = true;
  } catch (e) {
    diag('folder-save-failed', { file: it.name, err: String(e && (e.name + ': ' + e.message)).slice(0, 160) });
    r.bar(null); r.sub(size(it.size) + ' · Failed, tap to retry', true);
    waiting.set(it.id, [it, r]); r.li.onclick = () => retryWaiting();
  }
}
// coming back to the app (or the first tap anywhere) retries whatever is waiting
document.addEventListener('visibilitychange', () => { if (!document.hidden && waiting.size) retryWaiting(); });
addEventListener('pointerdown', () => { if (waiting.size) setTimeout(retryWaiting, 0); }, { once: true });
function retryWaiting() {
  const items = [...waiting.values()]; waiting.clear(); showSaveBar();
  for (const [it, r] of items) { r.li.onclick = null; receive(it, r); }
}

// ---------- phone -> laptop: resumable 8 MB chunks, three in flight ----------
const jobs = [];
function overall() {
  const live = jobs.filter(j => !j.finished);
  const total = live.reduce((a, j) => a + j.file.size, 0), done = live.reduce((a, j) => a + j.sent, 0);
  $('trail').style.strokeDashoffset = live.length && total ? (100 - 100 * done / total).toFixed(1) : 100;
  $('hero').classList.toggle('busy', live.length > 0);
}
function addJob(file, onDone, scan) {
  const thumb = IMG.test(file.name) || file.type.startsWith('image/') ? `<img src="${URL.createObjectURL(file)}" alt="">` : '';
  const job = { file, scan: !!scan, r: row({ dir: 'up', name: scan ? 'Scan' : file.name, sub: size(file.size) + ' · Waiting', thumb }), sent: 0, parts: {}, finished: false, onDone };
  jobs.push(job);
  run(job);
}
function put(job, idx) {
  return new Promise((ok, bad) => {
    const blob = job.file.slice(idx * CHUNK, Math.min(job.file.size, (idx + 1) * CHUNK));
    const x = new XMLHttpRequest();
    x.open('PUT', `/api/up/${job.id}/${idx}`);
    x.upload.onprogress = e => { job.parts[idx] = e.loaded; show(job); };
    x.onload = () => x.status === 200 ? (job.parts[idx] = blob.size, show(job), ok()) : bad(new Error(x.status));
    x.onerror = () => bad(new Error('net'));
    x.send(blob);
  });
}
function show(job) {
  job.sent = Object.values(job.parts).reduce((a, b) => a + b, 0);
  const p = job.file.size ? 100 * job.sent / job.file.size : 100;
  job.r.bar(p);
  job.r.sub(`${size(job.sent)} of ${size(job.file.size)}`);
  overall();
}
// How many 8 MB pieces are in flight at once. Shared by all transfers and remembered between them:
// it grows while measured speed keeps rising (up to 6) and shrinks when speed falls (down to 2).
const tune = { lanes: +localStorage.getItem('lanes') || 3, rate: 0, bytes: 0, t0: performance.now() };
function measured(n) {
  tune.bytes += n;
  const dt = (performance.now() - tune.t0) / 1000;
  if (tune.bytes < 4 * CHUNK || dt < 1.5) return;
  const rate = tune.bytes / dt;
  if (tune.rate && rate > tune.rate * 1.08 && tune.lanes < 6) tune.lanes++;
  else if (tune.rate && rate < tune.rate * 0.92 && tune.lanes > 2) tune.lanes--;
  tune.rate = rate; tune.bytes = 0; tune.t0 = performance.now();
  localStorage.setItem('lanes', tune.lanes);
}
async function pump(job, todo) {
  let active = 0, failed = null;
  await new Promise(done => {
    const next = () => {
      if (failed) return active || done();
      if (!todo.length && !active) return done();
      while (active < tune.lanes && todo.length) {
        const i = todo.shift();
        active++;
        put(job, i).then(() => measured(Math.min(CHUNK, job.file.size - i * CHUNK)), e => { failed = e; })
          .finally(() => { active--; next(); });
      }
    };
    next();
  });
  if (failed) throw failed;
}
async function run(job) {
  for (let attempt = 0; ; attempt++) {
    try {
      if (!job.id) {
        const r = await fetch('/api/up', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: job.file.name, size: job.file.size, mtime: job.file.lastModified, scan: job.scan }) });
        if (r.status === 507) { job.finished = true; job.r.bar(null); job.r.sub('Laptop storage is full', true); return overall(); }
        if (!r.ok) throw new Error(r.status);
        const j = await r.json(); job.id = j.id; job.total = j.total;
      }
      const have = new Set((await (await fetch(`/api/up/${job.id}`)).json()).have);   // resume: skip what already arrived
      for (const i of have) job.parts[i] = Math.min(CHUNK, job.file.size - i * CHUNK);
      show(job);
      const todo = [...Array(job.total).keys()].filter(i => !have.has(i));
      await pump(job, todo);
      const f = await fetch(`/api/up/${job.id}/finish`, { method: 'POST' });
      if (!f.ok) throw new Error(f.status);
      let info = {};
      try { info = await f.json(); } catch (e) {}
      job.finished = true; job.r.bar(null);
      if (job.scan) { job.r.sub('Adjust the corners…'); review(job, info); }
      else job.r.sub(size(job.file.size) + ' · Sent');
      overall();
      if (job.onDone) job.onDone();
      if (!job.scan && !jobs.some(j => !j.finished)) toast(jobs.length > 1 ? 'All sent' : 'Sent to laptop');
      return;
    } catch (e) {
      job.r.sub('Waiting for laptop…');
      await sleep(Math.min(15000, 1000 * 2 ** Math.min(attempt, 4)));
    }
  }
}
for (const id of ['pickMedia', 'pickFile']) $(id).onchange = e => { [...e.target.files].forEach(f => addJob(f)); e.target.value = ''; };
// Scan: the camera opens straight away; the laptop cleans the page up and opens it on screen
$('pickScan').onchange = e => {
  const f = e.target.files[0]; e.target.value = '';
  if (f) addJob(new File([f], 'Scan.jpg', { type: f.type || 'image/jpeg', lastModified: Date.now() }), null, true);
};

// ---------- clipboard -> laptop ----------
async function sendText(text) {
  const r = await fetch('/api/text', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }).catch(() => null);
  return r && r.ok;
}
$('paste').onclick = openClips;
$('sendclip').onclick = async () => {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch (e) { return toast('Allow clipboard access to send it'); }
  if (!text.trim()) return toast('Phone clipboard is empty');
  if (await sendText(text)) { lastPhoneClip = text; row({ dir: 'up', name: text.split('\n')[0].slice(0, 80), sub: 'Text · On laptop clipboard', thumb: 'Text' }); toast('Copied on laptop'); closeClips(); }
  else toast("Laptop isn't reachable");
};

// ---------- shared from other apps (parked by the service worker) ----------
let sharing = false;
const queued = new Set();
async function shared() {
  if (sharing || !('caches' in window)) return;
  sharing = true;
  const cache = await caches.open('shared');
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    if (res.headers.get('x-text')) {
      const text = await res.text();
      const link = (text.match(/https?:\/\/[^\s]+/) || [])[0];
      if (link && text.replace(link, '').trim().length < 200) {   // a shared page: title + URL
        const r = await fetch('/api/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: link }) }).catch(() => null);
        if (r && r.ok) { await cache.delete(req); row({ dir: 'up', name: link.replace(/^https?:\/\//, ''), sub: 'Link · Opened on laptop', thumb: 'Link' }); toast('Opened on laptop'); }
        continue;
      }
      if (await sendText(text)) { await cache.delete(req); row({ dir: 'up', name: text.split('\n')[0].slice(0, 80), sub: 'Text · On laptop clipboard', thumb: 'Text' }); }
      continue;
    }
    const blob = await res.blob();
    const file = new File([blob], decodeURIComponent(res.headers.get('x-name') || 'file'),
      { type: blob.type, lastModified: +res.headers.get('x-mtime') || Date.now() });
    if (queued.has(req.url)) continue;
    queued.add(req.url);
    addJob(file, () => cache.delete(req));   // stays parked until the laptop has every byte
  }
  if (location.search) history.replaceState(null, '', '/app');
  sharing = false;
}

// ---------- history (kept on the laptop, so it survives refresh and reinstall) ----------
const ago = t => {
  const m = Math.round((Date.now() / 1000 - t) / 60);
  if (new Date(t * 1000).toDateString() !== new Date().toDateString())   // the day header already says which day
    return new Date(t * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago';
};
let historyShown = false;
async function history() {
  if (historyShown) return;
  let list;
  try { list = await (await fetch('/api/history', { cache: 'no-store' })).json(); } catch (e) { return; }
  historyShown = true;
  for (const h of list.slice().reverse()) histRow(h, true);
}
function histRow(h, append) {
  const text = h.kind === 'text', link = h.kind === 'link', scanned = h.kind === 'scan';
  const verb = scanned ? 'Scan · Opened on laptop' : link ? 'Link · Opened on laptop' : h.dir === 'up' ? (text ? 'Copied on laptop' : 'Sent') : (text ? 'From laptop' : 'Saved to Downloads');
  return row({ dir: h.dir, name: link ? (h.text || h.name).replace(/^https?:\/\//, '') : text ? (h.text || h.name).split('\n')[0] : h.name,
    thumb: link ? 'Link' : text ? 'Text' : '',
    sub: (h.size && !text ? size(h.size) + ' · ' : '') + verb + ' · ' + ago(h.t), append, t: h.t });
}
function historyLive(h) {
  // rows for transfers that happened on this screen are already there
  if (h.dir === 'up' && (h.kind === 'text' || h.kind === 'link' || (h.kind === 'scan' && jobs.some(j => j.scan)) || jobs.some(j => j.file.name === h.name))) return;
  if (h.dir === 'down' && [...rowsIn.values()].some(r => r.li.querySelector('.name').textContent === h.name)) return;
  histRow(h, false);
}

// ---------- clear recents (with a few seconds to undo; files are never touched) ----------
$('clearRecent').onclick = async () => {
  const kept = [...$('list').children];
  if (!kept.some(li => li.classList.contains('item'))) return;
  const r = await fetch('/api/history', { method: 'DELETE' }).catch(() => null);
  if (!r || !r.ok) return toast("Laptop isn't reachable");
  kept.forEach(li => li.remove());
  $('recentH').hidden = true; $('empty').hidden = false;
  toast('Recents cleared', async () => {
    await fetch('/api/history/restore', { method: 'POST' }).catch(() => {});
    kept.forEach(li => $('list').append(li));
    $('recentH').hidden = false; $('empty').hidden = true;
  });
};

// ---------- scans: one tap turns this session's pages into a PDF on the laptop ----------
function scanPdfButton(r, pages) {
  document.querySelectorAll('.item .pdf').forEach(b => b.remove());   // only on the newest scan
  const b = document.createElement('button');
  b.className = 'text pdf'; b.textContent = pages > 1 ? `Make PDF (${pages})` : 'Make PDF';
  b.onclick = async () => {
    b.disabled = true;
    const res = await fetch('/api/scans/pdf', { method: 'POST' }).catch(() => null);
    if (res && res.ok) { b.textContent = 'PDF opened'; toast(`PDF with ${(await res.json()).pages} page(s) opened on laptop`); }
    else { b.disabled = false; toast(res && res.status === 404 ? 'No scans in the last 15 minutes' : "Laptop isn't reachable"); }
  };
  r.li.append(b);
}

// ---------- speed test: 100 MB each way, nothing saved ----------
$('speedBtn').onclick = async () => {
  const out = $('speedOut'), MB = 100;
  $('speedBtn').disabled = true; out.textContent = 'Testing download…'; $('spDown').textContent = '…'; $('spUp').textContent = '…';
  try {
    let t0 = performance.now();
    const r = await fetch(`/api/speed/down?mb=${MB}`, { cache: 'no-store' });
    const rd = r.body.getReader(); let got = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; got += value.byteLength; }
    const down = got * 8 / 1e6 / ((performance.now() - t0) / 1000);
    $('spDown').textContent = down.toFixed(0); out.textContent = 'Testing upload…';
    const blob = new Blob([new Uint8Array(MB * 1024 * 1024)]);
    t0 = performance.now();
    const u = await fetch('/api/speed/up', { method: 'POST', body: blob });
    if (!u.ok) throw new Error(u.status);
    const up = blob.size * 8 / 1e6 / ((performance.now() - t0) / 1000);
    $('spUp').textContent = up.toFixed(0);
    out.textContent = `${(down / 8).toFixed(0)} / ${(up / 8).toFixed(0)} MB/s · ${via || 'local network'}`;
    fetch('/api/speed/result', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ down: Math.round(down), up: Math.round(up) }) }).catch(() => {});
  } catch (e) { out.textContent = "Couldn't reach the laptop"; }
  $('speedBtn').disabled = false;
};

// ---------- scan review: the laptop suggests corners, you drag them, then it straightens + cleans ----------
const FULL = [[0, 0], [1, 0], [1, 1], [0, 1]];
let rv = null;   // { job, sid, corners, mode, url }
const FILTERS = { color: 'contrast(1.15) saturate(1.1) brightness(1.06)', bw: 'grayscale(1) contrast(1.7) brightness(1.1)', original: 'none' };
function review(job, info) {
  if (!info.scan) { job.r.sub('Scan failed, try again', true); return; }
  rv = { job, sid: info.scan, corners: (info.corners || FULL).map(p => p.slice()), mode: 'color', url: URL.createObjectURL(job.file) };
  $('rvHint').textContent = info.found ? 'Page found · adjust if needed' : 'Drag the corners to the page edges';
  $('rvImg').onload = drawCorners;
  $('rvImg').src = rv.url;
  setMode('color');
  $('review').hidden = false; $('review').classList.remove('rv-busy');
}
function imgBox() {   // where the photo actually sits inside the stage
  const st = $('rvStage').getBoundingClientRect(), im = $('rvImg').getBoundingClientRect();
  return { x: im.left - st.left, y: im.top - st.top, w: im.width, h: im.height };
}
function drawCorners() {
  if (!rv) return;
  const b = imgBox(), P = rv.corners.map(([x, y]) => [b.x + x * b.w, b.y + y * b.h]);
  const pts = P.map(p => p.join(',')).join(' ');
  $('rvPoly').setAttribute('points', pts);
  $('rvShade').setAttribute('d', `M${b.x},${b.y}h${b.w}v${b.h}h${-b.w}z M${P.map(p => p.join(',')).join(' L')}z`);
  const g = $('rvHandles');
  if (!g.children.length) {
    for (let i = 0; i < 4; i++) {
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); hit.setAttribute('r', 26); hit.setAttribute('class', 'rv-hit');
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); dot.setAttribute('r', 9); dot.setAttribute('class', 'rv-h');
      g.append(dot, hit);
      hit.addEventListener('pointerdown', e => drag(e, i));
    }
  }
  P.forEach(([x, y], i) => { for (const c of [g.children[i * 2], g.children[i * 2 + 1]]) { c.setAttribute('cx', x); c.setAttribute('cy', y); } });
}
function drag(e, i) {
  e.preventDefault();
  const el = e.target; el.setPointerCapture(e.pointerId);
  const move = ev => {
    const b = imgBox(), st = $('rvStage').getBoundingClientRect();
    rv.corners[i] = [Math.min(1, Math.max(0, (ev.clientX - st.left - b.x) / b.w)), Math.min(1, Math.max(0, (ev.clientY - st.top - b.y) / b.h))];
    drawCorners();
  };
  const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
function setMode(m) {
  if (rv) rv.mode = m;
  [...$('rvModes').children].forEach(b => b.classList.toggle('on', b.dataset.m === m));
  $('rvImg').style.filter = FILTERS[m];
}
$('rvModes').onclick = e => { if (e.target.dataset.m) setMode(e.target.dataset.m); };
$('rvFull').onclick = () => { if (rv) { rv.corners = FULL.map(p => p.slice()); drawCorners(); } };
addEventListener('resize', drawCorners);
function closeReview() { if (rv) URL.revokeObjectURL(rv.url); rv = null; $('review').hidden = true; $('rvImg').removeAttribute('src'); }
$('rvRetake').onclick = () => {
  const cur = rv; if (!cur) return;
  $('pickScan').click();   // straight back to the camera (needs this tap)
  fetch(`/api/scan/${cur.sid}`, { method: 'DELETE' }).catch(() => {});
  cur.job.r.li.remove(); closeReview();
};
async function saveScan(next) {
  const cur = rv; if (!cur) return;
  if (next) $('pickScan').click();
  $('review').classList.add('rv-busy');
  const full = cur.corners.every((p, i) => Math.abs(p[0] - FULL[i][0]) < .002 && Math.abs(p[1] - FULL[i][1]) < .002);
  const r = await fetch(`/api/scan/${cur.sid}`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ corners: full ? null : cur.corners, mode: cur.mode }) }).catch(() => null);
  closeReview();
  if (!r || !r.ok) { cur.job.r.sub("Couldn't save the scan", true); return toast("Laptop isn't reachable"); }
  const { pages } = await r.json();
  cur.job.r.sub(`Opened on laptop${pages > 1 ? ' · page ' + pages : ''}`);
  scanPdfButton(cur.job.r, pages);
  toast(pages > 1 ? `Page ${pages} saved` : 'Scan opened on laptop');
}
$('rvSave').onclick = () => saveScan(false);
$('rvNext').onclick = () => saveScan(true);

// ---------- notifications like any other app (Web Push when the app is closed) ----------
const canNotify = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
async function showNotifyState() {
  $('notifyRow').hidden = !canNotify;
  if (!canNotify) return;
  let sub = null;
  try { sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription(); } catch (e) {}
  const on = Notification.permission === 'granted' && sub;
  $('notifyText').textContent = Notification.permission === 'denied' ? 'Blocked · allow in Android settings for this app'
    : on ? 'On · even when the app is closed' : 'Know when the laptop sends something';
  $('notifyBtn').textContent = on ? 'Turn off' : 'Turn on';
  $('notifyBtn').hidden = Notification.permission === 'denied';
  return on;
}
$('notifyBtn').onclick = async () => {
  const reg = await navigator.serviceWorker.ready;
  const cur = await reg.pushManager.getSubscription().catch(() => null);
  if (cur && Notification.permission === 'granted') {   // turn off
    await cur.unsubscribe().catch(() => {});
    fetch('/api/push/sub', { method: 'DELETE' }).catch(() => {});
    toast('Notifications off'); return showNotifyState();
  }
  if ((await Notification.requestPermission()) !== 'granted') { toast('Notifications not allowed'); return showNotifyState(); }
  try {
    const { key } = await (await fetch('/api/push/key')).json();
    const raw = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - key.length % 4) % 4)), c => c.charCodeAt(0));
    const sub = cur || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
    const r = await fetch('/api/push/sub', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub.toJSON()) });
    if (!r.ok) throw new Error(r.status);
    toast('Notifications on');
  } catch (e) { toast("Couldn't turn on notifications (needs internet)"); diag('push-subscribe-failed', { err: String(e).slice(0, 160) }); }
  showNotifyState();
};
// app open but in the background: the page itself posts the notification (the laptop only pushes when the app is closed)
async function notifyIncoming(items) {
  if (!document.hidden || !canNotify || Notification.permission !== 'granted' || !items.length) return;
  const files = items.filter(i => i.kind !== 'text');
  const reg = await navigator.serviceWorker.ready;
  reg.showNotification(files.length ? `${$('laptop').textContent} sent ${files.length === 1 ? files[0].name : files.length + ' files'}` : `Text from ${$('laptop').textContent}`,
    { body: files.length ? 'Tap to save' : (items[0].text || '').slice(0, 120), tag: 'incoming', renotify: true, icon: '/icon-192.png', badge: '/icon-mono-512.png', data: { url: '/app' } });
}

// ---------- clipboard: pick from the laptop's history; the phone's copies go to the laptop's list ----------
async function openClips() {
  $('scrim').hidden = false; void $('sheet').offsetWidth; $('sheet').classList.add('on');
  $('clips').innerHTML = '<li class="empty">Loading…</li>';
  let items;
  try { items = await (await fetch('/api/clips', { cache: 'no-store' })).json(); }
  catch (e) { $('clips').innerHTML = '<li class="empty">Laptop isn\'t reachable</li>'; return; }
  if (!items.length) { $('clips').innerHTML = '<li class="empty">Nothing copied on the laptop yet</li>'; return; }
  $('clips').innerHTML = '';
  for (const it of items) {
    const li = document.createElement('li');
    li.className = 'clip';
    li.innerHTML = (it.kind === 'image' ? `<img src="/api/clips/${it.id}" alt="" loading="lazy"><div class="snippet">Image</div>`
      : `<div class="snippet">${esc(it.text)}</div>`) + (it.fav ? '<span class="star">★</span>' : '');
    li.onclick = async () => {
      if (it.kind === 'image') {
        const a = document.createElement('a'); a.href = `/api/clips/${it.id}`; a.download = 'clipboard.png'; a.click();
        return toast('Saving image');
      }
      try { await navigator.clipboard.writeText(it.text); lastPhoneClip = it.text; toast('Copied · paste anywhere'); closeClips(); }
      catch (e) { toast("Couldn't copy"); }
    };
    $('clips').append(li);
  }
}
function closeClips() { $('sheet').classList.remove('on'); setTimeout(() => { $('scrim').hidden = true; }, 280); }
$('scrim').onclick = closeClips;

// whatever this phone copied since the app was last in front lands in the laptop's "Phone clipboard" list
let lastPhoneClip = localStorage.getItem('lastPhoneClip');
async function capturePhoneClip() {
  if (!linked || document.hidden || !document.hasFocus()) return;
  let text;
  try { text = await navigator.clipboard.readText(); } catch (e) { return; }
  if (!text || !text.trim() || text === lastPhoneClip) return;
  lastPhoneClip = text; localStorage.setItem('lastPhoneClip', text);
  fetch('/api/phoneclip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }).catch(() => {});
}
addEventListener('focus', capturePhoneClip);

// ---------- battery, install ----------
let batt;
async function battery() {
  try {
    batt = batt || await navigator.getBattery();
    const send = () => {
      $('batt').textContent = Math.round(batt.level * 100) + '%';
      $('battChip').hidden = false;
      $('battChip').classList.toggle('low', batt.level < .2 && !batt.charging);
      $('battLvl').setAttribute('width', Math.max(1, 12 * batt.level).toFixed(1));
      fetch('/api/status', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ battery: batt.level, charging: batt.charging }) }).catch(() => {});
    };
    if (!batt.hooked) { batt.hooked = 1; batt.addEventListener('levelchange', send); batt.addEventListener('chargingchange', send); }
    send();
  } catch (e) {}
}
let installEv;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEv = e; $('install').hidden = false; });
$('installbtn').onclick = async () => { if (!installEv) return; installEv.prompt(); await installEv.userChoice; $('install').hidden = true; };
addEventListener('appinstalled', () => { $('install').hidden = true; toast('Installed'); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
folderReady = within(loadFolder(), 1500);
folderReady.then(() => diag('boot'));
showNotifyState();
// Phones paired at the old hotspot address move to the laptop's name, which works on every trusted network.
async function moveToName() {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(location.hostname)) return false;
  try {
    const r = await fetch('/api/migrate', { method: 'POST' });
    if (!r.ok) return false;
    location.replace((await r.json()).url);
    return true;
  } catch (e) { return false; }
}
moveToName().then(moved => { if (!moved) me().then(ok => { if (ok !== false) connect(); }); });
document.addEventListener('visibilitychange', () => { if (document.hidden) return; if (!linked) me(); else capturePhoneClip(); });
