// Audio engine: plays a mix of tracks with the Web Audio API.
//
// Track settings (see defaultTrack in model.js):
//   volume:   { mode: 'fixed' | 'range' | 'full', value, min, max }   (1..100 %)
//   interval: { mode: 'loop' | 'fixed' | 'range' | 'full', value, min, max } (seconds, 1..1800)
//   fade:     { in, out }  seconds
//   pos:      { x, y }  -1..1, (0,0) = listener; y < 0 is in front
//   muted:    boolean

export const VOL_FULL = [1, 100];
export const INT_FULL = [1, 1800];
const POS_SCALE = 6; // radar edge = 6 "metres" away

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class Engine {
  constructor(loadBuffer) {
    this.loadBuffer = loadBuffer; // async (soundId) => AudioBuffer
    this.ctx = null;
    this.players = new Map(); // track uid -> TrackPlayer
    this.playing = false;
    this.listeners = new Set();
    this.volume = 1;
  }

  ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'playback' });
      this.master = this.ctx.createGain();
      this.vol = this.ctx.createGain();
      this.vol.gain.value = this.volume;
      this.master.connect(this.vol).connect(this.ctx.destination);
      const l = this.ctx.listener;
      if (l.positionX) { l.positionX.value = 0; l.positionY.value = 0; l.positionZ.value = 0; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  // overall mix volume, 0..1 (squared so the slider feels even to the ear)
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v)) ** 2;
    if (!this.vol) return;
    const now = this.ctx.currentTime;
    this.vol.gain.cancelScheduledValues(now);
    this.vol.gain.setTargetAtTime(this.volume, now, 0.03);
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { this.listeners.forEach((fn) => fn(ev)); }

  // Bring the set of players in line with the mix's tracks.
  sync(tracks) {
    const ids = new Set(tracks.map((t) => t.uid));
    for (const [uid, p] of this.players) {
      if (!ids.has(uid)) { p.dispose(); this.players.delete(uid); }
    }
    for (const t of tracks) {
      let p = this.players.get(t.uid);
      if (!p) {
        if (!this.ctx) continue; // created lazily on first play
        p = new TrackPlayer(this, t);
        this.players.set(t.uid, p);
        if (this.playing) p.start();
      } else {
        p.update(t);
      }
    }
  }

  async play(tracks) {
    this.ensureContext();
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setValueAtTime(1, this.ctx.currentTime);
    this.playing = true;
    this.sync(tracks);
    for (const p of this.players.values()) p.start();
    this.emit({ type: 'state', playing: true });
  }

  pause() {
    this.playing = false;
    for (const p of this.players.values()) p.stop();
    this.emit({ type: 'state', playing: false });
  }

  // Fade everything out over `sec` seconds, then pause (used by the sleep timer).
  fadeOutAndPause(sec = 6) {
    if (!this.ctx || !this.playing) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0.0001, now + sec);
    setTimeout(() => this.pause(), sec * 1000 + 50);
  }

  stopAll() {
    for (const p of this.players.values()) p.dispose();
    this.players.clear();
    this.playing = false;
    this.emit({ type: 'state', playing: false });
  }
}

