# Graph data schema

Two hand-authored source files compile to one `graph.json` consumed by the site:

```
map/data/entities.yaml      ─┐
                             ├─ node build/build.mjs ──> map/data/graph.json
map/data/relationships.yaml ─┘
```

The build **fails** — it does not warn — if any citation points at a file that is not in
this repository, or if any node or edge carries no citation at all. That is the mechanical
enforcement of the standard this file holds itself to.

---

## Verification tiers

The tiers are the three-part standard every line here is held to.

| Tier | Meaning | Renders as |
|---|---|---|
| **1** | Stated in a primary document in `evidence/`, cited by path and instrument number | Solid line, full strength |
| **2** | A party's own statement — sworn filing, permit application, public-records response, on-record appearance — carried as *that party's characterization* | Solid line, lighter weight, "stated" marker |
| **3** | An open question or unresolved reading: the relationship is asserted, incomplete, or contested, and the file says so | Dashed line, muted, "unresolved" marker |
| **4** | Something the record expressly declines to claim | **Never drawn.** Listed in the "What this map does not claim" panel only |

Tier 4 has no representation in `entities.yaml` or `relationships.yaml`. It lives in
`map/data/non-claims.yaml` and reaches the UI as text, never as geometry.

---

## Node fields

| Field | Required | Notes |
|---|---|---|
| `id` | yes | kebab-case, stable, used in edge references |
| `name` | yes | full formal name as it appears in the record |
| `short` | no | label drawn on the canvas; falls back to `name` |
| `label` | no | one or two lines drawn verbatim, instead of wrapping `short`. For names the wrap has to be *said* rather than guessed — the three data centers, which carry a recognisable name above an address most readers would not place on its own |
| `category` | yes | one of the nine keys in `categories` (see below) |
| `tier` | yes | 1–3 |
| `date` | no | ISO `YYYY-MM-DD`, `YYYY-MM` or `YYYY` — the entity's earliest documented appearance. Drives the time ring, the date ramp and the scrubber. A **`YYYY-MM-DD`** date inside the recency window (`RECENT_DAYS` in `js/shapes.js`, currently 30) also drives the "new" halo; a date given only to the month or the year never does, because the record has not placed it on a day |
| `date_note` | no | what the date actually marks ("organized", "incorporated", "first documented signature") |
| `summary` | yes | one to three sentences, in the report's voice |
| `aliases` | no | additional search terms |
| `citations` | yes, ≥1 | see below |
| `caveat` | no | rendered in the panel as an explicit limit on what the node establishes |

There is deliberately **no `projects` field on a node**. An entity's membership is
derived by the build, as the union of the projects of the connections it stands on.
See below.



## Edge fields

| Field | Required | Notes |
|---|---|---|
| `source` / `target` | yes | node `id`s; the build fails on a dangling reference |
| `type` | yes | one of the keys in `connectionTypes` |
| `label` | yes | short verb phrase — "conveys Tract 1 to", "manager of" |
| `tier` | yes | 1–3 |
| `projects` | yes | which builds this connection belongs to: a list of keys from `projects` in `taxonomy.yaml`, or `all`. The build fails on an edge that names none, the same way it fails on an uncited one |
| `date` | no | ISO date of the instrument or event |
| `summary` | no | longer prose for the panel |
| `citations` | yes, ≥1 | see below |
| `resolves` | tier 3 only | what document would settle it — required by the build for tier 3 |

## Citation fields

A citation is either **internal** (a document in this repository) or **external** (a named
public source). Internal citations are validated against the filesystem.

