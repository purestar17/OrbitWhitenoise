// Admin page: edit sounds/manifest.json in the browser and download the result.
// Each sound opens in a modal: details, plus audio tools (volume change, seamless loop).
// Edited audio is encoded to MP3 in the browser with LAME (vendor/lame.min.js, LGPL).
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SCENES = ['rain', 'tent', 'storm', 'thunder', 'stream', 'wave', 'under', 'forest', 'birds', 'cricket', 'night', 'fire', 'fireplace', 'cafe', 'clock', 'chime', 'white', 'pink', 'brown', 'mine'];
const SCENE_KO = { rain: '비', tent: '텐트', storm: '폭우', thunder: '번개', stream: '시냇물', wave: '파도', under: '물속', forest: '숲', birds: '새', cricket: '여름밤', night: '밤', fire: '모닥불', fireplace: '벽난로', cafe: '카페', clock: '시계', chime: '풍경', white: '화이트', pink: '핑크', brown: '브라운', mine: '기본' };
const INT_KO = { loop: '∞ 지속', range: '범위 랜덤', fixed: '정해진 간격', full: '완전 랜덤' };
const SPAN = 3; // seconds on each side of the loop seam

let manifest;
const pending = []; // { name, blob } files the admin must upload
const changed = new Set(); // sound ids edited in this session
const loud = new Map(); // file -> loudness (dB), for the library average

// ---------------------------------------------------------------- list
async function load() {
  manifest = await (await fetch('sounds/manifest.json', { cache: 'no-cache' })).json();
  $('#f-scene').innerHTML = SCENES.map((s) => `<option value="${s}">${SCENE_KO[s]}</option>`).join('');
  renderList();
  measureLibrary();
}
function renderCats(sel) {
  $('#f-cat').innerHTML = manifest.categories.map((c) => `<option value="${c.id}"${c.id === sel ? ' selected' : ''}>${esc(c.name)}</option>`).join('');
}
const pendingBlob = (name) => pending.find((p) => p.name === name)?.blob;
const imageURL = (s) => { const b = pendingBlob(s.image); return b ? URL.createObjectURL(b) : `sounds/${s.image}`; };
function intText(s) {
  if (s.interval === 'range') return `${INT_KO.range} ${s.min}~${s.max}초`;
  if (s.interval === 'fixed') return `${INT_KO.fixed} ${s.value}초`;
  return INT_KO[s.interval] || s.interval;
}
function renderList() {
  $('#list').innerHTML = manifest.sounds.map((s, i) => {
    const cat = manifest.categories.find((c) => c.id === s.category)?.name || s.category;
    const thumb = s.image ? `<span class="th" style="background-image:url(${esc(imageURL(s))})"></span>` : `<span class="th scene s-${esc(s.scene)}"></span>`;
    const tag = changed.has(s.id) ? '<span class="tag">바뀜</span>' : '';
    return `<tr data-i="${i}"><td>${thumb}</td><td><span class="sw" style="background:${esc(s.color)}"></span>${esc(s.name)}${tag}</td><td>${esc(cat)}</td><td>${esc(s.file)}</td><td>${intText(s)}</td><td>${s.volume ?? 60}%</td></tr>`;
  }).join('');
  $('#dl').innerHTML = pending.map((p) => `<a href="${URL.createObjectURL(p.blob)}" download="${esc(p.name.split('/').pop())}">⬇ ${esc(p.name)}</a>`).join('') || '<p>새로 올릴 오디오·사진 파일이 없어요.</p>';
}
$('#list').addEventListener('click', (e) => { const tr = e.target.closest('[data-i]'); if (tr) openEditor(+tr.dataset.i); });
$('#add').addEventListener('click', () => openEditor(null));
$('#dlm').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(manifest, null, 2) + '\n'], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'manifest.json';
  a.click();
});
function msg(t) { $('#msg').textContent = t; }
function dmsg(t) { $('#dmsg').textContent = t; }
function clampN(v, a, b, d) { v = Math.round(+v); return Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; }

