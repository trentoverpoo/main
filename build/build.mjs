#!/usr/bin/env node
// Compiles map/data/*.yaml into map/data/graph.json.
//
// This script FAILS the build — it does not warn — when a citation points at a file
// that is not in this repository, when a node or edge carries no citation, or when a
// tier-3 edge does not say what would resolve it. That is the mechanical enforcement
// of the standard this file holds itself to.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from './vendor/js-yaml.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'map', 'data');

const errors = [];
const warnings = [];
const fail = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

// CORE_SCHEMA leaves YAML 1.1 timestamps as strings, so "2026" and "2026-07-10"
// keep their precision instead of being coerced to midnight Date objects.
const load = (name) =>
  yaml.load(readFileSync(join(DATA, name), 'utf8'), { schema: yaml.CORE_SCHEMA });

const taxonomy = load('taxonomy.yaml');
const nodes = load('entities.yaml');
const edges = load('relationships.yaml');
const nonClaims = load('non-claims.yaml');

const categoryKeys = new Set(taxonomy.categories.map((c) => c.key));
const familyKeys = new Set(taxonomy.hueFamilies.map((f) => f.key));
const typeKeys = new Set(taxonomy.connectionTypes.map((t) => t.key));

for (const c of taxonomy.categories) {
  if (!familyKeys.has(c.family)) fail(`category "${c.key}" names unknown family "${c.family}"`);
}

// ---------------------------------------------------------------- dates -----
// Accepts YYYY, YYYY-MM and YYYY-MM-DD. Returns a sortable timestamp plus the
// precision, so the interface can say "2025" rather than inventing "1 January".
function parseDate(value, where) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(s);
  if (!m) {
    fail(`${where}: date "${s}" is not YYYY, YYYY-MM or YYYY-MM-DD`);
    return null;
  }
  const [, y, mo, d] = m;
  const precision = d ? 'day' : mo ? 'month' : 'year';
  const t = Date.UTC(Number(y), mo ? Number(mo) - 1 : 0, d ? Number(d) : 1);
  if (Number.isNaN(t)) {
    fail(`${where}: date "${s}" is not a real date`);
    return null;
  }
  return { iso: s, t, precision, year: Number(y) };
}

// ----------------------------------------------------------- citations -----
const docIndex = new Map(); // repo path -> { path, exists, url, urlLabel, refs: [] }

