// Layered flat-vector landscape behind the player.
// Sky, mountains and meadow are always there; each sound adds its own layer
// (forest -> trees, stream -> lake and river, rain -> falling rain, ...).
// Layers fade in and out as the mix changes. Rain is drawn on a canvas so it moves smoothly.

const W = 600, H = 1000;

// Which layers each manifest `scene` turns on.
export const SCENE_LAYERS = {
  rain: ['rain', 'mist'],
  tent: ['tent', 'rain', 'mist'],
  storm: ['rain', 'rain2', 'mist', 'stormcloud'],
  thunder: ['stormcloud', 'bolt'],
  stream: ['lake', 'river'],
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

// ---------------------------------------------------------------- drawing helpers
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const r = (a, b) => a + rnd() * (b - a);
const f = (n) => Math.round(n * 10) / 10;

// smooth line through points (Catmull-Rom -> cubic Bézier)
function smooth(pts) {
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}
// a filled hill: smooth top edge through pts, closed down to the bottom
const hill = (pts, bottom = H + 10) => `${smooth(pts)}L${W + 20} ${bottom}L-20 ${bottom}Z`;

// mountain range with curved slopes; returns {d, shade, snow}
function range(peaks, base, snowLine) {
  let d = `M-30 ${base}`;
  let shade = '', snow = '';
  let prev = [-30, base - 20];
  d = `M-30 ${base}L${prev[0]} ${prev[1]}`;
  peaks.forEach(([px, py], i) => {
    const next = peaks[i + 1];
    const vx = next ? (px + next[0]) / 2 + r(-12, 12) : W + 30;
    const vy = next ? Math.min(base - 12, Math.max(py, next[1]) + Math.abs(next[0] - px) / 2 * r(0.45, 0.65)) : base - 20;
    // up: concave slope
    d += `C${f(prev[0] + (px - prev[0]) * 0.35)} ${f(prev[1] - (prev[1] - py) * 0.22)} ${f(prev[0] + (px - prev[0]) * 0.72)} ${f(prev[1] - (prev[1] - py) * 0.62)} ${f(px)} ${f(py)}`;
    // down
    d += `C${f(px + (vx - px) * 0.28)} ${f(py + (vy - py) * 0.38)} ${f(px + (vx - px) * 0.65)} ${f(py + (vy - py) * 0.78)} ${f(vx)} ${f(vy)}`;
    // shadow facet: a ridge running from the peak down and to the right
    const h = base - py;
    let ridge = `M${f(px)} ${f(py)}`;
    let x = px, y = py;
    for (let k = 0; k < 4; k++) { x += r(4, 16) * (k % 2 ? -0.3 : 1); y += h / 4; ridge += `L${f(x)} ${f(y)}`; }
    shade += `${ridge}L${f(vx + 80)} ${base + 20}L${f(vx + 80)} ${f(py - 10)}Z`;
    if (py < snowLine) {
      const sh = (snowLine - py) * 0.9 + 24;
      const w = sh * 0.75;
      snow += `M${f(px)} ${f(py - 2)}L${f(px - w * 0.55)} ${f(py + sh * 0.7)}L${f(px - w * 0.3)} ${f(py + sh * 0.55)}L${f(px - w * 0.12)} ${f(py + sh)}L${f(px + w * 0.08)} ${f(py + sh * 0.62)}L${f(px + w * 0.3)} ${f(py + sh * 0.9)}L${f(px + w * 0.6)} ${f(py + sh * 0.6)}Z`;
    }
    prev = [vx, vy];
  });
  d += `L${W + 30} ${base + 40}L-30 ${base + 40}Z`;
  return { d, shade, snow };
}

// jagged pine silhouette; returns [full, litHalf]
function pine(x, base, h, w, tiers = 7) {
  const top = base - h;
  const trunkH = h * 0.07, trunkW = Math.max(1.5, w * 0.06);
  const body = h - trunkH;
  const dy = body / tiers;
  const T = [];
  for (let i = 1; i <= tiers; i++) {
    const t = i / tiers;
    T.push({ y: top + body * t, wl: (w / 2) * (0.16 + 0.84 * t) * r(0.85, 1.1), wr: (w / 2) * (0.16 + 0.84 * t) * r(0.85, 1.1) });
  }
  let left = '';
  T.forEach((p, i) => {
    left += `Q${f(x - p.wl * 0.6)} ${f(p.y - dy * 0.25)} ${f(x - p.wl)} ${f(p.y + 2)}`;
    if (i < tiers - 1) left += `L${f(x - p.wl * 0.4)} ${f(p.y - dy * 0.1)}`;
  });
  let right = '';
  for (let i = tiers - 1; i >= 0; i--) {
    const p = T[i];
    right += `L${f(x + p.wr)} ${f(p.y + 2)}`;
    const q = T[i - 1];
    const nx = q ? x + q.wr * 0.4 : x, ny = q ? q.y - dy * 0.1 : top;
    right += `Q${f(x + p.wr * 0.6)} ${f(p.y - dy * 0.25)} ${f(nx)} ${f(ny)}`;
  }
  const full = `M${f(x)} ${f(top)}${left}L${f(x - trunkW)} ${f(base - trunkH)}L${f(x - trunkW)} ${f(base)}L${f(x + trunkW)} ${f(base)}L${f(x + trunkW)} ${f(base - trunkH)}${right}Z`;
  const lit = `M${f(x)} ${f(top)}${left}L${f(x)} ${f(base - trunkH)}Z`;
  return [full, lit];
}

// a row of small pines standing on a smooth ground line
function treeRow(x0, x1, groundAt, hMin, hMax, gap) {
  let d = '';
  for (let x = x0; x < x1; x += gap * r(0.6, 1.2)) {
    const h = r(hMin, hMax);
    d += pine(x, groundAt(x) + 4, h, h * r(0.38, 0.5), Math.max(3, Math.round(h / 9)))[0];
  }
  return d;
}

// flat-bottomed cloud
function cloud(x, y, w) {
  const bumps = [[0.12, 0.28], [0.32, 0.5], [0.58, 0.42], [0.82, 0.26]];
  let d = `M${f(x)} ${f(y)}`;
  bumps.forEach(([cx, rr]) => {
    const R = w * rr * 0.5;
    d += `A${f(R)} ${f(R)} 0 0 1 ${f(x + w * cx + R * 0.9)} ${f(y - R * 0.35)}`;
  });
  d += `A${f(w * 0.08)} ${f(w * 0.08)} 0 0 1 ${f(x + w)} ${f(y)}Z`;
  return d;
}

function bush(x, y, s) {
  return `<g transform="translate(${f(x)} ${f(y)}) scale(${s})"><path class="bu1" d="M-40 0a24 24 0 0 1 14-34a26 26 0 0 1 46-6a20 20 0 0 1 22 40z"/><path class="bu2" d="M-4 0a26 26 0 0 1 24-40a20 20 0 0 1 22 40z"/></g>`;
}

function tuft(x, y, s, cls = 'gt') {
  return `<path class="${cls}" transform="translate(${f(x)} ${f(y)}) scale(${s})" d="M-14 0Q-12 -14 -18 -26Q-8 -14 -6 -2Q-4 -22 0 -34Q3 -20 4 -2Q8 -16 18 -24Q10 -10 12 0Z"/>`;
}

// ---------------------------------------------------------------- the picture
function build() {
  seed = 11;
  // ground lines
  const g1At = (x) => 872 + Math.sin(x / 95) * 7 + Math.sin(x / 37) * 3;
  const fAAt = (x) => 786 + Math.sin(x / 70 + 1) * 6;

  const m1 = range([[-30, 640], [120, 560], [300, 600], [450, 520], [640, 600]], 790, 580);
  const m2 = range([[20, 700], [200, 650], [380, 690], [540, 660]], 800, 0);

  const stars = Array.from({ length: 90 }, (_, i) => {
    const big = i % 9 === 0;
    return `<circle class="star${i % 3 === 0 ? ' tw' : ''}" cx="${f(r(0, W))}" cy="${f(r(0, 700))}" r="${big ? 2.2 : f(r(0.6, 1.5))}" style="animation-delay:${f(r(0, 5))}s"/>`;
  }).join('');

  const farRow = treeRow(-10, W + 10, fAAt, 14, 30, 7);
  const midRow = treeRow(-10, W + 10, (x) => g1At(x) + 6, 28, 64, 11);

  // big foreground pines (forest layer)
  const big = [[30, 1000, 360, 150], [112, 1006, 250, 110], [182, 990, 150, 66], [575, 1000, 380, 160], [498, 1006, 255, 112], [432, 985, 140, 60]]
    .map(([x, b, h, w]) => { const [full, lit] = pine(x, b, h, w, 9); return `<path class="t2" d="${full}"/><path class="t1" d="${lit}"/>`; }).join('');

  const flies = Array.from({ length: 26 }, () => `<circle class="fly" cx="${f(r(20, 580))}" cy="${f(r(700, 950))}" r="${f(r(5, 9))}" fill="url(#ls-ff)" style="animation-delay:${f(r(0, 6))}s;animation-duration:${f(r(3, 7))}s"/>`).join('');
  const grass = Array.from({ length: 34 }, () => tuft(r(0, W), r(905, 1000), r(0.7, 1.25), 'gt2')).join('');
  const flowers = Array.from({ length: 34 }, (_, i) => {
    const x = r(10, 590), y = r(890, 990), s = r(0.7, 1.2);
    return `<g transform="translate(${f(x)} ${f(y)}) scale(${f(s)})"><path class="stem" d="M0 0V12"/><circle class="fw${i % 3}" r="4.2"/><circle class="fwc" r="1.6"/></g>`;
  }).join('');
  const birds = Array.from({ length: 6 }, (_, i) => {
    const x = 140 + i * 50 + r(-20, 20), y = 520 + r(-50, 40), s = r(0.6, 1.1);
    return `<g transform="translate(${f(x)} ${f(y)}) scale(${f(s)})"><path d="M-16 -2C-10 -10 -4 -8 0 0C4 -8 10 -10 16 -2C9 -5 4 -3 0 3C-4 -3 -9 -5 -16 -2Z" style="animation-delay:${f(-i * 0.37)}s"/></g>`;
  }).join('');
  const sparks = Array.from({ length: 8 }, (_, i) => `<circle class="spark" cx="${f(330 + r(-14, 14))}" cy="900" r="${f(r(1.2, 2.2))}" style="animation-delay:${f(i * 0.4)}s"/>`).join('');

  const baseTufts = Array.from({ length: 16 }, () => tuft(r(0, W), r(880, 990), r(0.7, 1.2))).join('');

  return `<svg class="ls" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
<defs>
  <linearGradient id="ls-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="sk1"/><stop offset=".5" class="sk2"/><stop offset=".78" class="sk3"/></linearGradient>
  <radialGradient id="ls-hglow" cx=".62" cy=".75" r=".6"><stop offset="0" class="hg"/><stop offset="1" class="hg" stop-opacity="0"/></radialGradient>
  <radialGradient id="ls-orbglow"><stop offset="0" class="og" stop-opacity=".7"/><stop offset=".35" class="og" stop-opacity=".25"/><stop offset="1" class="og" stop-opacity="0"/></radialGradient>
  <linearGradient id="ls-haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="hz" stop-opacity="0"/><stop offset="1" class="hz" stop-opacity=".85"/></linearGradient>
  <linearGradient id="ls-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="w1"/><stop offset="1" class="w2"/></linearGradient>
  <radialGradient id="ls-fire"><stop offset="0" stop-color="#ffcf6b" stop-opacity=".7"/><stop offset=".45" stop-color="#ff9a3c" stop-opacity=".22"/><stop offset="1" stop-color="#ff8a2a" stop-opacity="0"/></radialGradient>
  <radialGradient id="ls-ff"><stop offset="0" stop-color="#f4ffb0"/><stop offset=".25" stop-color="#e2ff7a" stop-opacity=".8"/><stop offset="1" stop-color="#c8ff5a" stop-opacity="0"/></radialGradient>
  <radialGradient id="ls-win"><stop offset="0" stop-color="#ffd27a" stop-opacity=".55"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>
  <linearGradient id="ls-aur" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5ee1c6" stop-opacity="0"/><stop offset=".3" stop-color="#6ff0c8" stop-opacity=".7"/><stop offset=".65" stop-color="#9a8cf0" stop-opacity=".55"/><stop offset="1" stop-color="#9a8cf0" stop-opacity="0"/></linearGradient>
  <filter id="ls-blur" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
  <filter id="ls-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4"/></filter>
  <clipPath id="ls-c1"><path d="${m1.d}"/></clipPath>
  <clipPath id="ls-c2"><path d="${m2.d}"/></clipPath>
  <clipPath id="ls-seac"><rect y="796" width="600" height="120"/></clipPath>
  <clipPath id="ls-lakec"><path d="M-20 798C120 794 470 794 620 798V890H-20Z"/></clipPath>
</defs>
<rect width="${W}" height="${H}" fill="url(#ls-sky)"/>
<rect width="${W}" height="${H}" fill="url(#ls-hglow)"/>
<g class="stars">${stars}</g>
<g class="orb"><circle cx="455" cy="470" r="150" fill="url(#ls-orbglow)"/><circle class="orbc" cx="455" cy="470" r="30"/><circle class="crater" cx="446" cy="462" r="6"/><circle class="crater" cx="465" cy="480" r="4"/></g>
<g class="L aurora" data-l="aurora"><g filter="url(#ls-blur)"><path class="au" d="M-60 300C80 220 220 360 340 280S540 200 660 280L660 340C540 280 450 380 340 350S80 290 -60 370Z" fill="url(#ls-aur)"/><path class="au au2" d="M-60 420C120 350 250 470 390 400S560 340 660 400L660 440C540 400 460 480 390 450S120 410 -60 470Z" fill="url(#ls-aur)"/></g></g>
<g class="clouds">
  <g class="cl" style="--dx:26px"><path class="cs" transform="translate(0 6)" d="${cloud(30, 520, 170)}"/><path class="cw" d="${cloud(30, 520, 170)}"/></g>
  <g class="cl" style="--dx:-22px"><path class="cs" transform="translate(0 6)" d="${cloud(360, 480, 200)}"/><path class="cw" d="${cloud(360, 480, 200)}"/></g>
  <g class="cl" style="--dx:16px"><path class="cs" transform="translate(0 5)" d="${cloud(230, 570, 110)}"/><path class="cw" d="${cloud(230, 570, 110)}"/></g>
</g>
<g class="L stormcloud" data-l="stormcloud"><g filter="url(#ls-soft)"><path d="M-40 -10H640V430C600 470 540 450 500 470C450 500 400 470 350 490C300 510 250 480 200 495C150 512 100 485 50 500C10 512 -20 495 -40 500Z"/><path class="sc2" d="M-40 -10H640V340C590 380 520 350 470 380C420 410 360 380 300 400C240 420 180 390 120 410C60 430 0 400 -40 420Z"/></g></g>
<g class="L bolt" data-l="bolt"><rect class="flash" width="${W}" height="${H}"/><g class="blg"><path class="bl blur" filter="url(#ls-soft)" d="M372 400L346 480L362 482L330 560L352 562L318 650L376 548L356 546L388 470L370 468Z"/><path class="bl" d="M372 400L346 480L362 482L330 560L352 562L318 650L376 548L356 546L388 470L370 468Z"/></g></g>
<path class="m1" id="ls-m1" d="${m1.d}"/>
<g clip-path="url(#ls-c1)"><path class="snow" d="${m1.snow}"/><path class="m1s" d="${m1.shade}"/></g>
<rect y="640" width="${W}" height="140" fill="url(#ls-haze)" opacity=".75"/>
<path class="m2" id="ls-m2" d="${m2.d}"/>
<g clip-path="url(#ls-c2)"><path class="m2s" d="${m2.shade}"/></g>
<rect y="700" width="${W}" height="100" fill="url(#ls-haze)" opacity=".8"/>
<path class="fA" d="${hill([[-20, 792], [150, 784], [300, 790], [460, 782], [620, 790]])}"/>
<path class="fA" d="${farRow}"/>
<rect y="760" width="${W}" height="40" fill="url(#ls-haze)" opacity=".6"/>
<path class="g0" d="${hill([[-20, 806], [140, 800], [320, 808], [480, 798], [620, 804]])}"/>
<g class="L sea" data-l="sea"><rect x="0" y="796" width="${W}" height="120" fill="url(#ls-water)"/><g clip-path="url(#ls-seac)"><use href="#ls-m2" class="refl" transform="translate(0 1592) scale(1 -1)"/></g><g class="wv"><path d="M-40 812h90M100 820h130M280 810h80M400 826h150M40 846h110M240 856h170M470 842h100"/></g></g>
<g class="L lake" data-l="lake"><path d="M-20 798C120 794 470 794 620 798V890H-20Z" fill="url(#ls-water)"/><g clip-path="url(#ls-lakec)"><use href="#ls-m2" class="refl" transform="translate(0 1592) scale(1 -1)"/></g><g class="wv"><path d="M60 812h70M200 818h120M380 808h60M460 826h90M120 840h80M300 846h110"/></g></g>
<path class="g1" d="${hill([[-20, g1At(-20)], [100, g1At(100)], [200, g1At(200)], [300, g1At(300)], [400, g1At(400)], [500, g1At(500)], [620, g1At(620)]])}"/>
<g class="L river" data-l="river"><path d="M262 868C280 884 236 900 246 922S330 948 306 972S220 990 214 1010H404C410 985 380 968 400 944S304 912 304 896S296 876 290 866Z" fill="url(#ls-water)"/><path class="wl" d="M262 900h26M276 938h46M318 980h40"/></g>
<g class="L trees" data-l="trees"><path class="fB" d="${midRow}"/></g>
<path class="g2" d="${hill([[-20, 918], [90, 904], [220, 916], [360, 908], [480, 898], [620, 910]])}"/>
<g class="tufts">${baseTufts}</g>
<g class="L grass" data-l="grass">${grass}</g>
<g class="L ripple" data-l="ripple"><ellipse class="pud" cx="160" cy="930" rx="70" ry="13"/><ellipse class="rp" cx="160" cy="930" rx="10" ry="3"/><ellipse class="rp" cx="160" cy="930" rx="10" ry="3" style="animation-delay:1s"/></g>
<g class="L cabin" data-l="cabin">
  <ellipse class="shadow" cx="440" cy="902" rx="92" ry="9"/>
  <circle cx="400" cy="860" r="70" fill="url(#ls-win)" class="wglow"/>
  <g class="smoke" filter="url(#ls-soft)"><circle cx="476" cy="772" r="9"/><circle cx="482" cy="748" r="12"/><circle cx="474" cy="718" r="15"/></g>
  <rect class="chim" x="466" y="782" width="16" height="40"/><rect class="chimc" x="463" y="778" width="22" height="7" rx="2"/>
  <rect class="wall" x="368" y="836" width="146" height="66"/>
  <path class="logs" d="M368 852H514M368 868H514M368 884H514"/>
  <path class="gable" d="M360 840L441 782L522 840Z"/>
  <path class="roof" d="M352 842L441 776L530 842L522 846L441 788L360 846Z"/>
  <rect class="win" x="386" y="852" width="34" height="28" rx="3"/><path class="frame" d="M403 852v28M386 866h34"/>
  <rect class="door" x="452" y="852" width="30" height="50" rx="3"/><circle class="knob" cx="476" cy="878" r="2"/>
</g>
<g class="L tent" data-l="tent">
  <ellipse class="shadow" cx="178" cy="920" rx="100" ry="10"/>
  <path class="tline" d="M100 918L176 806M256 918L180 806"/>
  <path class="tentb" d="M96 918L178 800L262 918Z"/>
  <path class="tents" d="M178 800L262 918H210Z"/>
  <path class="tento" d="M152 918C164 890 172 860 178 832C184 860 192 890 204 918Z"/>
  <path class="tentf" d="M178 832C174 860 168 890 152 918L140 918C158 890 170 860 178 832Z"/>
  <circle class="tentp" cx="178" cy="800" r="3"/>
</g>
<g class="L campfire" data-l="campfire">
  <circle cx="330" cy="900" r="130" fill="url(#ls-fire)" class="glow"/>
  <ellipse class="shadow" cx="330" cy="932" rx="52" ry="7"/>
  <g class="stones"><ellipse cx="290" cy="928" rx="11" ry="7"/><ellipse cx="310" cy="934" rx="12" ry="7"/><ellipse cx="333" cy="936" rx="12" ry="7"/><ellipse cx="356" cy="933" rx="12" ry="7"/><ellipse cx="373" cy="926" rx="10" ry="6"/></g>
  <path class="log" d="M298 926L362 908M302 908L364 928"/><circle class="logend" cx="362" cy="908" r="5"/><circle class="logend" cx="302" cy="908" r="5"/>
  <path class="fl1" d="M330 836C344 858 362 876 354 900C350 914 340 922 330 922C318 922 306 912 304 898C300 878 318 864 330 836Z"/>
  <path class="fl2" d="M332 858C342 872 350 886 344 902C340 912 334 916 330 916C322 916 316 908 316 898C316 884 326 876 332 858Z"/>
  <path class="fl3" d="M330 882C336 890 340 898 337 906C335 911 332 912 330 912C326 912 323 908 323 903C323 896 327 891 330 882Z"/>
  <g class="sparks">${sparks}</g>
</g>
<g class="L chime" data-l="chime"><path class="br" d="M-10 600C50 606 110 596 170 606"/><path class="leaf" d="M150 604c8-10 18-10 24-6c-6 8-16 10-24 6zM60 604c6-10 16-12 22-8c-6 8-14 10-22 8z"/><g class="sw"><path class="str" d="M110 600v34M98 636v40M110 636v54M122 636v46"/><path class="cap" d="M92 636h36"/><rect class="bar" x="94" y="674" width="8" height="28" rx="3"/><rect class="bar" x="106" y="688" width="8" height="32" rx="3"/><rect class="bar" x="118" y="680" width="8" height="26" rx="3"/><path class="str" d="M110 690v34"/><path class="paper" d="M104 722h12l-2 22h-8z"/></g></g>
<g class="L owl" data-l="owl"><path class="br" d="M620 690C560 684 520 698 470 692"/><path class="leaf" d="M520 694c6-10 16-12 22-6c-6 8-14 10-22 6z"/><g class="ow">
  <path class="owb" d="M500 692c-20 0-28-24-26-42c1-12 8-20 9-30l8 10h18l8-10c1 10 8 18 9 30c2 18-6 42-26 42z"/>
  <path class="owbelly" d="M500 688c-10 0-15-14-14-26c1-8 7-12 14-12s13 4 14 12c1 12-4 26-14 26z"/>
  <circle class="eyer" cx="492" cy="640" r="7"/><circle class="eyer" cx="508" cy="640" r="7"/>
  <circle class="eye" cx="492" cy="640" r="4.5"/><circle class="eye" cx="508" cy="640" r="4.5"/>
  <circle class="pupil" cx="492" cy="640" r="2"/><circle class="pupil" cx="508" cy="640" r="2"/>
  <path class="beak" d="M497 648h6l-3 6z"/></g></g>
<g class="L trees" data-l="trees">${big}${bush(70, 960, 1.1)}${bush(560, 968, 1.2)}${bush(250, 1000, 0.9)}</g>
<g class="L birds" data-l="birds">${birds}</g>
<g class="L flowers" data-l="flowers">${flowers}</g>
<g class="L fireflies" data-l="fireflies">${flies}</g>
<g class="L mist" data-l="mist"><g filter="url(#ls-blur)"><ellipse class="fog" cx="150" cy="790" rx="260" ry="26"/><ellipse class="fog f2" cx="470" cy="830" rx="240" ry="22"/><ellipse class="fog" cx="300" cy="720" rx="320" ry="30"/></g></g>
</svg>`;
}

// ---------------------------------------------------------------- rain (canvas)
class Rain {
  constructor() {
    this.cv = document.createElement('canvas');
    this.cv.className = 'ls-rain';
    this.ctx = this.cv.getContext('2d');
    this.drops = [];
    this.splash = [];
    this.level = 0; // 0 none, 1 rain, 2.4 storm
    this.target = 0;
    this.alpha = 0;
    this.raf = 0;
    this.last = 0;
    this.tick = this.tick.bind(this);
    new ResizeObserver(() => this.resize()).observe(this.cv);
  }
  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (!w || !h) return;
    this.cv.width = w * dpr; this.cv.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
  }
  set(level) {
    this.target = level;
    if (level > 0 && !this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.tick); }
  }
  spawn(n) {
    for (let i = 0; i < n; i++) {
      const z = Math.random(); // 0 far .. 1 near
      this.drops.push({
        x: Math.random() * (this.w + 120) - 60,
        y: -Math.random() * this.h * 0.3 - 20,
        z,
        len: 10 + z * 22,
        v: 420 + z * 620,
        a: 0.12 + z * 0.3,
        wd: 0.6 + z * 1.1,
        end: this.h * (0.72 + z * 0.3),
      });
    }
  }
  tick(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const { ctx } = this;
    if (!this.w) this.resize();
    this.alpha += (Math.min(1, this.target) - this.alpha) * Math.min(1, dt * 1.5);
    this.level += (this.target - this.level) * Math.min(1, dt * 1.5);
    const want = Math.round((this.w * this.h) / 2600 * this.level);
    if (this.drops.length < want) this.spawn(Math.min(12, want - this.drops.length));
    ctx.clearRect(0, 0, this.w, this.h);
    const slant = 0.16;
    ctx.lineCap = 'round';
    const keep = [];
    for (const d of this.drops) {
      d.y += d.v * dt;
      d.x -= d.v * dt * slant;
      if (d.y > d.end) {
        if (d.z > 0.45 && this.splash.length < 120) this.splash.push({ x: d.x, y: d.y, t: 0, s: 2 + d.z * 4 });
        if (this.drops.length - (this.drops.length - keep.length) <= want) { d.x = Math.random() * (this.w + 120) - 60; d.y = -20 - Math.random() * 60; keep.push(d); }
        continue;
      }
      const g = ctx.createLinearGradient(d.x + d.len * slant, d.y - d.len, d.x, d.y);
      g.addColorStop(0, 'rgba(235,245,250,0)');
      g.addColorStop(1, `rgba(235,245,250,${(d.a * this.alpha).toFixed(3)})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = d.wd;
      ctx.beginPath();
      ctx.moveTo(d.x + d.len * slant, d.y - d.len);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
      keep.push(d);
    }
    this.drops = keep.slice(0, Math.max(want, 0));
    ctx.lineWidth = 1;
    this.splash = this.splash.filter((s) => {
      s.t += dt * 3.2;
      if (s.t >= 1) return false;
      ctx.strokeStyle = `rgba(235,245,250,${((1 - s.t) * 0.35 * this.alpha).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, s.s * s.t * 1.6, s.s * s.t * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
      return true;
    });
    if (this.target === 0 && this.alpha < 0.01) {
      ctx.clearRect(0, 0, this.w, this.h);
      this.drops = []; this.splash = []; this.raf = 0;
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  }
}

// ---------------------------------------------------------------- illustrated layers
// Painted pictures live in art/. A background per mood, and a picture per sound layer.
// Positions are in % of the 941x1672 background frame.
const BG = { day: 'art/bg-day.jpg', night: 'art/bg-night.jpg', rain: 'art/bg-rain.jpg', dusk: 'art/bg-dusk.jpg' };
const PROPS = [
  // layer, file, style (inside the frame)
  ['stormcloud', 'art/stormclouds.webp', 'left:-30%;width:160%;top:30%;height:16%', 'cloudp'],
  ['river', 'art/stream.webp', 'left:24%;width:64%;top:70%;height:31%'],
  ['trees', 'art/pines-right.webp', 'right:-10%;width:50%;bottom:-2%;height:42%'],
  ['trees', 'art/tree-left.webp', 'left:-12%;width:64%;bottom:-1%;height:54%'],
];
// layers drawn by the pictures above (their code-drawn versions are hidden)
const PAINTED = new Set([...PROPS.map((p) => p[0]), 'lake', 'sea']); // the background already has the lake
const FIRE_SCENES = new Set(['fire', 'fireplace', 'cafe', 'clock']);

// ---------------------------------------------------------------- public
// Decide mood + layers from the tracks of the current mix.
export function layersFor(tracks, getSound) {
  const on = new Map(); // layer -> 'on' | 'dim'
  let night = false, grey = false, fire = false;
  for (const t of tracks) {
    const s = getSound(t.soundId);
    if (!s) continue;
    const sc = s.scene || 'mine';
    if (NIGHT_SCENES.has(sc)) night = true;
    if (GREY_SCENES.has(sc) && !t.muted) grey = true;
    if (FIRE_SCENES.has(sc) && !t.muted) fire = true;
    for (const l of SCENE_LAYERS[sc] || []) {
      if (!t.muted) on.set(l, 'on');
      else if (!on.has(l)) on.set(l, 'dim');
    }
  }
  const mood = night ? 'night' : grey ? 'rain' : fire ? 'dusk' : 'day';
  return { on, mood, night, grey, mode: (night || fire ? 'night' : 'day') + (grey ? ' grey' : '') };
}

export class Landscape {
  constructor() {
    this.root = null;
    this.svg = null;
    this.rain = null;
  }
  mount(host) {
    if (!this.root) {
      const root = document.createElement('div');
      root.className = 'lsx';
      root.innerHTML = `<div class="stage">
        ${Object.entries(BG).map(([k, src]) => `<img class="bg" data-bg="${k}" src="${src}" alt="" draggable="false">`).join('')}
        <div class="shimmer"><i></i><i></i><i></i><i></i><i></i></div>
        ${PROPS.map(([l, src, st, cls]) => `<img class="prop ${cls || ''}" data-p="${l}" src="${src}" style="${st}" alt="" draggable="false" loading="lazy">`).join('')}
        ${build()}
      </div>`;
      this.root = root;
      this.svg = root.querySelector('svg');
      this.rain = new Rain();
      root.append(this.rain.cv);
    }
    if (this.root.parentNode !== host) host.prepend(this.root);
    return this.root;
  }
  set({ on, mood, night, grey, mode }) {
    if (!this.root) return;
    this.root.className = `lsx m-${mood}${night && grey ? ' wet' : ''}${on.get('sea') === 'on' ? ' waves' : ''}`;
    this.root.querySelectorAll('.bg').forEach((im) => im.classList.toggle('on', im.dataset.bg === mood));
    this.root.querySelectorAll('.prop').forEach((im) => {
      const st = on.get(im.dataset.p);
      im.classList.toggle('on', st === 'on');
      im.classList.toggle('dim', st === 'dim');
    });
    this.svg.setAttribute('class', `ls img ${mode}`);
    this.svg.querySelectorAll('[data-l]').forEach((g) => {
      const st = PAINTED.has(g.dataset.l) ? null : on.get(g.dataset.l);
      g.classList.toggle('on', st === 'on');
      g.classList.toggle('dim', st === 'dim');
    });
    const lv = (k) => (on.get(k) === 'on' ? 1 : on.get(k) === 'dim' ? 0.25 : 0);
    this.rain.set(lv('rain') + lv('rain2') * 1.4);
  }
  // react to a one-shot play
  hit(scene) {
    if (!this.svg) return;
    const g = scene === 'thunder' ? this.svg.querySelector('.bolt') : scene === 'under' ? this.svg.querySelector('.ripple') : null;
    if (!g) return;
    g.classList.remove('go');
    void g.getBBox();
    g.classList.add('go');
  }
}