// ---------------------------------------------------------------- audio helpers
let actx = null;
const ctx = () => (actx ||= new (window.AudioContext || window.webkitAudioContext)());
async function decode(src) {
  const data = typeof src === 'string' ? await (await fetch(src)).arrayBuffer() : await src.arrayBuffer();
  return ctx().decodeAudioData(data);
}
// loudness of the audible parts (50 ms blocks above -50 dBFS), in dBFS
function loudness(buf) {
  const sr = buf.sampleRate, n = Math.floor(sr * 0.05), chs = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
  let sum = 0, cnt = 0;
  for (let i = 0; i + n <= buf.length; i += n) {
    let e = 0;
    for (const ch of chs) for (let j = i; j < i + n; j++) e += ch[j] * ch[j];
    e /= n * chs.length;
    if (e > 1e-5) { sum += e; cnt++; }
  }
  return cnt ? 10 * Math.log10(sum / cnt) : -99;
}
function peak(buf) {
  let p = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) { const ch = buf.getChannelData(c); for (let i = 0; i < ch.length; i++) { const v = Math.abs(ch[i]); if (v > p) p = v; } }
  return p;
}
const softclip = (v) => { const a = Math.abs(v); return a <= 0.9 ? v : Math.sign(v) * (0.9 + 0.1 * Math.tanh((a - 0.9) / 0.1)); };
function makeBuffer(chans, sr) {
  const b = ctx().createBuffer(chans.length, chans[0].length, sr);
  chans.forEach((d, c) => b.copyToChannel(d, c));
  return b;
}
function withGain(buf, db) {
  const g = 10 ** (db / 20), out = [];
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const x = buf.getChannelData(c), y = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) y[i] = softclip(x[i] * g);
    out.push(y);
  }
  return makeBuffer(out, buf.sampleRate);
}
// last `xfade` seconds blended into the first ones (equal-power crossfade)
function crossfadeLoop(buf, xfade) {
  const n = buf.length, k = Math.min(Math.floor(xfade * buf.sampleRate), Math.floor(n / 3)), out = [];
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const x = buf.getChannelData(c), y = new Float32Array(n - k);
    for (let i = 0; i < k; i++) { const t = (i + 0.5) / k; y[i] = softclip(x[n - k + i] * Math.cos(t * Math.PI / 2) + x[i] * Math.sin(t * Math.PI / 2)); }
    y.set(x.subarray(k, n - k), k);
    out.push(y);
  }
  return makeBuffer(out, buf.sampleRate);
}
// same loop points as js/engine.js startLoop()
function loopPoints(buf) { const pad = Math.min(0.03, buf.duration / 20); return { start: pad, end: buf.duration - pad }; }

let lameReady = null;
function loadLame() {
  lameReady ||= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'vendor/lame.min.js';
    s.onload = () => ok(window.lamejs);
    s.onerror = () => { lameReady = null; fail(new Error('lame')); };
    document.head.append(s);
  });
  return lameReady;
}
async function encodeMp3(buf, onProgress) {
  const lamejs = await loadLame();
  const ch = Math.min(2, buf.numberOfChannels);
  const enc = new lamejs.Mp3Encoder(ch, buf.sampleRate, ch === 2 ? 160 : 112);
  const toI16 = (f) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); o[i] = v < 0 ? v * 0x8000 : v * 0x7fff; } return o; };
  const L = toI16(buf.getChannelData(0)), R = ch === 2 ? toI16(buf.getChannelData(1)) : null;
  const parts = [], step = 1152 * 40;
  for (let i = 0; i < L.length; i += step) {
    const m = R ? enc.encodeBuffer(L.subarray(i, i + step), R.subarray(i, i + step)) : enc.encodeBuffer(L.subarray(i, i + step));
    if (m.length) parts.push(new Uint8Array(m));
    onProgress?.(i / L.length);
    await new Promise((r) => setTimeout(r));
  }
  const end = enc.flush();
  if (end.length) parts.push(new Uint8Array(end));
  return new Blob(parts, { type: 'audio/mpeg' });
}

