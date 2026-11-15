import { Engine } from './engine.js';
import { Landscape, layersFor } from './landscape.js';
import {
  defaultTrack, newMix, uid, fmtSec, fmtShort, parseTime, logPos, posLog, snapSec, intervalLabel, MAX_INT,
  loadMixes, saveMixes, loadCurrent, saveCurrent, loadLast, saveLast,
  listUserSounds, putUserSound, deleteUserSound, encodeMix, decodeMix,
} from './model.js';

// ---------------------------------------------------------------- state
const S = {
  cats: [],
  sounds: new Map(),
  mixes: loadMixes(),
  current: loadCurrent() || newMix(),
  lastId: loadLast(),
  view: 'mixes',
  open: null,          // uid of the expanded track card
  editMixes: false,
  sheetOpen: false,
  tracksHidden: (() => { try { return localStorage.getItem('orbit-tracks-hidden') === '1'; } catch { return false; } })(),
  timerEnd: null,
  timerLeft: null, // seconds left while paused
  volume: (() => { try { const v = +localStorage.getItem('orbit-volume'); return v >= 0 && localStorage.getItem('orbit-volume') !== null ? v : 100; } catch { return 100; } })(),
  search: '',
};
const MINE = { id: 'mine', name: '내 음원' };
const buffers = new Map();
const land = new Landscape();
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const isMobile = () => matchMedia('(max-width: 899px)').matches;

// ---------------------------------------------------------------- audio
const engine = new Engine(async (soundId) => {
  if (buffers.has(soundId)) return buffers.get(soundId);
  const p = (async () => {
    const s = S.sounds.get(soundId);
    if (!s) throw new Error('unknown sound ' + soundId);
    let data;
    if (s.blob) data = await s.blob.arrayBuffer();
    else {
      const res = await fetch('sounds/' + s.file);
      if (!res.ok) throw new Error(res.status);
      data = await res.arrayBuffer();
    }
    return await new Promise((ok, bad) => engine.ctx.decodeAudioData(data, ok, bad));
  })();
  buffers.set(soundId, p);
  p.catch(() => buffers.delete(soundId));
  return p;
});
engine.on((ev) => {
  if (ev.type === 'state') { renderPlayState(); updateMediaSession(); }
  if (ev.type === 'hit') {
    const th = $(`.k[data-uid="${ev.uid}"] .th`);
    if (th) { th.classList.remove('hit'); void th.offsetWidth; th.classList.add('hit'); }
    const t = trackBy(ev.uid);
    if (t && !t.muted) land.hit(soundOf(t)?.scene);
  }
  if (ev.type === 'error') toast(`"${S.sounds.get(ev.soundId)?.name || ev.soundId}" 음원을 불러오지 못했어요`);
});

let syncQueued = false;
function syncEngine() {
  if (syncQueued) return;
  syncQueued = true;
  requestAnimationFrame(() => { syncQueued = false; engine.sync(S.current.tracks); });
}
function persist() {
  S.current.updated = Date.now();
  saveCurrent(S.current);
}

// ---------------------------------------------------------------- helpers
function art(sound, cls = 'art') {
  if (!sound) return `<div class="${cls} scene s-night"></div>`;
  if (sound.image) return `<img src="${esc(sound.image)}" alt="" loading="lazy" draggable="false">`;
  return `<div class="${cls} scene s-${esc(sound.scene || 'night')}"></div>`;
}
const soundOf = (t) => S.sounds.get(t.soundId);
const colorOf = (t) => soundOf(t)?.color || '#5ee1c6';
const inMix = (sid) => S.current.tracks.some((t) => t.soundId === sid);
const trackBy = (u) => S.current.tracks.find((t) => t.uid === u);

