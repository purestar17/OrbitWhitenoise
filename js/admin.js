// Admin page: edit sounds/manifest.json in the browser and download the result.
// Each sound opens in a modal: details, plus audio tools (volume change, seamless loop).
// Edited audio is encoded to MP3 in the browser with LAME (vendor/lame.min.js, LGPL).
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
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
// category dropdown: a list of its own so "+ 새 분류 추가" can turn into a text box inside it
const allCats = () => [...manifest.categories, ...(ed?.newCats || [])];
function renderCats(sel) {
  if (sel !== undefined) ed.cat = sel;
  const cats = allCats();
  if (!cats.some((c) => c.id === ed.cat)) ed.cat = cats[0]?.id;
  $('#f-cat .dd-btn span').textContent = cats.find((c) => c.id === ed.cat)?.name || '분류 고르기';
  $('#f-cat .dd-list').innerHTML = cats.map((c) => `<li role="option" data-cat="${esc(c.id)}"${c.id === ed.cat ? ' class="on" aria-selected="true"' : ''}>${esc(c.name)}</li>`).join('')
    + '<li class="add" data-add>+ 새 분류 추가</li>';
}
function openCats(open) {
  const list = $('#f-cat .dd-list');
  if (open === undefined) open = list.hidden;
  if (open) renderCats();
  list.hidden = !open;
  if (open) list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}
function newCatForm() {
  const li = $('#f-cat [data-add]');
  li.outerHTML = '<li class="form"><input id="f-newcat" placeholder="새 분류 이름 (예: 동물)" maxlength="20"><button type="button" class="pri" id="f-newcat-ok">추가</button></li><li class="err" id="f-newcat-err" hidden></li>';
  $('#f-newcat').focus();
}
function addCat() {
  const name = $('#f-newcat').value.trim();
  const err = (t) => { $('#f-newcat-err').textContent = t; $('#f-newcat-err').hidden = false; $('#f-newcat').focus(); };
  if (!name) return err('이름을 넣어 주세요');
  const found = allCats().find((c) => c.name === name);
  if (found) ed.cat = found.id;
  else { const c = { id: 'cat' + Date.now().toString(36), name }; (ed.newCats ||= []).push(c); ed.cat = c.id; }
  ed.dirty = true;
  renderCats();
  openCats(false);
}
$('#f-cat .dd-btn').addEventListener('click', () => openCats());
$('#f-cat .dd-list').addEventListener('click', (e) => {
  e.stopPropagation();
  const li = e.target.closest('li');
  if (!li) return;
  if (li.dataset.cat) { if (ed.cat !== li.dataset.cat) ed.dirty = true; ed.cat = li.dataset.cat; renderCats(); openCats(false); }
  else if ('add' in li.dataset) newCatForm();
  else if (e.target.id === 'f-newcat-ok') addCat();
});
$('#f-cat .dd-list').addEventListener('keydown', (e) => {
  if (e.target.id !== 'f-newcat') return;
  if (e.key === 'Enter') { e.preventDefault(); addCat(); }
  if (e.key === 'Escape') { e.stopPropagation(); renderCats(); }
});
document.addEventListener('click', (e) => { if (!e.target.closest('#f-cat')) $('#f-cat .dd-list').hidden = true; });
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
    const tag = (s.video ? '<span class="tag">영상</span>' : '') + (changed.has(s.id) ? '<span class="tag">수정됨</span>' : '');
    return `<tr data-i="${i}"><td>${thumb}</td><td><span class="sw" style="background:${esc(s.color)}"></span>${esc(s.name)}${tag}</td><td>${esc(cat)}</td><td>${esc(s.file)}</td><td>${intText(s)}</td><td>${s.volume ?? 60}%</td></tr>`;
  }).join('');
  if (typeof ghStatus === 'function') queueMicrotask(ghStatus);
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
// keep a..b seconds, fading in over `fin` and out over `fout` seconds (smooth S-curve)
function trimFade(buf, a, b, fin, fout) {
  const sr = buf.sampleRate, i0 = Math.max(0, Math.floor(a * sr)), i1 = Math.min(buf.length, Math.floor(b * sr)), n = i1 - i0;
  const ni = Math.min(Math.floor(fin * sr), n), no = Math.min(Math.floor(fout * sr), n), out = [];
  const curve = (t) => Math.sin(t * Math.PI / 2) ** 2;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const y = buf.getChannelData(c).slice(i0, i1);
    for (let i = 0; i < ni; i++) y[i] *= curve(i / ni);
    for (let i = 0; i < no; i++) y[n - 1 - i] *= curve(i / no);
    out.push(y);
  }
  return makeBuffer(out, sr);
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
let ed = null; // { index, orig, buf, edits, audioFile, imageFile, videoFile, posterBlob, previewBlob, clearMedia }

