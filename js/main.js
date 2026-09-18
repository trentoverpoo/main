// Bootstrap: load the compiled graph and wire the view to the controls.
//
// Where everything opens is decided by js/layout.js, from the hierarchy
// authored in data/taxonomy.yaml.

(function (MAP) {
'use strict';

const { GraphView, UI } = MAP;

const el = (id) => document.getElementById(id);

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  el('theme-toggle').textContent = theme === 'dark' ? 'Light' : 'Dark';
  try { localStorage.setItem('map-theme', theme); } catch { /* private mode */ }
}

function boot() {
  // The graph arrives as a plain script assigning a global, not as a fetch:
  // fetch() of a local file is blocked under file://, and this page must work
  // when someone just opens it from disk.
  const data = window.__GRAPH__;
  if (!data) {
    throw new Error(
      'map/data/graph.js is missing or failed to load. Run: node build/build.mjs');
  }

  let stored = 'dark';
  try { stored = localStorage.getItem('map-theme') || 'dark'; } catch { /* ignore */ }
  applyTheme(stored);

  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const edgeById = new Map(data.edges.map((e) => [e.id, e]));

  const ui = new UI(data, {
    onFilter: () => applyFilters(),
    onPick: (id) => { view.select(id); view.focus(id); ui.showNode(byId.get(id)); },
    onPickEdge: (id) => {
      const e = edgeById.get(id);
      if (!e) return;
      view.selectEdge(e);
      ui.showEdge(e);
    },
    onClosePanel: () => view.select(null),
  });

  const view = new GraphView(el('canvas'), data, {
    onSelect: (n) => (n ? ui.showNode(n) : ui.closePanel()),
    onSelectEdge: (e) => ui.showEdge(e),
    onHover: (n, pt) => ui.showTooltip(n, pt),
  });

  // ------------------------------------------------------------ filters ---
  function applyFilters() {
    const nodes = new Set();
    for (const n of data.nodes) {
      if (ui.activeCategories.has(n.category)) nodes.add(n.id);
    }
    const edges = new Set();
    for (const e of data.edges) {
      if (!ui.activeTypes.has(e.type)) continue;
      if (!ui.activeTiers.has(e.tier)) continue;
      if (!nodes.has(e.sourceId) || !nodes.has(e.targetId)) continue;
      edges.add(e.id);
    }
    view.setVisible(nodes, edges);
    el('empty').classList.toggle('show', nodes.size === 0);
  }

  // ----------------------------------------------------------- timeline ---
  const [t0, t1] = data.meta.timeExtent;
  const scrubber = el('scrubber');
  const readout = el('scrub-readout');
  let playing = false;
  let raf = null;

  const cursorAt = (v) => t0 + ((t1 - t0) * v) / 1000;

  function setCursor(v, { silent = false } = {}) {
    const t = cursorAt(v);
    view.setTimeCursor(t);
    const d = new Date(t);
    readout.textContent = `${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${
      d.getUTCFullYear()}`;
    const shown = data.nodes.filter((n) => !n.date || n.date.t <= t).length;
    el('scrub-count').textContent = `${shown} of ${data.meta.nodeCount} entities documented by then`;
    if (!silent) scrubber.value = String(v);
  }

  scrubber.addEventListener('input', () => { stop(); setCursor(Number(scrubber.value), { silent: true }); });

  function stop() {
    playing = false;
    if (raf) cancelAnimationFrame(raf);
    el('play').setAttribute('aria-label', 'Play');
    el('play').innerHTML = PLAY_ICON;
  }

  const PLAY_ICON = '<svg width="13" height="14" viewBox="0 0 13 14" aria-hidden="true">' +
    '<path d="M2 1.4 11.6 7 2 12.6Z" fill="currentColor"/></svg>';
  const PAUSE_ICON = '<svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true">' +
    '<rect x="1" y="1.5" width="3.4" height="11" fill="currentColor"/>' +
    '<rect x="7.6" y="1.5" width="3.4" height="11" fill="currentColor"/></svg>';

  el('play').innerHTML = PLAY_ICON;
  el('play').addEventListener('click', () => {
    if (playing) { stop(); return; }
    playing = true;
    el('play').innerHTML = PAUSE_ICON;
    if (Number(scrubber.value) >= 1000) scrubber.value = '0';
    let last = performance.now();
    const tick = (now) => {
      if (!playing) return;
      const dt = now - last;
      last = now;
      const next = Number(scrubber.value) + dt * 0.055;
      if (next >= 1000) { setCursor(1000); stop(); return; }
      setCursor(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });

  el('ring-toggle').addEventListener('click', (ev) => {
    const on = ev.currentTarget.getAttribute('aria-pressed') !== 'true';
    ev.currentTarget.setAttribute('aria-pressed', String(on));
    ev.currentTarget.textContent = on ? 'Web layout' : 'Time rings';
    view.setRingMode(on);
  });

  el('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    view.refreshPalette();
  });

  // A handle on the live view, for the console and for layout checks.
  MAP.view = view;

  window.addEventListener('resize', () => view.resize());
  document.addEventListener('keydown', (ev) => {
    if (ev.key === '/' && document.activeElement !== el('search')) {
      ev.preventDefault();
      el('search').focus();
    }
  });

  setCursor(1000);
  applyFilters();
}

try {
  boot();
} catch (err) {
  document.body.innerHTML =
    '<pre style="padding:40px;font:14px/1.6 system-ui;color:#e34948;white-space:pre-wrap">' +
    String(err && err.message ? err.message : err) + '</pre>';
}
}(window.MAP));