let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function dialog(html, onMount) {
  const m = $('#modal');
  m.innerHTML = `<div class="dlg" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  const close = () => { m.hidden = true; m.innerHTML = ''; };
  m.onclick = (e) => { if (e.target === m) close(); };
  onMount?.(m.firstElementChild, close);
  return close;
}

// ---------------------------------------------------------------- library
function allCats() {
  const mine = [...S.sounds.values()].some((s) => s.category === 'mine');
  return [...S.cats, MINE].filter((c) => c !== MINE || mine || true);
}

function renderTabs() {
  $('#tabs').innerHTML = [{ id: 'all', name: '전체' }, ...allCats()]
    .map((c) => `<button data-cat="${c.id}" class="${c.id === 'all' ? 'on' : ''}">${esc(c.name)}</button>`).join('');
}

function renderLib() {
  const q = S.search.trim().toLowerCase();
  const html = allCats().map((c) => {
    let items = [...S.sounds.values()].filter((s) => s.category === c.id);
    if (q) items = items.filter((s) => s.name.toLowerCase().includes(q));
    if (q && !items.length) return '';
    const cards = items.map((s) => `
      <button class="card${inMix(s.id) ? ' in' : ''}" data-sid="${esc(s.id)}" aria-pressed="${inMix(s.id)}">
        ${art(s)}<span class="ck">✓</span>${s.blob ? `<span class="del" data-del="${esc(s.id)}" title="삭제">✕</span>` : ''}
        <span class="nm">${esc(s.name)}</span>
      </button>`).join('');
    const add = c.id === 'mine' && !q ? `<button class="card add" data-act="upload"><b>+</b>내 파일 추가<small>mp3 · wav · m4a</small></button>` : '';
    return `<div class="sec" id="sec-${c.id}">${esc(c.name)} <small>${items.length}</small></div><div class="grid">${cards}${add}</div>`;
  }).join('');
  $('#lib').innerHTML = html || `<div class="libempty">"${esc(S.search)}"에 맞는 음원이 없어요.</div>`;
}

function refreshLibChecks() {
  $$('#lib .card[data-sid]').forEach((c) => {
    const on = inMix(c.dataset.sid);
    c.classList.toggle('in', on);
    c.setAttribute('aria-pressed', on);
  });
}

// ---------------------------------------------------------------- left: mixes list
function renderMixes() {
  const cur = S.current;
  const playing = engine.playing && cur.tracks.length;
  const resume = !playing && cur.tracks.length;
  const list = [...S.mixes].sort((a, b) => (b.id === S.lastId) - (a.id === S.lastId) || b.updated - a.updated);
  $('#left').innerHTML = `
    <div class="mixes">
      ${playing ? `<div class="nowbar"><button class="nb" data-act="toplayer"><span class="eq"><i></i><i></i><i></i></span><span>${esc(cur.name)}</span><small>재생 중 ›</small></button>${mvolHTML(true)}</div>` : ''}
      ${resume ? `<div class="nowbar" style="background:#0b1b2c;border-color:var(--line2)"><button class="nb" data-act="toplayer"><span>▶</span><span>${esc(cur.name)}</span><small>이어 듣기 ›</small></button>${mvolHTML(true)}</div>` : ''}
      <div class="hh"><span>나의 믹스 <small>${S.mixes.length}</small></span>${S.mixes.length ? `<button data-act="editmixes" class="${S.editMixes ? 'on' : ''}">${S.editMixes ? '완료' : '편집'}</button>` : ''}</div>
      ${list.map((m) => {
        const bg = bgSound(m);
        return `<div class="mx${m.id === S.lastId ? ' last' : ''}" data-mix="${m.id}" role="button" tabindex="0">
          <div class="bgl">${art(bg)}</div>
          <div class="in"><b>${esc(m.name)}</b><small>음원 ${m.tracks.length}개 · ${m.timer ? `타이머 ${timerWords(m.timer)}` : '타이머 없음'}</small>
          <div class="ths">${m.tracks.slice(0, 6).map((t) => `<i class="scene s-${esc(S.sounds.get(t.soundId)?.scene || 'mine')}"></i>`).join('')}</div></div>
          ${S.editMixes ? `<button class="rm" data-rm="${m.id}">삭제</button>` : `<div class="pc"><button class="play${playing && cur.id === m.id ? ' on' : ''}" data-act="mixplay" data-id="${m.id}" aria-label="${playing && cur.id === m.id ? '일시정지' : '재생'}"></button>${m.id === S.lastId ? '<span class="tag">마지막 재생</span>' : ''}</div>`}
        </div>`;
      }).join('')}
      ${!S.mixes.length ? '<p class="hint">저장한 믹스가 여기에 모여요. 라이브러리에서 음원을 눌러 조합을 만들고 "저장"을 누르세요.</p>' : ''}
      <button class="newmix" data-act="newmix">+ 새 믹스 만들기</button>
    </div>`;
  initMasterVol($('#left'));
}

// ---------------------------------------------------------------- left: player
function bgSound(mix) {
  const ts = mix.tracks.filter((t) => !t.muted);
  const t = ts.find((t) => t.interval.mode === 'loop') || ts[0] || mix.tracks[0];
  return t ? S.sounds.get(t.soundId) : null;
}

function renderPlayer() {
  const m = S.current;
  $('#left').innerHTML = `
    <div class="player">
      <div class="pl-bg"><div class="shade"></div></div>
      <div class="pl-in">
        <div class="pl-top">
          <button class="chip" data-act="tomixes"><svg class="ico"><use href="#ic-list"/></svg>나의 믹스</button>
          <span class="sp"></span>
          <button class="chip w" data-act="save">저장</button>
          <button class="chip" data-act="share">공유</button>
        </div>
        <div class="pl-title">
          <button class="pb${engine.playing ? ' on' : ''}" data-act="playpause" aria-label="재생/일시정지"></button>
          <div class="ttl"><input class="mixname" value="${esc(m.name)}" maxlength="30" aria-label="믹스 이름"><small>음원 ${m.tracks.length}개${engine.playing ? ' 재생 중' : ''}</small></div>
          <button class="tm" data-act="timer" aria-expanded="false"></button>
        </div>
        <button class="tbar${S.tracksHidden ? ' off' : ''}" data-act="tracks" aria-expanded="${!S.tracksHidden}" aria-label="음원 목록 접기·펼치기"><i></i><svg class="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 7.6 6 4.1l3.5 3.5"/></svg><i></i></button>
        ${mvolHTML(S.tracksHidden)}
        <div class="tracks${S.tracksHidden ? ' off' : ''}">${m.tracks.length ? m.tracks.map(trackHTML).join('') : `<div class="pl-empty">${isMobile() ? '왼쪽으로 밀어 라이브러리' : '오른쪽 라이브러리'}에서 음원을 누르면<br>여기에 추가되고 바로 재생돼요.</div>`}</div>
      </div>
      <div class="sheet${S.sheetOpen ? ' open' : ''}">
        <div class="hdl" data-act="sheet"><i></i><span><svg class="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 7.6 6 4.1l3.5 3.5"/></svg>공간 배치</span></div>
        <div class="sh"><span>음원을 끌어서 위치 조정</span><span>가운데 = 사방에서 · 바깥 = 멀리</span></div>
        <div class="radar-wrap"><div class="radar">${radarHTML()}</div></div>
      </div>
    </div>`;
  renderTimer();
  initMasterVol($('#left'));
  $$('.k.op').forEach(initCardSliders);
  refreshBg();
}

function fillHTML(t) {
  const v = t.volume;
  if (v.mode === 'range') return `<div class="fill rng" style="left:${v.min}%;width:${v.max - v.min}%"></div>`;
  if (v.mode === 'full') return `<div class="fill full" style="width:100%"></div>`;
  return `<div class="fill" style="width:${v.value}%"></div>`;
}

const VOL_MODES = [['fixed', 'v-fixed', '고정'], ['range', 'v-range', '범위 랜덤']];
const INT_MODES = [['loop', 'i-loop', '∞ 지속'], ['fixed', 'i-fixed', '정해진 간격'], ['range', 'i-range', '범위 랜덤'], ['full', 'v-full', '완전 랜덤']];
const TICKS = [1, 5, 30, 120, 600, 1800];

function volText(v) {
  if (v.mode === 'fixed') return `${v.value}%`;
  if (v.mode === 'range') return `${v.min} ~ ${v.max}%`;
  return '1 ~ 100%';
}
function intText(i) {
  if (i.mode === 'loop') return '끊김 없이 계속';
  if (i.mode === 'fixed') return `${Math.round(i.value)}초`;
  if (i.mode === 'range') return `${Math.round(i.min)} ~ ${Math.round(i.max)}초`;
  return `1 ~ ${MAX_INT}초`;
}
const fadeText = (s) => `${(+s).toFixed(1)}초`;
const FADE_MAX = 5;

function toggleTracks() {
  S.tracksHidden = !S.tracksHidden;
  try { localStorage.setItem('orbit-tracks-hidden', S.tracksHidden ? '1' : '0'); } catch { /* private mode */ }
  $('.tracks')?.classList.toggle('off', S.tracksHidden);
  $('.pl-in .mvol')?.classList.toggle('on', S.tracksHidden);
  const b = $('.tbar');
  if (b) { b.classList.toggle('off', S.tracksHidden); b.setAttribute('aria-expanded', !S.tracksHidden); }
}
// overall volume: speaker icon follows the level and mutes / restores on tap
const volIcon = (v) => (v === 0 ? 'ic-mute' : v < 50 ? 'ic-vol1' : 'ic-vol');
const mvolHTML = (on) => `<div class="mvol${on ? ' on' : ''}"><button class="mvi" data-act="mvmute" aria-label="${S.volume ? '음소거' : '소리 켜기'}"><svg class="ico"><use href="#${volIcon(S.volume)}"/></svg></button><div class="sl" data-sl="master"></div><span class="mv">${S.volume}%</span></div>`;
function showMasterVol() {
  $$('.mvol').forEach((m) => {
    $('.mv', m).textContent = `${S.volume}%`;
    $('.mvi use', m).setAttribute('href', `#${volIcon(S.volume)}`);
    $('.mvi', m).setAttribute('aria-label', S.volume ? '음소거' : '소리 켜기');
  });
}
const saveVolume = () => { try { localStorage.setItem('orbit-volume', S.volume); } catch { /* private mode */ } };
function setMasterVol(v) {
  S.volume = v;
  engine.setVolume(v / 100);
  showMasterVol();
}
function initMasterVol(root = document) {
  $$('[data-sl="master"]', root).forEach((el) => {
    const fresh = el.cloneNode(false); // drop old listeners
    el.replaceWith(fresh);
    makeSlider(fresh, {
      values: [S.volume],
      toPos: (x) => x / 100,
      fromPos: (p) => Math.round(p * 100),
      color: '#fff',
      onInput: ([v]) => { if (v) S.prevVolume = null; setMasterVol(v); },
      onEnd: saveVolume,
    });
  });
}
function toggleMute() {
  if (S.volume > 0) { S.prevVolume = S.volume; setMasterVol(0); }
  else setMasterVol(S.prevVolume || 70);
  saveVolume();
  initMasterVol($('#left'));
}
function trackHTML(t) {
  if (t.volume.mode === 'full') Object.assign(t.volume, { mode: 'range', min: 1, max: 100 }); // old mixes
  const s = soundOf(t);
  const open = S.open === t.uid;
  const iv = intervalLabel(t.interval);
  return `
  <div class="k${open ? ' op' : ''}${t.muted ? ' mute' : ''}${S.swiped === t.uid ? ' sw open' : ''}" data-uid="${t.uid}" style="--c:${colorOf(t)}">
    <button class="swdel" data-act="remove" tabindex="-1">삭제</button>
    <div class="hd">
      ${fillHTML(t)}
      <button class="th" data-act="mute" aria-label="${t.muted ? '켜기' : '끄기'}">${art(s)}<svg class="ico"><use href="#ic-mute"/></svg></button>
      <div class="n">${esc(s?.name || '알 수 없는 음원')}</div>
      <div class="iv${iv === '∞' ? ' loop' : ''}">${iv}</div>
      <button class="x" data-act="remove" aria-label="믹스에서 빼기">✕</button>
    </div>
    ${open ? bodyHTML(t) : ''}
  </div>`;
}