// average loudness of the built-in sounds (measured once in the background)
async function measureLibrary() {
  for (const s of manifest.sounds) {
    if (loud.has(s.file)) continue;
    try { loud.set(s.file, loudness(await decode(`sounds/${s.file}`))); } catch { /* skip */ }
  }
  if (ed) showLoudness();
}
function libraryAverage() {
  const skip = ed?.index != null ? manifest.sounds[ed.index].file : null;
  const v = [...loud.entries()].filter(([f]) => f !== skip).map(([, d]) => d);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// ---------------------------------------------------------------- one player for every preview
let pl = null;
function stopPlay() {
  if (!pl) return;
  try { pl.src.stop(); } catch { /* already stopped */ }
  cancelAnimationFrame(pl.raf);
  pl.head?.classList.remove('on');
  pl.btn.textContent = pl.label;
  pl = null;
}
// play buf from `from` for `dur` seconds (looping across the seam if `loop`), moving `head` along `width`
function play(buf, { from = 0, dur = buf.duration, loop = false, db = 0, btn, head }) {
  stopPlay();
  ctx().resume();
  const c = ctx(), src = c.createBufferSource(), g = c.createGain();
  src.buffer = buf;
  if (loop) { const lp = loopPoints(buf); src.loop = true; src.loopStart = lp.start; src.loopEnd = lp.end; }
  const t0 = c.currentTime + 0.05, gain = 10 ** (db / 20);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.06);
  g.gain.setValueAtTime(gain, t0 + dur - 0.06);
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  src.connect(g).connect(c.destination);
  src.start(t0, from);
  src.stop(t0 + dur + 0.02);
  pl = { src, btn, head, label: btn.textContent, raf: 0 };
  btn.textContent = '■ 멈추기';
  head?.classList.add('on');
  const me = pl;
  const tick = () => {
    const p = Math.min(1, Math.max(0, (c.currentTime - t0) / dur));
    if (head) head.style.left = `${(head.dataset.base ? +head.dataset.base : 0) + p * (head.dataset.span ? +head.dataset.span : 100)}%`;
    if (p < 1 && pl === me) me.raf = requestAnimationFrame(tick);
  };
  tick();
  src.onended = () => { if (pl === me) stopPlay(); };
}

function drawWave(cv, getSample, total, marks = []) {
  const w = cv.width = cv.clientWidth * devicePixelRatio, h = cv.height = cv.clientHeight * devicePixelRatio, g = cv.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#5ee1c6';
  for (let x = 0; x < w; x++) {
    const i0 = Math.floor(x / w * total), i1 = Math.max(i0 + 1, Math.floor((x + 1) / w * total));
    let lo = 0, hi = 0;
    for (let i = i0; i < i1; i += Math.max(1, Math.floor((i1 - i0) / 200))) { const v = getSample(i); if (v < lo) lo = v; if (v > hi) hi = v; }
    g.fillRect(x, (1 - Math.min(1, hi)) * h / 2, 1, Math.max(1, (Math.min(1, hi) - Math.max(-1, lo)) * h / 2));
  }
  g.fillStyle = '#ff8a8a';
  marks.forEach((m) => g.fillRect(m * w - devicePixelRatio, 0, devicePixelRatio * 2, h));
}

// ---------------------------------------------------------------- editor modal
let ed = null; // { index, orig: AudioBuffer|null, buf: AudioBuffer|null, edits: [], audioFile: File|null, imageFile: File|null }

