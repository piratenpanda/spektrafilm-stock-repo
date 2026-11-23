# Lightbox

A static site that lists every spektrafilm film and paper profile available for
darktable, lets people pick the ones they want, and builds a darktable data
pack from them in the browser. A scheduled GitHub Actions job pulls the
profiles from git every night and redeploys the site to GitHub Pages.

## How it works

```
sources.json ──► tools/build.py ──► site/data/ ──► GitHub Pages ──► browser zips the pack
                 (nightly, Actions)
```

1. `tools/build.py` clones
   [darktable-spektrafilm](https://github.com/darktable-org/darktable-spektrafilm),
   picks the pack its `manifest.json` marks as default and checks every file
   against the manifest's sha256.
2. It sparse-clones the `data/` folder of each extension in `sources.json`
   ([Negs](https://github.com/noahhaasis/negs) by default) and folds it into
   the pack with `tools/negs_to_darktable_pack.py`, unchanged. Several
   extensions are applied one after another.
3. It writes `site/data/`:
   - `pack/` the merged pack: `pack.json`, `spectra_lut.f32`, `profiles/`, `licenses/`
   - `catalog.json` every stock with its source, licence, paper, sizes,
     checksums and a computed step wedge (density curves through the dye
     spectra and the CIE observer, seen under the viewing illuminant)
   - `stocks/<stock>.json` curves for the detail panel
   - `build-log.txt` the merge script's full output
4. The page (`site/index.html`, `app.js`, `style.css`) reads the catalogue.
   On download it fetches the chosen profiles plus `pack.json` and
   `spectra_lut.f32`, adds any paper a chosen film prints on, and zips a
   `spektrafilm/` folder with a README (install paths, sources, changes,
   credits) and `SHA256SUMS`. fflate is vendored in `site/vendor/`, so the
   page needs no CDN.

If the clone, the manifest check or the merge fails, the build exits non-zero,
nothing is deployed and the site keeps serving the last good build.

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
manifest's default, set `base.pack` to its path (`packs/0.3.3`), its table
hash or its spektrafilm version.

## Licences

The film data is CC BY-SA 4.0: spektrafilm by Andrea Volpato, Fotufilm
profiles by MUAStudio Inc., Negs preparations by Noah Haasis, packaged for
darktable by the darktable project. Every downloaded pack carries the licence
texts, a credit line for each chosen stock and a note of the changes made.
fflate is MIT (`site/vendor/fflate-LICENSE.txt`).
