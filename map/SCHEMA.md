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
| `date` | no | ISO `YYYY-MM-DD`, `YYYY-MM` or `YYYY` — the entity's earliest documented appearance. Drives the time ring, the date ramp and the scrubber. A **`YYYY-MM-DD`** date inside the last seven days also drives the "new this week" halo; a date given only to the month or the year never does, because the record has not placed it in a week |
| `date_note` | no | what the date actually marks ("organized", "incorporated", "first documented signature") |
| `summary` | yes | one to three sentences, in the report's voice |
| `aliases` | no | additional search terms |
| `citations` | yes, ≥1 | see below |
| `caveat` | no | rendered in the panel as an explicit limit on what the node establishes |

## Edge fields

| Field | Required | Notes |
|---|---|---|
| `source` / `target` | yes | node `id`s; the build fails on a dangling reference |
| `type` | yes | one of the keys in `connectionTypes` |
| `label` | yes | short verb phrase — "conveys Tract 1 to", "manager of" |
| `tier` | yes | 1–3 |
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
      - [site-marshfield, site-springfield, site-benton]
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