function openEditor(index) {
  const s = index == null ? { name: '', category: manifest.categories[0]?.id, scene: 'mine', color: '#5ee1c6', interval: 'loop', min: 10, max: 60, value: 60, volume: 60 } : manifest.sounds[index];
  ed = { index, orig: null, buf: null, edits: [], audioFile: null, imageFile: null, dirty: false };
  $('#dlg-title').textContent = index == null ? '새 음원 추가' : '음원 수정';
  $('#delete').hidden = index == null;
  $('#f-name').value = s.name;
  renderCats(s.category);
  $('#f-newcat').value = '';
  $('#f-color').value = s.color || '#5ee1c6';
  $('#f-scene').value = s.scene || 'mine';
  $('#f-int').value = s.interval || 'loop';
  $('#f-min').value = s.min ?? 10;
  $('#f-max').value = s.max ?? 60;
  $('#f-val').value = s.value ?? s.max ?? 60;
  $('#f-vol').value = s.volume ?? 60;
  $('#f-audio').value = '';
  $('#f-image').value = '';
  $('#f-audio-now').textContent = index == null ? '' : `(지금: ${s.file})`;
  $('#f-image-now').textContent = s.image ? `(지금: ${s.image.split('/').pop()})` : '';
  $('#v-db').value = 0; $('#v-dbv').textContent = '0 dB'; $('#v-warn').textContent = '';
  $('#lc-wv').hidden = true; $('#lc-info').textContent = '';
  dmsg('');
  syncInterval();
  preview();
  $('#ov').hidden = false;
  document.body.classList.add('lock');
  if (index != null) loadAudio(pendingBlob(s.file) || `sounds/${s.file}`);
  else showTools();
}
function closeEditor() {
  if (ed?.dirty && !confirm('바꾼 내용을 저장하지 않고 닫을까요?')) return;
  stopPlay();
  ed = null;
  $('#ov').hidden = true;
  document.body.classList.remove('lock');
}
$('#close').addEventListener('click', closeEditor);
$('#cancel').addEventListener('click', closeEditor);
$('#ov').addEventListener('click', (e) => { if (e.target.id === 'ov') closeEditor(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ed) closeEditor(); });
$('#ov').addEventListener('input', (e) => { if (ed && e.target.matches('input,select')) ed.dirty = true; });

function syncInterval() {
  const m = $('#f-int').value;
  $('#int-range').hidden = m !== 'range';
  $('#int-fixed').hidden = m !== 'fixed';
}
$('#f-int').addEventListener('change', syncInterval);

function preview() {
  if (!ed) return;
  const s = ed.index == null ? null : manifest.sounds[ed.index];
  const img = ed.imageFile ? URL.createObjectURL(ed.imageFile) : s?.image ? imageURL(s) : null;
  const name = $('#f-name').value || '미리보기';
  $('#pv').innerHTML = (img ? `<img src="${esc(img)}" alt="">` : `<div class="art scene s-${esc($('#f-scene').value)}"></div>`) + `<span>${esc(name)}</span>`;
}
['#f-name', '#f-scene'].forEach((s) => $(s).addEventListener('input', preview));
$('#f-image').addEventListener('change', () => { ed.imageFile = $('#f-image').files[0] || null; preview(); });
$('#f-audio').addEventListener('change', () => {
  const f = $('#f-audio').files[0];
  if (!f) return;
  ed.audioFile = f;
  ed.edits = [];
  loadAudio(f);
});

