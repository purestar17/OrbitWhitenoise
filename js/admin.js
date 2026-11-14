// Admin page: edit sounds/manifest.json in the browser and download the result.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SCENES = ['rain', 'tent', 'storm', 'thunder', 'stream', 'wave', 'under', 'forest', 'birds', 'cricket', 'night', 'fire', 'fireplace', 'cafe', 'clock', 'chime', 'white', 'pink', 'brown', 'mine'];
const SCENE_KO = { rain: '비', tent: '텐트', storm: '폭우', thunder: '번개', stream: '시냇물', wave: '파도', under: '물속', forest: '숲', birds: '새', cricket: '여름밤', night: '밤', fire: '모닥불', fireplace: '벽난로', cafe: '카페', clock: '시계', chime: '풍경', white: '화이트', pink: '핑크', brown: '브라운', mine: '기본' };
const INT_KO = { loop: '∞ 지속', range: '범위 랜덤', fixed: '정해진 간격', full: '완전 랜덤' };

let manifest;
const pending = []; // { name, blob } files the admin must upload

async function load() {
  manifest = await (await fetch('sounds/manifest.json', { cache: 'no-cache' })).json();
  $('#f-scene').innerHTML = SCENES.map((s) => `<option value="${s}">${SCENE_KO[s]}</option>`).join('');
  renderCats();
  renderList();
}
function renderCats() {
  $('#f-cat').innerHTML = manifest.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
}
function renderList() {
  $('#list').innerHTML = manifest.sounds.map((s, i) => {
    const cat = manifest.categories.find((c) => c.id === s.category)?.name || s.category;
    const isNew = pending.some((p) => p.name === s.file);
    const thumb = s.image ? `<span class="th" style="background-image:url(sounds/${esc(s.image)})"></span>` : `<span class="th scene s-${esc(s.scene)}"></span>`;
    const iv = s.interval === 'loop' ? INT_KO.loop : `${INT_KO[s.interval]}${s.interval === 'range' ? ` ${s.min}~${s.max}초` : s.interval === 'fixed' ? ` ${s.value}초` : ''}`;
    return `<tr><td>${thumb}</td><td><span class="sw" style="background:${esc(s.color)}"></span>${esc(s.name)} ${isNew ? '<span class="new">새로 추가</span>' : ''}</td><td>${esc(cat)}</td><td>${esc(s.file)}</td><td>${iv}</td><td>${s.volume ?? 60}%</td><td>${s.interval === 'loop' ? `<button class="lp" data-lp="${i}">🔁 이음새</button>` : ''}<button class="del" data-i="${i}">삭제</button></td></tr>`;
  }).join('');
  $('#dl').innerHTML = pending.map((p) => `<a href="${URL.createObjectURL(p.blob)}" download="${esc(p.name.split('/').pop())}">⬇ ${esc(p.name)}</a>`).join('') || '<p>새로 올릴 오디오·사진 파일이 없어요.</p>';
}

$('#list').addEventListener('click', (e) => {
  const lp = e.target.closest('[data-lp]');
  if (lp) {
    const s = manifest.sounds[+lp.dataset.lp];
    const fresh = pending.find((p) => p.name === s.file);
    loopCheck(fresh ? fresh.blob : `sounds/${s.file}`, s.name);
    return;
  }
  const b = e.target.closest('[data-i]');
  if (!b) return;
  const s = manifest.sounds[+b.dataset.i];
  if (!confirm(`"${s.name}"을(를) 목록에서 뺄까요? (manifest.json을 올려야 반영돼요)`)) return;
  manifest.sounds.splice(+b.dataset.i, 1);
  renderList();
});

function preview() {
  const img = $('#f-image').files[0];
  const name = $('#f-name').value || '미리보기';
  $('#pv').innerHTML = (img ? `<img src="${URL.createObjectURL(img)}" alt="">` : `<div class="art scene s-${$('#f-scene').value}"></div>`) + `<span>${esc(name)}</span>`;
  const a = $('#f-audio').files[0];
  if (a && $('#pa').dataset.f !== a.name) { $('#pa').src = URL.createObjectURL(a); $('#pa').dataset.f = a.name; }
}
['#f-name', '#f-image', '#f-scene', '#f-audio'].forEach((s) => $(s).addEventListener('input', preview));