class TrackPlayer {
  constructor(engine, track) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.t = structuredClone(track);
    this.out = this.ctx.createGain(); // user volume * mute
    this.out.gain.value = 0;
    this.panner = this.ctx.createPanner();
    this.panner.panningModel = 'HRTF';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 1;
    this.panner.maxDistance = 50;
    this.panner.rolloffFactor = 1;
    this.out.connect(this.panner).connect(engine.master);
    this.applyPos();
    this.buffer = null;
    this.loopSrc = null;
    this.loopGain = null;
    this.timer = null;
    this.driftTimer = null;
    this.active = false;
    this.gen = 0; // bumps on every (re)start so stale callbacks are ignored
    this.ready = engine.loadBuffer(track.soundId).then((b) => (this.buffer = b)).catch((e) => {
      console.warn('load failed', track.soundId, e);
      engine.emit({ type: 'error', soundId: track.soundId });
    });
  }

  get now() { return this.ctx.currentTime; }

  // Volume for the next play, 0..1.
  pickVolume() {
    const v = this.t.volume;
    if (v.mode === 'range') return rand(v.min, v.max) / 100;
    if (v.mode === 'full') return rand(VOL_FULL[0], VOL_FULL[1]) / 100;
    return v.value / 100;
  }

  pickInterval() {
    const i = this.t.interval;
    if (i.mode === 'fixed') return i.value;
    if (i.mode === 'range') return rand(i.min, i.max);
    // full random: log-uniform so short and long gaps both actually happen
    return Math.exp(rand(Math.log(INT_FULL[0]), Math.log(INT_FULL[1])));
  }

  setOutGain(ramp = 0.25) {
    const target = this.t.muted ? 0 : 1;
    const g = this.out.gain;
    g.cancelScheduledValues(this.now);
    g.setValueAtTime(g.value, this.now);
    g.linearRampToValueAtTime(target, this.now + ramp);
  }

  applyPos() {
    const { x, y } = this.t.pos || { x: 0, y: 0 };
    const px = x * POS_SCALE, pz = y * POS_SCALE;
    // At the centre, use plain stereo so the sound is "all around" rather than inside the head.
    const centre = Math.hypot(x, y) < 0.08;
    this.panner.panningModel = centre ? 'equalpower' : 'HRTF';
    if (this.panner.positionX) {
      const t = this.now + 0.05;
      this.panner.positionX.linearRampToValueAtTime(centre ? 0 : px, t);
      this.panner.positionY.linearRampToValueAtTime(0, t);
      this.panner.positionZ.linearRampToValueAtTime(centre ? -0.01 : pz, t);
    } else {
      this.panner.setPosition(centre ? 0 : px, 0, centre ? -0.01 : pz);
    }
  }

  async start() {
    this.active = true;
    const gen = ++this.gen;
    this.setOutGain(0.3);
    await this.ready;
    if (!this.active || gen !== this.gen || !this.buffer) return;
    if (this.t.interval.mode === 'loop') this.startLoop(gen);
    else this.scheduleNext(gen, true);
  }

  startLoop(gen) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    // trim encoder padding at both ends so the loop point is clean
    const pad = Math.min(0.03, this.buffer.duration / 20);
    src.loopStart = pad;
    src.loopEnd = this.buffer.duration - pad;
    const g = this.ctx.createGain();
    const fin = Math.max(0.05, this.t.fade.in);
    g.gain.setValueAtTime(0.0001, this.now);
    g.gain.linearRampToValueAtTime(this.pickVolume(), this.now + fin);
    src.connect(g).connect(this.out);
    src.start(this.now, pad);
    this.loopSrc = src;
    this.loopGain = g;
    if (this.t.volume.mode !== 'fixed') this.drift(gen);
  }

  // In loop mode with a random volume, glide to a new level every so often.
  drift(gen) {
    clearTimeout(this.driftTimer);
    this.driftTimer = setTimeout(() => {
      if (gen !== this.gen || !this.loopGain) return;
      const g = this.loopGain.gain;
      const glide = rand(3, 8);
      g.cancelScheduledValues(this.now);
      g.setValueAtTime(g.value, this.now);
      g.linearRampToValueAtTime(this.pickVolume(), this.now + glide);
      this.drift(gen);
    }, rand(6, 20) * 1000);
  }

  scheduleNext(gen, first = false) {
    clearTimeout(this.timer);
    // Start the first play soon so the user hears the sound right away.
    const wait = first ? rand(0.5, Math.min(4, this.pickInterval())) : this.pickInterval();
    this.engine.emit({ type: 'next', uid: this.t.uid, at: Date.now() + wait * 1000 });
    this.timer = setTimeout(() => {
      if (gen !== this.gen || !this.active) return;
      const dur = this.playOnce();
      // interval = silence between plays, so wait for this play to end first
      this.timer = setTimeout(() => {
        if (gen === this.gen && this.active) this.scheduleNext(gen);
      }, dur * 1000);
    }, wait * 1000);
  }

  playOnce() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    const g = this.ctx.createGain();
    const dur = this.buffer.duration;
    const vol = this.pickVolume();
    const fin = Math.min(this.t.fade.in, dur / 2);
    const fout = Math.min(this.t.fade.out, dur / 2);
    const t0 = this.now + 0.02;
    if (fin > 0.01) {
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + fin);
    } else g.gain.setValueAtTime(vol, t0);
    if (fout > 0.01) {
      g.gain.setValueAtTime(vol, t0 + dur - fout);
      g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    }
    src.connect(g).connect(this.out);
    src.start(t0);
    src.onended = () => g.disconnect();
    this.engine.emit({ type: 'hit', uid: this.t.uid });
    return dur;
  }

  stop() {
    this.active = false;
    this.gen++;
    clearTimeout(this.timer);
    clearTimeout(this.driftTimer);
    if (this.loopSrc) {
      const src = this.loopSrc, g = this.loopGain;
      const fout = Math.max(0.05, Math.min(this.t.fade.out, 4));
      g.gain.cancelScheduledValues(this.now);
      g.gain.setValueAtTime(g.gain.value, this.now);
      g.gain.linearRampToValueAtTime(0.0001, this.now + fout);
      src.stop(this.now + fout + 0.02);
      this.loopSrc = null;
      this.loopGain = null;
    }
    const g = this.out.gain;
    g.cancelScheduledValues(this.now);
    g.setValueAtTime(g.value, this.now);
    g.linearRampToValueAtTime(0, this.now + Math.max(0.05, Math.min(this.t.fade.out, 4)));
  }

  update(t) {
    const prev = this.t;
    this.t = structuredClone(t);
    if (prev.muted !== t.muted && this.active) this.setOutGain();
    if (prev.pos?.x !== t.pos?.x || prev.pos?.y !== t.pos?.y) this.applyPos();
    const modeChanged = (prev.interval.mode === 'loop') !== (t.interval.mode === 'loop');
    if (!this.active) return;
    if (modeChanged) {
      this.stop();
      this.start();
      return;
    }
    if (t.interval.mode === 'loop' && this.loopGain) {
      const volChanged = JSON.stringify(prev.volume) !== JSON.stringify(t.volume);
      if (volChanged) {
        const g = this.loopGain.gain;
        g.cancelScheduledValues(this.now);
        g.setValueAtTime(g.value, this.now);
        const target = t.volume.mode === 'fixed' ? t.volume.value / 100
          : clamp(g.value, (t.volume.mode === 'range' ? t.volume.min : 1) / 100, (t.volume.mode === 'range' ? t.volume.max : 100) / 100);
        g.linearRampToValueAtTime(target, this.now + 0.15);
        if (t.volume.mode !== 'fixed') this.drift(this.gen); else clearTimeout(this.driftTimer);
      }
    } else if (t.interval.mode !== 'loop') {
      const intChanged = JSON.stringify(prev.interval) !== JSON.stringify(t.interval);
      if (intChanged) this.scheduleNext(this.gen);
    }
  }

  dispose() {
    this.stop();
    setTimeout(() => { try { this.panner.disconnect(); } catch {} }, 5000);
  }
}
