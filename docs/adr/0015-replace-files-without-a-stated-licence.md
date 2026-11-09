# 0015. Replace the shipped files that have no stated licence

Date: 2026-11-06

Status: Accepted

## Context

Three files that Banana distributes had no licence the project could name (ADR 0011 recorded them and left the decision
open):

- `src/app/panels/map/lib/map.japan.js` and `src/app/panels/map/lib/map.world-antarctica.js`: jVectorMap map data with
  no header and no traceable source. (The other three map files, world, Europe and USA, are identical to the ones in
  Kibana 3.0.0 and stay.)
- `src/vendor/jquery/jquery.flot.stackpercent.js`: the Flot plugin that percent-stacks the series of the histogram,
  timeseries and rangeFacet panels. It came from a public repository without a licence file whose README says the plugin
  is based on Flot's MIT-licensed `jquery.flot.stack.js`. Without a licence, copyright law gives no right to
  redistribute it, whatever the README says about its ancestry.

The project is going to be community-maintained, so distributing files whose terms nobody can state is a liability for
every future maintainer and user. The files are replaced rather than left for a legal reading.

## Options considered

**Keep the files and keep the notice.** Costs nothing now, but leaves the risk with the project and with everyone who
redistributes `dist/`. Rejected.

**Remove the two maps and the percent stacking.** Removes the risk, but breaks dashboards that use the `japan` or
`world-antarctica` map or the "percentage" option of the stacked charts. Rejected: that would be a breaking change.

**Take map data from another jVectorMap map pack.** The jVectorMap maps that are distributed separately have their own
terms, which are not the same as the library's, and several of them derive from sources that also need attribution.
Rejected in favour of a source that is public domain by its own statement.

**Convert the data with GDAL.** Works, but is a heavy tool for two files, and not needed. Rejected in favour of an npm
package that is only used by the script.

**Derive the plugin from Flot's `jquery.flot.stack.js`.** That file is MIT-licensed and could be carried with its
notice, but the percent plugin does a different job (column totals, scaling) and shares almost nothing with it. Rejected:
nothing in the new plugin comes from it.

**Write the plugin fresh, under the project's licence** (chosen), and generate the maps from Natural Earth (chosen).

## Decision

### Maps

