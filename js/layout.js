// The opening layout.
//
// The map used to open on wherever a cold force simulation converged to, which
// meant several seconds of drifting nodes before a name could be read. It now
// opens on the arrangement authored in `data/taxonomy.yaml`: the three data
// centers across the top, and everything the record places beneath them in
// courses that descend by how close a party stands to the decisions.
//
// This file decides where things start, and — because nothing rearranges them
// afterwards — where they stay. It adds no force and changes no strength. What
// it also supplies is each node's `home`: the point the cluster springs hold it
// to while Time rings is morphing, which is the one thing that still runs the
// simulation.
//
// Classic script: it publishes MAP.layout and runs before js/graph.js.

window.MAP = window.MAP || {};
(function (MAP) {
'use strict';

// The reserved boxes already carry their own padding, so these are the clear
// air on top of it — enough to read the ladder as steps, and no more, because
// every pixel spent here is a pixel the camera has to zoom out to recover.
const COL_GAP = 5;    // between two reserved boxes on one course
const ROW_GAP = 8;    // between courses inside a band
const BAND_GAP = 28;  // between bands, so the ladder reads as steps
const SWEEPS = 8;     // barycenter passes; converges well before this
const PULL = 0.78;    // how far a name follows its connections, vs its own slot
const FOLD_TRIES = 24;  // fold widths measured on a portrait stage; see seed()

/** Places `members` along one course. The authored order is the reading order
 *  and is never re-sorted — `tx` only says where inside that order a node
 *  would rather sit. Two passes: left to right honouring every target that can
 *  be honoured, then right to left pulling the tail back inside the stage. */
function spread(members, halfW) {
  let cursor = -halfW;
  for (const n of members) {
    n.x = Math.max(n.tx, cursor + n.boxHW);
    cursor = n.x + n.boxHW + COL_GAP;
  }
  let limit = halfW;
  for (let i = members.length - 1; i >= 0; i--) {
    const n = members[i];
    n.x = Math.min(n.x, limit - n.boxHW);
    limit = n.x - n.boxHW - COL_GAP;
  }

  // Those two passes can only push a name right or pull it left, so a course
  // that had to open up to fit its labels comes out sitting to the right of
  // where it asked to be — and a map of eleven such courses leans. Slide each
  // one back onto the average of the targets it was given.
  const last = members[members.length - 1];
  const lo = -halfW - (members[0].x - members[0].boxHW);
  const hi = halfW - (last.x + last.boxHW);
  let shift = 0;
  for (const n of members) shift += n.tx - n.x;
  shift /= members.length;
  shift = lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, shift));
  if (shift) for (const n of members) n.x += shift;
}

/** A portrait screen is the one shape the ladder cannot fill: eleven courses
 *  laid across it frame as a band through the middle, with the screen empty
 *  above and below and every name too small to read. There, a course longer
 *  than the width continues on the line beneath it. The authored order is
 *  untouched — the course just turns the corner — so the reading order and the
 *  band it belongs to survive the fold.
 *
 *  Lines are evened out rather than filled to the brim, because a course
 *  packed greedily ends on a line holding one name, which reads as a stray
 *  rather than as the end of a course. */
function foldCourse(members, width) {
  const w = members.map((n) => 2 * n.boxHW + COL_GAP);
  const total = w.reduce((s, x) => s + x, -COL_GAP);
  if (total <= width || members.length < 2) return [members];

  const lines = Math.ceil(total / width);
  const target = total / lines;
  const out = [];
  let run = [];
  let span = -COL_GAP;
  for (let i = 0; i < members.length; i++) {
    const linesLeft = lines - out.length;
    // Closing here must still leave a name for every line that is left.
    const canClose = run.length && members.length - i >= linesLeft - 1;
    if (canClose && (span + w[i] > width || (linesLeft > 1 && span + w[i] > target))) {
      out.push(run);
      run = [];
      span = -COL_GAP;
    }
    run.push(members[i]);
    span += w[i];
  }
  if (run.length) out.push(run);
  return out;
}