function bodyHTML(t) {
  const v = t.volume, i = t.interval;
  const modes = (list, cur, kind) => `<div class="ms">${list.map(([m, ic, label]) =>
    `<button data-act="${kind}" data-mode="${m}" data-label="${label}" class="${cur === m ? 'on' : ''}" aria-label="${label}" aria-pressed="${cur === m}"><svg class="ico"><use href="#${ic}"/></svg></button>`).join('')}</div>`;
  const editable = (kind, mode) => (kind === 'vol' ? mode !== 'full' : mode === 'fixed' || mode === 'range');
  return `
  <div class="bdy">
    <div class="crow">
      <div class="rh"><b>볼륨</b>${modes(VOL_MODES, v.mode, 'vmode')}<span class="val${editable('vol', v.mode) ? ' ed' : ''}" data-act="editvol">${volText(v)}</span></div>
      <div class="sl" data-sl="vol"></div>
    </div>
    <div class="crow">
      <div class="rh"><b>재생 간격</b>${modes(INT_MODES, i.mode, 'imode')}<span class="val${editable('int', i.mode) ? ' ed' : ''}" data-act="editint">${intText(i)}</span></div>
      <div class="ib">${i.mode === 'fixed' || i.mode === 'range' ? `<div class="sl" data-sl="int"></div>
        <div class="ticks">${TICKS.map((s) => `<i style="left:${logPos(s) * 100}%">${s}초</i>`).join('')}</div>`
      : i.mode === 'loop' ? '<p class="note">소리가 끝나면 바로 이어서, 끊김 없이 반복해요.</p>'
      : `<p class="note">한 번 재생이 끝날 때마다 1~${MAX_INT}초 사이에서 다음 간격을 새로 골라요.</p>`}</div>
    </div>
    <div class="crow">
      <div class="rh"><b>페이드</b></div>
      <div class="fds">${['in', 'out'].map((w) => `<div class="fr"><svg class="ico"><use href="#f-${w}"/></svg><span>${w === 'in' ? '인' : '아웃'}</span><div class="sl" data-sl="fade-${w}"></div><span class="val ed" data-act="editfade" data-w="${w}">${fadeText(t.fade[w])}</span></div>`).join('')}</div>
      <p class="note fnote"${i.mode === 'loop' ? '' : ' style="visibility:hidden"'}>계속 재생에서는 켜고 끌 때만 페이드돼요.</p>
    </div>
  </div>`;
}

function rerenderCard(u) {
  const el = $(`.k[data-uid="${u}"]`);
  const t = trackBy(u);
  if (!el || !t) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = trackHTML(t);
  const fresh = tmp.firstElementChild;
  // patch the existing card so hover state and transitions carry over (no flash)
  el.className = fresh.className;
  el.style.cssText = fresh.style.cssText;
  el.innerHTML = fresh.innerHTML;
  if (S.open === u) initCardSliders(el);
}

// live update of a card's header + value text while dragging
function refreshCardHead(u) {
  const el = $(`.k[data-uid="${u}"]`);
  const t = trackBy(u);
  if (!el || !t) return;
  const f = $('.fill', el);
  const tmp = document.createElement('div');
  tmp.innerHTML = fillHTML(t);
  f.replaceWith(tmp.firstElementChild);
  const iv = intervalLabel(t.interval);
  const ivEl = $('.iv', el);
  ivEl.textContent = iv;
  ivEl.classList.toggle('loop', iv === '∞');
  const vv = $('[data-act="editvol"]', el); if (vv && !vv.querySelector('input')) vv.textContent = volText(t.volume);
  const iv2 = $('[data-act="editint"]', el); if (iv2 && !iv2.querySelector('input')) iv2.textContent = intText(t.interval);
}