`tools/maps/build-maps.js` generates both files from Natural Earth, which is in the public domain
(https://www.naturalearthdata.com; its terms are kept in `licenses/natural-earth.txt`).

- **Source and version.** Natural Earth 5.1.2, taken from the tag `v5.1.2` of github.com/nvkelso/natural-earth-vector:
  `ne_110m_admin_0_countries.geojson` for the world map (sha256
  `6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f`) and `ne_10m_admin_1_states_provinces.geojson` for
  the prefectures of Japan (sha256 `22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5`). The script
  downloads them to a temporary directory (or the one given with `--cache`) and stops if a checksum does not match.
- **Method.** The script keeps the features it needs, projects them with the formulas that jVectorMap itself uses
  (Miller cylindrical centred on 11.5 degrees east for the world, Albers equal-area centred on 135 degrees east for Japan,
  so latitude and longitude markers land where they should), simplifies the Japan map with mapshaper (Visvalingam to 20 per cent
  of the points, which keeps shared borders shared; the world map is Natural Earth's 110 m data as it is, only joined
  and rounded, with no simplification), scales them to 900 pixels wide and writes the paths in the `addMap` format as relative `l` moves
  rounded to 0.01 pixel. Antarctica crosses the edge of the map and is cut there and joined again. Japan is limited to
  122-150 degrees east and 24-46 degrees north, because the remote Pacific islands would otherwise shrink the rest of
  the map to a corner. `mapshaper` is used only by this script and never shipped (its licence is MPL-2.0). It is not a
  dependency of the application: see "Where mapshaper is installed" below.
- **Codes and names.** The map names (`japan`, `world-antarctica`), the region codes and the region names are exactly
  those of release 1.6.30, so saved dashboards shade the same regions and the editor's list of maps is unchanged:
  47 prefecture codes `01` to `47` (the two digits of ISO 3166-2:JP), and 177 country codes, which are ISO 3166-1
  alpha-2 codes plus `_0` Northern Cyprus, `_1` Kosovo, `_2` Western Sahara and `_3` Somaliland. The script refuses to
  write a file whose code set differs from `tools/maps/region-names.json`, and a test compares the code sets and names
  with the ones recorded from 1.6.30.
- **Visible differences from 1.6.30** (the geometry is new, so the outlines differ in detail):

  | | Japan 1.6.30 | Japan now | World 1.6.30 | World now |
  | --- | --- | --- | --- | --- |
  | File size | 49 KB | 32 KB | 180 KB | 118 KB |
  | Path points | 4283 | 2692 | 15858 | 10302 |
  | Map size (width x height) | 900 x 673 | 900 x 1016 | 900 x 581 | 900 x 614 |
  | Land drawn | 24.2 to 45.5 degrees north, 123 to 146 degrees east, in the left two thirds of the frame | the same extent, filling the frame | Antarctica drawn down to about 85 degrees south | Antarctica complete, down to 90 degrees south |

  Japan covers the same latitudes as before. The old frame had empty space to the east (about the right third of the
  canvas), and the new frame is cropped to the land, so the map is taller (673 to 1016 pixels at the same width) and the
  islands fill more of it. The world map now reaches the pole: the old Antarctica was drawn down to about 85 degrees
  south and cut off there, and it is now complete, which makes the map a little taller (581 to 614 pixels). (The old
  world file's inset box, which jVectorMap uses to place markers, did not match its own paths: it put the bottom edge at
  about 55.6 degrees south. The new box matches the drawing, so markers on the new maps land where they are drawn.) Coastlines are slightly coarser, and borders and a few disputed or
  recently renamed areas follow Natural Earth 5.1.2 (the names stay as they were). Both files are generated, not edited
  by hand: run `node tools/maps/build-maps.js` to reproduce them.

### Percent stacking

`src/vendor/jquery/jquery.flot.stackpercent.js` is rewritten from scratch, under the project's licence (Apache-2.0), from
the behaviour that the panels rely on, not from the old source. It keeps everything that panels and dashboards can see:

- the same module id (`jquery.flot.stackpercent`), file path and loading order, so webpack aliases, the vendored-script
  shim and the panels' `define` lists are unchanged;
- the same registration (`$.plot.plugins.push`, plugin name `stackpercent`) and the same option (`series.stackpercent`,
  default `null`, per series or for all series), so the rangeFacet panel, which only passes the option and relies on the
  histogram or timeseries panel having loaded the plugin, keeps working;
- the same results: stacked values, the lower bound of each column, a column that adds up to zero drawn at 0, horizontal
  bars, a series that does not set the option left out of the totals, a missing y value counted as zero, and the
  `series.percents` array.

Three behaviours differ, all in cases where the old plugin was wrong:

- **A percent chart that shows only points is now drawn correctly (a visible fix).** The old plugin assumed three values
  per point. Flot gives a point two values when the chart has neither bars nor filled lines, which the histogram and
  rangeFacet editors allow (switch off Bars and Lines and keep Points) with "Stack" and "Percentage" on. 1.6.30 then drew
  wrong values and positions for those points (for two series with the values 1, 3 and 3, 1 it produced six values per series instead of four, which Flot read as extra, misplaced points); the
  new plugin uses the point size Flot reports and draws the percentages. A unit test covers it.
- The old plugin kept its running totals for the life of the plot, so setting the data of an existing plot again stacked
  on top of the old totals; the new one starts from scratch each time the data is set. The panels build a new plot for
  every render, so they do not hit this.
- Column totals are added as numbers. The old plugin added the raw values, which joined numeric strings as text. The
  panels pass numbers.

## Consequences

- Nothing that ships has an unstated licence. `NOTICE`, `tools/vendor-licenses.json` and `THIRD-PARTY-LICENSES.txt` no
  longer list a component "without a stated licence", credit Natural Earth, and list the plugin as written for Banana.
  `tools/check-dist.js` now fails the build when an entry of the manifest that ships (or an embedded one) has an empty
  licence or one that says none is stated.
- The paragraph of ADR 0011 about three files without a licence no longer applies (a note there says so).
- Dashboards keep working; the two maps look a little different (see the table), and the percent charts are identical on
  the recorded fixtures. A unit test compares the plugin with values recorded from the old one, and the smoke check
  renders the histogram, timeseries and rangeFacet panels with percent stacking turned on and checks that every column
  adds up to 100.
- The map data is tied to Natural Earth 5.1.2. Moving to a newer release means changing the pinned URL and checksums in the
  script and reviewing the region codes; the script and the code-set test show what changed.
- Running the script needs network access and `npm ci --prefix tools/maps`; building Banana does not.

### Where mapshaper is installed

mapshaper has a large dependency tree (about 220 packages) with native install scripts: `better-sqlite3` downloads a
prebuilt binary from GitHub (or compiles one) and `msgpackr-extract` ships binaries. Added to the root `package.json`, it
would have raised the lockfile from 469 to 665 packages and run those scripts on every `npm ci` of every contributor, CI
job and image build, although the build never uses it.

- **A root devDependency** was rejected for that cost.
- **`npx mapshaper@0.7.101`** (no lockfile) was rejected: the dependency tree would not be pinned or integrity-checked.
- **A separate `tools/maps/package.json`** (private, mapshaper pinned to an exact version) **with its own committed
  lockfile** is chosen. It is installed only when the maps are regenerated (`npm ci --prefix tools/maps`). The lockfile was
  generated from an empty directory with the public registry and `legacy-peer-deps=false` (the project setting is repeated
  in `tools/maps/.npmrc`), and `tools/check-lockfile.js` checks it for public-registry URLs and integrity hashes together
  with the root one. The root `package.json` and lockfile are unchanged by this work. The cost is a second lockfile to
  keep up to date when mapshaper is upgraded.
