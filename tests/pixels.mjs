/**
 * Pixel inspection for the test suites.
 *
 * Computed styles lie. A heading can report the right colour, the right font
 * size and a sane bounding box while painting nothing at all — that is exactly
 * how the mobile rotating word stayed broken through a passing test. The only
 * honest assertion about rendering is "count the pixels".
 *
 * PNG decoding needs an inflate, and Node ships one, so this costs no packages.
 */
import zlib from 'node:zlib';

/** Decode a non-interlaced 8-bit RGB/RGBA PNG into { width, height, data }. */
export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');

  let width = 0;
  let height = 0;
  let colorType = 6;
  const idat = [];

  for (let at = 8; at < buffer.length; ) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('ascii', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);

    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      colorType = body[9];
      if (body[8] !== 8) throw new Error('only 8-bit PNGs are supported');
      if (body[12] !== 0) throw new Error('interlaced PNGs are not supported');
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length; // length + type + body + CRC
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error('unsupported colour type ' + colorType);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);

  // Undo the per-scanline filters (PNG spec §9). Each row is prefixed with the
  // filter type it was encoded with, and refers back to the row above.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0; // left
      const b = prev ? prev[x] : 0; // above
      const c = prev && x >= channels ? prev[x - channels] : 0; // upper left
      let value = src[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = value & 0xff;
    }
  }

  return { width, height, data: out, channels };
}

/**
 * The page-coordinate box of an element.
 *
 * getBoundingClientRect() is relative to the viewport, but a screenshot clip is
 * relative to the document — so once the page is scrolled, passing a raw rect
 * captures somewhere else entirely and every ink assertion reads zero. Always
 * source boxes from here rather than measuring in the page by hand.
 */
export async function pageBox(client, selector, index = 0) {
  return client.eval(`
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x + window.scrollX, y: b.y + window.scrollY,
             width: b.width, height: b.height };`);
}

/** Screenshot a region of the page and decode it. `clip` is in PAGE coordinates. */
export async function shoot(client, clip) {
  const { data } = await client.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: {
      x: Math.max(0, Math.floor(clip.x)),
      y: Math.max(0, Math.floor(clip.y)),
      width: Math.max(1, Math.ceil(clip.width)),
      height: Math.max(1, Math.ceil(clip.height)),
      scale: 1,
    },
  });
  return decodePng(Buffer.from(data, 'base64'));
}

/**
 * The share of pixels that differ noticeably from the image's own most common
 * colour — its background. Text, a logo or an icon pushes this well above zero;
 * an element that occupies space but paints nothing sits at zero.
 */
export function inkRatio(image) {
  const { width, height, data, channels } = image;
  const counts = new Map();
  const key = i => (data[i] >> 3) * 1024 + (data[i + 1] >> 3) * 32 + (data[i + 2] >> 3);

  for (let i = 0; i < data.length; i += channels) {
    const k = key(i);
    counts.set(k, (counts.get(k) || 0) + 1);
  }

  let background = 0;
  let best = -1;
  for (const [k, n] of counts) if (n > best) { best = n; background = k; }

  const br = (background >> 10) & 31;
  const bg = (background >> 5) & 31;
  const bb = background & 31;

  let ink = 0;
  for (let i = 0; i < data.length; i += channels) {
    if (channels === 4 && data[i + 3] < 16) continue; // transparent
    const dr = ((data[i] >> 3) - br);
    const dg = ((data[i + 1] >> 3) - bg);
    const db = ((data[i + 2] >> 3) - bb);
    if (dr * dr + dg * dg + db * db > 9) ink++;
  }
  return ink / (width * height);
}

/** How many distinct colours a region paints — a blank area has very few. */
export function colourCount(image) {
  const { data, channels } = image;
  const seen = new Set();
  for (let i = 0; i < data.length; i += channels) {
    seen.add((data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4));
  }
  return seen.size;
}