// ---------------------------------------------------------------- sliders
function makeSlider(el, { values, toPos, fromPos, color, onInput, onEnd }) {
  el.innerHTML = `<div class="tr"></div><div class="rg"></div>${values.map(() => '<div class="kn"></div>').join('')}`;
  const rg = $('.rg', el), kns = $$('.kn', el);
  if (color) rg.style.background = color;
  const draw = () => {
    const ps = values.map(toPos);
    kns.forEach((k, i) => (k.style.left = ps[i] * 100 + '%'));
    const a = values.length > 1 ? ps[0] : 0, b = ps[ps.length - 1];
    rg.style.left = a * 100 + '%';
    rg.style.width = (b - a) * 100 + '%';
  };
  draw();
  let idx = -1;
  const posAt = (e) => { const r = el.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width, 0, 1); };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const p = posAt(e);
    const ps = values.map(toPos);
    idx = ps.length === 1 ? 0 : (Math.abs(p - ps[0]) <= Math.abs(p - ps[1]) ? (p > ps[1] ? 1 : 0) : 1);
    move(e);
  });
  const move = (e) => {
    if (idx < 0) return;
    let v = fromPos(posAt(e));
    if (values.length > 1) {
      if (idx === 0) v = Math.min(v, values[1]); else v = Math.max(v, values[0]);
    }
    if (v === values[idx]) return;
    values[idx] = v;
    draw();
    onInput([...values]);
  };
  el.addEventListener('pointermove', move);
  const end = () => { if (idx >= 0) { idx = -1; onEnd?.(); } };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

function initCardSliders(card) {
  const t = trackBy(card.dataset.uid);
  if (!t) return;
  const vs = $('[data-sl="vol"]', card);
  if (vs) {
    const v = t.volume;
    makeSlider(vs, {
      values: v.mode === 'range' ? [v.min, v.max] : [v.value],
      toPos: (x) => (x - 1) / 99,
      fromPos: (p) => Math.round(1 + p * 99),
      color: colorOf(t),
      onInput: (vals) => {
        if (vals.length > 1) { v.min = vals[0]; v.max = vals[1]; } else v.value = vals[0];
        refreshCardHead(t.uid); syncEngine();
      },
      onEnd: persist,
    });
  }
  for (const w of ['in', 'out']) {
    const fs = $(`[data-sl="fade-${w}"]`, card);
    if (!fs) continue;
    makeSlider(fs, {
      values: [Math.min(FADE_MAX, t.fade[w])],
      toPos: (x) => x / FADE_MAX,
      fromPos: (p) => Math.round(p * FADE_MAX * 10) / 10,
      color: colorOf(t),
      onInput: ([x]) => { t.fade[w] = x; const el = $(`[data-act="editfade"][data-w="${w}"]`, card); if (el && !el.querySelector('input')) el.textContent = fadeText(x); },
      onEnd: () => { persist(); syncEngine(); },
    });
  }
  const is = $('[data-sl="int"]', card);
  if (is) {
    const i = t.interval;
    makeSlider(is, {
      values: i.mode === 'range' ? [i.min, i.max] : [i.value],
      toPos: logPos,
      fromPos: (p) => snapSec(posLog(p)),
      onInput: (vals) => {
        if (vals.length > 1) { i.min = vals[0]; i.max = vals[1]; } else i.value = vals[0];
        refreshCardHead(t.uid);
      },
      onEnd: () => { persist(); syncEngine(); },
    });
  }
}

// ---------------------------------------------------------------- radar
function radarHTML() {
  return `<div class="ax"></div><div class="ay"></div>
    <span class="lab" style="left:50%;top:4px;transform:translateX(-50%)">앞</span>
    <span class="lab" style="left:50%;bottom:4px;transform:translateX(-50%)">뒤</span>
    <span class="lab" style="left:6px;top:50%;transform:translateY(-50%)">왼</span>
    <span class="lab" style="right:6px;top:50%;transform:translateY(-50%)">오른</span>
    <div class="me">🙂</div>
    ${S.current.tracks.map((t) => {
      const c = Math.hypot(t.pos.x, t.pos.y) < 0.08;
      return `<div class="orb${c ? ' centre' : ''}${t.muted ? ' mute' : ''}" data-orb="${t.uid}" style="left:${50 + t.pos.x * 50}%;top:${50 + t.pos.y * 50}%;--c:${colorOf(t)}">
        <b>${art(soundOf(t))}</b><span>${esc(soundOf(t)?.name || '')}</span></div>`;
    }).join('')}`;
}
function refreshRadar() { const r = $('.radar'); if (r) r.innerHTML = radarHTML(); }

// ---------------------------------------------------------------- timer
function renderTimer() {
  const el = $('.pl-title .tm');
  if (!el) return;
  const m = S.current;
  const left = S.timerEnd ? Math.max(0, Math.round((S.timerEnd - Date.now()) / 1000)) : S.timerLeft ?? (m.timer ? Math.round(m.timer * 60) : null);
  el.classList.toggle('off', left == null);
  if (left == null) { el.innerHTML = '수면 타이머<b>설정 안 함</b>'; return; }
  const h = Math.floor(left / 3600), mm = Math.floor((left % 3600) / 60), ss = left % 60;
  el.innerHTML = `수면 타이머<b>${h ? h + ':' : ''}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}</b>`;
}
setInterval(() => {
  if (S.timerEnd && Date.now() >= S.timerEnd) {
    S.timerEnd = null; S.timerLeft = null;
    engine.fadeOutAndPause(8);
    toast('타이머가 끝나 소리를 천천히 줄였어요');
  }
  renderTimer();
}, 1000);

// timer length (stored in minutes, may hold seconds as a fraction) as words
function timerWords(min) {
  const t = Math.round(min * 60), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return [h && `${h}시간`, m && `${m}분`, s && `${s}초`].filter(Boolean).join(' ') || '0초';
}
// dial-style timer: three wheels (hours, minutes, seconds) that drop down under the timer
const ROW = 26;
function closeTimer() { $('.tpop')?.remove(); $('.pl-title .tm')?.setAttribute('aria-expanded', 'false'); }
function openTimer() {
  if ($('.tpop')) return closeTimer();
  const tm = $('.pl-title .tm');
  if (!tm) return;
  const base = S.timerEnd ? Math.round((S.timerEnd - Date.now()) / 1000) : S.timerLeft ?? Math.round((S.current.timer || 30) * 60);
  const init = [Math.min(12, Math.floor(base / 3600)), Math.floor((base % 3600) / 60), base % 60];
  const col = (max, i) => `<div class="wh" data-i="${i}">${Array.from({ length: max + 1 }, (_, n) => `<b data-n="${n}">${String(n).padStart(2, '0')}</b>`).join('')}</div>`;
  const pop = document.createElement('div');
  pop.className = 'tpop';
  pop.innerHTML = `<div class="wheels"><div class="band"></div>${col(12, 0)}${col(59, 1)}${col(59, 2)}</div>
    <div class="wl"><span>시</span><span>분</span><span>초</span></div>
    <div class="acts"><button data-t="off">끄기</button><button class="pri" data-t="set">설정</button></div>`;
  $('.pl-title').append(pop);
  tm.setAttribute('aria-expanded', 'true');
  const whs = $$('.wh', pop);
  const val = (w) => Math.round(w.scrollTop / ROW);
  const mark = (w) => { const v = val(w); $$('b', w).forEach((b) => b.classList.toggle('on', +b.dataset.n === v)); };
  whs.forEach((w, i) => {
    w.scrollTop = init[i] * ROW;
    mark(w);
    w.addEventListener('scroll', () => mark(w), { passive: true });
    w.addEventListener('click', (e) => { const b = e.target.closest('b'); if (b) w.scrollTo({ top: +b.dataset.n * ROW, behavior: 'smooth' }); });
  });
  pop.addEventListener('click', (e) => {
    const t = e.target.closest('[data-t]')?.dataset.t;
    if (!t) return;
    const sec = t === 'off' ? 0 : val(whs[0]) * 3600 + val(whs[1]) * 60 + val(whs[2]);
    const min = sec / 60;
    S.current.timer = sec > 0 ? min : null;
    S.timerEnd = engine.playing && sec > 0 ? Date.now() + sec * 1000 : null;
    S.timerLeft = null;
    persist(); renderTimer(); closeTimer();
    toast(sec > 0 ? `${timerWords(min)} 뒤에 멈춰요` : '타이머를 껐어요');
  });
}
document.addEventListener('pointerdown', (e) => { if ($('.tpop') && !e.target.closest('.tpop, .pl-title .tm')) closeTimer(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('.tpop')) closeTimer(); });

