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
    return `<tr><td>${thumb}</td><td><span class="sw" style="background:${esc(s.color)}"></span>${esc(s.name)} ${isNew ? '<span class="new">새로 추가</span>' : ''}</td><td>${esc(cat)}</td><td>${esc(s.file)}</td><td>${iv}</td><td>${s.volume ?? 60}%</td><td><button class="del" data-i="${i}">삭제</button></td></tr>`;
  }).join('');
  $('#dl').innerHTML = pending.map((p) => `<a href="${URL.createObjectURL(p.blob)}" download="${esc(p.name.split('/').pop())}">⬇ ${esc(p.name)}</a>`).join('') || '<p>새로 올릴 오디오·사진 파일이 없어요.</p>';
}

$('#list').addEventListener('click', (e) => {
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
load();
