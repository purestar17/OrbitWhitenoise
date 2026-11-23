// Seamless video loop: two stacked <video>s, the next clip fades in over the end of the current one.
// With several clips the next one is picked at random (never the same twice in a row).
export class LoopVideo {
  constructor(srcs, { className = '', poster = '', fade = 1, onReady } = {}) {
    this.srcs = srcs.filter(Boolean);
    this.fade = fade;
    this.el = document.createElement('div');
    this.el.className = className;
    this.el._lv = this;
    this.v = [0, 1].map((i) => {
      const v = document.createElement('video');
      Object.assign(v, { muted: true, playsInline: true, preload: i ? 'metadata' : 'auto' });
      v.setAttribute('aria-hidden', 'true');
      v.style.zIndex = 1 - i;
      v.style.opacity = i ? 0 : 1;
      v.addEventListener('ended', () => this.cur === v && this.next());
      v.addEventListener('timeupdate', () => this.cur === v && this.check());
      this.el.appendChild(v);
      return v;
    });
    if (poster) this.v[0].poster = poster;
    this.ci = Math.floor(Math.random() * this.srcs.length);
    this.cur = this.v[0];
    this.cur.src = this.srcs[this.ci];
    this.prepare();
    if (onReady) this.cur.addEventListener('loadeddata', onReady, { once: true });
    this.playing = false;
    this.fading = false;
    this.raf = 0;
  }
  get other() { return this.cur === this.v[0] ? this.v[1] : this.v[0]; }
  pick() {
    const n = this.srcs.length;
    if (n < 2) return 0;
    const i = Math.floor(Math.random() * (n - 1));
    return i >= this.ci ? i + 1 : i;
  }
  // load the clip that comes next into the hidden video
  prepare() {
    this.ni = this.pick();
    const o = this.other, src = new URL(this.srcs[this.ni], location.href).href;
    if (o.src !== src) o.src = src;
    o.preload = 'auto';
    try { o.currentTime = 0; } catch { /* not loaded yet */ }
  }
  check() {
    const v = this.cur;
    if (this.fading || !v.duration || !isFinite(v.duration)) return;
    if (v.currentTime >= v.duration - Math.min(this.fade, v.duration * 0.25)) this.next();
  }
  next() {
    if (this.fading) return;
    const from = this.cur, to = this.other;
    const f = from.duration && isFinite(from.duration) ? Math.min(this.fade, from.duration * 0.25) : 0;
    this.fading = true;
    to.style.transition = 'none';
    to.style.opacity = 0;
    to.style.zIndex = 2;
    from.style.zIndex = 1;
    try { to.currentTime = 0; } catch { /* ignore */ }
    if (this.playing) to.play().catch(() => {});
    void to.offsetWidth; // start the fade from 0
    to.style.transition = `opacity ${f}s linear`;
    to.style.opacity = 1;
    clearTimeout(this.ft);
    this.ft = setTimeout(() => {
      from.pause();
      from.style.transition = 'none';
      from.style.opacity = 0;
      this.cur = to;
      this.ci = this.ni;
      this.fading = false;
      this.prepare();
    }, f * 1000 + 60);
  }
  tick = () => {
    this.check();
    this.raf = this.playing ? requestAnimationFrame(this.tick) : 0;
  };
  play() {
    this.playing = true;
    this.cur.play().catch(() => {});
    if (this.fading) this.other.play().catch(() => {});
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }
  pause() {
    this.playing = false;
    this.v.forEach((v) => v.pause());
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
  setPos(p) { this.v.forEach((v) => { v.style.objectPosition = p; }); }
  destroy() {
    this.pause();
    clearTimeout(this.ft);
    this.v.forEach((v) => { v.removeAttribute('src'); v.load(); });
    this.el.remove();
  }
}