function openEditor(index) {
  const s = index == null ? { name: '', category: manifest.categories[0]?.id, scene: 'mine', color: '#5ee1c6', interval: 'loop', min: 10, max: 60, value: 60, volume: 60 } : manifest.sounds[index];
  ed = { index, orig: null, buf: null, edits: [], audioFile: null, imageFile: null, videoFile: null, posterBlob: null, previewBlob: null, previewJob: null, clearMedia: false, dirty: false };
  $('#f-focus').value = s.focus ?? 50;
  $('#dlg-title').textContent = index == null ? '새 음원 추가' : '음원 수정';
  $('#delete').hidden = index == null;
  $('#f-name').value = s.name;
  renderCats(s.category);
  openCats(false);
  $('#f-color').value = s.color || '#5ee1c6';
  $('#f-scene').value = s.scene || 'mine';
  $('#f-int').value = s.interval || 'loop';
  $('#f-min').value = s.min ?? 10;
  $('#f-max').value = s.max ?? 60;
  $('#f-val').value = s.value ?? s.max ?? 60;
  $('#f-vol').value = s.volume ?? 60;
  $('#f-audio').value = '';
  $('#f-image').value = '';
  $('#v-db').value = 0; $('#v-dbv').textContent = '0 dB'; $('#v-warn').textContent = '';
  $('#lc-wv').hidden = true; $('#lc-info').textContent = '';
  $('#tr-fx').hidden = true;
  dmsg('');
  syncInterval();
  preview();
  $('#ov').hidden = false;
  document.body.classList.add('lock');
  if (index != null) {
    const me = ed;
    showTools('불러오는 중…');
    fileFor(s.file, 'sounds/' + s.file).then((f) => {
      if (ed !== me) return;
      setPicker('#f-audio', f);
      loadAudio(f);
    }).catch(() => loadAudio(`sounds/${s.file}`));
    const m = s.video || s.image;
    if (m) fileFor(m, 'sounds/' + m).then((f) => { if (ed === me) setPicker('#f-image', f); }).catch(() => {});
  } else showTools();
}
// the sound's current file as a File, so the file picker shows it as chosen
async function fileFor(name, url) {
  const blob = pendingBlob(name) || await (await fetch(url)).blob();
  return new File([blob], name.split('/').pop(), { type: blob.type });
}
function setPicker(sel, file) {
  try { const dt = new DataTransfer(); dt.items.add(file); $(sel).files = dt.files; } catch { /* older browsers: picker stays empty */ }
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
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !ed) return;
  if (!$('#f-cat .dd-list').hidden) return openCats(false);
  closeEditor();
});
$('#ov').addEventListener('input', (e) => { if (ed && e.target.matches('input,select')) ed.dirty = true; });

function syncInterval() {
  const m = $('#f-int').value;
  $('#int-range').hidden = m !== 'range';
  $('#int-fixed').hidden = m !== 'fixed';
}
$('#f-int').addEventListener('change', syncInterval);

