const $ = id => document.getElementById(id);
let state;
function render(next) {
  state = next;
  $('theme').value = state.theme;
  const status = state.busy ? state.phase : (state.error ? 'error' : state.status);
  $('host-label').textContent = state.mode === 'local' ? 'Local demo' : (state.target.user ? `${state.target.user}@${state.target.host}` : state.target.host);
  $('host-label').title = $('host-label').textContent;
  $('status').textContent = { idle: 'Disconnected', connecting: 'Connecting', loading: 'Loading', online: 'SSH connected', offline: 'Connection lost', error: 'Connection error', ready: 'Connected' }[status] || 'Working';
  if (state.mode === 'local' && status === 'online') $('status').textContent = 'Local demo';
  $('orb').className = `orb ${status}`;
  $('detail').textContent = state.error || (state.phase === 'loading' && state.busy ? 'Loading workspace…' : state.detail);
  $('detail').hidden = !state.error && !state.busy && state.status === 'online';
  $('detail').title = $('detail').textContent;
  $('card').hidden = !state.expanded;
  $('launcher').hidden = state.expanded;
  document.body.classList.toggle('collapsed', !state.expanded);
  $('launcher').setAttribute('aria-label', `${$('status').textContent} · ${$('host-label').textContent} · Open connection controls`);
  $('launcher').title = `${$('status').textContent} · ${$('host-label').textContent}`;
  $('launcher-status').className = `signal ${status}`;
  $('endpoint').textContent = state.url || 'Disconnected';
  $('local-tools').hidden = state.mode !== 'local';
  $('warning').hidden = !state.warning;
  $('warning').textContent = state.warning;
  for (const el of document.querySelectorAll('button')) el.disabled = state.busy && !['launcher', 'collapse'].includes(el.id);
  $('disconnect').disabled = state.busy || state.status === 'idle';
}
async function action(name, payload) {
  try { render(await window.relay.action(name, payload)); }
  catch (error) { $('detail').hidden = false; $('detail').textContent = error.message; }
}
window.relay.onState(render);
window.relay.action('state').then(render);
for (const name of ['reconnect', 'disconnect', 'switch', 'refresh', 'stop', 'publish']) $(name).onclick = () => action(name);
$('launcher').onclick = () => action('expand', true);
$('collapse').onclick = () => action('expand', false);
document.addEventListener('keydown', event => { if (event.key === 'Escape') action('expand', false); });

$('theme').onchange = () => action('theme', $('theme').value);