$('#add').addEventListener('click', () => {
  const name = $('#f-name').value.trim();
  const audio = $('#f-audio').files[0];
  if (!name) return msg('이름을 넣어 주세요');
  if (!audio) return msg('오디오 파일을 골라 주세요');
  let cat = $('#f-cat').value;
  const newCat = $('#f-newcat').value.trim();
  if (newCat) {
    cat = 'cat' + Date.now().toString(36);
    manifest.categories.push({ id: cat, name: newCat });
    renderCats();
  }
  const id = 's' + Date.now().toString(36);
  const ext = (audio.name.match(/\.[a-z0-9]+$/i) || ['.mp3'])[0].toLowerCase();
  const entry = {
    id, name, category: cat, file: id + ext, scene: $('#f-scene').value, color: $('#f-color').value,
    interval: $('#f-int').value, volume: clampN($('#f-vol').value, 1, 100, 60),
  };
  const mn = clampN($('#f-min').value, 1, 1800, 10), mx = clampN($('#f-max').value, 1, 1800, 60);
  if (entry.interval === 'range') { entry.min = Math.min(mn, mx); entry.max = Math.max(mn, mx); }
  if (entry.interval === 'fixed') entry.value = mx;
  pending.push({ name: entry.file, blob: audio });
  const img = $('#f-image').files[0];
  if (img) {
    const iext = (img.name.match(/\.[a-z0-9]+$/i) || ['.jpg'])[0].toLowerCase();
    entry.image = `images/${id}${iext}`;
    pending.push({ name: entry.image, blob: img });
  }
  manifest.sounds.push(entry);
  renderList();
  msg(`"${name}"을(를) 추가했어요. 아래 3번에서 파일을 내려받아 올려 주세요.`);
  $('#f-name').value = ''; $('#f-audio').value = ''; $('#f-image').value = ''; $('#f-newcat').value = '';
});

$('#dlm').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(manifest, null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'manifest.json';
  a.click();
});

function clampN(v, a, b, d) { v = Math.round(+v); return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; }
function msg(t) { $('#msg').textContent = t; }
// ---------------------------------------------------------------- seamless loop check
// Plays the last 3 s of the file straight into the first 3 s, exactly the way the app loops it
// (same loop points as js/engine.js), and draws the waveform around the seam.
const SPAN = 3;
let lc = { ctx: null, src: null, timer: 0, raf: 0 };

function loopPoints(buf) {
  const pad = Math.min(0.03, buf.duration / 20); // keep in step with engine.js startLoop()
  return { start: pad, end: buf.duration - pad };
}

async function decode(blobOrUrl) {
  lc.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
  const data = typeof blobOrUrl === 'string' ? await (await fetch(blobOrUrl)).arrayBuffer() : await blobOrUrl.arrayBuffer();
  return lc.ctx.decodeAudioData(data);
}

function stopLoopCheck() {
  try { lc.src?.stop(); } catch { /* already stopped */ }
  lc.src = null;
  clearTimeout(lc.timer);
  cancelAnimationFrame(lc.raf);
  $('#lc-play').textContent = '▶ 다시 듣기';
  $('#lc-head').style.left = '0';
}

async function loopCheck(source, label) {
  stopLoopCheck();
  const box = $('#lc');
  box.hidden = false;
  $('#lc-title').textContent = `"${label}" 이음새 확인`;
  $('#lc-info').textContent = '불러오는 중…';
  let buf;
  try { buf = await decode(source); } catch { $('#lc-info').textContent = '이 파일은 재생할 수 없는 형식이에요.'; return; }
  await lc.ctx.resume();
  lc.buf = buf;
  const { start, end } = loopPoints(buf);
  const span = Math.min(SPAN, (end - start) / 2);
  drawSeam(buf, start, end, span);
  $('#lc-info').innerHTML = `길이 ${buf.duration.toFixed(1)}초 · 끝 ${span.toFixed(1)}초 → 처음 ${span.toFixed(1)}초를 이어서 들려줘요. 가운데 선이 이음새예요.<br>${seamHint(buf, start, end)}`;
  playSeam();
}