```yaml
citations:
  - doc: evidence/01-marshfield-site/recorded-instruments/2026-07-13_inst-2026003834_deed-of-trust_oakstar-bank.pdf
    label: Deed of trust, Inst. 2026003834
    date: 2026-07-10
    excerpt: >
      Manager of LUMON SOLUTIONS MANAGEMENT, LLC, Manager of LUMON SOLUTIONS
      MARSHFIELD, LLC
  - doc: evidence/03-entities/company/payment-1-financial-mo-llc/2026-09-17_linkedin-jake-gaddy.pdf
    url: https://www.linkedin.com/in/jcgaddy/
    url_label: LinkedIn profile — Jake Gaddy
    label: LinkedIn — Jake Gaddy
  - external: Biz 417 "B-School" panel
    url: https://www.biz417.com/blog/b-school-recap-data-centers/
    url_label: Biz 417 — the magazine's own recap of the panel
    date: 2026-06-23
    label: Overhue as a named panelist
    excerpt: >
      approximately 10 megawatts on roughly five acres, single-tenant
```

- `doc` — repository-relative path. **Must exist.**
- `external` — name of the source. Requires `label`.
- `excerpt` — the specific line the claim rests on. Strongly preferred over a bare link.
- `url` — optional on either kind: where the same source can be read on the public web
  today. See below.
- `url_label` — optional, and only alongside `url`: what the live link actually opens.
  Falls back to the bare host.
- `preview` — optional, `true` only: show the cited image in the panel. See below.

### Showing a cited image

Most of the images in `evidence/` are records to be read at full size — a parcel viewer,
a permit, a screenshot of a filing. A few are photographs that *are* the evidence, and
describing one in prose while refusing to show it asks the reader to take on trust the
one kind of source they could have judged for themselves.

`preview: true` marks such a citation. The image is drawn in the entity panel directly
under the summary, captioned with the citation's own `label` and `date`, and it links to
the full-size file. The citation still appears in the source list below with its
`excerpt` and its links, so the picture appears once and the record of it appears once.

It is opt-in per citation, never inferred from the file extension, because the default
for a record is to be read rather than displayed. The build enforces:

- `preview` may only be `true` — any other value fails, so `preview: no` cannot quietly
  turn into a truthy string;
- it requires a `doc`; an `external` source has no file in this repository to show;
- that `doc` must be an image (`.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`, `.avif`);
- the citation must carry a `label`, because a shown image is captioned.

Where a photograph comes from a source that does not itself say what it shows, the panel
says so — in the `excerpt`, or in the entity's `caveat`. The site aerials on
`site-marshfield` are the worked example: they were published in a company post that
names no site, address or county, and were identified visually. The caveat states both,
so the reader knows which part is the poster's and which part is this file's.

### The live url

Much of what this file rests on was captured from the web: a LinkedIn profile printed to
PDF, a screenshot of a company page, a saved article, a filing index. The capture is the
evidence — it is the source as it stood on the day it was gathered, and it cannot change
underneath a claim. It is also unverifiable by a reader, who has only this repository's
word that the page said what the PDF says it said.

`url` closes that gap without giving up the first property. The archived file stays the
citation; the live url sits beside it as the reader's independent check, and it is the
half that can move, change or disappear. **A `url` never appears without a `doc` or an
`external` beside it**, and adding one never licenses deleting the capture.

The build enforces three things:

- a `url` must be an absolute `http`/`https` URL;
- `url_label` without `url` fails;
- two citations of the **same** `doc` may not give it different `url`s — one archived
  document has one live location, and disagreement about which is an authoring error
  rather than something the interface should have to present.

What it cannot check is whether the url still resolves, or still says what the capture
says. Add one only where the live page genuinely carries the same record: a profile, an
article as published, a filing index, an agency's own record of the permit. Where a
source exists only behind a session-bound or search-only portal — Missouri's business
and UCC search, Case.net, the county recorders and GIS viewers — no url is given,
because a link to an empty search box verifies nothing.

## Categories and connection types

Both are declared once in `map/data/taxonomy.yaml` and drive the legend, the filters and
the colours. The build fails if a node or edge names a key that is not declared there.

Colour is assigned from three validated hues plus a neutral, and **shape and fill carry the
rest** — no category is identified by colour alone.

---

## The three builds

