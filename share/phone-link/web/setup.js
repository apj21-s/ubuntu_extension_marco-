// Step 1 (plain HTTP): is the laptop's certificate trusted yet? If so, move to the HTTPS pairing page.
const https = 'https://' + location.host + location.pathname;
const state = document.getElementById('state');
async function trusted() {
  try { await fetch('https://' + location.host + '/api/ping', { mode: 'no-cors', cache: 'no-store' }); return true; }
  catch (e) { return false; }
}
async function check() {
  if (await trusted()) { state.textContent = 'Trusted'; document.getElementById('status').className = 'status on'; location.replace(https); return; }
  state.textContent = 'Not trusted yet'; document.getElementById('status').className = 'status off';
  document.getElementById('steps').hidden = false;
}
check();
document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
setInterval(() => { if (!document.hidden) trusted().then(ok => ok && location.replace(https)); }, 4000);