// ---------------------------------------------------------------- actions
function renderLeft() {
  if (S.view === 'player') renderPlayer(); else renderMixes();
}
function renderPlayState() {
  const pb = $('.pb');
  if (pb) pb.classList.toggle('on', engine.playing);
  const sm = $('.pl-title .ttl small');
  if (sm) sm.textContent = `음원 ${S.current.tracks.length}개${engine.playing ? ' 재생 중' : ''}`;
  if (S.view === 'mixes') renderMixes();
}

engine.setVolume(S.volume / 100);
function play() {
  if (!S.current.tracks.length) { toast('먼저 라이브러리에서 음원을 골라 주세요'); return; }
  engine.play(S.current.tracks);
  const sec = S.timerLeft ?? (S.current.timer ? S.current.timer * 60 : null);
  S.timerEnd = sec ? Date.now() + sec * 1000 : null;
  S.timerLeft = null;
  if (S.current.id) { S.lastId = S.current.id; saveLast(S.lastId); }
  renderTimer();
}
function pause() {
  engine.pause();
  if (S.timerEnd) S.timerLeft = Math.max(1, Math.round((S.timerEnd - Date.now()) / 1000));
  S.timerEnd = null;
  renderTimer();
}

function toggleSound(sid) {
  const i = S.current.tracks.findIndex((t) => t.soundId === sid);
  if (i >= 0) {
    const [t] = S.current.tracks.splice(i, 1);
    if (S.open === t.uid) S.open = null;
  } else {
    const s = S.sounds.get(sid);
    S.current.tracks.push(defaultTrack(s));
    if (isMobile()) toast(`"${s.name}" 추가 · 오른쪽으로 밀면 믹스가 보여요`, 2000);
  }
  persist();
  refreshLibChecks();
  if (S.view !== 'player') S.view = 'player';
  renderLeft();
  if (!engine.playing && S.current.tracks.length && i < 0) play();
  else syncEngine();
  if (engine.playing && !S.current.tracks.length) pause();
}

function loadMix(id, { stay = false } = {}) {
  const m = S.mixes.find((x) => x.id === id);
  if (!m) return;
  engine.stopAll();
  S.current = structuredClone(m);
  S.current.tracks.forEach((t) => (t.uid = uid()));
  S.open = null; S.timerLeft = null;
  if (!stay) S.view = 'player';
  persist();
  renderLeft(); refreshLibChecks();
  play();
}

function startNewMix() {
  engine.stopAll();
  S.current = newMix();
  S.open = null; S.timerEnd = null; S.timerLeft = null;
  S.view = 'player';
  persist();
  renderLeft(); refreshLibChecks();
  if (isMobile()) goPage(1);
}

function saveMix() {
  if (!S.current.tracks.length) { toast('저장할 음원이 없어요'); return; }
  const doSave = (name) => {
    S.current.name = name;
    const copy = structuredClone(S.current);
    copy.updated = Date.now();
    if (S.current.id) {
      const i = S.mixes.findIndex((m) => m.id === S.current.id);
      if (i >= 0) S.mixes[i] = copy; else S.mixes.push(copy);
    } else {
      copy.id = S.current.id = uid();
      S.mixes.push(copy);
    }
    S.lastId = S.current.id; saveLast(S.lastId);
    saveMixes(S.mixes); persist();
    const nm = $('.mixname'); if (nm) nm.value = name;
    toast(`"${name}" 저장했어요`);
  };
  if (S.current.id) { doSave(S.current.name); return; }
  dialog(`<h3>믹스 저장</h3><p>나중에 "나의 믹스"에서 바로 다시 들을 수 있어요.</p>
    <input type="text" id="mname" maxlength="30" value="${esc(S.current.name === '새 믹스' ? '' : S.current.name)}" placeholder="예: 비 오는 캠핑">
    <div class="acts"><button data-x>취소</button><button class="pri" data-ok>저장</button></div>`, (dlg, close) => {
    const inp = $('#mname', dlg); inp.focus();
    const ok = () => { doSave(inp.value.trim() || '나의 믹스'); close(); };
    $('[data-ok]', dlg).onclick = ok; $('[data-x]', dlg).onclick = close;
    inp.onkeydown = (e) => { if (e.key === 'Enter') ok(); };
  });
}