function playSeam() {
  const buf = lc.buf;
  if (!buf) return;
  stopLoopCheck();
  const { start, end } = loopPoints(buf);
  const span = Math.min(SPAN, (end - start) / 2);
  const src = lc.ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.loopStart = start;
  src.loopEnd = end;
  const g = lc.ctx.createGain();
  const t0 = lc.ctx.currentTime + 0.05;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(1, t0 + 0.08);
  g.gain.setValueAtTime(1, t0 + span * 2 - 0.08);
  g.gain.linearRampToValueAtTime(0, t0 + span * 2);
  src.connect(g).connect(lc.ctx.destination);
  src.start(t0, end - span);
  src.stop(t0 + span * 2 + 0.02);
  lc.src = src;
  $('#lc-play').textContent = '■ 멈추기';
  const head = $('#lc-head');
  const tick = () => {
    const p = Math.min(1, Math.max(0, (lc.ctx.currentTime - t0) / (span * 2)));
    head.style.left = `${p * 100}%`;
    if (p < 1 && lc.src === src) lc.raf = requestAnimationFrame(tick);
  };
  tick();
  src.onended = () => { if (lc.src === src) stopLoopCheck(); };
}

// waveform of [end-span, end] followed by [start, start+span]
function drawSeam(buf, start, end, span) {
  const cv = $('#lc-wave');
  const w = cv.width = cv.clientWidth * devicePixelRatio;
  const h = cv.height = cv.clientHeight * devicePixelRatio;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, w, h);
  const ch = buf.getChannelData(0), sr = buf.sampleRate;
  const a0 = Math.floor((end - span) * sr), a1 = Math.floor(end * sr);
  const b0 = Math.floor(start * sr), b1 = Math.floor((start + span) * sr);
  const total = (a1 - a0) + (b1 - b0);
  const at = (i) => (i < a1 - a0 ? ch[a0 + i] : ch[b0 + i - (a1 - a0)]) || 0;
  g.fillStyle = '#5ee1c6';
  for (let x = 0; x < w; x++) {
    const i0 = Math.floor(x / w * total), i1 = Math.max(i0 + 1, Math.floor((x + 1) / w * total));
    let lo = 1, hi = -1;
    for (let i = i0; i < i1; i += 4) { const v = at(i); if (v < lo) lo = v; if (v > hi) hi = v; }
    g.fillRect(x, (1 - hi) * h / 2, 1, Math.max(1, (hi - lo) * h / 2));
  }
  g.fillStyle = '#ff8a8a';
  g.fillRect(w / 2 - devicePixelRatio, 0, devicePixelRatio * 2, h);
}

// loudness just before vs just after the seam
function seamHint(buf, start, end) {
  const ch = buf.getChannelData(0), sr = buf.sampleRate, n = Math.floor(0.25 * sr);
  const rms = (from) => { let s = 0; for (let i = 0; i < n; i++) { const v = ch[from + i] || 0; s += v * v; } return Math.sqrt(s / n) + 1e-9; };
  const before = rms(Math.floor(end * sr) - n), after = rms(Math.floor(start * sr));
  const db = Math.abs(20 * Math.log10(after / before));
  if (before < 1e-4 && after < 1e-4) return '이음새 양쪽이 거의 무음이에요.';
  if (db < 2.5) return `이음새 앞뒤 소리 크기 차이 ${db.toFixed(1)}dB: 크기는 자연스럽게 이어져요. 귀로 "툭" 소리나 끊김이 없는지 확인해 주세요.`;
  if (db < 5) return `이음새 앞뒤 소리 크기 차이 ${db.toFixed(1)}dB: 조금 차이가 나요. 들어 보고 어색하면 편집이 필요해요.`;
  return `이음새 앞뒤 소리 크기 차이 ${db.toFixed(1)}dB: 차이가 커서 반복될 때 티가 날 가능성이 높아요.`;
}

$('#lc-play').addEventListener('click', () => (lc.src ? stopLoopCheck() : playSeam()));
$('#lc-close').addEventListener('click', () => { stopLoopCheck(); $('#lc').hidden = true; });
$('#f-loop').addEventListener('click', () => {
  const a = $('#f-audio').files[0];
  if (!a) return msg('먼저 오디오 파일을 골라 주세요');
  loopCheck(a, a.name);
});

load();