// the sound's picture as it is now in the editor: { video?, image? } urls, or null
const urls = new Map();
const urlOf = (b) => { if (!urls.has(b)) urls.set(b, URL.createObjectURL(b)); return urls.get(b); };
function currentMedia() {
  if (!ed || ed.clearMedia) return null;
  if (ed.videoFile) return { video: urlOf(ed.videoFile), image: ed.posterBlob && urlOf(ed.posterBlob) };
  if (ed.imageFile) return { image: urlOf(ed.imageFile) };
  const s = ed.index == null ? null : manifest.sounds[ed.index];
  if (!s) return null;
  const u = (f) => (f ? (pendingBlob(f) ? urlOf(pendingBlob(f)) : `sounds/${f}`) : null);
  return s.video || s.image ? { video: u(s.video), image: u(s.image) } : null;
}
const mediaHTML = (m) => (m.video ? `<video src="${esc(m.video)}"${m.image ? ` poster="${esc(m.image)}"` : ''} muted loop autoplay playsinline></video>` : `<img src="${esc(m.image)}" alt="">`);
function preview() {
  if (!ed) return;
  const m = currentMedia();
  const name = $('#f-name').value || '미리보기';
  $('#pv').innerHTML = (m ? mediaHTML(m) + '<i class="fwin"></i>' : `<div class="art scene s-${esc($('#f-scene').value)}"></div>`) + `<span>${esc(name)}</span>`;
  $('#pv').classList.toggle('has-media', !!m);
  $('#pv-hint').hidden = !m;
  $('#media-row').hidden = !m;
  if (m) { const el = $('#pv img, #pv video'); el.addEventListener(el.tagName === 'VIDEO' ? 'loadedmetadata' : 'load', showFocus); showFocus(); }
}
// mix screen is about 9:16; show which part of the picture it keeps
const MIX_ASPECT = 9 / 16;
function showFocus() {
  const pv = $('#pv'), el = $('#pv img, #pv video'), win = $('#pv .fwin');
  if (!el || !win) return;
  const nw = el.videoWidth || el.naturalWidth, nh = el.videoHeight || el.naturalHeight;
  if (!nw || !nh) return;
  const W = pv.clientWidth, Hc = pv.clientHeight, A = nw / nh;
  // while focusing the whole picture is shown (contain): its box inside the card
  const mw = A >= W / Hc ? W : Hc * A, mh = mw / A, mx = (W - mw) / 2, my = (Hc - mh) / 2;
  const frac = Math.min(1, MIX_ASPECT / A), f = +$('#f-focus').value / 100;
  Object.assign(win.style, { left: `${mx + f * (1 - frac) * mw}px`, top: `${my}px`, width: `${frac * mw}px`, height: `${mh}px` });
  el.style.objectPosition = pv.classList.contains('focusing') ? '' : '50% 50%';
}
let fdrag = null;
$('#pv').addEventListener('pointerdown', (e) => {
  if (!$('#pv').classList.contains('has-media')) return;
  e.preventDefault();
  $('#pv').setPointerCapture(e.pointerId);
  $('#pv').classList.add('focusing');
  fdrag = e.pointerId;
  $('#pv-hint').textContent = '믹스 화면';
  moveFocus(e);
});
function moveFocus(e) {
  const pv = $('#pv'), el = $('#pv img, #pv video'), win = $('#pv .fwin');
  const nw = el?.videoWidth || el?.naturalWidth, nh = el?.videoHeight || el?.naturalHeight;
  if (!nw) return;
  const r = pv.getBoundingClientRect(), A = nw / nh;
  const mw = A >= r.width / r.height ? r.width : r.height * A, mx = (r.width - mw) / 2;
  const frac = Math.min(1, MIX_ASPECT / A);
  if (frac >= 1) return;
  const f = (e.clientX - r.left - mx - (frac * mw) / 2) / ((1 - frac) * mw);
  $('#f-focus').value = Math.round(Math.max(0, Math.min(1, f)) * 100);
  if (ed) ed.dirty = true;
  showFocus();
}
$('#pv').addEventListener('pointermove', (e) => { if (fdrag === e.pointerId) moveFocus(e); });
const endFocus = (e) => {
  if (fdrag !== e.pointerId) return;
  fdrag = null;
  setTimeout(() => { if (fdrag == null) { $('#pv').classList.remove('focusing'); $('#pv-hint').textContent = '누르고 좌우로 끌면 믹스 화면 위치'; showFocus(); } }, 500);
};
$('#pv').addEventListener('pointerup', endFocus);
$('#pv').addEventListener('pointercancel', endFocus);
['#f-name', '#f-scene'].forEach((s) => $(s).addEventListener('input', preview));
$('#f-image').addEventListener('change', () => {
  const f = $('#f-image').files[0];
  if (!f) return;
  ed.clearMedia = false;
  if (f.type.startsWith('video/')) {
    ed.videoFile = f; ed.imageFile = null; ed.posterBlob = null; ed.previewBlob = null;
    prepareVideo(f);
  } else {
    ed.imageFile = f; ed.videoFile = null; ed.posterBlob = null; ed.previewBlob = null; ed.previewJob = null;
    $('#media-state').textContent = '';
  }
  preview();
});
$('#f-media-clear').addEventListener('click', () => {
  ed.clearMedia = true; ed.videoFile = null; ed.imageFile = null; ed.previewJob = null; ed.dirty = true;
  $('#f-image').value = '';
  preview();
});

