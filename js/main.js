// Bootstrap: load the compiled graph and wire the view to the controls.
//
// Where everything opens is decided by js/layout.js, from the hierarchy
// authored in data/taxonomy.yaml.

(function (MAP) {
'use strict';

const { GraphView, UI } = MAP;
const { recencyOf } = MAP.shapes;

const el = (id) => document.getElementById(id);

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const next = theme === 'dark' ? 'Light' : 'Dark';
  const btn = el('theme-toggle');
  btn.textContent = next;
  // SC 2.5.3: the visible word has to start the accessible name, or "click
  // Light" reaches nothing.
  btn.setAttribute('aria-label', `${next} theme — switch to it`);
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
    // The panel opens before the camera moves, so the camera knows how much of
    // the stage is left to frame the node into — on a phone the panel is a
    // sheet over the foot of it, and the middle of the map is behind it.
    // The keyboard cursor follows a pointer pick too, so tabbing back into the
    // map resumes from the entity the eye is already on.
    onPick: (id) => { view.kbFocus = id; view.select(id); ui.showNode(byId.get(id)); view.focus(id); },
    onPickEdge: (id) => {
      const e = edgeById.get(id);
      if (!e) return;
      view.selectEdge(e);
      ui.showEdge(e);
      view.reveal(e.sourceId);
    },
    onClosePanel: () => view.select(null),
  });

  const view = new GraphView(el('canvas'), data, {
    onSelect: (n) => {
      if (!n) { ui.closePanel(); return; }
      view.kbFocus = n.id;
      ui.showNode(n);
      view.reveal(n.id);
    },
    onSelectEdge: (e) => { ui.showEdge(e); view.reveal(e.sourceId); },
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
    const wasEmpty = el('empty').classList.contains('show');
    el('empty').classList.toggle('show', nodes.size === 0);
    // A cursor left on an entity the filters just removed is a cursor on
    // nothing, and the ring would keep being drawn for it.
    if (view.kbFocus && !nodes.has(view.kbFocus)) view.clearKeyboardCursor();
    if (nodes.size === 0 && !wasEmpty) announce('No entity categories selected. The map is empty.');
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
    // Without this a screen reader reads the raw 0-1000 position.
    scrubber.setAttribute('aria-valuetext',
      `${readout.textContent} — ${shown} of ${data.meta.nodeCount} entities documented by then`);
    if (!silent) scrubber.value = String(v);
  }

  scrubber.addEventListener('input', () => { stop(); setCursor(Number(scrubber.value), { silent: true }); });

  function stop() {
    playing = false;
    if (raf) cancelAnimationFrame(raf);
    el('play').setAttribute('aria-label', 'Play');
    el('play').setAttribute('title', 'Play the network assembling');
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
    el('play').setAttribute('aria-label', 'Pause');
    el('play').setAttribute('title', 'Pause the network assembling');
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
    announce(on ? 'Time rings layout. Entities are arranged in rings by date.'
      : 'Web layout. Entities are arranged by their connections.');
  });

  el('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    view.refreshPalette();
  });

  // A handle on the live view, for the console and for layout checks.
  MAP.view = view;

  // ---------------------------------------------------- keyboard on the map ---
  //
  // The canvas is a single tab stop with its own cursor inside it: arrows step
  // between entities and along connections, Enter opens the panel. Every move
  // is spoken through #canvas-status, because nothing in a canvas is.

  const canvas = el('canvas');
  const status = el('canvas-status');

  function announce(msg) {
    // Re-setting identical text does not re-announce, so it is cleared first.
    status.textContent = '';
    window.requestAnimationFrame(() => { status.textContent = msg; });
  }

  function describe(n) {
    const cat = ui.catById.get(n.category);
    const conns = view.keyboardNeighbors(n.id).length;
    // The halo and the chip are both things you have to be looking at the
    // canvas to get. Said here, the same group reaches a screen reader.
    return `${n.name}. ${cat ? cat.label : 'Entity'}. ` +
      (recencyOf(n.date) ? 'New this week. ' : '') +
      `${conns} connection${conns === 1 ? '' : 's'}, ` +
      `${n.citations.length} source${n.citations.length === 1 ? '' : 's'}. ` +
      'Press Enter for details.';
  }

  // Left/Right walk the whole map. Up/Down review one entity's connections:
  // the list is anchored when you first press Down, so a second press is the
  // next connection of the same entity rather than a jump two hops out.
  let branch = { anchor: null, list: [], at: -1 };
  const resetBranch = () => { branch = { anchor: null, list: [], at: -1 }; };

  function step(delta) {
    resetBranch();
    const order = view.keyboardOrder();
    if (!order.length) { announce('No entities are showing. Check the filters.'); return; }
    const at = order.findIndex((n) => n.id === view.kbFocus);
    const next = order[at < 0 ? (delta > 0 ? 0 : order.length - 1)
      : (at + delta + order.length) % order.length];
    view.setKeyboardCursor(next.id);
    announce(describe(next));
  }

  function stepBranch(delta) {
    const cur = view.kbFocus;
    if (!cur) { step(delta); return; }
    // Still inside the branch we opened? Then keep cycling its siblings.
    if (branch.anchor !== cur && !branch.list.some((n) => n.id === cur)) {
      branch = { anchor: cur, list: view.keyboardNeighbors(cur), at: -1 };
    }
    if (!branch.list.length) { announce('No connections are showing for this entity.'); return; }
    branch.at = (branch.at + delta + branch.list.length) % branch.list.length;
    const next = branch.list[branch.at];
    view.setKeyboardCursor(next.id);
    announce(`Connection ${branch.at + 1} of ${branch.list.length}. ${describe(next)}`);
  }

  canvas.addEventListener('focus', () => el('stage').classList.add('kb-help'));
  canvas.addEventListener('blur', () => el('stage').classList.remove('kb-help'));

  canvas.addEventListener('keydown', (ev) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;

    switch (ev.key) {
      case 'ArrowRight': ev.preventDefault(); step(1); break;
      case 'ArrowLeft':  ev.preventDefault(); step(-1); break;
      case 'ArrowDown':  ev.preventDefault(); stepBranch(1); break;
      case 'ArrowUp':    ev.preventDefault(); stepBranch(-1); break;
      case 'Home': case 'End': {
        ev.preventDefault();
        resetBranch();
        const order = view.keyboardOrder();
        if (!order.length) { announce('No entities are showing. Check the filters.'); break; }
        const edge = ev.key === 'Home' ? order[0] : order[order.length - 1];
        view.setKeyboardCursor(edge.id);
        announce(describe(edge));
        break;
      }
      case 'Enter': case ' ': {
        ev.preventDefault();
        if (!view.kbFocus) { step(1); return; }
        const n = byId.get(view.kbFocus);
        if (n) { view.select(view.kbFocus); ui.showNode(n); }
        break;
      }
      case 'Escape':
        if (view.kbFocus) {
          ev.preventDefault();
          resetBranch();
          view.clearKeyboardCursor();
          announce('Selection cleared.');
        }
        break;
      case '+': case '=': ev.preventDefault(); view.zoomBy(1.3); break;
      case '-': case '_': ev.preventDefault(); view.zoomBy(1 / 1.3); break;
      case '0': ev.preventDefault(); view.fit(); announce('Zoom reset to fit the whole map.'); break;
      case '/':
        ev.preventDefault();
        // On a phone the field lives in the drawer, so the drawer opens first
        // — it moves focus to its own close button, and search wants it back.
        ui.setDrawer(true);
        el('search').focus();
        break;
      default: break;
    }
  });

  const onResize = () => view.resize();
  window.addEventListener('resize', onResize);
  // A rotation does not always arrive as a resize, and where it does the new
  // viewport is not always measurable yet, so it is re-measured a beat later.
  window.addEventListener('orientationchange', () => setTimeout(onResize, 180));
  // "/" used to be a document-wide shortcut. SC 2.1.4 allows a single-character
  // shortcut only if it can be turned off, remapped, or is active just while
  // its component has focus — so it now belongs to the map, like + - 0 do.

  setCursor(1000);
  applyFilters();
  // Last, so the note lands over a map that is already drawn.
  ui.showMobileNote();
}

try {
  boot();
} catch (err) {
  document.body.innerHTML =
    '<pre style="padding:40px;font:14px/1.6 system-ui;color:#e34948;white-space:pre-wrap">' +
    String(err && err.message ? err.message : err) + '</pre>';
}
}(window.MAP));