async function loadAudio(src) {
  showTools('불러오는 중…');
  try {
    const b = await decode(src);
    if (!ed) return;
    ed.orig = b; ed.buf = b;
    showTools();
  } catch {
    showTools('이 파일은 재생할 수 없는 형식이에요.');
  }
}
function showTools(state) {
  const has = !!ed?.buf;
  $('#tools').querySelectorAll('button,input').forEach((el) => { el.disabled = !has; });
  $('#t-reset').hidden = !ed?.edits.length;
  $('#t-state').textContent = state ?? (ed?.edits.length ? `편집됨: ${ed.edits.join(' → ')} (저장할 때 새 MP3로 만들어져요)` : '');
  if (!has) { $('#t-len').textContent = ''; $('#v-now').textContent = '-'; drawWave($('#wv-all'), () => 0, 1); return; }
  const b = ed.buf, ch = b.getChannelData(0);
  $('#t-len').textContent = `${b.duration.toFixed(1)}초`;
  drawWave($('#wv-all'), (i) => ch[i] || 0, b.length);
  showLoudness();
}
function showLoudness() {
  if (!ed?.buf) return;
  ed.loud ??= new Map();
  if (!ed.loud.has(ed.buf)) ed.loud.set(ed.buf, loudness(ed.buf));
  const now = ed.loud.get(ed.buf), avg = libraryAverage();
  $('#v-now').textContent = `${now.toFixed(1)} dB`;
  $('#v-avg').textContent = avg == null ? '계산 중…' : `${avg.toFixed(1)} dB`;
  updateGainWarn();
}
function updateGainWarn() {
  const db = +$('#v-db').value;
  $('#v-dbv').textContent = `${db > 0 ? '+' : ''}${db} dB`;
  if (!ed?.buf) return;
  ed.peak ??= new Map();
  if (!ed.peak.has(ed.buf)) ed.peak.set(ed.buf, peak(ed.buf));
  const over = ed.peak.get(ed.buf) * 10 ** (db / 20);
  $('#v-warn').textContent = over > 1 ? '가장 큰 부분이 한계를 넘어서 살짝 눌러 담아요' : '';
}
$('#v-db').addEventListener('input', updateGainWarn);
$('#v-match').addEventListener('click', () => {
  const avg = libraryAverage();
  if (avg == null || !ed?.buf) return;
  const d = Math.round((avg - ed.loud.get(ed.buf)) * 2) / 2;
  $('#v-db').value = Math.max(-18, Math.min(18, d));
  updateGainWarn();
});
$('#v-prev').addEventListener('click', () => {
  if (pl?.btn === $('#v-prev')) return stopPlay();
  if (!ed?.buf) return;
  const b = ed.buf;
  $('#wv-all-head').dataset.span = (Math.min(8, b.duration) / b.duration) * 100;
  play(b, { dur: Math.min(8, b.duration), db: +$('#v-db').value, btn: $('#v-prev'), head: $('#wv-all-head') });
});
$('#v-apply').addEventListener('click', () => {
  const db = +$('#v-db').value;
  if (!ed?.buf || !db) return;
  stopPlay();
  ed.buf = withGain(ed.buf, db);
  ed.edits.push(`볼륨 ${db > 0 ? '+' : ''}${db}dB`);
  ed.dirty = true;
  $('#v-db').value = 0;
  showTools();
});
$('#t-play').addEventListener('click', () => {
  if (pl?.btn === $('#t-play')) return stopPlay();
  if (!ed?.buf) return;
  $('#wv-all-head').dataset.span = 100;
  play(ed.buf, { btn: $('#t-play'), head: $('#wv-all-head') });
});
$('#t-reset').addEventListener('click', () => {
  stopPlay();
  ed.buf = ed.orig; ed.edits = [];
  $('#lc-wv').hidden = true; $('#lc-info').textContent = '';
  showTools();
});

// seam: last 3 s straight into the first 3 s, with the app's own loop points
function seamHint(buf) {
  const { start, end } = loopPoints(buf);
  const ch = buf.getChannelData(0), sr = buf.sampleRate, n = Math.floor(0.25 * sr);
  const rms = (from) => { let s = 0; for (let i = 0; i < n; i++) { const v = ch[from + i] || 0; s += v * v; } return Math.sqrt(s / n) + 1e-9; };
  const before = rms(Math.floor(end * sr) - n), after = rms(Math.floor(start * sr));
  const db = Math.abs(20 * Math.log10(after / before));
  if (before < 1e-4 && after < 1e-4) return '이음새 양쪽이 거의 무음이에요.';
  if (db < 2.5) return `이음새 앞뒤 크기 차이 ${db.toFixed(1)}dB: 자연스럽게 이어져요.`;
  if (db < 5) return `이음새 앞뒤 크기 차이 ${db.toFixed(1)}dB: 조금 차이가 나요.`;
  return `이음새 앞뒤 크기 차이 ${db.toFixed(1)}dB: 반복될 때 티가 날 수 있어요.`;
}
function playSeam() {
  const b = ed.buf, { start, end } = loopPoints(b), span = Math.min(SPAN, (end - start) / 2);
  const ch = b.getChannelData(0), sr = b.sampleRate;
  const a0 = Math.floor((end - span) * sr), a1 = Math.floor(end * sr), b0 = Math.floor(start * sr), b1 = Math.floor((start + span) * sr);
  $('#lc-wv').hidden = false;
  drawWave($('#lc-wave'), (i) => (i < a1 - a0 ? ch[a0 + i] : ch[b0 + i - (a1 - a0)]) || 0, (a1 - a0) + (b1 - b0), [0.5]);
  $('#lc-info').textContent = seamHint(b);
  $('#lc-head').dataset.span = 100;
  play(b, { from: end - span, dur: span * 2, loop: true, btn: $('#lc-play'), head: $('#lc-head') });
}
$('#lc-play').addEventListener('click', () => { if (pl?.btn === $('#lc-play')) stopPlay(); else if (ed?.buf) playSeam(); });
$('#lc-xf').addEventListener('input', (e) => { $('#lc-xfv').textContent = `${(+e.target.value).toFixed(1)}초`; });
$('#lc-make').addEventListener('click', () => {
  if (!ed?.buf) return;
  stopPlay();
  const xf = +$('#lc-xf').value;
  ed.buf = crossfadeLoop(ed.buf, xf);
  ed.edits.push(`매끄럽게 ${xf}초`);
  ed.dirty = true;
  showTools();
  playSeam();
});