// ---------------------------------------------------------------- video: poster image + small preview clip
function openVideo(file) {
  return new Promise((ok, fail) => {
    const v = document.createElement('video');
    Object.assign(v, { muted: true, playsInline: true, preload: 'auto', src: URL.createObjectURL(file) });
    v.onloadeddata = () => ok(v);
    v.onerror = () => fail(new Error('video'));
  });
}
const seek = (v, t) => new Promise((ok) => { v.onseeked = () => ok(); v.currentTime = t; });
async function posterFrom(v) {
  await seek(v, 0);
  const W = Math.min(960, v.videoWidth), H = Math.round(W * v.videoHeight / v.videoWidth);
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  c.getContext('2d').drawImage(v, 0, 0, W, H);
  return new Promise((ok) => c.toBlob(ok, 'image/webp', 0.82));
}
let muxReady = null;
function loadMuxer() {
  muxReady ||= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'vendor/mp4-muxer.js';
    s.onload = () => ok(window.Mp4Muxer);
    s.onerror = () => { muxReady = null; fail(new Error('mux')); };
    document.head.append(s);
  });
  return muxReady;
}
// 480px-wide H.264 MP4 for the library card (only where the browser can encode H.264)
async function previewFrom(v, onProgress, alive) {
  if (!('VideoEncoder' in window)) return null;
  const W = 480, H = Math.round(W * v.videoHeight / v.videoWidth / 2) * 2, fps = 24;
  const codecs = window.__previewCodecs || [['avc1.42001f', 'avc']];
  let pick = null;
  for (const [codec, mux] of codecs) {
    try { if ((await VideoEncoder.isConfigSupported({ codec, width: W, height: H, bitrate: 350_000, framerate: fps })).supported) { pick = { codec, mux }; break; } } catch { /* next */ }
  }
  if (!pick) return null;
  const { Muxer, ArrayBufferTarget } = await loadMuxer();
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: pick.mux, width: W, height: H }, fastStart: 'in-memory' });
  let err = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { err = e; } });
  enc.configure({ codec: pick.codec, width: W, height: H, bitrate: 350_000, framerate: fps });
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H }), g = c.getContext('2d');
  const n = Math.floor(Math.min(v.duration, 30) * fps);
  for (let i = 0; i < n; i++) {
    if (!alive() || err) { enc.close(); return null; }
    await seek(v, i / fps);
    g.drawImage(v, 0, 0, W, H);
    const frame = new VideoFrame(c, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
    enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
    onProgress(i / n);
  }
  await enc.flush();
  if (err) return null;
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}
function prepareVideo(file) {
  const me = ed, job = {};
  ed.previewJob = job;
  const mb = file.size / 1024 / 1024;
  const warn = mb > 25 ? ` · ${mb.toFixed(0)}MB라 꽤 커요 (10MB 안팎 추천)` : '';
  const state = (t) => { if (ed === me && me.previewJob === job) $('#media-state').textContent = t + warn; };
  state('영상에서 대표 이미지를 만드는 중…');
  job.done = (async () => {
    try {
      const v = await openVideo(file);
      me.posterBlob = await posterFrom(v);
      if (ed === me) preview();
      state('카드 미리보기 영상을 만드는 중…');
      me.previewBlob = await previewFrom(v, (p) => state(`카드 미리보기 영상을 만드는 중… ${Math.round(p * 100)}%`), () => ed === me && me.previewJob === job);
      URL.revokeObjectURL(v.src);
      state(me.previewBlob
        ? `준비됐어요 · 대표 이미지 ${(me.posterBlob.size / 1024).toFixed(0)}KB · 미리보기 영상 ${(me.previewBlob.size / 1024).toFixed(0)}KB`
        : '준비됐어요 · 이 브라우저에서는 미리보기 영상을 만들 수 없어 카드에도 원본 영상을 써요');
    } catch {
      me.videoFile = null;
      state('이 영상은 열 수 없어요. MP4(H.264) 파일을 올려 주세요.');
      if (ed === me) preview();
    }
  })();
}
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
  $('#tr-fx').disabled = false;
  $('#t-reset').hidden = !ed?.edits.length;
  $('#t-state').textContent = state ?? (ed?.edits.length ? `편집됨: ${ed.edits.join(' → ')} (저장할 때 새 MP3로 만들어져요)` : '');
  if (!has) { $('#t-len').textContent = ''; $('#v-now').textContent = '-'; drawWave($('#wv-all'), () => 0, 1); return; }
  const b = ed.buf, ch = b.getChannelData(0);
  $('#t-len').textContent = `${b.duration.toFixed(1)}초`;
  drawWave($('#wv-all'), (i) => ch[i] || 0, b.length);
  if (ed.selBuf !== b) { ed.selBuf = b; ed.sel = { a: 0, b: b.duration }; }
  showSel();
  showLoudness();
}