async function shareMix() {
  if (!S.current.tracks.length) { toast('공유할 음원이 없어요'); return; }
  const skipped = S.current.tracks.filter((t) => t.soundId.startsWith('user:')).length;
  const url = `${location.origin}${location.pathname}#m=${encodeMix(S.current)}`;
  if (navigator.share && isMobile()) {
    try { await navigator.share({ title: S.current.name, text: `ORBIT 믹스 "${S.current.name}"`, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  dialog(`<h3>믹스 공유</h3><p>이 링크를 받은 사람은 같은 조합을 바로 들을 수 있어요.${skipped ? ` 내가 추가한 음원 ${skipped}개는 링크에 담기지 않아요.` : ''}</p>
    <div class="link">${esc(url)}</div><div class="acts"><button data-x>닫기</button><button class="pri" data-copy>링크 복사</button></div>`, (dlg, close) => {
    $('[data-x]', dlg).onclick = close;
    $('[data-copy]', dlg).onclick = async () => {
      try { await navigator.clipboard.writeText(url); toast('링크를 복사했어요'); close(); }
      catch { toast('복사하지 못했어요. 링크를 길게 눌러 복사해 주세요'); }
    };
  });
}

function editValue(u, kind) {
  const t = trackBy(u);
  const el = $(`.k[data-uid="${u}"] [data-act="edit${kind}"]`);
  if (!t || !el || el.querySelector('input')) return;
  const o = kind === 'vol' ? t.volume : t.interval;
  if ((kind === 'vol' && o.mode === 'full') || (kind === 'int' && (o.mode === 'loop' || o.mode === 'full'))) return;
  const fmt = (x) => Math.round(x);
  const two = o.mode === 'range';
  el.innerHTML = two ? `<input value="${fmt(o.min)}"> ~ <input value="${fmt(o.max)}">` : `<input value="${fmt(o.value)}">`;
  const ins = $$('input', el);
  ins[0].focus(); ins[0].select();
  const parse = (s) => kind === 'vol' ? clamp(Math.round(parseFloat(s)), 1, 100) : clamp(Math.round(parseTime(s)), 1, MAX_INT);
  let done = false;
  const commit = () => {
    if (done) return; done = true;
    const vals = ins.map((i) => parse(i.value));
    if (vals.every((v) => !Number.isNaN(v))) {
      if (two) { o.min = Math.min(...vals); o.max = Math.max(...vals); } else o.value = vals[0];
      persist(); syncEngine();
    } else toast(kind === 'vol' ? '1~100 사이 숫자를 넣어 주세요' : `1~${MAX_INT} 사이 초를 넣어 주세요`);
    rerenderCard(u);
  };
  ins.forEach((i) => {
    i.onkeydown = (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { done = true; rerenderCard(u); } };
    i.onblur = () => setTimeout(() => { if (!el.contains(document.activeElement)) commit(); }, 0);
  });
}

function editFade(u, w) {
  const t = trackBy(u);
  const el = $(`.k[data-uid="${u}"] [data-act="editfade"][data-w="${w}"]`);
  if (!t || !el || el.querySelector('input')) return;
  el.innerHTML = `<input value="${t.fade[w]}" inputmode="decimal">`;
  const inp = $('input', el);
  inp.focus(); inp.select();
  let done = false;
  const commit = () => {
    if (done) return; done = true;
    const v = parseFloat(inp.value);
    if (Number.isFinite(v)) { t.fade[w] = clamp(Math.round(v * 10) / 10, 0, FADE_MAX); persist(); syncEngine(); }
    else toast(`0~${FADE_MAX} 사이 초를 넣어 주세요`);
    rerenderCard(u);
  };
  inp.onkeydown = (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { done = true; rerenderCard(u); } };
  inp.onblur = () => setTimeout(commit, 0);
}

// ---------------------------------------------------------------- events: left pane
const left = $('#left');
left.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  const mixCard = e.target.closest('[data-mix]');
  const rm = e.target.closest('[data-rm]');
  if (rm) {
    const id = rm.dataset.rm;
    const m = S.mixes.find((x) => x.id === id);
    dialog(`<h3>믹스 삭제</h3><p>"${esc(m?.name)}"을(를) 지울까요? 되돌릴 수 없어요.</p><div class="acts"><button data-x>취소</button><button class="pri" data-ok style="background:var(--danger)">삭제</button></div>`, (dlg, close) => {
      $('[data-x]', dlg).onclick = close;
      $('[data-ok]', dlg).onclick = () => {
        S.mixes = S.mixes.filter((x) => x.id !== id); saveMixes(S.mixes);
        if (S.current.id === id) { S.current.id = null; persist(); }
        if (!S.mixes.length) S.editMixes = false;
        close(); renderMixes();
      };
    });
    return;
  }
  if (!a && mixCard && !S.editMixes) { loadMix(mixCard.dataset.mix); return; }
  if (!a) return;
  const card = a.closest('.k');
  const u = card?.dataset.uid;
  const t = u && trackBy(u);
  switch (a.dataset.act) {
    case 'toplayer': S.view = 'player'; renderLeft(); break;
    case 'tomixes': S.view = 'mixes'; S.editMixes = false; renderLeft(); break;
    case 'editmixes': S.editMixes = !S.editMixes; renderMixes(); break;
    case 'newmix': startNewMix(); break;
    case 'playpause': engine.playing ? pause() : play(); break;
    case 'save': saveMix(); break;
    case 'share': shareMix(); break;
    case 'timer': openTimer(); break;
    case 'sheet': break; // handled by pointer logic
    case 'tracks': toggleTracks(); break;
    case 'mvmute': toggleMute(); break;
    case 'mixplay': {
      const id = a.dataset.id;
      if (S.current.id === id && S.current.tracks.length) { engine.playing ? pause() : play(); renderMixes(); }
      else loadMix(id, { stay: true });
      break;
    }
    case 'mute':
      t.muted = !t.muted; persist(); syncEngine(); rerenderCard(u); refreshRadar(); refreshBg(); break;
    case 'remove':
      if (S.swiped === u) S.swiped = null;
      S.current.tracks = S.current.tracks.filter((x) => x.uid !== u);
      if (S.open === u) S.open = null;
      persist(); syncEngine(); renderPlayer(); refreshLibChecks();
      if (!S.current.tracks.length) pause();
      break;
    case 'vmode':
      t.volume.mode = a.dataset.mode; persist(); syncEngine(); rerenderCard(u); break;
    case 'imode':
      t.interval.mode = a.dataset.mode; persist(); syncEngine(); rerenderCard(u); refreshBg(); break;
    case 'editfade': editFade(u, a.dataset.w); break;
    case 'editvol': editValue(u, 'vol'); break;
    case 'editint': editValue(u, 'int'); break;
  }
});
left.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.mixname')) { e.preventDefault(); e.target.blur(); return; }
  if (e.key === 'Enter' && e.target.matches('[data-mix]') && !S.editMixes) loadMix(e.target.dataset.mix);
});
left.addEventListener('change', (e) => {
  if (e.target.matches('.mixname')) { S.current.name = e.target.value.trim() || '새 믹스'; persist(); updateMediaSession(); }
});

function refreshBg() {
  const bg = $('.pl-bg');
  if (!bg) return;
  land.mount(bg);
  land.set(layersFor(S.current.tracks, (id) => S.sounds.get(id)));
}