/** One course laid out end to end, in world units. */
function courseSpan(members) {
  return members.reduce((s, n) => s + 2 * n.boxHW + COL_GAP, -COL_GAP);
}

/** Folds every course to a width, keeping each one's band and its place in the
 *  ladder. The first course stays the first: it is the one the map hangs from. */
function foldAll(rows, width) {
  return rows.flatMap((c) => foldCourse(c.members, width).map((members, i) => ({
    band: c.band, members, first: c.first && i === 0,
  })));
}

/** Writes the heights, gaps and spans a list of courses needs, and returns the
 *  box they come to. */
function measure(rows) {
  rows.forEach((c, i) => {
    c.up = Math.max(...c.members.map((n) => n.boxUp));
    c.down = Math.max(...c.members.map((n) => n.boxDown));
    c.gap = i === 0 ? 0 : rows[i - 1].band === c.band ? ROW_GAP : BAND_GAP;
    c.span = courseSpan(c.members);
  });
  return [
    Math.max(...rows.map((c) => c.span)),
    rows.reduce((s, c) => s + c.gap + c.up + c.down, 0),
  ];
}

/** Reads the authored hierarchy into a flat list of courses, top to bottom.
 *  Anything the hierarchy does not name still has to be drawn, so it lands on
 *  a course of its own at the foot of the map and says so — though the build
 *  fails on an unplaced node long before this can happen. */
function courses(nodes, hierarchy) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = [];
  const seated = new Set();

  hierarchy.forEach((band, bi) => {
    for (const row of band.rows || []) {
      const members = row.map((id) => byId.get(id)).filter(Boolean);
      if (!members.length) continue;
      for (const n of members) { n.band = band.key; seated.add(n.id); }
      // The first course is the one the rest of the map hangs from, and it is
      // the one course that is never pulled onto its own contents.
      out.push({ band: bi, members, first: out.length === 0 });
    }
  });

  const orphans = nodes.filter((n) => !seated.has(n.id));
  if (orphans.length) {
    console.warn('map: no seat in the taxonomy.yaml hierarchy for ' +
      orphans.map((n) => n.id).join(', '));
    for (const n of orphans) n.band = 'unplaced';
    out.push({ band: hierarchy.length, members: orphans, first: out.length === 0 });
  }
  return out;
}

/** Writes x, y and `home` onto every node, and returns the box the result
 *  actually needs. `world` is the stage in its own units; a ladder that wants
 *  more room than that gets it, because the camera frames whatever the layout
 *  comes to — whereas a course squeezed into less room than its names need
 *  would simply overlap. */