// A citation may carry a LIVE url alongside the archived copy: the place the same
// source can be read today. The archived file is what the claim rests on — it is
// the source as it stood when it was gathered, and it does not change. The live
// url is the reader's independent check on it, and it can move, change or vanish.
// So the url never replaces the document; it only ever sits beside one.
function checkUrl(c, at) {
  if (c.url === undefined || c.url === null) {
    if (c.url_label) fail(`${at}: has "url_label" but no "url"`);
    return { url: null, urlLabel: null };
  }
  const url = String(c.url).trim();
  if (!/^https?:\/\/[^\s"'<>]+$/.test(url)) {
    fail(`${at}: "url" must be an absolute http(s) URL — got "${url}"`);
    return { url: null, urlLabel: null };
  }
  return { url, urlLabel: c.url_label ? String(c.url_label).trim() : null };
}

function checkCitations(list, where, refLabel) {
  if (!Array.isArray(list) || list.length === 0) {
    fail(`${where}: no citations. Every node and edge must be traceable to a document.`);
    return [];
  }
  return list.map((c, i) => {
    const at = `${where} citation[${i}]`;
    if (!c || (!c.doc && !c.external)) {
      fail(`${at}: needs either "doc" (a path in this repository) or "external" (a named source)`);
      return c;
    }
    if (c.doc && c.external) fail(`${at}: has both "doc" and "external"; pick one`);
    const { url, urlLabel } = checkUrl(c, at);
    if (c.doc) {
      const abs = join(ROOT, c.doc);
      const exists = existsSync(abs);
      if (!exists) fail(`${at}: cited document does not exist — ${c.doc}`);
      if (!docIndex.has(c.doc)) {
        docIndex.set(c.doc, { path: c.doc, exists, url: null, urlLabel: null, refs: [] });
      }
      const entry = docIndex.get(c.doc);
      // One archived document has one live location. Two citations of the same file
      // that disagree about where it lives now is an authoring error, not a choice
      // the interface should have to present.
      if (url) {
        if (entry.url && entry.url !== url) {
          fail(`${at}: ${c.doc} is already given the live url ${entry.url}; this cites ${url}`);
        } else {
          entry.url = url;
          entry.urlLabel = urlLabel;
        }
      }
      entry.refs.push(refLabel);
    } else if (!c.label) {
      fail(`${at}: an external citation must carry a "label" naming the source`);
    }
    if (c.date) parseDate(c.date, at);
    // url_label is the authoring name; the graph carries it as urlLabel, beside
    // the other camelCase fields the interface reads.
    const { url_label, ...rest } = c;
    return { ...rest, url, urlLabel };
  });
}

// --------------------------------------------------------------- nodes -----
const byId = new Map();
const outNodes = nodes.map((n, i) => {
  const where = `node[${i}] ${n.id ?? '(no id)'}`;
  if (!n.id) fail(`${where}: missing id`);
  if (byId.has(n.id)) fail(`${where}: duplicate id`);
  if (!n.name) fail(`${where}: missing name`);
  if (!n.summary) fail(`${where}: missing summary`);
  if (!categoryKeys.has(n.category)) fail(`${where}: unknown category "${n.category}"`);
  if (![1, 2, 3].includes(n.tier)) fail(`${where}: tier must be 1, 2 or 3`);

  if (n.label !== undefined) {
    if (!Array.isArray(n.label) || n.label.length < 1 || n.label.length > 2) {
      fail(`${where}: "label" must be one or two lines, drawn verbatim on the canvas`);
    } else if (n.label.some((l) => !String(l).trim())) {
      fail(`${where}: "label" has an empty line`);
    }
  }

  const date = parseDate(n.date, where);
  const out = {
    id: n.id,
    name: n.name,
    short: n.short || n.name,
    // Explicit canvas lines, for the few names where the wrap has to be said
    // rather than guessed — the sites, which carry a recognisable name above
    // an address most readers would not place on its own.
    label: n.label && n.label.length ? n.label.map((l) => String(l).trim()) : null,
    category: n.category,
    family: taxonomy.categories.find((c) => c.key === n.category)?.family,
    tier: n.tier,
    date,
    dateNote: n.date_note || null,
    summary: n.summary.trim(),
    caveat: n.caveat ? n.caveat.trim() : null,
    aliases: n.aliases || [],
    citations: checkCitations(n.citations, where, { kind: 'node', id: n.id, name: n.name }),
    degree: 0,
  };
  byId.set(n.id, out);
  return out;
});

// --------------------------------------------------------------- edges -----
const seenEdge = new Set();
const outEdges = edges.map((e, i) => {
  const where = `edge[${i}] ${e.source ?? '?'} -> ${e.target ?? '?'}`;
  if (!byId.has(e.source)) fail(`${where}: source "${e.source}" is not a declared node`);
  if (!byId.has(e.target)) fail(`${where}: target "${e.target}" is not a declared node`);
  if (e.source === e.target) fail(`${where}: self-loop`);
  if (!typeKeys.has(e.type)) fail(`${where}: unknown connection type "${e.type}"`);
  if (!e.label) fail(`${where}: missing label`);
  if (e.label && /;/.test(e.label)) {
    fail(`${where}: "label" contains a semicolon — split the explanatory clause into "because"`);
  }
  if (![1, 2, 3].includes(e.tier)) fail(`${where}: tier must be 1, 2 or 3`);
  if (e.tier === 3 && !e.resolves) {
    fail(`${where}: tier 3 requires "resolves" — the document that would settle it`);
  }

  const id = `${e.source}__${e.target}__${e.type}__${e.date ?? 'undated'}__${i}`;
  const dedupe = `${e.source}|${e.target}|${e.type}|${e.label}`;
  if (seenEdge.has(dedupe)) warn(`${where}: duplicate of an identical earlier edge`);
  seenEdge.add(dedupe);

  if (byId.has(e.source)) byId.get(e.source).degree++;
  if (byId.has(e.target)) byId.get(e.target).degree++;

  return {
    id,
    source: e.source,
    target: e.target,
    // d3-force REPLACES source/target with node objects once the simulation
    // initialises. These two survive that, so identity checks stay valid.
    sourceId: e.source,
    targetId: e.target,
    type: e.type,
    label: e.label,
    // The relationship itself ("A did X to B") stays a short verb phrase; the reason
    // or supporting detail for it — often a different voice (counsel, a document, a
    // date) — is kept separate so the panel can show "A → B" and its explanation as
    // two distinct lines instead of one run-on sentence.
    because: e.because ? String(e.because).trim() : null,
    tier: e.tier,
    date: parseDate(e.date, where),
    summary: e.summary ? e.summary.trim() : null,
    resolves: e.resolves ? e.resolves.trim() : null,
    citations: checkCitations(e.citations, where, {
      kind: 'edge',
      id,
      name: `${byId.get(e.source)?.short ?? e.source} → ${byId.get(e.target)?.short ?? e.target}`,
    }),
  };
});

for (const n of outNodes) {
  if (n.degree === 0) warn(`node "${n.id}" has no edges and will float unconnected`);
}

// ----------------------------------------------------------- hierarchy -----
// The opening layout is authored, not derived, so it has to stay in step with
// the entity list. A node added to entities.yaml and forgotten here would open
// in the wrong place, or on a course of its own at the foot of the map — so
// the build fails on it, the same way it fails on a missing citation.
const seat = new Map();
(taxonomy.hierarchy || []).forEach((band, bi) => {
  const where = `hierarchy[${bi}] ${band.key ?? '(no key)'}`;
  if (!band.key) fail(`${where}: missing key`);
  if (!band.label) fail(`${where}: missing label`);
  if (!Array.isArray(band.rows) || band.rows.length === 0) {
    fail(`${where}: needs at least one row of entity ids`);
    return;
  }
  band.rows.forEach((row, ri) => {
    if (!Array.isArray(row) || row.length === 0) {
      fail(`${where} row[${ri}]: must be a non-empty list of entity ids`);
      return;
    }
    for (const id of row) {
      if (!byId.has(id)) fail(`${where} row[${ri}]: "${id}" is not a declared node`);
      else if (seat.has(id)) fail(`${where} row[${ri}]: "${id}" is also placed in ${seat.get(id)}`);
      else seat.set(id, `${band.key} row[${ri}]`);
    }
  });
});
if (taxonomy.hierarchy) {
  for (const n of outNodes) {
    if (!seat.has(n.id)) {
      fail(`node "${n.id}" is not placed in the taxonomy.yaml hierarchy — ` +
        'every entity needs a seat in the opening layout');
    }
  }
}

// --------------------------------------------------------------- output -----
const dated = [...outNodes, ...outEdges].filter((x) => x.date).map((x) => x.date.t);
const allCites = [...outNodes, ...outEdges].flatMap((x) => x.citations);
const liveUrlCount = allCites.filter((c) => c && c.url).length;
const graph = {
  meta: {
    generated: new Date().toISOString().slice(0, 10),
    source: 'Compiled from map/data/*.yaml',
    nodeCount: outNodes.length,
    edgeCount: outEdges.length,
    documentCount: docIndex.size,
    citationCount: allCites.length,
    liveUrlCount,
    documentsWithLiveUrl: [...docIndex.values()].filter((d) => d.url).length,
    timeExtent: [Math.min(...dated), Math.max(...dated)],
  },
  taxonomy,
  nodes: outNodes,
  edges: outEdges,
  documents: [...docIndex.values()].sort((a, b) => a.path.localeCompare(b.path)),
  nonClaims,
};

if (warnings.length) {
  console.warn(`\n${warnings.length} warning(s):`);
  for (const w of warnings) console.warn(`  · ${w}`);
}

if (errors.length) {
  console.error(`\nBUILD FAILED — ${errors.length} error(s):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error('\nNo graph.json written. Every node and every edge must be traceable.\n');
  process.exit(1);
}

const json = JSON.stringify(graph, null, 1);
writeFileSync(join(DATA, 'graph.json'), json);
// Also emit the graph as a plain script assigning a global. fetch() of a local
// file is blocked under file://, so the pages load this rather than the JSON —
// which is what lets the map work from a double-click, with no server.
writeFileSync(join(DATA, 'graph.js'),
  `// GENERATED by build/build.mjs — do not edit.\nwindow.__GRAPH__ = ${json};\n`);
const tiers = (arr) => [1, 2, 3].map((t) => `T${t} ${arr.filter((x) => x.tier === t).length}`).join(' · ');
console.log(`
  map/data/graph.json and graph.js written

  ${outNodes.length} nodes   ${tiers(outNodes)}
  ${outEdges.length} edges   ${tiers(outEdges)}
  ${docIndex.size} distinct documents cited, all present on disk
  ${liveUrlCount} of ${allCites.length} citations also carry a live url
`);