// card header: tap = expand, horizontal drag = volume
let hdDrag = null;
// card header: tap = expand, horizontal drag = volume, long press (touch) = show "삭제"
const LONG_MS = 500;
left.addEventListener('pointerdown', (e) => {
  const hd = e.target.closest('.k .hd');
  if (!hd || e.target.closest('button')) return;
  const u = hd.parentElement.dataset.uid;
  const t = trackBy(u);
  const d = hdDrag = { hd, u, t, x0: e.clientX, y0: e.clientY, moved: false, start: structuredClone(t.volume), id: e.pointerId, wasOpen: S.swiped === u };
  if (e.pointerType !== 'mouse' && !d.wasOpen) {
    d.timer = setTimeout(() => {
      if (hdDrag !== d || d.moved) return;
      d.long = true;
      openSwipe(u);
      navigator.vibrate?.(15);
    }, LONG_MS);
  }
});
// an open "삭제" closes when anything else is touched
left.addEventListener('pointerdown', (e) => {
  if (!S.swiped || e.target.closest(`.k[data-uid="${S.swiped}"] .swdel`)) return;
  if (e.target.closest(`.k[data-uid="${S.swiped}"] .hd`)) return; // handled on release
  closeSwipe();
}, true);
left.addEventListener('contextmenu', (e) => { if (e.target.closest('.k .hd')) e.preventDefault(); });
function openSwipe(u) {
  if (S.swiped && S.swiped !== u) closeSwipe();
  const k = $(`.k[data-uid="${u}"]`);
  if (!k) return;
  S.swiped = u;
  k.classList.add('sw');
  requestAnimationFrame(() => k.classList.add('open'));
}
function closeSwipe() {
  const k = S.swiped && $(`.k[data-uid="${S.swiped}"]`);
  S.swiped = null;
  if (!k) return;
  k.classList.remove('open');
  setTimeout(() => { if (!k.classList.contains('open')) k.classList.remove('sw'); }, 220);
}
left.addEventListener('pointermove', (e) => {
  if (!hdDrag || e.pointerId !== hdDrag.id || hdDrag.long) return;
  const dx = e.clientX - hdDrag.x0, dy = e.clientY - hdDrag.y0;
  if (!hdDrag.moved) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { clearTimeout(hdDrag.timer); hdDrag = null; return; }
    if (Math.abs(dx) < 6) return;
    hdDrag.moved = true;
    clearTimeout(hdDrag.timer);
    if (hdDrag.wasOpen) closeSwipe();
    hdDrag.hd.setPointerCapture(e.pointerId);
  }
  const v = hdDrag.t.volume;
  const r = hdDrag.hd.getBoundingClientRect();
  if (v.mode === 'fixed') v.value = clamp(Math.round(((e.clientX - r.left) / r.width) * 100), 1, 100);
  else {
    const d = Math.round((dx / r.width) * 100);
    const w = hdDrag.start.max - hdDrag.start.min;
    v.min = clamp(hdDrag.start.min + d, 1, 100 - w);
    v.max = v.min + w;
  }
  refreshCardHead(hdDrag.u);
  syncEngine();
});
const hdEnd = (e) => {
  if (!hdDrag || e.pointerId !== hdDrag.id) return;
  const { u, moved, long, wasOpen, timer } = hdDrag;
  clearTimeout(timer);
  hdDrag = null;
  if (long) return; // the long press just showed "삭제"
  if (moved) {
    persist();
    if (S.open === u) rerenderCard(u);
  } else if (wasOpen) {
    closeSwipe(); // a tap on a card showing "삭제" just hides it
  } else {
    const prev = S.open, opening = prev !== u;
    S.open = opening ? u : null;
    if (prev) closeCardAnim(prev);
    if (opening) { rerenderCard(u); openCardAnim(u, prev ? 210 : 0); }
  }
};
// settings slide open / closed; opening also scrolls so the whole card is in view
const EASE = 'cubic-bezier(.2,.8,.2,1)';
function openCardAnim(u, wait = 0) {
  const el = $(`.k[data-uid="${u}"]`), b = el && $('.bdy', el);
  if (!b) return;
  const h = b.offsetHeight, full = el.offsetHeight;
  b.style.overflow = 'hidden';
  b.animate([{ height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px' }, { height: `${h}px`, opacity: 1 }], { duration: 260, easing: EASE })
    .onfinish = () => { b.style.overflow = ''; };
  setTimeout(() => scrollCardIntoView(el, full), wait);
}
function scrollCardIntoView(el, full) {
  const list = el.closest('.tracks');
  if (!list) return;
  const sheet = $('.sheet');
  const bottom = Math.min(list.getBoundingClientRect().bottom, sheet ? sheet.getBoundingClientRect().top : Infinity) - 10;
  const r = el.getBoundingClientRect();
  const over = r.top + full - bottom; // the card's height once fully open
  if (over <= 0) return;
  // scroll along with the opening card (the list only gets taller as the card grows)
  const dist = Math.min(over, r.top - list.getBoundingClientRect().top), from = list.scrollTop, t0 = performance.now(), D = 320;
  const ease = (t) => 1 - (1 - t) ** 3;
  const step = (now) => {
    const t = Math.min(1, (now - t0) / D);
    list.scrollTop = from + dist * ease(t);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function closeCardAnim(u) {
  const el = $(`.k[data-uid="${u}"]`), b = el && $('.bdy', el);
  if (!b) { rerenderCard(u); return; }
  b.style.overflow = 'hidden';
  b.animate([{ height: `${b.offsetHeight}px`, opacity: 1 }, { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px' }], { duration: 200, easing: EASE })
    .onfinish = () => { if (S.open !== u) rerenderCard(u); };
}
left.addEventListener('pointerup', hdEnd);
left.addEventListener('pointercancel', (e) => {
  if (hdDrag?.id !== e.pointerId) return;
  clearTimeout(hdDrag.timer);
  hdDrag = null;
});

// spatial sheet: drag the handle, or tap it
let sh = null;
left.addEventListener('pointerdown', (e) => {
  const h = e.target.closest('.sheet .hdl');
  if (!h) return;
  const sheet = h.parentElement;
  sh = { sheet, y0: e.clientY, h: sheet.offsetHeight, open: S.sheetOpen, id: e.pointerId, dy: 0 };
  h.setPointerCapture(e.pointerId);
  sheet.classList.add('drag');
});
left.addEventListener('pointermove', (e) => {
  if (!sh || sh.id !== e.pointerId) return;
  sh.dy = e.clientY - sh.y0;
  const closedY = sh.h - 46;
  const base = sh.open ? 0 : closedY;
  sh.sheet.style.transform = `translateY(${clamp(base + sh.dy, 0, closedY)}px)`;
});
const shEnd = (e) => {
  if (!sh || sh.id !== e.pointerId) return;
  const { sheet, dy } = sh;
  sh = null;
  sheet.classList.remove('drag');
  sheet.style.transform = '';
  if (Math.abs(dy) < 6) S.sheetOpen = !S.sheetOpen;
  else S.sheetOpen = dy < 0;
  sheet.classList.toggle('open', S.sheetOpen);
};
left.addEventListener('pointerup', shEnd);
left.addEventListener('pointercancel', shEnd);

// radar orbs
let orb = null;
left.addEventListener('pointerdown', (e) => {
  const o = e.target.closest('.orb');
  if (!o) return;
  e.preventDefault();
  orb = { el: o, u: o.dataset.orb, id: e.pointerId };
  o.setPointerCapture(e.pointerId);
  o.classList.add('dragging');
});
left.addEventListener('pointermove', (e) => {
  if (!orb || orb.id !== e.pointerId) return;
  const r = $('.radar').getBoundingClientRect();
  let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
  let y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
  const d = Math.hypot(x, y);
  if (d > 1) { x /= d; y /= d; }
  if (d < 0.1) { x = 0; y = 0; }
  const t = trackBy(orb.u);
  t.pos = { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
  orb.el.style.left = 50 + t.pos.x * 50 + '%';
  orb.el.style.top = 50 + t.pos.y * 50 + '%';
  orb.el.classList.toggle('centre', x === 0 && y === 0);
  syncEngine();
});
const orbEnd = (e) => {
  if (!orb || orb.id !== e.pointerId) return;
  orb.el.classList.remove('dragging');
  orb = null;
  persist();
};
left.addEventListener('pointerup', orbEnd);
left.addEventListener('pointercancel', orbEnd);

// ---------------------------------------------------------------- events: library
$('#lib').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) { e.stopPropagation(); removeUserSound(del.dataset.del); return; }
  if (e.target.closest('[data-act="upload"]')) { $('#file').click(); return; }
  const c = e.target.closest('.card[data-sid]');
  if (c) toggleSound(c.dataset.sid);
});
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  const lib = $('#lib');
  if (b.dataset.cat === 'all') lib.scrollTo({ top: 0 });
  else $(`#sec-${b.dataset.cat}`)?.scrollIntoView({ block: 'start' });
  setTab(b.dataset.cat);
  b.scrollIntoView({ inline: 'center', block: 'nearest' });
});
function setTab(id) { $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.cat === id)); }
$('#lib').addEventListener('scroll', () => {
  const lib = $('#lib');
  if (lib.scrollTop < 10) { setTab('all'); return; }
  let cur = 'all';
  for (const s of $$('.sec', lib)) if (s.offsetTop - lib.offsetTop <= lib.scrollTop + 30) cur = s.id.slice(4);
  setTab(cur);
}, { passive: true });
$('#search').addEventListener('input', (e) => { S.search = e.target.value; renderLib(); if (isMobile()) goPage(1); });

// ---------------------------------------------------------------- user sounds
$('#file').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  let added = 0;
  for (const f of files) {
    if (!f.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name)) { toast(`${f.name}: 오디오 파일이 아니에요`); continue; }
    if (f.size > 60 * 1024 * 1024) { toast(`${f.name}: 60MB보다 커서 넣을 수 없어요`); continue; }
    const rec = { id: 'user:' + uid(), name: f.name.replace(/\.[^.]+$/, '').slice(0, 30), blob: f, added: Date.now() };
    try { await putUserSound(rec); addUserSound(rec); added++; }
    catch { toast('저장 공간이 부족해서 추가하지 못했어요'); }
  }
  if (added) { renderTabs(); renderLib(); $('#sec-mine')?.scrollIntoView(); toast(`내 음원 ${added}개를 추가했어요`); }
});
function addUserSound(rec) {
  S.sounds.set(rec.id, { id: rec.id, name: rec.name, category: 'mine', scene: 'mine', color: '#5ee1c6', interval: 'loop', volume: 60, blob: rec.blob });
}
function removeUserSound(id) {
  const s = S.sounds.get(id);
  dialog(`<h3>내 음원 삭제</h3><p>"${esc(s?.name)}"을(를) 이 기기에서 지울까요? 이 음원을 쓰는 믹스에서도 빠져요.</p><div class="acts"><button data-x>취소</button><button class="pri" data-ok style="background:var(--danger)">삭제</button></div>`, (dlg, close) => {
    $('[data-x]', dlg).onclick = close;
    $('[data-ok]', dlg).onclick = async () => {
      await deleteUserSound(id).catch(() => {});
      S.sounds.delete(id); buffers.delete(id);
      S.current.tracks = S.current.tracks.filter((t) => t.soundId !== id);
      S.mixes.forEach((m) => (m.tracks = m.tracks.filter((t) => t.soundId !== id)));
      saveMixes(S.mixes); persist(); syncEngine();
      close(); renderLib(); renderLeft();
    };
  });
}

