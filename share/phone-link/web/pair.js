// Pairing (HTTPS): name the phone, the laptop allows it, the key arrives as a cookie.
const code = location.pathname.split('/')[2];
const $ = id => document.getElementById(id);
const say = (t, state, cls) => { $('msg').textContent = t; if (state) $('state').textContent = state; if (cls) $('status').className = 'status ' + cls; };
(async () => {
  let name = 'My phone';
  try {
    if (navigator.userAgentData) {
      const v = await navigator.userAgentData.getHighEntropyValues(['model']);
      if (v.model) name = v.model.replace(/\b\w/g, c => c.toUpperCase());
    }
  } catch (e) {}
  $('name').value = name;
})();
async function poll() {
  for (let i = 0; i < 150; i++) {
    await new Promise(r => setTimeout(r, 900));
    let s;
    try { s = await (await fetch('/api/pair/' + code, { cache: 'no-store' })).json(); } catch (e) { continue; }
    if (s.state === 'ok') {
      $('form').hidden = true; $('done').hidden = false;
      say('Opening the app…', 'Connected', 'on');
      return setTimeout(() => location.replace('/app'), 1200);
    }
    if (s.state === 'denied') return say('The laptop declined.', 'Declined', 'off');
    if (s.state === 'expired') return say('This code expired. Show a new one on the laptop.', 'Expired', 'off');
  }
  say('No answer from the laptop. Show a new code and try again.', 'Timed out', 'off');
}
if (new URLSearchParams(location.search).has('m')) {   // moving from the old address: already approved
  $('form').hidden = true;
  say('Moving Dropline to work on every trusted network…', 'Updating');
  poll();
}
$('go').onclick = async () => {
  $('go').disabled = true;
  const r = await fetch('/api/pair/' + code, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: $('name').value.trim() }) }).catch(() => null);
  if (!r || r.status === 404) { $('go').disabled = false; return say('This code expired. Show a new one on the laptop.', 'Expired', 'off'); }
  $('go').textContent = 'Waiting for laptop…';
  say('Tap Allow on the laptop.', 'Waiting');
  poll();
};
