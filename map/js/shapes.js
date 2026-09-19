// Node glyphs. Shape and fill are the secondary encoding that lets nine
// categories share three validated hues: no two categories have the same
// shape, fill and hue, so identity never rests on colour alone.
//
// Classic script, not an ES module: modules are blocked under file://, and this
// page has to work when someone just double-clicks index.html.

window.MAP = window.MAP || {};
(function (MAP) {
'use strict';
const FAMILY_VAR = {
  principals: '--hue-principals',
  counterparties: '--hue-counterparties',
  public: '--hue-public',
  places: '--hue-places',
};

/** Reads the live CSS custom properties so a theme change repaints correctly. */
function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  return {
    family: Object.fromEntries(Object.entries(FAMILY_VAR).map(([k, n]) => [k, v(n)])),
    surface: v('--surface'),
    plane: v('--plane'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    muted: v('--ink-muted'),
    hairline: v('--hairline'),
    edge: v('--edge'),
    edgeStrong: v('--edge-strong'),
    accent: v('--accent'),
    ageOld: v('--age-old'),
    ageNew: v('--age-new'),
    // The freshness halo. Its peak opacity is a token too: the same bloom that
    // reads as light on the dark plane reads as a heavy smudge on the light
    // one, and the difference belongs in the stylesheet with every other
    // colour decision rather than as a magic number in the renderer.
    fresh: v('--fresh'),
    freshVeil: parseFloat(v('--fresh-veil')) || 0,
  };
}

const hex = (c) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Straight sRGB lerp. Both ends of the age ramp are achromatic, so there is
 *  no hue to shift through and a simple mix reads as one continuous scale. */
function mix(a, b, t) {
  const [r1, g1, b1] = hex(a);
  const [r2, g2, b2] = hex(b);
  const k = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(r1 + (r2 - r1) * k)},${Math.round(g1 + (g2 - g1) * k)},${
    Math.round(b1 + (b2 - b1) * k)})`;
}

function withAlpha(color, alpha) {
  const [r, g, b] = hex(color);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Traces a glyph path of the given shape, centered on (x, y). */
function tracePath(ctx, shape, x, y, r) {
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  } else if (shape === 'square') {
    const s = r * 0.92;
    const k = Math.min(3.2, s * 0.34);
    ctx.moveTo(x - s + k, y - s);
    ctx.arcTo(x + s, y - s, x + s, y + s, k);
    ctx.arcTo(x + s, y + s, x - s, y + s, k);
    ctx.arcTo(x - s, y + s, x - s, y - s, k);
    ctx.arcTo(x - s, y - s, x + s, y - s, k);
    ctx.closePath();
  } else if (shape === 'diamond') {
    const s = r * 1.24;
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s, y);
    ctx.lineTo(x, y + s);
    ctx.lineTo(x - s, y);
    ctx.closePath();
  } else if (shape === 'hexagon') {
    const s = r * 1.1;
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      const px = x + Math.cos(a) * s;
      const py = y + Math.sin(a) * s;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  } else {
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
}

/** The same glyph as an inline SVG, so the legend and the canvas cannot drift.
 *  `color` is a CSS custom-property name: the swatch paints with currentColor so
 *  a theme change repaints it without any re-render. */
function swatchSVG(shape, fill, cssVar, size = 17) {
  const color = 'currentColor';
  const style = ` style="color:var(${cssVar})"`;
  const c = size / 2;
  const r = size * 0.36;
  const hollow = fill === 'hollow';
  const attrs = hollow
    ? `fill="none" stroke="${color}" stroke-width="2.4"`
    : `fill="${color}"`;
  let inner;
  if (shape === 'circle') {
    inner = `<circle cx="${c}" cy="${c}" r="${hollow ? r - 1.2 : r}" ${attrs}/>`;
  } else if (shape === 'square') {
    const s = r * 0.92;
    const d = hollow ? s - 1.2 : s;
    inner = `<rect x="${c - d}" y="${c - d}" width="${d * 2}" height="${d * 2}" rx="${Math.min(
      3, d * 0.34)}" ${attrs}/>`;
  } else if (shape === 'diamond') {
    const s = (hollow ? r - 1.2 : r) * 1.24;
    inner = `<polygon points="${c},${c - s} ${c + s},${c} ${c},${c + s} ${c - s},${c}" ${attrs}/>`;
  } else {
    const s = (hollow ? r - 1.2 : r) * 1.1;
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      return `${(c + Math.cos(a) * s).toFixed(2)},${(c + Math.sin(a) * s).toFixed(2)}`;
    }).join(' ');
    inner = `<polygon points="${pts}" ${attrs}/>`;
  }
  // Intrinsic width/height so the glyph is correctly sized everywhere it is
  // used, not only where a container rule happens to size it.
  return `<svg class="swatch"${style} width="${size}" height="${size}"
    viewBox="0 0 ${size} ${size}" aria-hidden="true">${inner}</svg>`;
}

/* ------------------------------------------------------------- recency ---
   What counts as "new" on a map that is meant to answer "what is happening".
   Measured against the reader's own clock rather than the build date, so the
   window is the one the sentence promises — the last seven days — and a quiet
   fortnight honestly shows nothing new instead of a stale banner over the last
   thing anyone happened to add. */
const RECENT_DAYS = 7;
const DAY_MS = 86400000;

/** How new a dated thing is, on 0-1 across that window: 1 on the day it is
 *  dated, falling to 0 at the far edge of it. Anything older, undated, or
 *  dated only to the month or the year returns 0, which is the same statement
 *  as "not part of this group".
 *
 *  The precision test is the point of the function, not a detail of it. "2026"
 *  is not evidence that something happened this week, and a node the record
 *  dates to a month is not one the record dates to a Tuesday — putting a
 *  freshness halo on either would claim a precision the file does not have.
 *
 *  A date ahead of the clock is treated as the newest there is rather than as
 *  an error: node dates are UTC midnight, and a reader far enough east is
 *  simply reading today's entry before UTC agrees it is today. */
function recencyOf(date, now = Date.now()) {
  if (!date || date.precision !== 'day') return 0;
  const days = (now - date.t) / DAY_MS;
  if (days <= 0) return 1;
  if (days >= RECENT_DAYS) return 0;
  return 1 - days / RECENT_DAYS;
}

/** Tier is carried by line style, so verification status survives greyscale. */
const TIER = {
  1: { label: 'Primary document', dash: [], width: 1.5, alpha: 0.92 },
  2: { label: 'Attributed or externally verified', dash: [], width: 1.1, alpha: 0.6 },
  3: { label: 'Open or unresolved', dash: [4, 4], width: 1.2, alpha: 0.55 },
};

function tierLineSVG(tier, cssVar) {
  const t = TIER[tier];
  const dash = t.dash.length ? `stroke-dasharray="${t.dash.join(' ')}"` : '';
  return `<svg class="line" style="color:var(${cssVar})" width="24" height="12"
    viewBox="0 0 24 12" aria-hidden="true">
    <line x1="1" y1="6" x2="23" y2="6" stroke="currentColor" stroke-width="${t.width + 0.6}"
      stroke-opacity="${t.alpha}" ${dash}/></svg>`;
}

MAP.shapes = {
  FAMILY_VAR, readPalette, mix, withAlpha, tracePath, swatchSVG, TIER, tierLineSVG,
  RECENT_DAYS, recencyOf,
};
}(window.MAP));
