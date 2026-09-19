# The interactive map

A node-and-edge map of the entities, people, land and proceedings on record
here — pannable, zoomable, filterable, searchable, and traceable to a document
at every point.

**Open `map/index.html`.** Double-clicking it from disk works — no server, no build
step, no network. Canvas rendering, plain classic scripts, and `d3-force` vendored
as UMD into `js/vendor/`.

That constraint is why the code looks the way it does. Browsers block **both** ES
module loading and `fetch()` of a local file under `file://`, so the page uses
neither: the graph ships as `data/graph.js`, a plain script that assigns
`window.__GRAPH__`, and the app files are classic scripts sharing a `MAP` global.
`data/graph.json` is emitted alongside it for anything else that wants the data.

Serving it works identically, if you'd rather:

```sh
python3 -m http.server 8000     # then open http://localhost:8000/map/
```

---

## The rule this map is built around

**Every node and every edge cites a document.** That is enforced mechanically, not
by good intentions: `build/build.mjs` fails the build — it does not warn — if any
citation points at a file absent from this repository, if any node or edge carries
no citation, or if a tier-3 edge does not say what would resolve it.

```sh
node build/build.mjs
```

```
  map/data/graph.json and graph.js written

  85 nodes   T1 81 · T2 3 · T3 1
  117 edges  T1 102 · T2 11 · T3 4
  88 distinct documents cited, all present on disk
  38 of 261 citations also carry a live url
```

Edit the YAML, re-run, reload. `graph.json` and `graph.js` are both generated —
never hand-edit either.

## The archived source, and the live one

A good part of this file was captured from the web: a LinkedIn profile printed to
PDF, a screenshot of a company page, a saved article, a filing index. The capture
is the evidence — it is the source as it stood on the day it was gathered, and no
later edit to the page can move a claim that rests on it. It is also, on its own,
unverifiable: a reader has only this repository's word that the page said what the
PDF says it said.

So a citation may carry a **live url** as well, and the panels and the Sources page
show both. The archived file is what the claim rests on; the link marked **Live**
is where the same source can be read today, and it is the half that can move,
change or vanish. Neither substitutes for the other, and the build will not let a
`url` stand in a citation that has no `doc` or `external` beside it.

A live url is given only where the public page genuinely carries the same record —
a profile, the article as published, an SEC filing index, an agency's own permit
record. It is **not** given for sources that exist only behind a session-bound or
search-only portal: Missouri's business and UCC search, Case.net, the county
recorders, the county GIS viewers. A link to an empty search box verifies nothing,
and those records reach the reader as the certified and downloaded copies in
`evidence/`, which is why they were collected that way.

See [`SCHEMA.md`](SCHEMA.md) § "The live url" for the field contract.

## How well established

The tiers are the standard every line here is held to.

| | | Drawn as |
|---|---|---|
| **1** | Stated in a primary document in `evidence/` | Solid line |
| **2** | A party's own statement, or externally verified from a named public source | Solid, lighter |
| **3** | An open question or unresolved reading the file tracks but does not settle | Dashed, muted, and it says what would resolve it |
| **4** | Something the record expressly declines to claim | **Never drawn.** Text only, in "Not claimed" |

Tier 4 is the important one. A line on a map is an assertion; a paragraph is not.
The readings the record does not support live in `data/non-claims.yaml` and reach
the screen as prose, where they cannot be mistaken for findings.

Two consequences are worth stating plainly, because they are choices, not
oversights:

- **No edge is drawn for the Marshfield power agreement.** The developer states he
  secured one before buying the land. No agreement and no counterparty appears
  anywhere in this file, so drawing a line to any utility would invent the single
  fact the record is missing. The Sho-Me relationship is drawn as *parcel
  adjacency*, which is what the surveys actually establish.
- **Payment 1 Financial MO LLC is drawn**, because the summons naming it is a court
  filing and that is the strongest kind of documented connection. Why it reads that
  way is unresolved, and the panel says so without presuming either explanation.

## Reading the map

**Colour** is one of three hues plus a neutral, grouping entities into people and
the vehicles they form, operating businesses and infrastructure, public bodies and
proceedings, and land. **Shape and fill** carry the nine categories within those
groups, so no category is identified by colour alone — the hues clear the
colour-vision and normal-vision separation gates in both light and dark mode, and
shape keeps the map legible if they did not.

**The map opens on a fixed hierarchy, already settled.** Nothing drifts into
place: the arrangement is computed before the first frame is painted, so the
page is readable the moment it appears. It reads top to bottom —

| | |
|---|---|
| **The three data centers** | Marshfield, Springfield and Warsaw, each named above its address, because the addresses are what the record uses and not what anyone would recognise |
| **Principals** | the people the record shows directing the projects |
| **Control and holding vehicles** | what those people manage or hold through |
| **Entities holding title** | the single-purpose entities named as owner on the deeds and permits |
| **Grantors, earlier vehicles and the people behind them** | where the land came from, and who signed for it |
| **Counterparties, lenders and professional services** | equipment, money and paperwork |
| **Public bodies, proceedings, utilities and adjacent land** | who has taken a position, and the ground next door |

