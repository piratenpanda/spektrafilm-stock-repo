# Spektrafilm Pack Creator for darktable

A static site that lists every spektrafilm film and paper profile available for
darktable, lets people pick the ones they want, and builds a darktable data
pack from them in the browser. A scheduled GitHub Actions job pulls the
profiles from git every night and redeploys the site to GitHub Pages.

## How it works

```
sources.json ──► tools/build.py ──► site/data/ ──► GitHub Pages ──► browser zips the pack
                 (nightly, Actions)
```

1. `tools/build.py` clones the base pack repository named in `sources.json`
   (currently the `arctic_upsampling` branch of
   [piratenpanda/darktable-spektrafilm](https://github.com/piratenpanda/darktable-spektrafilm/tree/arctic_upsampling)),
   picks the pack `base.pack` names (`packs/0.3.4`, pack format 3, carrying the
   `hanatos2025` and `arctic2026beta04` spectral upsampling tables) and checks
   every file against the manifest's sha256.
2. It sparse-clones the `data/` folder of each extension in `sources.json`
   ([Negs](https://github.com/noahhaasis/negs) by default) and folds it into
   the pack with `tools/negs_to_darktable_pack.py`, unchanged. Several
   extensions are applied one after another.
3. It writes `site/data/`:
   - `pack/` the merged pack: `pack.json`, every `spectra_lut*.f32` table,
     `profiles/`, `licenses/`
   - `catalog.json` every stock with its source, licence, paper, sizes,
     checksums and a computed step wedge (density curves through the dye
     spectra and the CIE observer, seen under the viewing illuminant); the
     pack's spectral tables; and the `pack_hash` seed described below
   - `stocks/<stock>.json` curves for the detail panel
   - `build-log.txt` the merge script's full output
4. The page (`site/index.html`, `app.js`, `style.css`) reads the catalogue.
   On download it fetches the chosen profiles, `pack.json` and the chosen
   spectral tables, adds any paper a chosen film prints on, and zips them as
   `<pack_hash>.zip` holding one `<pack_hash>/` folder with `pack.json`, the
   tables and `profiles/`: the layout of a pack darktable downloads, to be
   unzipped into `<user data>/darktable/spektrafilm/packs/` and picked with
   `default_pack`. Since darktable#23253 that line is required: darktable uses a
   pack under `packs/` that its data repository's manifest does not list only
   while `default_pack` names it, and offers its built-in looks only on a
   published pack. An edit made with a pack from here keeps finding it by its
   `pack_hash` after `default_pack` moves on, as long as the folder stays. Each profile carries its copyright and licence notice in
   its `metadata` block. fflate is vendored in `site/vendor/`; the IBM
   Plex fonts come from Google Fonts.

## Spectral upsampling and pack identity

With a pack format 3 base the page offers each spectral upsampling table: put
it in the pack or leave it out, and pick the one new edits start with. The
downloaded `pack.json` gets a `spectral_upsampling` list of exactly those
tables, the default first and flagged, and is otherwise byte for byte the
merged pack's.

Each download also gets its own `pack_hash`, by the recipe of
darktable-spektrafilm's `tools/spektrafilm_export_data.py`: FNV-1a over the
pack format, spektrafilm version and model constants, one line per declared
table and one per profile. `build.py` checks that the recipe reproduces the
base pack's own `pack_hash` from its files and stops if it does not, then
publishes the hash state after the constants (`pack_hash_seed`) and each
profile's FNV-1a (`fnv`), so the page finishes the hash for any selection
without fetching anything. The page shows the result as a darktablerc line to
copy:

```
plugins/darkroom/spektrafilm/default_pack=<pack_hash>
```

The base pack must therefore be pack format 3 and declare a `pack_hash`, and
`build.py` stops if it does not. A pack built from a base without one could
only be named for its spectral table: it would unzip into the directory
darktable downloads the published pack with that table into, and darktable,
which publishes such a pack by its table hash, would take the subset for the
published pack.

If the clone, the manifest check or the merge fails, the build exits non-zero,
nothing is deployed and the site keeps serving the last good build.

## One pack for new edits

darktable uses a single pack for new edits: the one `default_pack` names, or its own downloaded pack when the key is missing. A pack from this page therefore replaces darktable's stocks for new edits instead of adding to them, and stocks in other installed packs don't show up in the module. Edits that already record a pack keep rendering with it as long as it stays installed. The page says so above the shelf, in the install steps and in the FAQ, and the download tray warns, with a one-click fix, when a selection leaves out any of darktable's own stocks. To add stocks, start from darktable's own set and pick on top; to use negatives and slides together, put both in one pack.

## Set up on GitHub

1. Push this folder to a new repository.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Actions → Sync film stocks → **Run workflow** for the first deploy. After
   that it runs every night at 04:23 UTC and on every push to `main`.

GitHub turns off scheduled workflows in repositories with no activity for 60
days. If the "Synced" date in the header stops moving, re-enable the workflow
on the Actions tab.

## Run locally

```sh
pip install numpy               # Python 3.11 or newer
python3 tools/build.py          # writes site/data/
python3 -m http.server -d site 8000
```

Open http://localhost:8000. Building needs `git` and network access to GitHub.

## Adding a source

Add an entry to `extensions` in `sources.json`:

```json
{ "name": "My stocks", "repo": "https://github.com/me/my-stocks", "ref": "main" }
```

The repository must have the layout Negs uses, because the merge script
reads it: `data/profiles/*.json`, `data/presets/couplers.toml`,
`data/presets/grain.toml` and `data/filters/neutral_print_filters.json`. Any
`data/*LICENSE*.txt` and `data/CHANGELOG.txt` are shipped in the pack's
`licenses/` folder. To pin darktable's base pack instead of using the
manifest's default, set `base.pack` to its path (`packs/0.3.4`), its
`pack_hash` or its spektrafilm version. It has to be a pack format 3 pack with
a `pack_hash`, so not `packs/0.3.3`.

## Licences

The film data is CC BY-SA 4.0: spektrafilm by Andrea Volpato, Fotufilm
profiles by MUAStudio Inc., Negs preparations by Noah Haasis, packaged for
darktable by the darktable project. Every profile in a downloaded pack carries its own
copyright and licence notice; the licence texts, sources and changes are
linked from the page.
fflate is MIT (`site/vendor/fflate-LICENSE.txt`).

The page design and the film box covers (`site/covers.js`, `site/style.css`)
follow [GRKit](https://github.com/ahonn/grkit)'s film look picker, MIT License,
Copyright (c) 2026 ahonn; its licence is in `site/vendor/grkit-LICENSE.txt` and
credited in the page footer. The box colours are GRKit's curated inks; film
names on them are trademarks of their owners, and the footer says the site is
not affiliated with them.