`map/data/taxonomy.yaml` declares the projects the map can focus on. The map opens on
one of them rather than on all 88 entities at once, because the whole file at once is
the view nobody reads.

```yaml
projects:
  - key: marshfield
    label: Marshfield
    anchor: site-marshfield
    default: true
    note: >
      Ten acres off Rifle Range Road, the deepest-documented of the three …
```

| Field | Required | Notes |
|---|---|---|
| `key` | yes | named by every edge's `projects` |
| `label` | yes | what the switch in the sidebar reads |
| `anchor` | yes | the site the build is read from. A focused view centres on it, and the build fails if it is not a declared node, or not on any connection tagged with this project |
| `default` | exactly one | the build the map opens on |
| `note` | no | one or two sentences, shown under the switch |

### Why membership is tagged, and tagged on edges

A project is an **editorial grouping, not a documented relationship.** It never becomes
a node or an edge, and nothing on the canvas is drawn because of it — which is the same
reason tier 4 lives in `non-claims.yaml` rather than in the graph.

It has to be authored, because it cannot be derived. The graph is a single connected
component: every entity reaches every other one, so no distance from a site is
membership. Breadth-first from `site-springfield` reaches 8 entities at one hop — too
thin to be a map — 25 at two, which already includes the Marshfield fire district, and
53 at three, by which point 43 of the 88 are shared by all three sites and the focus is
gone.

The tag sits on **edges** rather than entities because an entity's membership is
genuinely ambiguous where its connections are not. Trent Overhue stands on all three
sites; each of his connections stands on exactly one. Tagged on the entity, every one of
his connections would follow him into every view. Tagged on the connections, a focused
view draws him with only the connections that belong to it.

So `entities.yaml` carries no project field at all. The build computes each entity's
membership as the union of its connections' projects, and **fails** on an entity that
comes out belonging to none — it would be drawn in no view but the whole map. Fifteen
entities come out in more than one build; those overlaps are among the more substantial
things the file has to show, and a schema that forced each entity under one site would
have had to assert a relationship the record does not state.

Most of the tags were read off the `evidence/` folder each citation lives in, which is
already arranged by site. What that cannot place is the corporate-formation layer — a
filing naming an organizer, a registered agent or a firm, which says nothing about which
site it was for — and those were decided one line at a time by what the entity at the
other end of the chain turns out to be.

### Bridges

A focused view also draws, faintly, the connections that **leave** it and the entities
on the far end of them. Those are not extra: a Springfield that quietly omitted the
principal who is also on the other two sites would be a cleaner picture of something
that is not true. Bridges are how a focused view stays honest about what it has set
aside. They carry no **NEW** chip and no recency wash, because both are meant to be
caught before anything else is read, and what is new in a build the reader is not
looking at is not.

---

## The opening layout

`map/data/taxonomy.yaml` also carries `hierarchy`: the arrangement the map opens on,
which is editorial and therefore authored rather than derived. It is an ordered list
of bands, drawn top to bottom, each holding one or more `rows` of node ids:

```yaml
hierarchy:
  - key: sites
    label: The three data centers
    note: The locations themselves. Everything below stands under one of them.
    rows:
      - [site-springfield, site-marshfield, site-benton]
```

| Field | Required | Notes |
|---|---|---|
| `key` | yes | stable identifier; reaches the nodes as `n.band` |
| `label` | yes | what the band is, in the report's voice |
| `note` | no | why these entities belong together |
| `rows` | yes, ≥1 | each a list of node ids. A row is one course across the map, and the order is the reading order, left to right |

**The build fails** if an id is not a declared node, if a node is placed in two rows, or
if a node is left out. A layout authored by hand and an entity list that grows are
otherwise guaranteed to drift apart; this is the same mechanical check that keeps
citations honest, applied to the thing the reader sees first.

Rows say *what order*, not *what coordinates*. Within its course each node then settles
towards the average position of what it connects to, which is what puts a grantor under
the entity it conveyed to. See `map/js/layout.js`.