// ---------------------------------------------------------------- trim: pick a part on the waveform
const r1 = (v) => Math.round(v * 10) / 10;
function showSel() {
  const box = $('#tr-sel');
  if (!ed?.buf) { box.hidden = true; $('#tr-len').textContent = ''; return; }
  const d = ed.buf.duration, { a, b } = ed.sel, len = b - a;
  box.hidden = false;
  box.style.left = `${a / d * 100}%`;
  box.style.width = `${len / d * 100}%`;
  const fi = Math.min(+$('#tr-fi').value, len / 2), fo = Math.min(+$('#tr-fo').value, len / 2);
  $('#tr-fi-sh').style.width = `${fi / len * 100}%`;
  $('#tr-fo-sh').style.width = `${fo / len * 100}%`;
  if (document.activeElement !== $('#tr-a')) $('#tr-a').value = r1(a);
  if (document.activeElement !== $('#tr-b')) $('#tr-b').value = r1(b);
  $('#tr-a').max = $('#tr-b').max = r1(d);
  $('#tr-len').textContent = `고른 길이 ${len.toFixed(1)}초`;
  $('#tr-apply').disabled = len >= d - 0.05 && !(+$('#tr-fi').value || +$('#tr-fo').value);
}
function setSel(a, b) {
  const d = ed.buf.duration, MIN = 0.1;
  a = Math.max(0, Math.min(d - MIN, a)); b = Math.max(a + MIN, Math.min(d, b));
  ed.sel = { a, b };
  showSel();
}
let drag = null;
$('#wv-box').addEventListener('pointerdown', (e) => {
  if (!ed?.buf || e.button) return;
  const r = $('#wv-box').getBoundingClientRect(), d = ed.buf.duration, t = (e.clientX - r.left) / r.width * d;
  const px = (s) => Math.abs(e.clientX - (r.left + s / d * r.width));
  if (px(ed.sel.a) < 10) drag = { edge: 'a' };
  else if (px(ed.sel.b) < 10) drag = { edge: 'b' };
  else drag = { anchor: t, moved: false };
  $('#wv-box').setPointerCapture(e.pointerId);
});
$('#wv-box').addEventListener('pointermove', (e) => {
  if (!drag) {
    if (!ed?.buf) return;
    const r = $('#wv-box').getBoundingClientRect(), d = ed.buf.duration;
    const near = [ed.sel.a, ed.sel.b].some((s) => Math.abs(e.clientX - (r.left + s / d * r.width)) < 10);
    $('#wv-box').style.cursor = near ? 'ew-resize' : '';
    return;
  }
  const r = $('#wv-box').getBoundingClientRect(), d = ed.buf.duration;
  const t = Math.max(0, Math.min(d, (e.clientX - r.left) / r.width * d));
  if (drag.edge === 'a') setSel(t, ed.sel.b);
  else if (drag.edge === 'b') setSel(ed.sel.a, t);
  else { drag.moved = true; setSel(Math.min(drag.anchor, t), Math.max(drag.anchor, t)); }
});
$('#wv-box').addEventListener('pointerup', () => { drag = null; });
$('#wv-box').addEventListener('pointercancel', () => { drag = null; });
['#tr-a', '#tr-b'].forEach((id) => $(id).addEventListener('change', () => { if (ed?.buf) setSel(+$('#tr-a').value || 0, +$('#tr-b').value || ed.buf.duration); }));
['fi', 'fo'].forEach((k) => $(`#tr-${k}`).addEventListener('input', (e) => { $(`#tr-${k}v`).textContent = `${(+e.target.value).toFixed(1)}초`; if (ed?.buf) showSel(); }));
$('#tr-all').addEventListener('click', () => { if (ed?.buf) setSel(0, ed.buf.duration); });
const trimmed = () => trimFade(ed.buf, ed.sel.a, ed.sel.b, +$('#tr-fi').value, +$('#tr-fo').value);
$('#tr-play').addEventListener('click', () => {
  if (pl?.btn === $('#tr-play')) return stopPlay();
  if (!ed?.buf) return;
  const d = ed.buf.duration, head = $('#wv-all-head');
  head.dataset.base = ed.sel.a / d * 100;
  head.dataset.span = (ed.sel.b - ed.sel.a) / d * 100;
  play(trimmed(), { btn: $('#tr-play'), head });
});
$('#tr-apply').addEventListener('click', () => {
  if (!ed?.buf) return;
  stopPlay();
  const { a, b } = ed.sel, fi = +$('#tr-fi').value, fo = +$('#tr-fo').value;
  ed.buf = trimmed();
  ed.edits.push(`잘라내기 ${r1(a)}~${r1(b)}초${fi || fo ? ` (페이드 ${fi}·${fo}초)` : ''}`);
  ed.dirty = true;
  showTools();
  $('#tr-fx').hidden = $('#f-int').value !== 'loop';
});
$('#tr-fx').addEventListener('click', () => {
  $('#f-int').value = 'range';
  syncInterval();
  ed.dirty = true;
  $('#tr-fx').hidden = true;
  $('#f-min').focus();
});
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
  $('#wv-all-head').dataset.base = 0;
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
  $('#wv-all-head').dataset.base = 0;
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