The bands are authored in [`data/taxonomy.yaml`](data/taxonomy.yaml), because
which rung an entity stands on is a reading of the record and not something the
edge list knows. **The build fails if an entity is placed twice or left out** —
the same mechanical check that keeps the citations honest, applied to the thing
a reader sees first. Within its course each name then settles towards the
average position of whatever it connects to, which is what puts a grantor under
the entity it conveyed to.

**Every entity is named in that frame.** The layout reserves the space each name
needs, so the opening view is the readable one — no zooming in, no dragging
nodes out of each other's way. A name may cross a connection, because a line
still reads under text; it never sits on another node. A ladder is a less
economical shape than a web, so on a window narrower than about 1700 pixels it
is larger than the stage and the opening frame scales down to fit it — the map
pans and zooms, and past a certain smallness only the hubs keep a name.

**On a portrait screen the ladder folds.** Eleven long courses laid across a
phone would frame as a band through the middle with the screen empty above and
below, so a course longer than the width continues on the line beneath it. The
authored order is untouched — the course turns the corner, and keeps its band.
Where it folds is not a guess: the layout measures the candidate widths and
takes whichever one leaves the map drawn largest. A landscape screen of any
size, desktop to phone-on-its-side, frames the ladder exactly as it always has.

**Nothing moves on its own.** Clicking a node selects it; dragging one moves
that node and no other. An arrangement made by hand is therefore an arrangement
that survives the next thing you pick up, and a window resize. The force
simulation is still here, and **Time rings** is what runs it — morphing away
from the ladder, and returning the map to it.

**Time** is layered rather than imposed as an axis:

- every node carries an **age ring**, shaded light-to-bright by its earliest
  documented date, on an achromatic scale that never competes with category colour;
- the **scrubber** ghosts what had not yet happened, holding positions stable so the
  web does not rearrange underneath you — press play to watch it assemble from 1996
  to September 2026;
- **Time rings** morphs the same web into concentric year rings, oldest at the
  center, and returns the map to the hierarchy it opened on.

## Interacting

| | |
|---|---|
| Drag background / wheel | Pan, zoom |
| One finger / two fingers | Pan, pinch to zoom |
| Drag a node | Move it, and only it — every other position holds. A click on its own moves nothing at all |
| Click or tap a node | Focus it, dim everything but its neighbours, open its panel |
| Click or tap a connection | Open *that connection's* sources — an edge's citation is never more than one click away |
| Double-click / double-tap the plane | Re-frame the whole web — the way back from a zoom |
| Hover | Name, category, date, source and connection counts. A pointer thing: touch goes from a tap straight to the panel |
| `/` | Jump to search |
| Sidebar | Filter by category, connection type and how well established. Below 900px it is a drawer over the map, behind **Filters** |
| **Sources** | The map inverted — every document, and what rests on it |
| **Not claimed** | What the record does not support, and why some expected lines are absent |
| **Tipline** | What kind of information is useful to send in, and that identities are kept anonymous |

## Files

```
map/
  index.html          the map
  sources.html        document index
  SCHEMA.md           field contracts for nodes, edges and citations
  data/
    taxonomy.yaml     categories, connection types, hue families, the opening hierarchy
    entities.yaml     nodes          ─┐
    relationships.yaml edges          ├─ hand-authored from the record
    non-claims.yaml   tier 4, text only ─┘
    graph.json        GENERATED — do not edit
    graph.js          GENERATED — the same data as a global, for file://
  js/
    main.js           bootstrap, timeline, controls
    layout.js         the opening hierarchy — courses, and where each name sits on one
    graph.js          simulation, camera, canvas renderer, hit testing
    ui.js             sidebar, search, panels, modal
    shapes.js         glyphs, palette, tier line styles
    vendor/           d3-force and its three dependencies, UMD builds
build/
  build.mjs           YAML -> graph.json, with the validation that fails the build
```

## Adding to the map

1. Add the node to `data/entities.yaml` with a `category`, a `tier`, a `summary`
   and at least one citation. Give the citation an `excerpt` — the specific line the
   claim rests on — not just a path. If the document is a capture of a page that is
   still on the public web, add the `url` it was captured from, and a `url_label`
   saying what the link opens.
2. Add edges to `data/relationships.yaml`. Tier 3 needs `resolves`.
3. Give it a seat in `hierarchy` in `data/taxonomy.yaml`: the band it belongs to,
   and where in that row it reads.
4. `node build/build.mjs`. If it fails, it names the file and the field.

The failure mode this guards against is the ordinary one: a claim that outlived
the document it rested on. Here, that cannot survive a build.
