// Data model, persistence (localStorage + IndexedDB) and small helpers.

export const MAX_INT = 1800; // 30 minutes
const LS_MIXES = 'orbit.mixes.v1';
const LS_CURRENT = 'orbit.current.v1';
const LS_LAST = 'orbit.lastMix.v1';

export const uid = () => Math.random().toString(36).slice(2, 10);

export function defaultTrack(sound) {
  const loop = (sound.interval || 'loop') === 'loop';
  const vol = sound.volume ?? 60;
  return {
    uid: uid(),
    soundId: sound.id,
    volume: { mode: 'fixed', value: vol, min: Math.max(1, vol - 20), max: Math.min(100, vol + 10) },
    interval: {
      mode: loop ? 'loop' : (sound.interval || 'range'),
      value: sound.value ?? 60,
      min: sound.min ?? 10,
      max: sound.max ?? 60,
    },
    fade: loop ? { in: 3, out: 3 } : { in: 0.2, out: 0.8 },
    pos: { x: 0, y: 0 },
    muted: false,
  };
}

export function newMix(name = '새 믹스') {
  return { id: null, name, timer: null, tracks: [], updated: Date.now() };
}

// ---------- time formatting / parsing ----------
export function fmtSec(s) {
  s = Math.round(s);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m}분 ${r}초` : `${m}분`;
}
export function fmtShort(s) {
  s = Math.round(s);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m}:${String(r).padStart(2, '0')}` : `${m}분`;
}
// Accepts "90", "1:30", "2분 15초", "2m", "45s", "1분"
export function parseTime(str) {
  if (str == null) return NaN;
  str = String(str).trim().toLowerCase();
  if (!str) return NaN;
  let m;
  if ((m = str.match(/^(\d+):(\d{1,2})$/))) return +m[1] * 60 + +m[2];
  let total = 0, hit = false;
  for (const [, n, u] of str.matchAll(/(\d+(?:\.\d+)?)\s*(분|m|min|초|s|sec)?/g)) {
    hit = true;
    total += (u === '분' || u === 'm' || u === 'min') ? +n * 60 : +n;
  }
  return hit ? total : NaN;
}

// Log scale for the interval slider: 1s .. 30min
export const logPos = (s) => Math.log(Math.max(1, s)) / Math.log(MAX_INT);
export const posLog = (p) => Math.pow(MAX_INT, Math.min(1, Math.max(0, p)));
export function snapSec(s) {
  if (s < 60) return Math.max(1, Math.round(s));
  if (s < 300) return Math.round(s / 5) * 5;
  return Math.min(MAX_INT, Math.round(s / 30) * 30);
}

export function intervalLabel(i) {
  if (i.mode === 'loop') return '∞';
  if (i.mode === 'fixed') return `${Math.round(i.value)}초마다`;
  if (i.mode === 'range') return `${Math.round(i.min)}~${Math.round(i.max)}초`;
  return '랜덤';
}

// ---------- mixes (localStorage) ----------
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn(e); } };

export const loadMixes = () => readJSON(LS_MIXES, []);
export const saveMixes = (list) => writeJSON(LS_MIXES, list);
export const loadCurrent = () => readJSON(LS_CURRENT, null);
export const saveCurrent = (mix) => writeJSON(LS_CURRENT, mix);
export const loadLast = () => readJSON(LS_LAST, null);
export const saveLast = (id) => writeJSON(LS_LAST, id);

// ---------- user sounds (IndexedDB) ----------
let dbp;
function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('orbit', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('sounds', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('sounds', mode);
    const out = fn(t.objectStore('sounds'));
    t.oncomplete = () => res(out?.result);
    t.onerror = () => rej(t.error);
  });
}
export const listUserSounds = () => tx('readonly', (s) => s.getAll()).then((r) => r || []).catch(() => []);
export const putUserSound = (rec) => tx('readwrite', (s) => s.put(rec));
export const deleteUserSound = (id) => tx('readwrite', (s) => s.delete(id));

// ---------- sharing ----------
export function encodeMix(mix) {
  const data = { n: mix.name, tm: mix.timer, t: mix.tracks.filter((t) => !t.soundId.startsWith('user:')).map((t) => ({
    s: t.soundId, v: t.volume, i: t.interval, f: t.fade, p: t.pos, m: t.muted ? 1 : 0,
  })) };
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeMix(code) {
  const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const d = JSON.parse(new TextDecoder().decode(bytes));
  return {
    id: null, name: d.n || '공유받은 믹스', timer: d.tm ?? null, updated: Date.now(),
    tracks: (d.t || []).map((t) => ({ uid: uid(), soundId: t.s, volume: t.v, interval: t.i, fade: t.f, pos: t.p || { x: 0, y: 0 }, muted: !!t.m })),
  };
}