function seed(nodes, edges, hierarchy, [worldW, worldH], centre) {
  const authored = courses(nodes, hierarchy || []);
  if (!authored.length) return [worldW, worldH];

  // Only a portrait stage folds. Every landscape one — desktop, laptop, tablet,
  // a phone turned on its side — frames the ladder exactly as it always has.
  let rows = authored;
  if (worldH > worldW) {
    // Where to fold decides the shape of the whole ladder, and both ends of the
    // choice are bad: fold narrow and it grows into a ribbon far taller than
    // the screen, fold wide and it stays a strip across the middle of it. The
    // camera then has to zoom out to whichever dimension overshoots, so the
    // fold worth having is simply the one that leaves the map drawn largest.
    // That is cheap to measure and hard to guess, so it is measured.
    const widest = Math.max(...nodes.map((n) => 2 * n.boxHW));
    const longest = Math.max(...authored.map((c) => courseSpan(c.members)));
    let best = null;
    for (let i = 0; i <= FOLD_TRIES; i++) {
      const width = Math.max(widest, widest + ((longest - widest) * i) / FOLD_TRIES);
      const cand = foldAll(authored, width);
      const [w, h] = measure(cand);
      const drawn = Math.min(worldW / Math.max(worldW, w), worldH / Math.max(worldH, h));
      if (!best || drawn > best.drawn) best = { drawn, rows: cand };
    }
    rows = best.rows;
  }

  // A course is as tall as the tallest box on it — the glyph, and the name
  // underneath — and as long as its boxes laid end to end. Both are measured
  // before anything is placed, so nothing has to be compressed afterwards.
  const [needW, needH] = measure(rows);
  const halfW = Math.max(worldW, needW) / 2;
  const halfH = Math.max(worldH, needH) / 2;

  // --------------------------------------------------------- vertical ---
  // Whatever room is left over is shared evenly between the courses, so the
  // ladder fills the frame instead of bunching under the top edge.
  const share = rows.length > 1 ? (halfH * 2 - needH) / (rows.length - 1) : 0;
  let y = -halfH;
  rows.forEach((c, i) => {
    y += c.gap + (i ? share : 0);
    c.y = y + c.up;
    y += c.up + c.down;
    for (const n of c.members) { n.y = c.y; n.vx = 0; n.vy = 0; }
  });

  // ------------------------------------------------------- horizontal ---
  // Start from an even spread across the course, which is already the answer
  // for the data centers: one per column, and the columns the rest of the map
  // hangs from. `slot` keeps that even position, because a course pulled
  // entirely onto its connections leaves half the width empty.
  for (const c of rows) {
    const last = c.members.length - 1;
    const lo = -halfW + c.members[0].boxHW;
    const hi = halfW - c.members[last].boxHW;
    c.members.forEach((n, i) => {
      n.slot = last ? lo + ((hi - lo) * i) / last : 0;
      n.x = n.slot;
    });
  }

  // A focused build is read from its own site, so that site takes the middle of
  // its course and the rest of the course spreads to either side of it. Only the
  // slots move — the authored order is the reading order and is not re-sorted —
  // and because the courses below settle towards what they connect to, putting
  // the site in the middle is what brings its build in under it. Without this a
  // build authored at one end of the top course opens against the edge of the
  // stage with half the map empty beside it.
  const top = rows[0];
  const anchor = centre ? top.members.find((n) => n.id === centre) : null;
  if (anchor && top.members.length > 1) {
    const at = top.members.indexOf(anchor);
    const last = top.members.length - 1;
    const lo = -halfW + top.members[0].boxHW;
    const hi = halfW - top.members[last].boxHW;
    top.members.forEach((n, i) => {
      n.slot = i === at ? 0
        : i < at ? (lo * (at - i)) / at
        : (hi * (i - at)) / (last - at);
      n.x = n.slot;
    });
  }

  // Then let each name drift, inside its course and inside its authored order,
  // most of the way towards the average of what it connects to. That is what
  // puts a grantor under the entity it conveyed to and a notary under what it
  // notarised — the columns the map reads by — while the share left on the
  // even slot keeps a course from collapsing onto one side of the stage.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    adj.get(e.sourceId)?.push(e.targetId);
    adj.get(e.targetId)?.push(e.sourceId);
  }

  for (let pass = 0; pass < SWEEPS; pass++) {
    // The data centers stay where the even spread put them: they are the
    // columns, and a column that drifts towards its own contents is not one.
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i];
      if (c.first) continue;
      for (const n of c.members) {
        let sum = 0;
        let count = 0;
        for (const id of adj.get(n.id) || []) {
          const o = byId.get(id);
          if (o && o !== n) { sum += o.x; count++; }
        }
        n.tx = count ? (sum / count) * PULL + n.slot * (1 - PULL) : n.x;
      }
      spread(c.members, halfW);
    }
  }

  // The seat each node keeps: normalised, so the same layout holds when the
  // window changes size, and so the cluster springs pull towards the ladder.
  for (const n of nodes) {
    n.home = { x: n.x / halfW, y: n.y / halfH };
  }

  return [halfW * 2, halfH * 2];
}

MAP.layout = { seed };
}(window.MAP));