// ---------------------------------------------------------------- mobile pages
const main = $('#main');
function goPage(i, smooth = true) {
  if (!isMobile()) return;
  main.scrollTo({ left: i * main.clientWidth, behavior: smooth ? 'smooth' : 'instant' });
}
$('#pager').addEventListener('click', (e) => { const b = e.target.closest('[data-page]'); if (b) goPage(+b.dataset.page); });
main.addEventListener('scroll', () => {
  const p = Math.round(main.scrollLeft / main.clientWidth);
  $$('#pager button').forEach((b) => b.classList.toggle('on', +b.dataset.page === p));
}, { passive: true });

// ---------------------------------------------------------------- media session (lock screen controls)
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title: S.current.name, artist: 'ORBIT', artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }] });
  navigator.mediaSession.playbackState = engine.playing ? 'playing' : 'paused';
}
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', play);
  navigator.mediaSession.setActionHandler('pause', pause);
}

// ---------------------------------------------------------------- boot
async function boot() {
  try {
    const res = await fetch('sounds/manifest.json', { cache: 'no-cache' });
    const m = await res.json();
    S.cats = m.categories;
    m.sounds.forEach((s) => S.sounds.set(s.id, { ...s, image: s.image ? 'sounds/' + s.image : null }));
  } catch (e) {
    toast('음원 목록을 불러오지 못했어요');
  }
  (await listUserSounds()).forEach(addUserSound);
  // drop tracks whose sound no longer exists
  S.current.tracks = S.current.tracks.filter((t) => S.sounds.has(t.soundId));

  if (location.hash.startsWith('#m=')) {
    try {
      const shared = decodeMix(location.hash.slice(3));
      shared.tracks = shared.tracks.filter((t) => S.sounds.has(t.soundId));
      S.current = shared;
      S.view = 'player';
      persist();
      setTimeout(() => toast('공유받은 믹스예요. ▶를 눌러 들어 보세요', 4000), 300);
    } catch { toast('공유 링크를 읽지 못했어요'); }
    history.replaceState(null, '', location.pathname);
  }

  renderTabs(); renderLib(); renderLeft();
  // mobile: open on the library page, or on the mix page for a shared link
  requestAnimationFrame(() => goPage(S.view === 'player' ? 0 : 1, false));

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();

// expose for debugging in the console
window.orbit = { S, engine };
