// Layered flat-vector landscape behind the player.
// The sky, mountains and ground are always there; each sound adds its own layer
// (forest -> trees, stream -> river, ...). Layers fade in and out as the mix changes.

const W = 600, H = 1000;

// Which layers each manifest `scene` turns on.
export const SCENE_LAYERS = {
  rain: ['rain'],
  tent: ['tent', 'rain'],
  storm: ['rain', 'rain2', 'stormcloud'],
  thunder: ['stormcloud', 'bolt'],
  stream: ['river'],
  wave: ['sea'],
  under: ['ripple'],
  forest: ['trees'],
  birds: ['birds', 'flowers'],
  cricket: ['grass', 'fireflies'],
  night: ['owl'],
  fire: ['campfire'],
  fireplace: ['cabin'],
  cafe: ['cabin'],
  clock: ['cabin'],
  chime: ['chime'],
  white: ['aurora'],
  pink: ['aurora'],
  brown: ['aurora'],
  mine: [],
};
const NIGHT_SCENES = new Set(['cricket', 'night']);
const GREY_SCENES = new Set(['rain', 'tent', 'storm', 'thunder']);

// seeded random so the picture is the same every time
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const r = (a, b) => a + rnd() * (b - a);

function pine(x, y, h, cls) {
  const w = h * 0.42;
  let d = '';
  for (let i = 0; i < 4; i++) {
    const top = y - h + i * h * 0.2;
    const bw = w * (0.45 + i * 0.2);
    const by = top + h * 0.36;
    d += `M${x} ${top}L${x - bw} ${by}L${x + bw} ${by}Z`;
  }
  return `<rect class="trunk" x="${x - h * 0.03}" y="${y - h * 0.12}" width="${h * 0.06}" height="${h * 0.14}"/><path class="${cls}" d="${d}"/>`;
}