// ---------------------------------------------------------------- fold the audio tools
const foldTools = (on) => {
  $('#tools').classList.toggle('folded', on);
  $('#tools-fold').setAttribute('aria-expanded', !on);
  try { localStorage.setItem('orbit-admin-tools-folded', on ? '1' : '0'); } catch { /* private mode */ }
};
$('#tools-fold').addEventListener('click', () => foldTools(!$('#tools').classList.contains('folded')));
try { if (localStorage.getItem('orbit-admin-tools-folded') === '1') foldTools(true); } catch { /* private mode */ }

// ---------------------------------------------------------------- save / delete
$('#save').addEventListener('click', async () => {
  const name = $('#f-name').value.trim();
  if (!name) return dmsg('이름을 넣어 주세요');
  if (ed.index == null && !ed.audioFile) return dmsg('오디오 파일을 골라 주세요');
  if (ed.audioFile && !ed.buf) return dmsg('오디오 파일을 불러오는 중이에요');
  stopPlay();
  const btn = $('#save');
  btn.disabled = true;
  btn.classList.add('busy');
  try {
    const s = ed.index == null ? { id: 's' + Date.now().toString(36) } : { ...manifest.sounds[ed.index] };
    const cat = ed.cat;
    const fresh = ed.newCats?.find((c) => c.id === cat);
    if (fresh) manifest.categories.push(fresh);
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
    if (ed.videoFile) {
      if (ed.previewJob?.done) { btn.textContent = '영상 준비 중…'; await ed.previewJob.done; }
      if (!ed.videoFile) throw new Error('video');
      const vext = (ed.videoFile.name.match(/\.[a-z0-9]+$/i) || ['.mp4'])[0].toLowerCase();
      s.video = `videos/${s.id}${vext === '.mov' ? '.mp4' : vext}`;
      queue(s.video, ed.videoFile);
      if (ed.posterBlob) { s.image = `images/${s.id}.webp`; queue(s.image, ed.posterBlob); } else delete s.image;
      if (ed.previewBlob) { s.preview = `videos/${s.id}-s.mp4`; queue(s.preview, ed.previewBlob); } else delete s.preview;
    } else if (ed.imageFile) {
      const iext = (ed.imageFile.name.match(/\.[a-z0-9]+$/i) || ['.jpg'])[0].toLowerCase();
      s.image = `images/${s.id}${iext}`;
      queue(s.image, ed.imageFile);
      delete s.video; delete s.preview;
    } else if (ed.clearMedia) {
      delete s.image; delete s.video; delete s.preview; delete s.focus;
    }
    if (s.image || s.video) s.focus = clampN($('#f-focus').value, 0, 100, 50);
    if (ed.index == null) manifest.sounds.push(s); else manifest.sounds[ed.index] = s;
    changed.add(s.id);
    ed.dirty = false;
    closeEditor();
    renderList();
    msg(`"${name}" 저장했어요. 아래 "GitHub에 바로 올리기"를 누르면 앱에 반영돼요.`);
  } catch (e) {
    dmsg(e.message === 'video' ? '영상을 열 수 없어요. 다른 파일을 골라 주세요.' : e.message === 'lame' ? 'MP3 변환 도구를 불러오지 못했어요. 새로고침 후 다시 해 주세요.' : '저장 중 문제가 생겼어요.');
  } finally {
    btn.disabled = false;
    btn.classList.remove('busy');
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
  if (!confirm(`"${s.name}"을(를) 목록에서 뺄까요? (GitHub에 올려야 반영돼요)`)) return;
  manifest.sounds.splice(ed.index, 1);
  manifestDirty = true;
  ed.dirty = false;
  closeEditor();
  renderList();
  msg(`"${s.name}"을(를) 뺐어요. "GitHub에 바로 올리기"를 누르면 반영돼요.`);
});

// ---------------------------------------------------------------- GitHub: commit everything in one go
const GH = {
  get token() { try { return localStorage.getItem('orbit-gh-token') || ''; } catch { return ''; } },
  get repo() { try { return localStorage.getItem('orbit-gh-repo') || 'purestar17/OrbitWhitenoise'; } catch { return 'purestar17/OrbitWhitenoise'; } },
};
async function gh(path, opt = {}, token = GH.token, repo = GH.repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...opt,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(opt.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!res.ok) { const e = new Error(`gh ${res.status}`); e.status = res.status; throw e; }
  return res.status === 204 ? null : res.json();
}
const b64 = (blob) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = fail; r.readAsDataURL(blob); });
function ghStatus() {
  $('#gh-set').textContent = GH.token ? '토큰 설정 ✓' : '토큰 설정';
  $('#gh-push').disabled = !(pending.length || changed.size || manifestDirty);
}
let manifestDirty = false;
$('#gh-set').addEventListener('click', () => {
  $('#gh-form').hidden = !$('#gh-form').hidden;
  $('#gh-repo').value = GH.repo;
  $('#gh-token').value = '';
  $('#gh-token').placeholder = GH.token ? '저장된 토큰이 있어요 (바꾸려면 새로 붙여 넣기)' : 'github_pat_로 시작하는 긴 글자';
});
$('#gh-save').addEventListener('click', async () => {
  const token = $('#gh-token').value.trim() || GH.token, repo = $('#gh-repo').value.trim();
  if (!token) return ($('#gh-msg').textContent = '토큰을 붙여 넣어 주세요');
  $('#gh-msg').textContent = '확인 중…';
  try {
    const r = await gh('', {}, token, repo);
    if (!r.permissions?.push) throw Object.assign(new Error('perm'), { status: 403 });
    localStorage.setItem('orbit-gh-token', token);
    localStorage.setItem('orbit-gh-repo', repo);
    $('#gh-msg').textContent = '저장했어요. 이제 바로 올릴 수 있어요.';
    $('#gh-token').value = '';
    setTimeout(() => { $('#gh-form').hidden = true; $('#gh-msg').textContent = ''; }, 1500);
  } catch (e) {
    $('#gh-msg').textContent = e.status === 401 ? '토큰이 맞지 않아요. 다시 복사해 주세요.' : e.status === 404 ? '저장소를 찾을 수 없어요. 저장소 이름과 토큰의 저장소 선택을 확인해 주세요.' : e.status === 403 ? '쓰기 권한이 없어요. Contents를 Read and write로 해 주세요.' : '확인하지 못했어요. 인터넷 연결을 확인해 주세요.';
  }
  ghStatus();
});
$('#gh-forget').addEventListener('click', () => {
  try { localStorage.removeItem('orbit-gh-token'); } catch { /* private mode */ }
  $('#gh-msg').textContent = '토큰을 지웠어요.';
  ghStatus();
});
$('#gh-push').addEventListener('click', async () => {
  if (!GH.token) { $('#gh-form').hidden = false; $('#gh-msg').textContent = '먼저 토큰을 설정해 주세요.'; return; }
  const btn = $('#gh-push'), state = (t) => { $('#gh-state').textContent = t; };
  btn.disabled = true; btn.classList.add('busy');
  try {
    const files = [...pending.map((p) => ({ path: `sounds/${p.name}`, blob: p.blob })),
      { path: 'sounds/manifest.json', blob: new Blob([JSON.stringify(manifest, null, 2) + '\n'], { type: 'application/json' }) }];
    const tree = [];
    for (const [i, f] of files.entries()) {
      state(`파일 올리는 중… ${i + 1}/${files.length}`);
      const blob = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: await b64(f.blob), encoding: 'base64' }) });
      tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    state('저장소에 기록하는 중…');
    const names = [...changed].map((id) => manifest.sounds.find((s) => s.id === id)?.name).filter(Boolean);
    const message = `관리자: ${names.length ? names.slice(0, 3).join(', ') + (names.length > 3 ? ` 외 ${names.length - 3}개` : '') + ' 수정' : '음원 목록 수정'}`;
    for (let attempt = 0; ; attempt++) {
      const ref = await gh('/git/ref/heads/main');
      const head = await gh(`/git/commits/${ref.object.sha}`);
      const t = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: head.tree.sha, tree }) });
      const c = await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: t.sha, parents: [ref.object.sha] }) });
      try { await gh('/git/refs/heads/main', { method: 'PATCH', body: JSON.stringify({ sha: c.sha }) }); break; }
      catch (e) { if (attempt >= 2 || e.status !== 422) throw e; } // someone else pushed meanwhile: rebuild on the new head
    }
    pending.length = 0; changed.clear(); manifestDirty = false;
    renderList();
    state('');
    msg('저장소에 올렸어요. 1~2분 뒤 앱에 반영돼요.');
  } catch (e) {
    state(e.status === 401 ? '토큰이 만료됐거나 맞지 않아요. 토큰을 다시 설정해 주세요.' : e.status === 403 || e.status === 404 ? '저장소에 쓸 권한이 없어요. 토큰 설정을 확인해 주세요.' : e.status === 413 || e.status === 422 ? '파일이 너무 커서 올리지 못했어요. 영상 크기를 줄여 주세요.' : '올리지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.');
  } finally {
    btn.classList.remove('busy');
    ghStatus();
  }
});
window.addEventListener('beforeunload', (e) => { if (pending.length || changed.size || manifestDirty) { e.preventDefault(); e.returnValue = ''; } });

load();
