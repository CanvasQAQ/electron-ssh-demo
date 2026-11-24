const $ = id => document.getElementById(id);
let initialized = false, previousScreen, historyKey = '';
function useTarget(target) {
  $('host').value = target.host;
  $('user').value = target.user || '';
  $('path').value = target.path || '';
  $('ssh-port').value = target.sshPort;
  $('port').value = target.port;
  $('start-service').checked = target.startService;
  $('mode').value = 'ssh';
  setMode();
}
function setMode() {
  const local = $('mode').value === 'local';
  $('host').required = !local;
  for (const id of ['host', 'user', 'ssh-port', 'port', 'start-service']) $(id).disabled = local;
  $('connect-label').textContent = local ? 'Open demo' : 'Connect';
}
function render(state) {
  $('theme').value = state.theme;
  if (!initialized) { useTarget(state.defaults); initialized = true; }
  $('user').placeholder = state.localUser || 'SSH default';
  if (previousScreen === 'workspace' && state.screen === 'connection') {
    useTarget(state.target); $('host').focus(); $('host').select();
  }
  previousScreen = state.screen;
  document.body.classList.toggle('busy', state.busy);
  document.body.classList.toggle('workspace', state.screen === 'workspace');
  for (const el of document.querySelectorAll('input,select,button')) el.disabled = state.busy;
  if (!state.busy) setMode();
  if (state.busy) $('connect-label').textContent = state.phase === 'loading' ? 'Loading' : 'Connecting';
  $('progress-text').textContent = state.busy ? (state.phase === 'loading' ? 'Loading workspace…' : state.detail) : '';
  $('progress').hidden = !state.busy;
  $('error').hidden = !state.error;
  $('error').textContent = state.error;
  const key = JSON.stringify(state.history);
  if (historyKey !== key) {
    historyKey = key;
    $('history-list').replaceChildren();
    for (const target of state.history) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'history-item';
      const text = document.createElement('span'), host = document.createElement('strong'), project = document.createElement('small'), arrow = document.createElement('span');
      text.className = 'history-text';
      const user = target.user || state.localUser || 'Default user';
      host.textContent = `${user}@${target.host}`;
      project.textContent = target.path || 'Choose a project path';
      project.title = target.path;
      arrow.textContent = '↗'; arrow.className = 'arrow';
      text.append(host, project); button.append(text, arrow);
      button.title = `${user}@${target.host} · ${target.path || 'Path required'} · SSH ${target.sshPort} · Service ${target.port}`;
      button.onclick = () => { useTarget(target); $(target.path ? 'host' : 'path').focus(); $('error').hidden = true; };
      button.disabled = state.busy;
      $('history-list').append(button);
    }
    $('history').hidden = state.history.length === 0;
  }
}
window.relay.onState(render);
window.relay.action('state').then(render);
$('mode').onchange = setMode;
$('connect-form').onsubmit = async event => {
  event.preventDefault();
  try {
    if (!$('path').value.trim()) { $('error').textContent = 'Enter a project path.'; $('error').hidden = false; $('path').focus(); return; }
    render(await window.relay.action('connect', { mode: $('mode').value, target: { host: $('host').value.trim(), user: $('user').value.trim(), path: $('path').value, port: Number($('port').value), sshPort: Number($('ssh-port').value), startService: $('start-service').checked } }));
  } catch (error) { $('error').textContent = error.message; $('error').hidden = false; }
};

$('theme').onchange = async () => {
  try { render(await window.relay.action('theme', $('theme').value)); }
  catch (error) { $('error').textContent = error.message; $('error').hidden = false; }
};