// ---------------------------------------------------------------- save / delete
$('#save').addEventListener('click', async () => {
  const name = $('#f-name').value.trim();
  if (!name) return dmsg('이름을 넣어 주세요');
  if (ed.index == null && !ed.audioFile) return dmsg('오디오 파일을 골라 주세요');
  if (ed.audioFile && !ed.buf) return dmsg('오디오 파일을 불러오는 중이에요');
  stopPlay();
  const btn = $('#save');
  btn.disabled = true;
  try {
    const s = ed.index == null ? { id: 's' + Date.now().toString(36) } : { ...manifest.sounds[ed.index] };
    let cat = $('#f-cat').value;
    const newCat = $('#f-newcat').value.trim();
    if (newCat) {
      const found = manifest.categories.find((c) => c.name === newCat);
      cat = found ? found.id : 'cat' + Date.now().toString(36);
      if (!found) manifest.categories.push({ id: cat, name: newCat });
    }
    Object.assign(s, { name, category: cat, scene: $('#f-scene').value, color: $('#f-color').value, interval: $('#f-int').value, volume: clampN($('#f-vol').value, 1, 100, 60) });
    delete s.min; delete s.max; delete s.value;
    if (s.interval === 'range') { const a = clampN($('#f-min').value, 1, 1800, 10), b = clampN($('#f-max').value, 1, 1800, 60); s.min = Math.min(a, b); s.max = Math.max(a, b); }
    if (s.interval === 'fixed') s.value = clampN($('#f-val').value, 1, 1800, 60);

    // audio: edited -> new MP3; new upload -> the file as is
    let audio = null, ext = null;
    if (ed.edits.length) {
      audio = await encodeMp3(ed.buf, (p) => { btn.textContent = `MP3 만드는 중… ${Math.round(p * 100)}%`; });
      ext = '.mp3';
    } else if (ed.audioFile) {
      audio = ed.audioFile;
      ext = (ed.audioFile.name.match(/\.[a-z0-9]+$/i) || ['.mp3'])[0].toLowerCase();
    }
    if (audio) {
      const base = s.file ? s.file.replace(/\.[a-z0-9]+$/i, '') : s.id;
      s.file = base + ext;
      queue(s.file, audio);
      loud.set(s.file, loudness(ed.buf));
    }
    if (ed.imageFile) {
      const iext = (ed.imageFile.name.match(/\.[a-z0-9]+$/i) || ['.jpg'])[0].toLowerCase();
      s.image = `images/${s.id}${iext}`;
      queue(s.image, ed.imageFile);
    }
    if (ed.index == null) manifest.sounds.push(s); else manifest.sounds[ed.index] = s;
    changed.add(s.id);
    ed.dirty = false;
    closeEditor();
    renderList();
    msg(`"${name}" 저장했어요. 아래에서 파일을 내려받아 올려 주세요.`);
  } catch (e) {
    dmsg(e.message === 'lame' ? 'MP3 변환 도구를 불러오지 못했어요. 새로고침 후 다시 해 주세요.' : '저장 중 문제가 생겼어요.');
  } finally {
    btn.disabled = false;
    btn.textContent = '저장';
  }
});
function queue(name, blob) {
  const i = pending.findIndex((p) => p.name === name);
  if (i >= 0) pending.splice(i, 1);
  pending.push({ name, blob });
}
$('#delete').addEventListener('click', () => {
  const s = manifest.sounds[ed.index];
  if (!confirm(`"${s.name}"을(를) 목록에서 뺄까요? (manifest.json을 올려야 반영돼요)`)) return;
  manifest.sounds.splice(ed.index, 1);
  ed.dirty = false;
  closeEditor();
  renderList();
  msg(`"${s.name}"을(를) 뺐어요. manifest.json을 내려받아 올려 주세요.`);
});

load();
