// Sidebar, search, detail panel, non-claims modal and the time scrubber.

window.MAP = window.MAP || {};
(function (MAP) {
'use strict';

const { swatchSVG, tierLineSVG, readPalette, FAMILY_VAR, TIER,
  RECENT_PHRASE, recencyOf } = MAP.shapes;

const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// Where the small-screen note records that it has been read.
const NOTE_KEY = 'map-mobile-note';

/** Makes everything outside `keep` unreachable — to the pointer, to Tab, and
 *  to a screen reader's own cursor. `inert` is what aria-modal only promises:
 *  aria-hidden on a container full of buttons is itself a violation, and a
 *  hand-rolled Tab trap does nothing about a virtual cursor. */
function setBackgroundInert(keep) {
  for (const child of document.body.children) {
    if (child === keep) child.inert = false;
    else child.inert = !!keep;
  }
}

/** Opens a dialog: remembers the opener, seals the background, moves focus in.
 *  Returns the close half, which puts all three back. */
function dialogFocus(dialog, firstFocus) {
  const opener = document.activeElement;
  setBackgroundInert(dialog);
  const target = firstFocus || dialog.querySelector('button, [href], input, [tabindex]') || dialog;
  if (target === dialog && !dialog.hasAttribute('tabindex')) dialog.setAttribute('tabindex', '-1');
  try { target.focus({ preventScroll: true }); } catch { /* detached */ }
  return () => {
    setBackgroundInert(null);
    if (opener && document.contains(opener)) {
      try { opener.focus({ preventScroll: true }); } catch { /* gone */ }
    }
  };
}

/** The bare host of a live url, for a link that has nothing better to say. */
function hostOf(url) {
  const m = /^https?:\/\/([^/?#]+)/i.exec(String(url || ''));
  return m ? m[1].replace(/^www\./, '') : String(url || '');
}

/** Renders only as much of a date as the record actually supports. */
function formatDate(d) {
  if (!d) return null;
  const dt = new Date(d.t);
  if (d.precision === 'year') return String(dt.getUTCFullYear());
  if (d.precision === 'month') return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

/** What to call an entity in a list that points at the map: whatever the map
 *  itself draws under the glyph, so a reader scanning the list and then the
 *  canvas is reading the same words twice rather than matching a formal style
 *  against a short one. `label` first, because the three data centers carry a
 *  recognisable name above an address that on its own — which is all `short`
 *  is for them — names nothing anyone would place. */
function listName(n) {
  return n.label && n.label.length ? n.label.join(', ') : (n.short || n.name);
}

class UI {
  constructor(data, handlers) {
    this.data = data;
    this.h = handlers;
    this.nodeById = new Map(data.nodes.map((n) => [n.id, n]));
    this.catById = new Map(data.taxonomy.categories.map((c) => [c.key, c]));
    this.typeById = new Map(data.taxonomy.connectionTypes.map((t) => [t.key, t]));

    this.projects = data.taxonomy.projects || [];
    this.projectByKey = new Map(this.projects.map((p) => [p.key, p]));

    this.activeCategories = new Set(data.taxonomy.categories.map((c) => c.key));
    this.activeTypes = new Set(data.taxonomy.connectionTypes.map((t) => t.key));
    this.activeTiers = new Set([1, 2, 3]);
    // Which build the map opens on. Null is the whole file at once, which is
    // the one view nobody can read — so it is a choice, not the starting point.
    const opening = this.projects.find((p) => p.default) || this.projects[0];
    this.activeProject = opening ? opening.key : null;

    this._buildMasthead();
    this._buildProjects();
    this._buildLegend();
    this._buildTypes();
    this._buildTiers();
    this._buildAgeKey();
    this._buildSearch();
    this._buildDrawer();
    this._buildPanel();
    this._buildModal();
    this._buildFiltersModal();
    this._buildMobileNote();
    this._buildTiplineModal();
    this._buildShortcutsModal();
  }

  palette() { return readPalette(); }
  /** The custom-property name for a family, so swatches follow the theme. */
  hue(family) { return FAMILY_VAR[family]; }

  // -------------------------------------------------------------- chrome ---

  _buildMasthead() {
    const m = this.data.meta;
    el('counts').textContent =
      `${m.nodeCount} entities · ${m.edgeCount} connections · ${m.documentCount} documents`;
  }

  // ------------------------------------------------------------ projects ---

  /** The three builds, and the whole file. Radios rather than buttons: the
   *  choice is one of four, and a radiogroup is arrowed through and spoken as
   *  "2 of 4" without any of that having to be written. */
  _buildProjects() {
    const host = el('projects');
    if (!host || !this.projects.length) return;

    const counts = new Map(this.projects.map((p) => [p.key,
      this.data.nodes.filter((n) => (n.projects || []).includes(p.key)).length]));

    const row = (key, label, note, n) => {
      const id = `proj-note-${key || 'all'}`;
      return `
      <label class="check proj" title="${esc(note)}">
        <input type="radio" name="project" value="${esc(key)}"
               ${key === this.activeProject ? 'checked' : ''} aria-describedby="${id}">
        <span class="label">${esc(label)}</span>
        <span class="n">${n}</span>
        <span class="visually-hidden" id="${id}">${esc(note)}</span>
      </label>`;
    };

    host.innerHTML = this.projects.map((p) =>
      row(p.key, p.label, (p.note || '').trim(), counts.get(p.key))).join('') +
      row('', 'The whole map', 'Every entity in the file at once, and every ' +
        'connection between them.', this.data.nodes.length);

    host.addEventListener('change', (ev) => {
      if (ev.target.name !== 'project') return;
      this.activeProject = ev.target.value || null;
      this._syncProjectNote();
      this.setDrawer(false);
      this.h.onProject();
    });
    this._syncProjectNote();
  }

  /** Turns a category back on from code, for a search landing on an entity the
   *  filters are holding back. A node is hidden by its category and by
   *  nothing else, so this is the whole of what it takes to make one drawable. */
  enableCategory(key) {
    if (this.activeCategories.has(key)) return false;
    this.activeCategories.add(key);
    const input = document.querySelector(`input[data-category="${key}"]`);
    if (input) {
      input.checked = true;
      input.closest('.check').classList.remove('off');
    }
    this.syncFilterCount();
    return true;
  }

  /** Moves the switch from code — a search landing outside the build in focus,
   *  say. The radio is updated too, or the sidebar would be describing a map
   *  that is no longer on the screen. */
  setProject(key) {
    this.activeProject = key || null;
    const input = el('projects')
      && el('projects').querySelector(`input[value="${key || ''}"]`);
    if (input) input.checked = true;
    this._syncProjectNote();
  }

  _syncProjectNote() {
    const note = el('project-note');
    if (!note) return;
    const p = this.activeProject ? this.projectByKey.get(this.activeProject) : null;
    note.textContent = p ? (p.note || '').trim()
      : 'Every entity in the file at once. Thorough, and a great deal to read; ' +
        'the three builds above take it one at a time.';
  }

  /** What the map is showing, for the readout that follows a switch. */
  projectLabel() {
    const p = this.activeProject ? this.projectByKey.get(this.activeProject) : null;
    return p ? p.label : 'the whole map';
  }

  /** Everything in a build, or everything in the file when none is in focus.
   *  The filters sit on top of the build, so their counts have to be of the
   *  build — a legend reading "Person 24" over a map of twenty-two entities is
   *  a legend describing something the reader is not looking at. */
  inFocus(x) {
    return !this.activeProject || (x.projects || []).includes(this.activeProject);
  }

  _countNodes(catKey) {
    return this.data.nodes.filter((n) => n.category === catKey && this.inFocus(n)).length;
  }

  /** Re-counts the legend, the connection types and the tiers after a switch.
   *  The rows themselves are untouched: only the numbers on them change. */
  syncCounts() {
    for (const cell of document.querySelectorAll('[data-count-cat]')) {
      cell.textContent = String(this._countNodes(cell.dataset.countCat));
    }
    const edges = this.data.edges.filter((e) => this.inFocus(e));
    for (const cell of document.querySelectorAll('[data-count-type]')) {
      cell.textContent = String(edges.filter((e) => e.type === cell.dataset.countType).length);
    }
    for (const cell of document.querySelectorAll('[data-count-tier]')) {
      cell.textContent = String(edges.filter((e) => e.tier === Number(cell.dataset.countTier)).length);
    }
  }

  _buildLegend() {
    const host = el('legend');
    host.innerHTML = this.data.taxonomy.hueFamilies.map((fam) => {
      const cats = this.data.taxonomy.categories.filter((c) => c.family === fam.key);
      // The note rides on title for the pointer and on aria-describedby for
      // everyone else — title alone reaches neither a keyboard nor a fingertip.
      const rows = cats.map((c) => {
        const note = c.note || '';
        const nid = `cat-note-${c.key}`;
        return `
        <label class="check" data-cat="${c.key}" title="${esc(note || c.label)}">
          <input type="checkbox" checked data-category="${c.key}"${
            note ? ` aria-describedby="${nid}"` : ''}>
          ${swatchSVG(c.shape, c.fill, this.hue(fam.key))}
          <span class="label">${esc(c.label)}</span>
          <span class="n" data-count-cat="${c.key}">${this._countNodes(c.key)}</span>
          ${note ? `<span class="visually-hidden" id="${nid}">${esc(note)}</span>` : ''}
        </label>`;
      }).join('');
      return `<div class="family">
        <span class="family-label">${esc(fam.label)}</span>${rows}</div>`;
    }).join('');

    host.addEventListener('change', (ev) => {
      const key = ev.target.dataset.category;
      if (!key) return;
      ev.target.checked ? this.activeCategories.add(key) : this.activeCategories.delete(key);
      ev.target.closest('.check').classList.toggle('off', !ev.target.checked);
      this.syncFilterCount();
      this.h.onFilter();
    });

    el('legend-toggle').addEventListener('click', () => {
      const all = this.activeCategories.size === this.data.taxonomy.categories.length;
      host.querySelectorAll('input[data-category]').forEach((i) => {
        i.checked = !all;
        i.closest('.check').classList.toggle('off', all);
      });
      this.activeCategories = all ? new Set()
        : new Set(this.data.taxonomy.categories.map((c) => c.key));
      this.syncFilterCount();
      this.h.onFilter();
    });
  }

  _buildTypes() {
    const host = el('types');
    const counts = new Map();
    for (const e of this.data.edges) {
      if (this.inFocus(e)) counts.set(e.type, (counts.get(e.type) || 0) + 1);
    }
    host.innerHTML = this.data.taxonomy.connectionTypes.map((t) => {
      const note = t.note || '';
      const nid = `type-note-${t.key}`;
      return `
      <label class="check" title="${esc(note)}">
        <input type="checkbox" checked data-type="${t.key}"${
          note ? ` aria-describedby="${nid}"` : ''}>
        <span class="label">${esc(t.label)}</span>
        <span class="n" data-count-type="${t.key}">${counts.get(t.key) || 0}</span>
        ${note ? `<span class="visually-hidden" id="${nid}">${esc(note)}</span>` : ''}
      </label>`;
    }).join('');

    host.addEventListener('change', (ev) => {
      const key = ev.target.dataset.type;
      if (!key) return;
      ev.target.checked ? this.activeTypes.add(key) : this.activeTypes.delete(key);
      ev.target.closest('.check').classList.toggle('off', !ev.target.checked);
      this.syncFilterCount();
      this.h.onFilter();
    });
  }

  _buildTiers() {
    const host = el('tiers');
    const counts = new Map();
    for (const e of this.data.edges) {
      if (this.inFocus(e)) counts.set(e.tier, (counts.get(e.tier) || 0) + 1);
    }
    host.innerHTML = [1, 2, 3].map((t) => `
      <label class="check tier-row">
        <input type="checkbox" checked data-tier="${t}">
        ${tierLineSVG(t, t === 3 ? '--ink-muted' : '--edge-strong')}
        <span class="label">${esc(TIER[t].label)}</span>
        <span class="n" data-count-tier="${t}">${counts.get(t) || 0}</span>
      </label>`).join('');

    host.addEventListener('change', (ev) => {
      const t = Number(ev.target.dataset.tier);
      if (!t) return;
      ev.target.checked ? this.activeTiers.add(t) : this.activeTiers.delete(t);
      ev.target.closest('.check').classList.toggle('off', !ev.target.checked);
      this.syncFilterCount();
      this.h.onFilter();
    });
  }

  _buildAgeKey() {
    const [t0, t1] = this.data.meta.timeExtent;
    const fresh = this.freshNodes();
    el('age-key').innerHTML = `
      <div class="age-ramp">
        <span>${new Date(t0).getUTCFullYear()}</span>
        <span class="bar"></span>
        <span>${new Date(t1).getUTCFullYear()}</span>
      </div>
      <p class="note">Every node carries a ring shaded by its earliest documented date,
      an achromatic channel, so it never competes with category colour.</p>

      <div class="fresh-key${fresh.length ? '' : ' empty'}">
        <span class="fresh-dot" aria-hidden="true"></span>
        <span class="label">New in ${RECENT_PHRASE}</span>
        <span class="n">${fresh.length}</span>
      </div>
      ${fresh.length ? `<ul class="fresh-list">${fresh.map((n) => `
        <li><button class="fresh-go" data-goto="${esc(n.id)}">
          <span class="fresh-name">${esc(listName(n))}</span>
          <span class="fresh-when">${esc(formatDate(n.date))}</span>
        </button></li>`).join('')}</ul>
      <p class="note">Each of these carries a halo on the map and a <b>NEW</b> chip
      above it. The more recent the entry, the stronger the halo. Only dates the
      record gives to the day count: an entity the file dates to a month or a year
      is not one it dates to a Tuesday.</p>`
      : `<p class="note">Nothing in the record is dated inside ${RECENT_PHRASE},
      so nothing on the map is haloed. A quiet month is an answer, and this says
      so rather than leaving the last thing added lit.</p>`}`;

    // The list is how a keyboard reaches what the halo points at. A canvas
    // cannot be scanned by anyone who is not looking at it.
    el('age-key').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-goto]');
      if (!b) return;
      if (this.closeFilters) this.closeFilters();
      this.setDrawer(false);
      this.h.onPick(b.dataset.goto);
    });
  }

  /** Whatever the record dates inside the recency window, most recent first.
   *  The same helper the renderer measures the halo with, so the sidebar and
   *  the canvas cannot disagree about what is new. */
  freshNodes() {
    return this.data.nodes
      .filter((n) => recencyOf(n.date) > 0)
      .sort((a, b) => b.date.t - a.date.t || a.name.localeCompare(b.name));
  }

  // -------------------------------------------------------------- search ---

  /** The ARIA 1.2 combobox pattern. The previous markup was a listbox holding
   *  buttons, which is not a thing: a listbox's children must be options, and
   *  aria-selected on a button is discarded. Focus stays in the input and the
   *  active option is named by aria-activedescendant, so arrowing through the
   *  results is spoken instead of silent. */
  _buildSearch() {
    const input = el('search');
    const list = el('suggest');
    const status = el('search-status');
    let cursor = -1;

    const options = () => [...list.querySelectorAll('[role="option"]')];

    const close = () => {
      list.innerHTML = '';
      cursor = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    };

    const results = (q) => {
      const s = q.trim().toLowerCase();
      if (!s) return [];
      return this.data.nodes
        .map((n) => {
          const hay = [n.name, n.short, ...(n.aliases || [])].join(' ').toLowerCase();
          const i = hay.indexOf(s);
          return i < 0 ? null : { n, rank: i + (n.name.toLowerCase().startsWith(s) ? -50 : 0) };
        })
        .filter(Boolean)
        .sort((a, b) => a.rank - b.rank || b.n.degree - a.n.degree)
        .slice(0, 9)
        .map((r) => r.n);
    };

    const render = (items) => {
      list.innerHTML = items.map((n, i) => {
        const cat = this.catById.get(n.category);
        return `<div class="s-opt" role="option" id="suggest-opt-${i}"
                     aria-selected="false" data-id="${esc(n.id)}">
          ${swatchSVG(cat.shape, cat.fill, this.hue(n.family), 14)}
          <span class="s-name">${esc(n.name)}</span>
          <span class="s-cat">${esc(cat.label)}</span>
        </div>`;
      }).join('');
      cursor = -1;
      input.setAttribute('aria-expanded', 'true');
      input.removeAttribute('aria-activedescendant');
    };

    const announce = (n) => {
      status.textContent = n === 0 ? 'No matches.'
        : `${n} ${n === 1 ? 'match' : 'matches'}. Use the up and down arrow keys to review them.`;
    };

    const moveCursor = (delta) => {
      const opts = options();
      if (!opts.length) return;
      cursor = (cursor + delta + opts.length) % opts.length;
      opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === cursor)));
      input.setAttribute('aria-activedescendant', opts[cursor].id);
      opts[cursor].scrollIntoView({ block: 'nearest' });
    };

    const choose = (id) => {
      close();
      input.value = '';
      status.textContent = '';
      this.setDrawer(false);
      // Deliberately no blur() here: _openPanel takes focus to the panel that
      // is opening. Blurring used to drop focus onto <body>.
      this.h.onPick(id);
    };

    input.addEventListener('input', () => {
      const items = results(input.value);
      items.length ? render(items) : close();
      announce(input.value.trim() ? items.length : 0);
      if (!input.value.trim()) status.textContent = '';
    });

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { close(); return; }
      if (!options().length) return;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        moveCursor(ev.key === 'ArrowDown' ? 1 : -1);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        const opts = options();
        choose(opts[Math.max(0, cursor)].dataset.id);
      }
    });

    list.addEventListener('click', (ev) => {
      const o = ev.target.closest('[role="option"]');
      if (o) choose(o.dataset.id);
    });

    el('search-clear').addEventListener('click', () => {
      input.value = '';
      close();
      status.textContent = '';
      input.focus();
    });
    document.addEventListener('click', (ev) => {
      if (!ev.target.closest('.search-wrap')) close();
    });
  }

  // -------------------------------------------------------------- drawer ---

  /** Below the small-screen breakpoint the sidebar is a drawer over the map.
   *  Above it the class does nothing, so the same wiring runs at every width
   *  and there is no size to watch for. */
  _buildDrawer() {
    const bar = el('sidebar');
    const scrim = el('scrim');
    const toggle = el('open-menu');
    // The drawer only exists under the breakpoint. Above it the sidebar is an
    // ordinary column and must never be sealed off.
    const narrow = window.matchMedia('(max-width: 900px)');

    /** A drawer shut by transform alone is still in the tab order — 25 controls
     *  of it, off the left edge of the screen. */
    const syncInert = () => {
      const open = bar.classList.contains('open');
      bar.inert = narrow.matches && !open;
      // While the drawer is over the map, the map is not reachable behind it.
      const behind = narrow.matches && open;
      el('stage').inert = behind;
      el('timeline').inert = behind;
    };

    const set = (open) => {
      const was = bar.classList.contains('open');
      bar.classList.toggle('open', open);
      scrim.hidden = false;
      scrim.classList.toggle('show', open);
      toggle.setAttribute('aria-expanded', String(open));
      syncInert();
      if (open && !was && narrow.matches) {
        el('sidebar-close').focus({ preventScroll: true });
      } else if (!open && was && narrow.matches && document.activeElement === document.body) {
        toggle.focus({ preventScroll: true });
      }
    };
    this.setDrawer = set;
    syncInert();
    narrow.addEventListener('change', syncInert);

    toggle.addEventListener('click', () => set(!bar.classList.contains('open')));
    el('sidebar-close').addEventListener('click', () => { set(false); toggle.focus(); });
    scrim.addEventListener('click', () => { set(false); toggle.focus(); });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && bar.classList.contains('open')) { set(false); toggle.focus(); }
    });
  }

  // --------------------------------------------------------------- panel ---

  _buildPanel() {
    const panel = el('panel');
    panel.setAttribute('tabindex', '-1');
    // Closed, the panel is parked off-screen by a transform — which hides it
    // from the eye and from nothing else.
    panel.inert = true;
    this._panelOpener = null;
    el('panel-close').addEventListener('click', () => this.closePanel());
    el('panel').addEventListener('click', (ev) => {
      const edge = ev.target.closest('[data-edge]');
      if (edge) { this.h.onPickEdge(edge.dataset.edge); return; }
      const b = ev.target.closest('[data-goto]');
      if (b) { this.setDrawer(false); this.h.onPick(b.dataset.goto); }
    });
  }

  closePanel() {
    const panel = el('panel');
    const wasOpen = panel.classList.contains('open');
    panel.classList.remove('open');
    panel.inert = true;
    el('stage').classList.remove('panel-open');
    // Focus cannot be left standing on a control that just went inert.
    if (wasOpen) {
      const back = this._panelOpener && document.contains(this._panelOpener)
        ? this._panelOpener : el('canvas');
      try { back.focus({ preventScroll: true }); } catch { /* gone */ }
    }
    this._panelOpener = null;
    this.h.onClosePanel();
  }

  _citationHTML(c) {
    const date = c.date ? formatDate({ t: Date.parse(c.date), precision:
      String(c.date).length === 4 ? 'year' : String(c.date).length === 7 ? 'month' : 'day' }) : null;
    const quote = c.excerpt
      ? `<blockquote>${esc(String(c.excerpt).trim())}</blockquote>` : '';
    const link = c.doc
      ? `<a class="doc" href="../${esc(c.doc)}" target="_blank" rel="noopener">${esc(c.doc)}</a>`
      : `<span class="ext">External source, not in evidence/</span>`;
    // The archived copy is the source of the claim and never moves. The live url,
    // where one exists, is where the same source can be read today — a reader's own
    // check on it, and the thing that can rot. Both are shown; the archived one first.
    const live = c.url
      ? `<a class="live" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">
           <span class="live-tag">Live</span>${esc(c.urlLabel || hostOf(c.url))}</a>`
      : '';
    return `<div class="cite">
      <div class="cite-head">
        <span class="cite-label">${esc(c.label || c.doc || c.external)}</span>
        ${date ? `<span class="cite-date">${esc(date)}</span>` : ''}
      </div>
      ${quote}<div class="cite-links">${link}${live}</div>
    </div>`;
  }

  // The chain of title, which the three sites carry in place of a flat source list.
  // Each step is a conveyance: who the interest passed out of, who it passed to, and
  // the instrument that says so. The order is itself the claim, so the steps are an
  // ordered list with the flow of ownership drawn between them, and a step the record
  // does not establish says so in its own words rather than being quietly dropped.
  _chainHTML(chain) {
    const steps = chain.map((s) => `<li class="chain-step">
      <div class="chain-flow">
        <span class="chain-party">${esc(s.from)}</span>
        <span class="chain-to" aria-hidden="true">→</span>
        <span class="chain-party">${esc(s.to)}</span>
      </div>
      ${s.date || s.interest ? `<div class="chain-meta">${
        [s.date ? formatDate(s.date) : null, s.interest]
          .filter(Boolean).map((x) => esc(x)).join(' · ')}</div>` : ''}
      ${s.note ? `<p class="chain-note">${esc(s.note)}</p>` : ''}
      ${s.citations.map((c) => this._citationHTML(c)).join('')}
    </li>`).join('');
    return `<div class="p-section">Chain of title · ${chain.length} step${
      chain.length === 1 ? '' : 's'}</div><ol class="chain">${steps}</ol>`;
  }

  showNode(node) {
    const cat = this.catById.get(node.category);
    const date = formatDate(node.date);
    const related = this.data.edges
      .filter((e) => e.sourceId === node.id || e.targetId === node.id)
      .map((e) => {
        const otherId = e.sourceId === node.id ? e.targetId : e.sourceId;
        const other = this.nodeById.get(otherId);
        const dir = e.sourceId === node.id ? '' : '← ';
        const oc = this.catById.get(other.category);
        // The row opens the CONNECTION, so its citation is one click away —
        // an edge's sources must be reachable, not only a node's.
        return `<button class="rel" data-edge="${esc(e.id)}"
                  title="Show the document behind this connection">
          <span class="rel-name">${swatchSVG(oc.shape, oc.fill, this.hue(other.family), 13)}
            ${esc(other.name)}</span>
          <span class="rel-desc">${esc(dir)}${esc(e.label)}${
            e.date ? ` · ${esc(formatDate(e.date))}` : ''}${
            e.tier === 3 ? ' · unresolved' : e.tier === 2 ? ' · attributed' : ''} ·
            ${e.citations.length} source${e.citations.length === 1 ? '' : 's'}</span>
        </button>`;
      }).join('');

    el('panel-body').innerHTML = `
      <div class="p-kicker">${swatchSVG(cat.shape, cat.fill, this.hue(node.family), 15)}
        <span>${esc(cat.label)}</span>
        ${node.tier !== 1 ? `<span>· ${esc(TIER[node.tier].label)}</span>` : ''}
        ${recencyOf(node.date) ? `<span class="p-new">New</span>` : ''}</div>
      <h2 class="p-title">${esc(node.name)}</h2>
      ${date ? `<p class="p-date">${esc(date)}${
        node.dateNote ? ` · ${esc(node.dateNote)}` : ''}</p>` : ''}
      <p class="p-body">${esc(node.summary)}</p>
      ${node.caveat ? `<p class="p-caveat"><b>What this does not establish.</b>
        ${esc(node.caveat)}</p>` : ''}
      ${node.chain && node.chain.length
        ? this._chainHTML(node.chain) + (node.citations.length
          ? `<div class="p-section">Also on file · ${node.citations.length}</div>
             ${node.citations.map((c) => this._citationHTML(c)).join('')}` : '')
        : `<div class="p-section">Sources · ${node.citations.length}</div>
           ${node.citations.map((c) => this._citationHTML(c)).join('')}`}
      <details class="p-fold">
        <summary class="p-section p-fold-head">Connections · ${
          this.data.edges.filter((e) => e.sourceId === node.id || e.targetId === node.id).length
        }<span class="p-fold-hint">on the map</span></summary>
        ${related}
      </details>`;
    this._openPanel();
  }

  _openPanel() {
    const panel = el('panel');
    const wasOpen = panel.classList.contains('open');
    // Where to send focus back to. A .rel button inside the panel swaps the
    // panel's own contents, so it is not a destination to return to.
    if (!wasOpen) {
      const a = document.activeElement;
      this._panelOpener = (a && a !== document.body && !panel.contains(a)) ? a : el('canvas');
    }
    panel.inert = false;
    panel.classList.add('open');
    el('stage').classList.add('panel-open');
    panel.scrollTop = 0;
    // The panel is the content that was just asked for, so focus follows it —
    // and a keyboard user is no longer dropped onto <body>.
    panel.focus({ preventScroll: true });
  }

  showEdge(edge) {
    const s = this.nodeById.get(edge.sourceId);
    const t = this.nodeById.get(edge.targetId);
    const type = this.typeById.get(edge.type);
    el('panel-body').innerHTML = `
      <div class="p-kicker"><span>${esc(type.label)}</span>
        <span>· ${esc(TIER[edge.tier].label)}</span></div>
      <h2 class="p-title">${esc(s.short)} <span class="p-verb">${esc(edge.label)}</span> ${esc(t.short)}</h2>
      ${edge.date ? `<p class="p-date">${esc(formatDate(edge.date))}</p>` : ''}
      ${edge.because ? `<p class="p-because"><span class="p-because-arrow">↳</span> ${esc(edge.because)}</p>` : ''}
      ${edge.summary ? `<p class="p-body">${esc(edge.summary)}</p>` : ''}
      ${edge.resolves ? `<p class="p-caveat"><b>What would resolve this.</b>
        ${esc(edge.resolves)}</p>` : ''}
      <div class="p-section">Sources · ${edge.citations.length}</div>
      ${edge.citations.map((c) => this._citationHTML(c)).join('')}
      <div class="p-section">Endpoints</div>
      <button class="rel" data-goto="${esc(s.id)}"><span class="rel-name">${esc(s.name)}</span>
        <span class="rel-desc">from · open this entity</span></button>
      <button class="rel" data-goto="${esc(t.id)}"><span class="rel-name">${esc(t.name)}</span>
        <span class="rel-desc">to · open this entity</span></button>`;
    this._openPanel();
  }

  // --------------------------------------------------------------- modal ---

  _buildModal() {
    const nc = this.data.nonClaims;
    const m = this.data.meta;
    const section = (title, items) => !items || !items.length ? '' : `<h3>${esc(title)}</h3>` + items.map((i) =>
      `<div class="nc"><b>${esc(i.title)}</b><span>${esc(i.body.trim())}</span></div>`).join('');

    el('modal-body').innerHTML = `
      <h2>What this map claims, and what it does not</h2>
      <p class="lede">This project maps who owns what, who is connected to whom, and
      where the money behind the southwest Missouri data-center build-out comes from.
      It is assembled from ${m.documentCount} documents: deeds, UCC filings, corporate
      registrations, SEC filings, permits, court records and captured public pages. It
      claims exactly what those documents carry. Not less, and not more.</p>

      <h3>What is claimed, and stood behind</h3>
      <div class="nc"><b>The entities, the people, the land and the lines between them</b>
      <span>Each of the ${m.nodeCount} entities and ${m.edgeCount} connections drawn here
      cites at least one document, and the build refuses to produce the map (it fails, it
      does not warn) if a citation points at a file that is not in this repository. A solid
      line rests on a primary record in <code>evidence/</code>. Those lines are not
      impressions or inferences, and this project owns them.</span></div>
      <div class="nc"><b>That out-of-state capital and out-of-state operators are working
      through locally registered entities</b><span>This is the shape of the record, and it
      is asserted plainly: formation documents filed in other states, officers and agents
      signing from other states, lenders' instruments recorded against Missouri parcels,
      and single-purpose entities holding land they bought from local owners. Every step of
      that is on the map with the filing that establishes it. Read the documents rather
      than take our word for it. That is what they are here for.</span></div>
      <div class="nc"><b>The dates, and the order things happened in</b><span>Formation,
      purchase, recording, permitting and filing dates are as the records state them. Where
      a record gives only a month or only a year, the map shows only that much, and the
      time scrubber moves on those dates alone.</span></div>

      <h3>What is not claimed</h3>
      <div class="nc"><b>No crime, no fraud, no wrongdoing by anyone</b><span>Nothing on
      this map alleges that any person or company has broken a law, breached a duty or acted
      improperly. Forming an entity in another state, assembling land through a
      single-purpose LLC, borrowing against it, using a registered-agent address and
      declining to name a prospective tenant are all ordinary and lawful ways to do
      business. If a line here reads as an accusation, that reading is the reader's and not
      the record's.</span></div>
      <div class="nc"><b>Connection is not coordination</b><span>An edge means two parties
      appear together in a document or a transaction. It does not claim they act in concert,
      share a plan or purpose, or know what the other is doing.</span></div>
      <div class="nc"><b>No motive, no intent, no forecast</b><span>The record shows what was
      done and when. It does not establish why, what anyone meant by it, or what anyone
      will do next, and this map does not guess at any of the three.</span></div>
      <div class="nc"><b>Nothing about consequences</b><span>No claim is made here about
      water, electricity, rates, emissions, tax abatements, jobs, property values, or
      whether any of this is good or bad for the people who live nearby. Those are arguments
      worth having somewhere else. This is a file, not a brief.</span></div>
      <div class="nc"><b>A dashed line is a question, not a finding</b><span>Tier-3
      connections are threads the file tracks and does not treat as settled. Each one has to
      say what evidence would resolve it, or the build rejects it.</span></div>
      <div class="nc"><b>An absent line means an absent document</b><span>Where no
      connection is drawn, nothing has been found. It is not proof that no relationship
      exists. This map is the portion of the picture that documents currently support.</span></div>
      <div class="nc"><b>Appearing here is not an accusation</b><span>Many entities and
      people are on this map because they sold land, lent money, notarized an instrument,
      issued a permit or filed a routine report. Presence on the map carries no implication
      about anyone, and the categories and colors mark what a party is, never how it should
      be judged.</span></div>

      ${section('Expressly not claimed', nc.notClaimed)}
      ${section('Open questions: why some expected lines are absent', nc.openQuestions)}
      ${section('Threads closed by review', nc.closedThreads)}

      <h3>If something here is wrong</h3>
      <p class="note" style="margin-top:11px">A name, a date, a relationship read the wrong
      way out of a filing. Corrections are wanted, and they are made against the document.
      Use the tipline, or write to
      <a href="mailto:trentoverpoo@proton.me">trentoverpoo@proton.me</a>.</p>`;

    const modal = el('modal');
    let release = null;
    const open = () => {
      modal.classList.add('open');
      release = dialogFocus(modal, el('modal-close'));
    };
    const close = () => {
      if (!modal.classList.contains('open')) return;
      modal.classList.remove('open');
      if (release) { release(); release = null; }
    };
    el('open-modal').addEventListener('click', open);
    modal.addEventListener('click', (ev) => {
      if (ev.target.id === 'modal' || ev.target.closest('[data-close]')) close();
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });
  }

  // ------------------------------------------------------------- filters ---

  /** The category, connection, tier and time filters used to be five panels of
   *  the sidebar, which put the map's opening question — which build am I
   *  looking at — below a fold of controls most readers never touch. They live
   *  in a dialog now. The controls themselves are untouched: _buildLegend and
   *  the rest still write into the same four elements, which simply moved. */
  _buildFiltersModal() {
    const modal = el('filters-modal');
    if (!modal) return;
    const opener = el('open-filters');
    let release = null;

    const open = () => {
      modal.classList.add('open');
      release = dialogFocus(modal, el('filters-modal-close'));
    };
    const close = () => {
      if (!modal.classList.contains('open')) return;
      modal.classList.remove('open');
      if (release) { release(); release = null; }
    };
    this.closeFilters = close;

    opener.addEventListener('click', open);
    modal.addEventListener('click', (ev) => {
      if (ev.target.id === 'filters-modal' || ev.target.closest('[data-close]')) close();
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });

    el('filters-reset').addEventListener('click', () => {
      this.activeCategories = new Set(this.data.taxonomy.categories.map((c) => c.key));
      this.activeTypes = new Set(this.data.taxonomy.connectionTypes.map((t) => t.key));
      this.activeTiers = new Set([1, 2, 3]);
      for (const input of modal.querySelectorAll('input[type="checkbox"]')) {
        input.checked = true;
        input.closest('.check').classList.remove('off');
      }
      this.syncFilterCount();
      this.h.onFilter();
    });

    this.syncFilterCount();
  }

  /** How many filters are currently holding something back. A control that has
   *  been put behind a button has to say when it is doing something, or a map
   *  drawing two thirds of what it should looks like a map that is broken. */
  syncFilterCount() {
    const badge = el('filters-count');
    if (!badge) return;
    const off = (this.data.taxonomy.categories.length - this.activeCategories.size) +
      (this.data.taxonomy.connectionTypes.length - this.activeTypes.size) +
      (3 - this.activeTiers.size);
    badge.hidden = off === 0;
    badge.textContent = String(off);
    el('open-filters').setAttribute('aria-label', off
      ? `Filters: ${off} of them narrowing the map`
      : 'Filters');
  }

  // --------------------------------------------------- small-screen note ---

  /** Said once, to whoever arrives on a phone: the map is usable here, and it
   *  is still a picture that wants more room than a phone has. Dismissal is
   *  remembered, because a disclaimer that reappears on every visit stops
   *  being read and starts being swatted. */
  _buildMobileNote() {
    const m = this.data.meta;
    el('mobile-note-body').innerHTML = `
      <h2>Better on a bigger screen</h2>
      <p>Everything works here: pan, pinch to zoom, search, the filters, and the
      sources behind every entity and every line. Small screens were supported so
      the map is reachable from anywhere.</p>
      <p>But this is ${m.nodeCount} entities and ${m.edgeCount} connections meant to
      be read as one picture, and a phone can only show you part of it at a time.
      Where you can, open this page in a desktop browser.</p>
      <button id="mobile-note-close" data-close type="button">Continue on this device</button>`;

    const note = el('mobile-note');
    const close = () => {
      if (!note.classList.contains('open')) return;
      note.classList.remove('open');
      if (this._noteRelease) { this._noteRelease(); this._noteRelease = null; }
      try { localStorage.setItem(NOTE_KEY, '1'); } catch { /* private mode */ }
    };
    note.addEventListener('click', (ev) => {
      if (ev.target.id === 'mobile-note' || ev.target.closest('[data-close]')) close();
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && note.classList.contains('open')) close();
    });
  }

  /** Opens it, unless this is a wide screen or it has been dismissed before.
   *  Called once the map is painted, so the note arrives over the thing it is
   *  a note about rather than over an empty plane. */
  showMobileNote() {
    let seen = false;
    try { seen = localStorage.getItem(NOTE_KEY) === '1'; } catch { /* private mode */ }
    if (seen) return;
    if (window.matchMedia && !window.matchMedia('(max-width: 900px)').matches) return;
    const note = el('mobile-note');
    note.classList.add('open');
    this._noteRelease = dialogFocus(note, el('mobile-note-close'));
  }

  // ------------------------------------------------------------- tipline ---

  _buildTiplineModal() {
    el('tipline-modal-body').innerHTML = `
      <h2>Send a tip</h2>
      <p class="lede">This project is entirely sourced from public documents and information.
      If you have something that we haven't found yet, we'd love to hear about it.</p>
      <h3>What's valuable</h3>
      <div class="nc"><b>Documents</b><span>Filings, contracts, permits, correspondence,
      minutes, financial records: anything with a date and a source, even a partial
      one.</span></div>
      <div class="nc"><b>Corrections</b><span>A name, date, or relationship on this map
      that's wrong, outdated, or missing context.</span></div>
      <div class="nc"><b>Leads</b><span>A person, entity, or public record worth looking
      into, even without documents in hand yet.</span></div>
      <h3>Anonymity</h3>
      <div class="nc"><b>Your identity stays out of it</b><span>Tips are handled
      anonymously. Nothing you send is published or attributed without your explicit
      permission. Using an email service like
      <a href="https://account.proton.me/signup" target="_blank" rel="noopener">Proton</a>
      adds an extra layer of protection to your identity.</span></div>
      <p class="lede" style="margin-top:22px">
        <a href="mailto:trentoverpoo@proton.me">trentoverpoo@proton.me</a>
      </p>`;

    const modal = el('tipline-modal');
    let release = null;
    const open = () => {
      modal.classList.add('open');
      release = dialogFocus(modal, el('tipline-modal-close'));
    };
    const close = () => {
      if (!modal.classList.contains('open')) return;
      modal.classList.remove('open');
      if (release) { release(); release = null; }
    };
    el('open-tipline').addEventListener('click', open);
    modal.addEventListener('click', (ev) => {
      if (ev.target.id === 'tipline-modal' || ev.target.closest('[data-close]')) close();
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });
  }

  // ---------------------------------------------------------- shortcuts ---

  /** The keys the map answers to — moved out of the always-on-canvas popover
   *  and behind this link, so a sighted mouse user can find them without first
   *  giving the canvas keyboard focus. The canvas keeps its own, silent copy
   *  for aria-describedby; see #canvas-help in index.html. */
  _buildShortcutsModal() {
    const modal = el('shortcuts-modal');
    if (!modal) return;

    const rows = [
      { keys: ['←', '→'], desc: 'Step through entities' },
      { keys: ['↑', '↓'], desc: 'Follow a connection' },
      { keys: ['Enter'], desc: 'Open details' },
      { keys: ['+', '−', '0'], desc: 'Zoom' },
      { keys: ['/'], desc: 'Search' },
      { keys: ['Esc'], desc: 'Clear' },
    ];
    el('shortcuts-modal-body').innerHTML = `
      <h2>Keyboard shortcuts</h2>
      <p class="lede">These work once the map has keyboard focus. Click it, or tab to it.</p>
      ${rows.map((r) => `
        <div class="shortcut-row">
          <span class="keys">${r.keys.map((k) => `<kbd>${esc(k)}</kbd>`).join(' ')}</span>
          <span class="desc">${esc(r.desc)}</span>
        </div>`).join('')}`;

    let release = null;
    const open = () => {
      modal.classList.add('open');
      release = dialogFocus(modal, el('shortcuts-modal-close'));
    };
    const close = () => {
      if (!modal.classList.contains('open')) return;
      modal.classList.remove('open');
      if (release) { release(); release = null; }
    };
    el('open-shortcuts').addEventListener('click', open);
    modal.addEventListener('click', (ev) => {
      if (ev.target.id === 'shortcuts-modal' || ev.target.closest('[data-close]')) close();
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });
  }

  // ------------------------------------------------------------- tooltip ---

  showTooltip(node, pt) {
    const tip = el('tooltip');
    if (!node) { tip.classList.remove('show'); return; }
    const cat = this.catById.get(node.category);
    const date = formatDate(node.date);
    tip.innerHTML = `
      <div class="t-name">${esc(node.name)}</div>
      <div class="t-meta">${swatchSVG(cat.shape, cat.fill, this.hue(node.family), 12)}
        <span>${esc(cat.label)}</span>${date ? `<span>· ${esc(date)}</span>` : ''}${
        recencyOf(node.date) ? `<span class="t-new">New</span>` : ''}</div>
      <div class="t-cites">${node.citations.length} source${
        node.citations.length === 1 ? '' : 's'} · ${node.degree} connection${
        node.degree === 1 ? '' : 's'}${node.tier === 3 ? ' · unresolved' : ''}</div>`;
    tip.classList.add('show');
    const stage = el('stage').getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    tip.style.left = `${Math.min(pt.x + 16, stage.width - w - 10)}px`;
    tip.style.top = `${Math.max(8, Math.min(pt.y + 16, stage.height - h - 10))}px`;
  }
}

MAP.UI = UI;
MAP.formatDate = formatDate;
MAP.esc = esc;
}(window.MAP));
