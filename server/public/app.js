const $ = id => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function feedback(element) {
  if (reducedMotion.matches) return;
  element.getAnimations().forEach(animation => animation.cancel());
  element.animate([{ opacity: 0.5, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180, easing: 'cubic-bezier(.22,1,.36,1)' });
}
let count = 0;
$('increment').onclick = () => { $('count').textContent = String(++count).padStart(2, '0'); feedback($('count')); };
$('delay').oninput = () => {
  $('delay-value').textContent = (Number($('delay').value) / 1000).toFixed(1);
};
let frameCount = 0;
let last = performance.now();
function tick(now) {
  frameCount++;
  if (now - last > 1000) {
    $('frames').textContent = `${Math.round(frameCount * 1000 / (now - last))} fps`;
    frameCount = 0; last = now;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
$('request').onclick = async () => {
  const delay = Number($('delay').value);
  const start = performance.now();
  $('request').disabled = true;
  document.body.classList.add('pending');
  $('request-state').className = 'request-state waiting';
  const timer = setInterval(() => { $('request-state').textContent = `Waiting ${((performance.now() - start) / 1000).toFixed(1)} s`; }, 100);
  $('result-code').textContent = `GET /api/report?delay=${delay}`;
  try {
    const response = await fetch(`/api/report?delay=${delay}`, { signal: AbortSignal.timeout(13000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const elapsed = ((performance.now() - start) / 1000).toFixed(2);
    $('request-state').textContent = `Done · ${elapsed} s`;
    $('result-title').textContent = `${data.jobs} jobs`;
    $('result-code').textContent = `200 OK · ${elapsed}s · ${new Date(data.at).toLocaleTimeString('en')}`;
  } catch {
    $('request-state').textContent = 'Request failed · Retry';
    $('result-title').textContent = 'Service unavailable';
  } finally {
    clearInterval(timer);
    document.body.classList.remove('pending');
    feedback(document.querySelector('.result'));
    $('request-state').className = 'request-state';
    $('request').disabled = false;
  }
};
