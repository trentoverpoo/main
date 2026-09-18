// Force simulation, camera and canvas renderer.
//
// The map opens on the hierarchy authored in taxonomy.yaml and laid out by
// js/layout.js — settled and framed before the first frame is painted, so
// there is nothing to wait through. Nothing moves on its own after that:
// clicking selects, and dragging moves the node under the pointer and only
// that node, so an arrangement made by hand survives the next thing you pick
// up. The force simulation is still here, and Time rings is what runs it.
// What the layout is held to is legibility: every node reserves the room its
// name needs, the web is laid out in the stage's own units, and the opening
// frame is one where all 85 names can be read without touching anything.
// Time is layered on top three ways, none of which imposes a linear axis —
// an age ramp on every node ring, a scrubber that fades what had not yet
// happened, and an optional morph to concentric rings where radius is date.

// Classic script: d3-force is loaded as a UMD bundle onto the shared `d3`
// global, and this file publishes GraphView onto MAP.

window.MAP = window.MAP || {};
(function (MAP, d3) {
'use strict';

const {
  forceSimulation, forceLink, forceManyBody, forceX, forceY, forceRadial,
} = d3;
const { readPalette, tracePath, mix, withAlpha, TIER } = MAP.shapes;

// Names are laid out in world units alongside the glyphs, not as a screen
// overlay, and the layout reserves the room each one needs. A name therefore
// never sits on a glyph at one zoom and clears it at another, and the default
// framing — the whole web, untouched — is already the readable one.
const LABEL_FONT = 11;     // world units, which the default framing renders 1:1
const LINE_H = 12.4;
const LABEL_GAP = 5;       // glyph edge to the top of the name
const PAD_X = 7;           // breathing room written into the collision box
const PAD_Y = 4;
const WRAP_W = 126;        // names wider than this run onto a second line
const MIN_LABEL_PX = 6.5;  // zoomed out past this, only the hubs keep a name
const HUB_DEGREE = 4;
const MARGIN = 26;         // inset from the stage edge, so no name is clipped
const WORLD_MIN = [960, 620];
const TOPBAR = 52;         // the floating toolbar, which the frame sits clear of
const DRAG_SLOP = 3;       // px of movement that separates a drag from a click

/** At most two lines, split at whichever space leaves the evenest pair: a
 *  residuary trust reads better stacked than as one line the width of a
 *  neighbourhood, and a squarer box packs into the web far better. */
function wrapLabel(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return [text];
  const words = text.split(' ');
  if (words.length < 2) return [text];
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const w = Math.max(ctx.measureText(a).width, ctx.measureText(b).width);
    if (!best || w < best.w) best = { w, lines: [a, b] };
  }
  return best.lines;
}

/** Overlapping area of two boxes, 0 when they are clear of each other. */
function overlapArea(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  if (w <= 0) return 0;
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return h <= 0 ? 0 : w * h;
}

class GraphView {
  constructor(canvas, data, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.data = data;
    this.onSelect = opts.onSelect || (() => {});
    this.onSelectEdge = opts.onSelectEdge || (() => {});
    this.onHover = opts.onHover || (() => {});

    this.nodes = data.nodes;
    this.edges = data.edges;
    this.shapeOf = new Map(data.taxonomy.categories.map((c) => [c.key, c]));
    this.byId = new Map(this.nodes.map((n) => [n.id, n]));

    this.palette = readPalette();
    this.camera = { x: 0, y: 0, k: 1 };
    this.hover = null;
    this.selected = null;
    this.neighbors = new Set();
    this.ringMode = false;
    this.ringStrength = 0;
    this.timeCursor = Infinity;
    this.visibleNodes = new Set(this.nodes.map((n) => n.id));
    this.visibleEdges = new Set(this.edges.map((e) => e.id));

    this._indexEdges();
    this._measureStage();
    this._prepareNodes();
    this._seedLayout();
    this._initSim();
    this._bindEvents();
    this.resize();
    this._open();
  }

  /** The opening arrangement, from the hierarchy in taxonomy.yaml. Runs after
   *  _prepareNodes, which is what measures the box each name needs.
   *
   *  A ladder of eleven courses does not always fold into the stage as neatly
   *  as a web does, so the world is whatever the ladder came to — never less
   *  than the stage. Undersizing it would only hand the overflow to the bounds
   *  clamp, which would pile the ends of the long courses on top of each
   *  other; oversizing it costs a little zoom and nothing else. */
  _seedLayout() {
    const need = MAP.layout.seed(this.nodes, this.edges,
      this.data.taxonomy.hierarchy, this.stageBase);
    this.layoutNeed = need.map(Math.ceil);
    this._sizeWorld();
  }

  /** The first frame is the settled one. Separation and framing cost a few
   *  milliseconds, so they happen before anything is painted rather than a few
   *  seconds into a simulation: the map is readable the moment it appears. */
  _open() {
    this._settle();
    this._fitted = true;
    this.fit(16, false);
  }

  // Curve parallel edges apart so four OakStar instruments between the same two
  // entities read as four lines rather than one thick smear.
  _indexEdges() {
    const groups = new Map();
    for (const e of this.edges) {
      const key = [e.sourceId, e.targetId].sort().join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    }
    for (const list of groups.values()) {
      const n = list.length;
      list.forEach((e, i) => { e.curve = n === 1 ? 0 : (i - (n - 1) / 2) * 0.24; });
    }
    this.adjacency = new Map(this.nodes.map((n) => [n.id, new Set()]));
    for (const e of this.edges) {
      this.adjacency.get(e.sourceId)?.add(e.targetId);
      this.adjacency.get(e.targetId)?.add(e.sourceId);
    }
  }

  /** The layout is laid out in the stage's own units: the settled web is as
   *  big as the screen it has to fit, so the default framing lands near 1:1
   *  and a name sized for reading is sized for the layout too. A small window
   *  keeps a floor and scales down rather than jamming the web together. */
  _measureStage() {
    const rect = this.canvas.getBoundingClientRect();
    this.stageBase = [
      Math.max(WORLD_MIN[0], (rect.width || 1040) - MARGIN * 2),
      Math.max(WORLD_MIN[1], (rect.height || 720) - MARGIN * 2 - TOPBAR),
    ];
    this._sizeWorld();
  }

  /** The world is the stage, or the ladder, whichever is larger. */
  _sizeWorld() {
    const need = this.layoutNeed || [0, 0];
    this.worldBase = [
      Math.max(this.stageBase[0], need[0]),
      Math.max(this.stageBase[1], need[1]),
    ];
    [this.worldW, this.worldH] = this.worldBase;
  }

  /** Glyph size, age ramp, and the box each node holds open for its name. */
  _prepareNodes() {
    const [t0, t1] = this.data.meta.timeExtent;
    const span = Math.max(1, t1 - t0);
    const { ctx } = this;
    ctx.save();
    ctx.font = `450 ${LABEL_FONT}px ${getComputedStyle(document.body).fontFamily}`;
    for (const n of this.nodes) {
      n.age = n.date ? (n.date.t - t0) / span : 0.5;
      n.radius = 7 + Math.sqrt(n.degree) * 2.5;
      // A name the file spells out over two lines is drawn as written — each
      // data center carries a recognisable name above an address that, on its
      // own, most readers would not place.
      n.lines = n.label && n.label.length ? n.label : wrapLabel(ctx, n.short, WRAP_W);
      n.labelW = Math.max(...n.lines.map((l) => ctx.measureText(l).width));
      n.labelH = n.lines.length * LINE_H;
      // The reserved box: the glyph, and the name sitting under it.
      n.boxHW = Math.max(n.radius + 4, n.labelW / 2) + PAD_X;
      n.boxUp = n.radius + 4 + PAD_Y;
      n.boxDown = n.radius + LABEL_GAP + n.labelH + PAD_Y;
    }
    ctx.restore();
  }

  _initSim() {
    this.sim = forceSimulation(this.nodes)
      .force('link', forceLink(this.edges).id((d) => d.id).distance((e) => {
        // Adjacency and professional-service links sit looser: they are weaker
        // statements about the network than ownership or a conveyance.
        const loose = e.type === 'adjacency' || e.type === 'professional';
        return (loose ? 132 : 86) + (e.tier === 3 ? 38 : 0);
      }))
      .force('charge', forceManyBody().distanceMax(700))
      .force('clusterX', forceX(0))
      .force('clusterY', forceY(0))
      .force('ring', forceRadial(0, 0, 0))
      .force('label', () => this._labelCollide())
      .force('bounds', () => this._clampToWorld())
      .alphaDecay(0.022)
      .on('tick', () => this.draw())
      .on('end', () => {
        this._settle();
        this.draw();   // places the names, which fit() then frames
        if (this._refitOnEnd) { this._refitOnEnd = false; this._computeRingLabelAngle(); }
        else if (this._fitted) return;
        this._fitted = true;
        this.fit();
      });

    this._applyWorld();
    this._applyForceStrengths();
    // Cold, on a layout that is already settled. The ring morph is the only
    // thing that reheats it, and it does so from here at the alpha it asks for.
    this.sim.alpha(0).stop();
  }

  /** Seats and ring radii are fractions of the stage, so the same layout reads
   *  on a laptop and on a wall display. A node's seat is the place the
   *  hierarchy gave it — or where it was last dropped — and it is what the
   *  cluster springs hold it to while the ring morph is running. */
  _applyWorld() {
    const hx = this.worldW / 2;
    const hy = this.worldH / 2;
    this.sim.force('clusterX').x((n) => (n.home?.x ?? 0) * hx);
    this.sim.force('clusterY').y((n) => (n.home?.y ?? 0) * hy);
    this.ringOuter = Math.min(hx, hy) - 26;
    this.ringInner = this.ringOuter * 0.2;
    this.sim.force('ring').radius((n) => this._ringRadius(n.age));
  }

  _ringRadius(age) { return this.ringInner + age * (this.ringOuter - this.ringInner); }

  /** Rectangle separation rather than circle packing. What has to stay clear
   *  is the glyph plus the name beneath it, and a name is wide and short: a
   *  circle large enough to hold one would push the web four times further
   *  apart than the ink actually needs. */
  _labelCollide(strength = 0.5) {
    const nodes = this.nodes;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        const ax = a.x + a.vx;
        const ay = a.y + a.vy;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = b.x + b.vx - ax;
          const dy = b.y + b.vy - ay;
          const ox = a.boxHW + b.boxHW - Math.abs(dx);
          if (ox <= 0) continue;
          const oy = dy >= 0 ? a.boxDown + b.boxUp - dy : a.boxUp + b.boxDown + dy;
          if (oy <= 0) continue;
          // Resolve along whichever axis needs the smaller nudge: a pair that
          // barely touches slides sideways instead of jumping.
          const horizontal = ox <= oy;
          const move = (horizontal ? ox : oy) * strength;
          const sign = (horizontal ? dx : dy) >= 0 ? 1 : -1;
          const aFixed = horizontal ? a.fx != null : a.fy != null;
          const bFixed = horizontal ? b.fx != null : b.fy != null;
          if (aFixed && bFixed) continue;
          const share = aFixed || bFixed ? move : move / 2;
          if (horizontal) {
            if (!aFixed) a.vx -= share * sign;
            if (!bFixed) b.vx += share * sign;
          } else {
            if (!aFixed) a.vy -= share * sign;
            if (!bFixed) b.vy += share * sign;
          }
        }
      }
    }
  }

  /** Keeps every reserved box inside the stage, so the web spreads into the
   *  corners instead of settling into a blob with empty margins. */
  _clampToWorld() {
    const hx = this.worldW / 2;
    const hy = this.worldH / 2;
    for (const n of this.nodes) {
      if (n.fx != null || n.fy != null) continue;
      const x0 = -hx + n.boxHW;
      const x1 = hx - n.boxHW;
      const y0 = -hy + n.boxUp;
      const y1 = hy - n.boxDown;
      if (x1 > x0) n.x = Math.max(x0, Math.min(x1, n.x));
      if (y1 > y0) n.y = Math.max(y0, Math.min(y1, n.y));
    }
  }

  _relax(iterations) {
    for (const n of this.nodes) { n.vx = 0; n.vy = 0; }
    for (let i = 0; i < iterations; i++) {
      this._labelCollide(0.6);
      for (const n of this.nodes) {
        if (n.fx == null) { n.x += n.vx; n.vx = 0; }
        if (n.fy == null) { n.y += n.vy; n.vy = 0; }
      }
      this._clampToWorld();
    }
  }

  /** One last pass with the springs switched off. Separation converges in a
   *  few dozen iterations, and the frame people actually read is the settled
   *  one — so it is worth finishing the job rather than leaving it to alpha. */
  _settle() {
    [this.worldW, this.worldH] = this.worldBase;
    for (let round = 0; round <= 5; round++) {
      this._relax(round ? 110 : 260);
      this._applyWorld();
      if (this._layoutLabels().dropped === 0 || round === 5) break;
      // A jammed corner: give the frame a little more room and try again. Past
      // a tenth or so the type shrinks more than the crowding is worth.
      this.worldW = this.worldBase[0] * (1 + 0.02 * (round + 1));
      this.worldH = this.worldBase[1] * (1 + 0.02 * (round + 1));
    }
  }

  // d3-force PRECOMPUTES strength accessors when a force initialises, so a
  // closure that reads a mutable field is frozen at its first value. Re-setting
  // each accessor is what makes d3 recompute, so the morph has to push the new
  // strengths in on every frame rather than relying on the closure.
  _applyForceStrengths() {
    const rs = this.ringStrength;
    this.sim.force('link').strength((e) => {
      const base = e.type === 'adjacency' ? 0.25 : e.tier === 3 ? 0.3 : 0.75;
      return base * (1 - rs * 0.8);
    });
    this.sim.force('charge').strength((n) => (-120 - n.degree * 16) * (1 - rs * 0.45));
    this.sim.force('clusterX').strength((1 - rs) * 0.075);
    this.sim.force('clusterY').strength((1 - rs) * 0.075);
    this.sim.force('ring').strength(rs * 0.9);
  }

  setRingMode(on) {
    this.ringMode = on;
    if (!on) { this._returnToLadder(); return; }
    const target = on ? 1 : 0;
    const step = () => {
      const d = target - this.ringStrength;
      if (Math.abs(d) < 0.01) {
        this.ringStrength = target;
        this._applyForceStrengths();
        // Reframe once the layout has actually stopped, not on a timer: the
        // frame has to be drawn from where the names ended up.
        this._refitOnEnd = true;
        this.sim.alpha(0.5).restart();
        return;
      }
      this.ringStrength += d * 0.07;
      this._applyForceStrengths();
      this.sim.alpha(Math.max(this.sim.alpha(), 0.4)).restart();
      requestAnimationFrame(step);
    };
    this.sim.alpha(0.8).restart();
    step();
  }

  /** Leaving the rings puts the map back the way it opens — the seats the
   *  hierarchy gave every node — rather than wherever the springs happen to
   *  carry it on the way out of a morph. The journey is a tween on the
   *  positions: no force is asked to do it, and none of them is changed. */
  _returnToLadder(dur = 640) {
    this.sim.stop();
    this.ringStrength = 0;
    this._applyForceStrengths();
    const from = this.nodes.map((n) => [n.x, n.y]);
    this._seedLayout();
    this._settle();
    const to = this.nodes.map((n) => [n.x, n.y]);
    const t0 = performance.now();
    const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
    const step = (now) => {
      const e = ease(Math.min(1, (now - t0) / dur));
      this.nodes.forEach((n, i) => {
        n.x = from[i][0] + (to[i][0] - from[i][0]) * e;
        n.y = from[i][1] + (to[i][1] - from[i][1]) * e;
        n.vx = 0;
        n.vy = 0;
      });
      this.draw();
      if (e < 1) { requestAnimationFrame(step); return; }
      // Back on the ladder, and untouched again: a later resize re-seats it
      // rather than reheating an arrangement nobody made.
      this.sim.alpha(0).stop();
      this._touched = false;
    };
    // Framed from the seats, which are already in place — only the journey
    // there is animated — so the camera and the nodes arrive together.
    this.fit(16);
    requestAnimationFrame(step);
  }

  setTimeCursor(t) { this.timeCursor = t; this.draw(); }

  setVisible(nodeIds, edgeIds) {
    this.visibleNodes = nodeIds;
    this.visibleEdges = edgeIds;
    this.draw();
  }

  select(id) {
    this.selectedEdge = null;
    this.selected = id;
    this.neighbors = id ? new Set([id, ...(this.adjacency.get(id) || [])]) : new Set();
    this.draw();
  }

  focus(id, zoom = 1.5) {
    const n = this.nodes.find((x) => x.id === id);
    if (!n) return;
    const rect = this.canvas.getBoundingClientRect();
    const target = { x: rect.width / 2 - n.x * zoom, y: rect.height / 2 - n.y * zoom, k: zoom };
    this._animateCamera(target);
  }

  _animateCamera(target) {
    const from = { ...this.camera };
    const t0 = performance.now();
    const dur = 460;
    const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = ease(p);
      this.camera.x = from.x + (target.x - from.x) * e;
      this.camera.y = from.y + (target.y - from.y) * e;
      this.camera.k = from.k + (target.k - from.k) * e;
      this.draw();
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  refreshPalette() { this.palette = readPalette(); this.draw(); }

  /** Frames the whole web with a margin. The bounds are the reserved boxes,
   *  not the node centers, so names at the edge are inside the frame too. */
  fit(pad = 16, animate = true) {
    const pts = this.nodes.filter((n) => this.visibleNodes.has(n.id) && Number.isFinite(n.x));
    if (!pts.length || !this.width) return;
    let minX = Math.min(...pts.map((n) => n.x - n.boxHW));
    let maxX = Math.max(...pts.map((n) => n.x + n.boxHW));
    let minY = Math.min(...pts.map((n) => n.y - n.boxUp));
    let maxY = Math.max(...pts.map((n) => n.y + n.boxDown));
    // A name that had to take an alternate slot can reach past its own box,
    // and placement is world-space, so the boxes from the last frame hold.
    for (const b of this._labelBoxes || []) {
      minX = Math.min(minX, b.x0); maxX = Math.max(maxX, b.x1);
      minY = Math.min(minY, b.y0); maxY = Math.max(maxY, b.y1);
    }
    // The toolbar floats over the top of the stage, so the frame starts below it.
    const availW = this.width - pad * 2;
    const availH = this.height - TOPBAR - pad;
    const k = Math.max(0.22, Math.min(1.6,
      Math.min(availW / Math.max(1, maxX - minX), availH / Math.max(1, maxY - minY))));
    const target = {
      k,
      x: this.width / 2 - ((minX + maxX) / 2) * k,
      y: TOPBAR + availH / 2 - ((minY + maxY) / 2) * k,
    };
    animate ? this._animateCamera(target) : Object.assign(this.camera, target);
    this.draw();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
    if (this.sim && rect.width) {
      const before = this.stageBase;
      this._measureStage();
      if (before[0] !== this.stageBase[0] || before[1] !== this.stageBase[1]) {
        // A map nobody has moved is re-seated on the new stage, so a resized
        // window opens on the same readable arrangement. Once someone has
        // dragged a node, that is their layout: the world is re-measured
        // around it and nothing is moved.
        if (this._touched) {
          this._applyWorld();
        } else {
          this._seedLayout();
          this._settle();
          this.fit(16, false);
        }
      }
    }
    if (!this._centered && rect.width) {
      this.camera.x = rect.width / 2;
      this.camera.y = rect.height / 2;
      this._centered = true;
    }
    this.draw();
  }

  toScreen(n) {
    return { x: n.x * this.camera.k + this.camera.x, y: n.y * this.camera.k + this.camera.y };
  }

  toWorld(px, py) {
    return { x: (px - this.camera.x) / this.camera.k, y: (py - this.camera.y) / this.camera.k };
  }

  // -------------------------------------------------------------- state ---

  _nodeState(n) {
    if (!this.visibleNodes.has(n.id)) return 'hidden';
    if (n.date && n.date.t > this.timeCursor) return 'future';
    if (this.selected && !this.neighbors.has(n.id)) return 'dim';
    if (this.selected === n.id) return 'selected';
    if (this.hover === n.id) return 'hover';
    return 'normal';
  }

  _edgeState(e) {
    if (!this.visibleEdges.has(e.id)) return 'hidden';
    if (!this.visibleNodes.has(e.sourceId) || !this.visibleNodes.has(e.targetId)) return 'hidden';
    if (e.date && e.date.t > this.timeCursor) return 'future';
    if (this.selected) {
      return this.neighbors.has(e.sourceId) && this.neighbors.has(e.targetId) ? 'active' : 'dim';
    }
    if (this.hover && (this.hover === e.sourceId || this.hover === e.targetId)) return 'active';
    return 'normal';
  }

  // ------------------------------------------------------------- render ---

  draw() {
    const { ctx, palette: p } = this;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.save();
    ctx.translate(this.camera.x, this.camera.y);
    ctx.scale(this.camera.k, this.camera.k);

    if (this.ringStrength > 0.05) this._drawRings();

    for (const e of this.edges) this._drawEdge(e);
    for (const n of this.nodes) this._drawNode(n);

    for (const placement of this._layoutLabels().placed) this._paintLabel(placement);

    ctx.restore();
  }

  /** Picks the emptiest direction to run the year labels down, so they do not
   *  land on top of the nodes. Computed once per morph, not per frame. */
  _computeRingLabelAngle() {
    let best = -Math.PI / 2;
    let bestCount = Infinity;
    for (let i = 0; i < 24; i++) {
      const a = (Math.PI * 2 * i) / 24;
      let count = 0;
      for (const n of this.nodes) {
        if (!this.visibleNodes.has(n.id) || !Number.isFinite(n.x)) continue;
        let d = Math.atan2(n.y, n.x) - a;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        if (Math.abs(d) < 0.22) count++;
      }
      if (count < bestCount) { bestCount = count; best = a; }
    }
    this._ringLabelAngle = best;
  }

  _drawRings() {
    const { ctx, palette: p } = this;
    const [t0, t1] = this.data.meta.timeExtent;
    const y0 = new Date(t0).getUTCFullYear();
    const y1 = new Date(t1).getUTCFullYear();
    const alpha = this.ringStrength * 0.5;
    const ang = this._ringLabelAngle ?? -Math.PI / 2;
    ctx.save();
    ctx.lineWidth = 1 / this.camera.k;
    const fs = 11 / this.camera.k;
    ctx.font = `${fs}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let y = Math.ceil(y0 / 5) * 5; y <= y1; y += 5) {
      const age = (Date.UTC(y, 0, 1) - t0) / Math.max(1, t1 - t0);
      const r = this._ringRadius(age);
      ctx.strokeStyle = withAlpha(p.hairline, alpha);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();

      const lx = Math.cos(ang) * r;
      const ly = Math.sin(ang) * r;
      const label = String(y);
      const w = ctx.measureText(label).width;
      // A chip behind the year keeps it readable wherever the ring runs.
      ctx.fillStyle = withAlpha(p.plane, 0.82 * this.ringStrength);
      ctx.beginPath();
      ctx.roundRect(lx - w / 2 - 4 / this.camera.k, ly - fs * 0.72,
        w + 8 / this.camera.k, fs * 1.44, 3 / this.camera.k);
      ctx.fill();
      ctx.fillStyle = withAlpha(p.muted, Math.min(1, alpha * 2.1));
      ctx.fillText(label, lx, ly);
    }
    ctx.restore();
  }

  _edgeGeometry(e) {
    const s = typeof e.source === 'object' ? e.source : this.byId.get(e.sourceId);
    const t = typeof e.target === 'object' ? e.target : this.byId.get(e.targetId);
    if (!s || !t) return null;
    const mx = (s.x + t.x) / 2;
    const my = (s.y + t.y) / 2;
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    return { s, t, cx: mx - dy * e.curve, cy: my + dx * e.curve };
  }

  _drawEdge(e) {
    const state = this._edgeState(e);
    if (state === 'hidden') return;
    const g = this._edgeGeometry(e);
    if (!g) return;
    const { ctx, palette: p } = this;
    const spec = TIER[e.tier];

    let color = p.edge;
    let alpha = spec.alpha;
    let width = spec.width;
    if (state === 'active') { color = p.accent; alpha = 0.95; width = spec.width + 0.9; }
    else if (state === 'dim') alpha = spec.alpha * 0.16;
    else if (state === 'future') alpha = spec.alpha * 0.1;
    else if (this.selected || this.hover) alpha = spec.alpha * 0.3;

    ctx.save();
    ctx.setLineDash(spec.dash.map((d) => d / this.camera.k));
    ctx.strokeStyle = withAlpha(color, alpha);
    ctx.lineWidth = width / this.camera.k;
    ctx.beginPath();
    ctx.moveTo(g.s.x, g.s.y);
    ctx.quadraticCurveTo(g.cx, g.cy, g.t.x, g.t.y);
    ctx.stroke();
    ctx.restore();
  }

  _drawNode(n) {
    const state = this._nodeState(n);
    if (state === 'hidden') return;
    const { ctx, palette: p } = this;
    const cat = this.shapeOf.get(n.category);
    const hue = p.family[n.family] || p.muted;
    const hollow = cat?.fill === 'hollow';
    const r = n.radius;

    let alpha = 1;
    if (state === 'dim') alpha = 0.2;
    else if (state === 'future') alpha = 0.13;

    ctx.save();
    ctx.globalAlpha = alpha;

    // The age ring: achromatic, so it reads as a separate channel from the
    // categorical hue rather than competing with it.
    if (n.date) {
      ctx.strokeStyle = mix(p.ageOld, p.ageNew, n.age);
      ctx.lineWidth = 2 / Math.max(0.8, this.camera.k) + 0.6;
      tracePath(ctx, cat?.shape || 'circle', n.x, n.y, r + 3.4);
      ctx.stroke();
    }

    if (state === 'selected' || state === 'hover') {
      ctx.strokeStyle = withAlpha(p.accent, state === 'selected' ? 0.95 : 0.55);
      ctx.lineWidth = 2.4;
      tracePath(ctx, cat?.shape || 'circle', n.x, n.y, r + 7.5);
      ctx.stroke();
    }

    tracePath(ctx, cat?.shape || 'circle', n.x, n.y, r);
    if (hollow) {
      ctx.fillStyle = p.surface;
      ctx.fill();
      ctx.strokeStyle = hue;
      ctx.lineWidth = 2.4;
      ctx.stroke();
    } else {
      ctx.fillStyle = hue;
      ctx.fill();
      // A 2px surface ring keeps overlapping glyphs legible where the web is dense.
      ctx.strokeStyle = p.surface;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    // Tier 3 nodes are marked on the glyph itself, not only in the panel.
    if (n.tier === 3) {
      ctx.setLineDash([2.5, 2.5]);
      ctx.strokeStyle = withAlpha(p.ink, 0.62);
      ctx.lineWidth = 1.3;
      tracePath(ctx, cat?.shape || 'circle', n.x, n.y, r + 1.6);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  /** How much ink a name in this box would land on: glyphs, and names already
   *  placed. Zero means the slot is clear. Threads are not counted — a name
   *  reading across a line is fine, a name sitting on a glyph is not. */
  _slotCost(box, glyphs, boxes) {
    let cost = 0;
    for (const g of glyphs) cost += overlapArea(box, g);
    for (const b of boxes) cost += overlapArea(box, b);
    return cost;
  }

  /** Chooses a slot for every name on show. Purely geometric and independent
   *  of the camera, so the answer holds at any zoom the layout has not moved
   *  under, and fit() can frame the result. */
  _layoutLabels() {
    const glyphs = [];
    for (const n of this.nodes) {
      if (this._nodeState(n) === 'hidden') continue;
      const r = n.radius + 3;
      glyphs.push({ x0: n.x - r, x1: n.x + r, y0: n.y - r, y1: n.y + r });
    }
    // Placed in importance order, so a hub keeps the slot under its glyph and
    // a leaf is the one that has to shoulder aside.
    const ranked = [...this.nodes].sort((a, b) => {
      const w = (n) => (n.id === this.selected ? 3 : n.id === this.hover ? 2 : 0);
      return (w(b) - w(a)) || (b.degree - a.degree);
    });

    const boxes = [];
    const placed = [];
    let dropped = 0;
    for (const n of ranked) {
      const state = this._nodeState(n);
      if (state === 'hidden' || state === 'future' || state === 'dim') continue;
      const forced = state === 'selected' || state === 'hover';
      // The layout holds a slot open for every name, so nothing is dropped at
      // the default framing. Zoomed far out the type would be sub-pixel, and
      // only the hubs are worth drawing.
      if (!forced && this.camera.k * LABEL_FONT < MIN_LABEL_PX && n.degree < HUB_DEGREE) continue;

      const w = n.labelW;
      const h = n.labelH;
      const r = n.radius;
      // Under the glyph is the reserved slot; the alternates pick up the few
      // nodes a dense corner could not give one to — above, beside, or
      // shouldered off to one side of the glyph.
      const below = n.y + r + LABEL_GAP;
      const above = n.y - r - LABEL_GAP - h;
      const slots = [
        { align: 'center', x: n.x, y: below },
        { align: 'center', x: n.x, y: above },
        { align: 'left', x: n.x + r + 6, y: n.y - h / 2 },
        { align: 'right', x: n.x - r - 6, y: n.y - h / 2 },
        { align: 'left', x: n.x - r, y: below },
        { align: 'right', x: n.x + r, y: below },
        { align: 'left', x: n.x - r, y: above },
        { align: 'right', x: n.x + r, y: above },
      ];
      let best = null;
      for (const slot of slots) {
        const x0 = slot.align === 'center' ? slot.x - w / 2
          : slot.align === 'left' ? slot.x : slot.x - w;
        const box = { x0: x0 - 2, x1: x0 + w + 2, y0: slot.y - 1, y1: slot.y + h + 1 };
        const cost = this._slotCost(box, glyphs, boxes);
        if (!best || cost < best.cost) best = { slot, box, cost };
        if (cost === 0) break;
      }
      // Nowhere clear: a selected or hovered name is worth the collision, any
      // other is not — an unreadable pile-up helps nobody.
      if (best.cost > 0 && !forced) { dropped++; continue; }
      boxes.push(best.box);
      placed.push({ n, state, slot: best.slot });
    }

    this._glyphBoxes = glyphs;
    this._labelBoxes = boxes;
    return { placed, dropped };
  }

  _paintLabel({ n, state, slot }) {
    const { ctx, palette: p } = this;
    ctx.save();
    ctx.font = `${state === 'selected' ? 600 : 450} ${LABEL_FONT}px ${
      getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = slot.align;
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3.2;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = withAlpha(p.plane, 0.9);
    const fill = state === 'selected' ? p.ink : p.ink2;
    n.lines.forEach((line, i) => {
      const y = slot.y + i * LINE_H;
      ctx.strokeText(line, slot.x, y);
      ctx.fillStyle = fill;
      ctx.fillText(line, slot.x, y);
    });
    ctx.restore();
  }

  // -------------------------------------------------------- interaction ---

  nodeAt(px, py) {
    const w = this.toWorld(px, py);
    let best = null;
    let bestD = Infinity;
    for (const n of this.nodes) {
      if (this._nodeState(n) === 'hidden') continue;
      const d = Math.hypot(n.x - w.x, n.y - w.y);
      if (d < n.radius + 9 && d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  /** Nearest visible edge to a screen point, by sampling the drawn curve. */
  edgeAt(px, py) {
    const w = this.toWorld(px, py);
    const tol = 7 / this.camera.k;
    let best = null;
    let bestD = tol;
    for (const e of this.edges) {
      const st = this._edgeState(e);
      if (st === 'hidden' || st === 'future') continue;
      const g = this._edgeGeometry(e);
      if (!g) continue;
      for (let i = 0; i <= 14; i++) {
        const t = i / 14;
        const mt = 1 - t;
        const x = mt * mt * g.s.x + 2 * mt * t * g.cx + t * t * g.t.x;
        const y = mt * mt * g.s.y + 2 * mt * t * g.cy + t * t * g.t.y;
        const d = Math.hypot(x - w.x, y - w.y);
        if (d < bestD) { bestD = d; best = e; }
      }
    }
    return best;
  }

  selectEdge(edge) {
    this.selected = null;
    this.selectedEdge = edge ? edge.id : null;
    this.neighbors = edge ? new Set([edge.sourceId, edge.targetId]) : new Set();
    if (edge) this.selected = edge.sourceId;
    this.draw();
  }

  _bindEvents() {
    const c = this.canvas;
    let dragging = null;
    let panning = null;

    const pos = (ev) => {
      const r = c.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    };

    c.addEventListener('pointerdown', (ev) => {
      const pt = pos(ev);
      const n = this.nodeAt(pt.x, pt.y);
      c.setPointerCapture(ev.pointerId);
      if (n) {
        // Armed, not started: a click is a press and a release in the same
        // place, and it must leave the map alone. The drag begins on the first
        // real movement, below.
        dragging = { n, from: pt, live: false };
      } else {
        panning = { ...pt, cx: this.camera.x, cy: this.camera.y, moved: false };
        c.classList.add('dragging');
      }
    });

    c.addEventListener('pointermove', (ev) => {
      const pt = pos(ev);
      if (dragging) {
        if (!dragging.live) {
          if (Math.hypot(pt.x - dragging.from.x, pt.y - dragging.from.y) <= DRAG_SLOP) return;
          dragging.live = true;
          this._touched = true;
        }
        // The node under the pointer moves, and nothing else does. Arranging
        // the map by hand is only worth doing if the arrangement survives the
        // next thing you pick up.
        const w = this.toWorld(pt.x, pt.y);
        const n = dragging.n;
        n.x = w.x; n.y = w.y;
        n.vx = 0; n.vy = 0;
        this.draw();
        return;
      }
      if (panning) {
        this.camera.x = panning.cx + (pt.x - panning.x);
        this.camera.y = panning.cy + (pt.y - panning.y);
        if (Math.hypot(pt.x - panning.x, pt.y - panning.y) > 3) panning.moved = true;
        this.draw();
        return;
      }
      const n = this.nodeAt(pt.x, pt.y);
      const id = n ? n.id : null;
      if (id !== this.hover) {
        this.hover = id;
        this.draw();
      }
      this.onHover(n, pt);
      c.style.cursor = n || this.edgeAt(pt.x, pt.y) ? 'pointer' : '';
    });

    const end = (ev) => {
      if (dragging) {
        // Where it was dropped is where it stays, and the seat it would be
        // held to — by the ring morph, the one thing that still runs the
        // simulation — moves with it.
        if (dragging.live) {
          const n = dragging.n;
          n.home = { x: n.x / (this.worldW / 2), y: n.y / (this.worldH / 2) };
        }
        dragging = null;
      }
      if (panning) {
        if (!panning.moved) { this.select(null); this.onSelect(null); }
        panning = null;
        c.classList.remove('dragging');
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    c.addEventListener('click', (ev) => {
      const pt = pos(ev);
      const n = this.nodeAt(pt.x, pt.y);
      if (n) { this.select(n.id); this.onSelect(n); return; }
      const e = this.edgeAt(pt.x, pt.y);
      if (e) { this.selectEdge(e); this.onSelectEdge(e); }
    });

    c.addEventListener('pointerleave', () => {
      if (this.hover) { this.hover = null; this.draw(); }
      this.onHover(null);
    });

    c.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const pt = pos(ev);
      const w = this.toWorld(pt.x, pt.y);
      const k = Math.max(0.22, Math.min(4.5, this.camera.k * Math.exp(-ev.deltaY * 0.0014)));
      this.camera.k = k;
      this.camera.x = pt.x - w.x * k;
      this.camera.y = pt.y - w.y * k;
      this.draw();
    }, { passive: false });
  }
}

MAP.GraphView = GraphView;
}(window.MAP, window.d3));
