// Draws everything that is generated from the logo:
//   assets/icon.ico, icon.png, logo.svg      the app and setup icon
//   assets/setup-art.png                     the setup's animated logo: 33 frames of 192 px in rows of 13
//   docs/banner.png, docs/social-preview.png the top of the GitHub page and its link preview
// Needs the Segoe UI fonts that come with Windows.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const require = createRequire(import.meta.url);
const { iconSvg, wedgePaths } = require('../src/logo.js');
const root = new URL('../', import.meta.url);
const file = (rel) => new URL(rel, root).pathname.replace(/^\/([A-Z]:)/i, '$1');
mkdirSync(file('assets'), { recursive: true });
mkdirSync(file('docs'), { recursive: true });

const LEMON = '#ffd60a';

// ---------- icons ----------
const icon = iconSvg();
writeFileSync(file('assets/logo.svg'), icon);
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = await Promise.all(sizes.map((s) => sharp(Buffer.from(icon), { density: 384 }).resize(s, s).png().toBuffer()));
writeFileSync(file('assets/icon.ico'), await pngToIco(pngs));
await sharp(Buffer.from(icon), { density: 768 }).resize(512, 512).png().toFile(file('assets/icon.png'));

// The mark: a light rind with a soft sheen and lemon wedges, with a faint glow. The picture is `size` px with the mark
// filling the middle `fill` part of it, so the glow has room. `turn` rotates the wedges in degrees.
function markSvg(size, turn = 0, glow = 0.35, fill = 0.8) {
  const wedges = wedgePaths().map((d) => `<path d="${d}"/>`).join('');
  const pad = (100 / fill - 100) / 2;
  const body = `<circle cx="50" cy="50" r="44" fill="none" stroke="url(#sheen)" stroke-width="5.5"/>
    <circle cx="50" cy="50" r="39" fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="1.2"/>
    <g transform="rotate(${turn} 50 50)" fill="${LEMON}" stroke="${LEMON}" stroke-width="2" stroke-linejoin="round">${wedges}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${100 + pad * 2} ${100 + pad * 2}" width="${size}" height="${size}">
    <defs><linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c4c4ca"/></linearGradient>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4"/></filter></defs>
    <g filter="url(#soft)" opacity="${glow}">${body}</g>${body}
  </svg>`;
}

// ---------- setup art ----------
const FR = 192, COLS = 13, N = 33;
const frames = [];
for (let i = 0; i < N; i++) {
  const t = i / N;
  const pulse = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
  // eight wedges: turning by one wedge (45 degrees) loops seamlessly
  frames.push(await sharp(Buffer.from(markSvg(FR, 45 * t, 0.2 + 0.25 * pulse))).png().toBuffer());
}
await sharp({ create: { width: FR * COLS, height: FR * Math.ceil(N / COLS), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(frames.map((input, i) => ({ input, left: (i % COLS) * FR, top: Math.floor(i / COLS) * FR })))
  .png({ compressionLevel: 9 }).toFile(file('assets/setup-art.png'));

// ---------- banner ----------
// Text is rendered on its own and trimmed, which gives its real width for the layout.
async function text(str, size, { weight = 400, color = '#f4f4f5' } = {}) {
  const w = Math.ceil(str.length * size * 0.75 + size), h = Math.ceil(size * 1.6);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="${size * 0.2}" y="${size * 1.15}" font-family="Segoe UI" font-weight="${weight}" font-size="${size}" fill="${color}">${str}</text></svg>`;
  const { data, info } = await sharp(Buffer.from(svg)).trim().png().toBuffer({ resolveWithObject: true });
  return { input: data, width: info.width, height: info.height };
}

async function chip(str, size) {
  const t = await text(str, size, { weight: 600, color: '#e8e8ea' });
  const pad = Math.round(size * 0.95), h = Math.round(size * 2.05), w = t.width + pad * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="${h / 2 - 1.5}" fill="#141415" stroke="#3a3a3e" stroke-width="3"/></svg>`;
  const input = await sharp(Buffer.from(svg)).composite([{ input: t.input, left: pad, top: Math.round((h - t.height) / 2) }]).png().toBuffer();
  return { input, width: w, height: h };
}

async function compose(W, H, logo, titleSize, tagSize, chipSize, out) {
  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><radialGradient id="g" cx="50%" cy="115%" r="75%"><stop offset="0" stop-color="#1c1c1d"/><stop offset="1" stop-color="#0a0a0a"/></radialGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/></svg>`;
  const title = await text('Lemonade', titleSize, { weight: 700 });
  const tag = await text('Lyrics, freshly squeezed.', tagSize, { color: '#96969c' });
  const chips = [];
  for (const c of ['Rhymes as you write', 'Record over your beat', 'Free and open source']) chips.push(await chip(c, chipSize));
  const chipGap = Math.round(chipSize * 0.6);
  const chipsW = chips.reduce((a, c) => a + c.width, 0) + chipGap * (chips.length - 1);
  const gap = Math.round(W * 0.05);
  const textW = Math.max(title.width, tag.width, chipsW);
  const x0 = Math.round((W - (logo + gap + textW)) / 2);
  const blockH = title.height + tagSize * 0.7 + tag.height + tagSize * 0.95 + chips[0].height;
  const top = Math.round(H / 2 - blockH / 2);
  const ly = Math.round(H / 2 - logo / 2);
  const tx = x0 + logo + gap;

  const shadow = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><ellipse cx="${x0 + logo / 2}" cy="${ly + logo * 1.03}" rx="${logo * 0.3}" ry="${logo * 0.035}" fill="#000" fill-opacity="0.7"/></svg>`))
    .blur(logo * 0.035).png().toBuffer();
  const big = Math.round(logo / 0.8), off = Math.round((big - logo) / 2);
  const mark = await sharp(Buffer.from(markSvg(big, 0, 0.22))).png().toBuffer();
  const layers = [
    { input: shadow, left: 0, top: 0 },
    { input: mark, left: x0 - off, top: ly - off },
    { input: title.input, left: tx, top },
    { input: tag.input, left: tx + Math.round(tagSize * 0.04), top: Math.round(top + title.height + tagSize * 0.7) },
  ];
  let cx = tx;
  const cy = Math.round(top + title.height + tagSize * 0.7 + tag.height + tagSize * 0.95);
  for (const c of chips) { layers.push({ input: c.input, left: cx, top: cy }); cx += c.width + chipGap; }
  await sharp(Buffer.from(bg)).composite(layers).png({ compressionLevel: 9 }).toFile(out);
}

await compose(2560, 840, 400, 196, 62, 34, file('docs/banner.png'));
await compose(1280, 640, 230, 92, 32, 18, file('docs/social-preview.png'));
console.log('art written');