function build() {
  seed = 7;
  const stars = Array.from({ length: 70 }, (_, i) => `<circle class="star${i % 4 === 0 ? ' tw' : ''}" cx="${r(0, W)}" cy="${r(0, 640)}" r="${r(0.7, 2.1)}" style="animation-delay:${r(0, 4)}s"/>`).join('');
  // distant tree line
  let tl = 'M0 760';
  for (let x = 0; x <= W; x += 9) { const h = r(14, 34); tl += `L${x} ${712 - (x % 18 ? h * 0.4 : h)}`; }
  tl += `L${W} 760Z`;
  const flies = Array.from({ length: 22 }, () => `<circle class="fly" cx="${r(20, 580)}" cy="${r(760, 980)}" r="${r(2, 3.6)}" style="animation-delay:${r(0, 5)}s;animation-duration:${r(3, 6)}s"/>`).join('');
  const grass = Array.from({ length: 70 }, () => { const x = r(0, W), h = r(30, 90), b = r(-14, 14); return `<path d="M${x} 1000Q${x + b / 2} ${1000 - h / 2} ${x + b} ${1000 - h}" />`; }).join('');
  const flowers = Array.from({ length: 26 }, (_, i) => `<circle cx="${r(10, 590)}" cy="${r(880, 990)}" r="${r(3, 6)}" class="fw${i % 3}"/>`).join('');
  const birds = Array.from({ length: 6 }, (_, i) => { const x = 120 + i * 55 + r(-20, 20), y = 380 + r(-60, 60), s = r(0.7, 1.3); return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-14 0Q-7 -8 0 0Q7 -8 14 0" style="animation-delay:${-i * 1.3}s"/></g>`; }).join('');

  return `<svg class="ls" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
<defs>
  <linearGradient id="ls-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="sk1"/><stop offset=".55" class="sk2"/><stop offset=".75" class="sk3"/></linearGradient>
  <radialGradient id="ls-glow"><stop offset="0" stop-color="#ffd27a" stop-opacity=".55"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>
  <radialGradient id="ls-orbglow"><stop offset="0" class="og"/><stop offset="1" class="og" stop-opacity="0"/></radialGradient>
  <linearGradient id="ls-aur" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5ee1c6" stop-opacity="0"/><stop offset=".3" stop-color="#5ee1c6" stop-opacity=".55"/><stop offset=".7" stop-color="#8f8cf0" stop-opacity=".45"/><stop offset="1" stop-color="#8f8cf0" stop-opacity="0"/></linearGradient>
  <pattern id="ls-rainp" width="60" height="120" patternUnits="userSpaceOnUse"><path d="M10 0l-8 26M40 50l-8 26M25 90l-8 26M55 20l-8 26" class="drop"/></pattern>
</defs>
<rect width="${W}" height="${H}" fill="url(#ls-sky)"/>
<g class="L stars">${stars}</g>
<g class="L orb"><circle cx="440" cy="300" r="120" fill="url(#ls-orbglow)"/><circle class="orbc" cx="440" cy="300" r="38"/></g>
<g class="L clouds"><g class="cl" style="--dx:30px"><path d="M60 420a28 28 0 0 1 50-18a36 36 0 0 1 68 6a24 24 0 0 1 22 36H66a22 22 0 0 1-6-24z"/></g><g class="cl" style="--dx:-25px"><path d="M330 330a30 30 0 0 1 54-16a40 40 0 0 1 74 10a24 24 0 0 1 18 34H338a20 20 0 0 1-8-28z"/></g></g>
<g class="L aurora" data-l="aurora"><path class="au" d="M-50 260C80 180 200 330 330 240S520 170 650 250L650 330C520 260 450 350 330 320S80 260 -50 340Z" fill="url(#ls-aur)"/><path class="au au2" d="M-50 380C120 300 240 430 380 350S560 300 650 360L650 410C540 360 460 440 380 410S120 360 -50 430Z" fill="url(#ls-aur)"/></g>
<g class="L stormcloud" data-l="stormcloud"><path d="M-20 0H620V300c-40 30-90 10-120 28c-40 24-90 4-130 22c-40 18-90-6-130 10c-40 16-90-4-130 14c-40 18-80-4-130 10Z"/></g>
<g class="L bolt" data-l="bolt"><rect class="flash" width="${W}" height="${H}"/><path class="bl" d="M360 300l-40 120h34l-50 140 90-170h-36l36-90z"/></g>
<path class="mf" d="M-10 720L70 560L120 600L210 440L270 520L330 470L420 330L500 480L560 430L620 520V740H-10Z"/>
<path class="snow" d="M210 440L188 480L205 474L218 490L232 470ZM420 330L392 382L410 374L424 392L440 368Z"/>
<path class="mm" d="M-10 740L80 640L170 690L260 610L360 680L460 600L560 660L620 630V760H-10Z"/>
<path class="tl" d="${tl}"/>
<g class="L sea" data-l="sea"><rect class="water" x="0" y="728" width="${W}" height="120"/><g class="wv"><path d="M-40 760h90M90 772h120M260 758h80M380 778h140M60 800h110M250 812h150M470 798h100"/></g></g>
<path class="g1" d="M-10 790C120 760 230 800 330 784S520 760 620 776V1010H-10Z"/>
<path class="g2" d="M-10 860C140 820 260 880 400 850S560 836 620 846V1010H-10Z"/>
<g class="L river" data-l="river"><path class="water" d="M286 784C300 800 262 826 280 846S360 880 330 920S240 960 250 1010H430C400 960 470 930 440 900S330 862 340 842S318 798 302 784Z"/><path class="wl" d="M300 860h30M280 930h50M330 975h40"/></g>
<g class="L ripple" data-l="ripple"><ellipse class="pud" cx="170" cy="900" rx="90" ry="20"/><ellipse class="rp" cx="170" cy="900" rx="10" ry="3"/><ellipse class="rp" cx="170" cy="900" rx="10" ry="3" style="animation-delay:1s"/></g>
<g class="L trees" data-l="trees">${pine(40, 1000, 360, 't1')}${pine(115, 1000, 250, 't2')}${pine(170, 990, 170, 't1')}${pine(560, 1000, 380, 't1')}${pine(490, 1000, 260, 't2')}${pine(440, 980, 160, 't1')}</g>
<g class="L cabin" data-l="cabin"><g class="smoke"><circle cx="452" cy="738" r="9"/><circle cx="458" cy="712" r="12"/><circle cx="450" cy="682" r="15"/></g><rect class="chim" x="444" y="748" width="14" height="30"/><rect class="wall" x="360" y="790" width="130" height="80"/><path class="roof" d="M346 796L425 742L504 796Z"/><rect class="win" x="380" y="808" width="30" height="26" rx="2"/><rect class="door" x="438" y="818" width="26" height="52" rx="2"/><path class="frame" d="M395 808v26M380 821h30"/></g>
<g class="L tent" data-l="tent"><g transform="translate(0 -30)"><path class="tentb" d="M90 900L180 780L270 900Z"/><path class="tento" d="M162 900L180 820L198 900Z"/><path class="tline" d="M180 780L180 770"/></g></g>
<g class="L campfire" data-l="campfire"><g transform="translate(0 -50)"><circle cx="330" cy="925" r="110" fill="url(#ls-glow)" class="glow"/><path class="log" d="M296 942l70-16M300 926l66 18" /><path class="fl1" d="M330 860c18 24 28 42 14 64c-6 8-22 8-28 0c-12-18 4-32 14-64z"/><path class="fl2" d="M330 892c9 14 12 22 6 32c-3 4-10 4-13 0c-5-9 2-18 7-32z"/></g></g>
<g class="L chime" data-l="chime"><path class="br" d="M-10 520C60 530 120 512 190 528"/><g class="sw"><path class="str" d="M120 522v40M108 562v40M120 562v54M132 562v46"/><path class="cap" d="M102 562h36"/><rect class="bar" x="104" y="600" width="8" height="26" rx="3"/><rect class="bar" x="116" y="614" width="8" height="30" rx="3"/><rect class="bar" x="128" y="606" width="8" height="24" rx="3"/></g></g>
<g class="L owl" data-l="owl"><path class="br" d="M620 600C540 596 500 612 440 606"/><g class="ow"><path class="owb" d="M488 600c-18 0-24-22-22-38c1-10 6-18 8-26l6 10h16l6-10c2 8 7 16 8 26c2 16-4 38-22 38z"/><circle class="eye" cx="481" cy="556" r="4.5"/><circle class="eye" cx="495" cy="556" r="4.5"/></g></g>
<g class="L birds" data-l="birds">${birds}</g>
<g class="L flowers" data-l="flowers">${flowers}</g>
<g class="L grass" data-l="grass">${grass}</g>
<g class="L fireflies" data-l="fireflies">${flies}</g>
<g class="L rain" data-l="rain"><rect class="rainr" x="-60" y="-120" width="${W + 120}" height="${H + 240}" fill="url(#ls-rainp)"/></g>
<g class="L rain2" data-l="rain2"><g transform="translate(23 37)"><rect class="rainr r2" x="-60" y="-120" width="${W + 120}" height="${H + 240}" fill="url(#ls-rainp)"/></g></g>
</svg>`;
}

// Decide mode + layers from the tracks of the current mix.
export function layersFor(tracks, getSound) {
  const on = new Map(); // layer -> 'on' | 'dim'
  let night = false, grey = false;
  for (const t of tracks) {
    const s = getSound(t.soundId);
    if (!s) continue;
    const sc = s.scene || 'mine';
    if (NIGHT_SCENES.has(sc)) night = true;
    if (GREY_SCENES.has(sc) && !t.muted) grey = true;
    for (const l of SCENE_LAYERS[sc] || []) {
      if (!t.muted) on.set(l, 'on');
      else if (!on.has(l)) on.set(l, 'dim');
    }
  }
  return { on, mode: (night ? 'night' : 'day') + (grey ? ' grey' : '') };
}

export class Landscape {
  constructor() {
    this.el = null;
  }
  // returns the svg element (created once, reused between renders)
  mount(host) {
    if (!this.el) {
      const d = document.createElement('div');
      d.innerHTML = build();
      this.el = d.firstElementChild;
    }
    if (this.el.parentNode !== host) host.prepend(this.el);
    return this.el;
  }
  set({ on, mode }) {
    if (!this.el) return;
    this.el.setAttribute('class', `ls ${mode}`);
    this.el.querySelectorAll('[data-l]').forEach((g) => {
      const st = on.get(g.dataset.l);
      g.classList.toggle('on', st === 'on');
      g.classList.toggle('dim', st === 'dim');
    });
  }
  // react to a one-shot play
  hit(scene) {
    if (!this.el) return;
    const g = scene === 'thunder' ? this.el.querySelector('.bolt') : scene === 'under' ? this.el.querySelector('.ripple') : null;
    if (!g) return;
    g.classList.remove('go');
    void g.getBBox();
    g.classList.add('go');
  }
}
