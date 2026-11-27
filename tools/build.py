#!/usr/bin/env python3
"""Sync film profiles from git and build the site's data folder.

Run by .github/workflows/sync.yml on a schedule. It

  1. clones the base darktable pack repository (darktable-org/darktable-spektrafilm)
     and checks every file against its manifest's sha256,
  2. sparse-clones each extension repository listed in sources.json (Negs by
     default) and folds its profiles into the pack with negs_to_darktable_pack.py,
     one extension after another,
  3. writes the merged pack to <out>/pack/ and a catalogue the page reads:
     <out>/catalog.json        every stock, its source, licence and a step wedge,
                               and the pack's spectral upsampling tables
     <out>/stocks/<stock>.json curves for the detail panel
     <out>/build-log.txt       the merge script's full output

If anything fails the script exits non-zero, so the workflow does not deploy and
the site keeps serving the last good build.

Usage:
    python3 tools/build.py [--sources sources.json] [--out site/data]
                           [--work .work] [--previous URL_OR_PATH]

--previous points at the catalog.json of the live site, so a stock keeps the date
it first appeared ("new" badges) across builds. Missing or unreachable is fine.
Requires Python 3.11+ and numpy.
"""

import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
MERGE_SCRIPT = HERE / 'negs_to_darktable_pack.py'

spec = importlib.util.spec_from_file_location('negs_merge', MERGE_SCRIPT)
merge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(merge)  # only the helpers; main() is guarded

BRANDS = {
    'kodak': 'Kodak', 'fujifilm': 'Fujifilm', 'ilford': 'Ilford', 'agfa': 'Agfa',
    'cinestill': 'CineStill', 'harman': 'Harman', 'lomography': 'Lomography',
    'fotufilm': 'Fotufilm', 'foma': 'Foma', 'rollei': 'Rollei',
}
WEDGE_STEPS = 9


def log(msg):
    print(msg, flush=True)


def git(*args, cwd=None):
    r = subprocess.run(['git', *args], cwd=cwd, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"git {' '.join(args)} failed:\n{r.stderr}")
    return r.stdout.strip()


def clone(repo, ref, dest, sparse=None):
    if dest.exists():
        shutil.rmtree(dest)
    if sparse:
        git('clone', '--quiet', '--depth', '1', '--filter=blob:none', '--sparse',
            '--branch', ref, repo, str(dest))
        git('sparse-checkout', 'set', *sparse, cwd=dest)
    else:
        git('clone', '--quiet', '--depth', '1', '--branch', ref, repo, str(dest))
    return {
        'commit': git('rev-parse', 'HEAD', cwd=dest),
        'date': git('log', '-1', '--format=%cI', cwd=dest),
        'subject': git('log', '-1', '--format=%s', cwd=dest),
    }


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


# ------------------------------------------------------------------ base pack --

def pick_base_pack(repo_dir, want):
    manifest = json.loads((repo_dir / 'manifest.json').read_text())
    packs = manifest['packs']
    if want:
        chosen = [p for p in packs if want in (p['base'], p.get('pack_hash'), p['lut_hash'], p['spektrafilm_version'])]
        if not chosen:
            sys.exit(f"base pack {want!r} is not in the manifest")
        entry = chosen[0]
    else:
        entry = next((p for p in packs if p.get('default')), packs[-1])
    # A pack built here is installed under packs/ and named for its pack_hash,
    # which darktable reads back from pack.json. A base without one gives the
    # page nothing to compute that hash from: the download would fall back to
    # the default table's hash, land in the very directory darktable downloads
    # the published base pack into, and -- since darktable#23253 records a
    # pack without pack_hash as published by its table hash -- be taken for
    # that published pack, built-in looks and all, by every edit that recorded
    # its table. So only a pack_format 3 base with its own pack_hash will do.
    if entry.get('pack_format', 2) < 3 or not entry.get('pack_hash'):
        sys.exit(f"base pack {entry['base']} is pack_format {entry.get('pack_format', 2)}"
                 f"{' with no pack_hash' if not entry.get('pack_hash') else ''}: a pack built "
                 f"from it would have no identity of its own and would pass for the "
                 f"published one. Pick a pack_format 3 base that declares a pack_hash")
    pack_dir = repo_dir / entry['base']
    for f in entry['files']:
        p = pack_dir / f['path']
        if not p.exists() or p.stat().st_size != f['size'] or sha256(p) != f['sha256']:
            sys.exit(f"base pack file {f['path']} does not match the manifest")
    log(f"base pack {entry['base']}: {len(entry['files'])} files verified against the manifest")
    return pack_dir, entry


# --------------------------------------------------------------- step wedge --

def _arr(v):
    return np.array([[np.nan if x is None else x for x in r] if isinstance(r, list) else
                     (np.nan if r is None else r) for r in v], dtype=float)


def _interp_nan(x, xp, fp):
    ok = ~np.isnan(fp)
    if ok.sum() < 2:
        return np.zeros_like(x)
    return np.interp(x, xp[ok], fp[ok])


BRADFORD = np.array([[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]])
XYZ_TO_SRGB = np.array([[3.2404542, -1.5371385, -0.4985314], [-0.9692660, 1.8760108, 0.0415560],
                        [0.0556434, -0.2040259, 1.0572252]])
D65 = np.array([0.95047, 1.0, 1.08883])


def _to_hex(xyz, white):
    lms, lmsw, lmsd = BRADFORD @ xyz, BRADFORD @ white, BRADFORD @ D65
    xyz65 = np.linalg.inv(BRADFORD) @ (lms * lmsd / lmsw)
    rgb = np.clip(XYZ_TO_SRGB @ xyz65, 0, 1)
    rgb = np.where(rgb <= 0.0031308, 12.92 * rgb, 1.055 * rgb ** (1 / 2.4) - 0.055)
    return '#' + ''.join(f'{int(round(c * 255)):02x}' for c in rgb)


def fnv1a(data, h=2166136261):
    """FNV-1a, 32 bit, continuing from h: the hash pack_hash and the tables use."""
    for b in data:
        h = ((h ^ b) * 16777619) & 0xFFFFFFFF
    return h


def pack_hash_seed(pack):
    """FNV-1a state after the part of darktable-spektrafilm's pack_hash text that
    does not depend on which stocks and tables a pack carries (pack format,
    spektrafilm version, model constants). The page continues it with one
    '\\ntable=identifier:kind:file' line per table in declaration order and one
    '\\nprofile=file:fnv' line per profile sorted by file name, as
    tools/spektrafilm_export_data.py writes them."""
    constants = {k: v for k, v in pack.items() if k not in ('spectral_upsampling', 'pack_hash')}
    head = '\n'.join([f"pack_format={pack['pack_format']}",
                      f"spektrafilm_version={pack['spektrafilm_version']}",
                      'constants=' + json.dumps(constants, sort_keys=True, separators=(',', ':'))])
    return fnv1a(head.encode())


def pack_hash(seed, tables, profiles):
    """pack_hash of a pack carrying `tables` (declaration dicts, in order) and
    `profiles` ({file name: profile bytes})."""
    h = seed
    for t in tables:
        h = fnv1a(f"\ntable={t['identifier']}:{t['kind']}:{t['file']}".encode(), h)
    for name in sorted(profiles):
        h = fnv1a(f"\nprofile={name}:{fnv1a(profiles[name]):08x}".encode(), h)
    return f'{h:08x}'


def table_list(pack_out, pack, entry):
    """Every spectral upsampling table of the published pack, default first, with
    what the page needs to offer it as a choice and to rewrite pack.json's
    spectral_upsampling block when a table is left out."""
    from_manifest = {t['file']: t for t in entry.get('tables', [])}
    decl = pack.get('spectral_upsampling') if pack.get('pack_format', 2) >= 3 else None
    if not decl:
        decl = [{'identifier': None, 'kind': 'irradiance', 'file': 'spectra_lut.f32', 'default': True}]
    out = []
    for d in decl:
        f = pack_out / d['file']
        m = from_manifest.get(d['file'], {})
        out.append({
            'identifier': d.get('identifier'),
            'kind': d.get('kind'),
            'file': d['file'],
            'default': bool(d.get('default')),
            'scene_illuminant': d.get('scene_illuminant'),
            'lut_hash': m.get('lut_hash') or (entry.get('lut_hash') if d.get('default') else None),
            'lut_id': m.get('lut_id') or (entry.get('lut_id') if d.get('default') else None),
            'decl': d,
            'size': f.stat().st_size,
            'sha256': sha256(f),
        })
    out.sort(key=lambda t: not t['default'])
    return out


def development_index(data):
    dev = data.get('development_time')
    return len(dev) // 2 if isinstance(dev, list) and len(dev) > 1 else None


def spectral_density_fn(data):
    """Return (log_exposure grid, f(logE) -> spectral density over 81 wavelengths, mean density curve)."""
    le = np.array(data['log_exposure'], dtype=float)
    cd = np.nan_to_num(_arr(data['channel_density']))
    base = np.nan_to_num(_arr(data['base_density']))
    dc = _arr(data['density_curves'])
    k = development_index(data)
    if k is not None:  # B&W development-time family: one emulsion, the middle time
        base = base[:, k]
        cd = cd.sum(axis=1, keepdims=True)
        dc = dc[:, [k]]
    elif base.ndim == 2:
        base = base[:, 0]
    if cd.shape[1] != dc.shape[1]:
        cd = cd.sum(axis=1, keepdims=True)
        dc = np.nanmean(dc, axis=1, keepdims=True)

    def at(x):
        d = np.array([_interp_nan(np.array([x]), le, dc[:, c])[0] for c in range(dc.shape[1])])
        return base + cd @ d

    return le, at, np.nanmean(dc, axis=1)


def step_wedge(data, pack, viewing):
    """sRGB colours of a neutral step wedge as the developed film or print looks on a
    light table (film) or under the viewing light (paper): density curves through the
    dye spectra, the illuminant and the CIE observer. The darkest-to-lightest range is
    where the curve moves, so slides and negatives both show their whole scale."""
    cmfs = np.array(pack['cmfs'], dtype=float)
    ill = np.array(pack['illuminants'].get(viewing) or pack['illuminants']['D50'], dtype=float)
    norm = (ill * cmfs[:, 1]).sum()
    white = (ill[:, None] * cmfs).sum(axis=0) / norm
    le, at, mean = spectral_density_fn(data)
    ok = ~np.isnan(mean)
    m = mean[ok]
    lo, hi = np.nanmin(m), np.nanmax(m)
    moving = le[ok][(m > lo + 0.03 * (hi - lo)) & (m < hi - 0.03 * (hi - lo))]
    a, b = (moving.min(), moving.max()) if moving.size else (-2.0, 1.0)
    pad = 0.08 * (b - a)
    steps = np.linspace(a - pad, b + pad, WEDGE_STEPS)

    def colour(x):
        t = 10.0 ** (-at(x))
        return _to_hex(((ill * t)[:, None] * cmfs).sum(axis=0) / norm, white)

    wedge = [colour(x) for x in steps]
    rebate = colour(le[0])  # unexposed: orange mask on negatives, black on slides
    return wedge, rebate, [round(float(x), 3) for x in steps]


# ---------------------------------------------------------------- catalogue --

def classify(info):
    if info['stage'] == 'printing':
        return 'print-film' if info.get('use') == 'cine' else 'paper'
    if info.get('channel_model') == 'bw':
        return 'bw'
    if info['type'] == 'positive':
        return 'slide'
    return 'cine' if info.get('use') == 'cine' else 'negative'


def origin_of(meta):
    c = (meta.get('copyright') or '') + ' ' + (meta.get('license') or '')
    if 'Fotufilm' in c or 'MUAStudio' in c:
        return 'Fotufilm'
    if 'spektrafilm-rs' in c:
        return 'spektrafilm-rs'
    if 'Negs' in c or 'Haasis' in c:
        return 'Negs'
    if 'Volpato' in c:
        return 'spektrafilm'
    return 'other'


def brand_model(info):
    name = info.get('name') or info['stock']
    prefix = info['stock'].split('_', 1)[0]
    brand = BRANDS.get(prefix, prefix.capitalize())
    model = name[len(brand):].strip() if name.lower().startswith(brand.lower()) else name
    return brand, model or name


def rnd(v, n=4):
    return None if v is None or (isinstance(v, float) and np.isnan(v)) else round(float(v), n)


def detail(d):
    a = d['data']
    le = np.array(a['log_exposure'], dtype=float)
    idx = np.arange(0, len(le), 4)
    dc = _arr(a['density_curves'])
    dev = a.get('development_time')
    curves = [[rnd(x) for x in dc[idx, c]] for c in range(dc.shape[1])]
    labels = ([f'{t:g} min' for t in dev] if isinstance(dev, list) and len(dev) > 1
              else (['Density'] if dc.shape[1] == 1 else ['Red layer', 'Green layer', 'Blue layer']))
    wl = a['wavelengths'][::2]

    def per_channel(key):
        v = a.get(key)
        if v is None:
            return []
        arr = _arr(v)[::2]
        if arr.ndim == 1:
            arr = arr[:, None]
        return [[rnd(x) for x in arr[:, c]] for c in range(arr.shape[1])]

    return {
        'log_exposure': [rnd(x, 3) for x in le[idx]],
        'density_curves': curves,
        'curve_labels': labels,
        'dev_default': development_index(a),
        'wavelengths': wl,
        'log_sensitivity': per_channel('log_sensitivity'),
        'channel_density': per_channel('channel_density'),
        'metadata': d.get('metadata', {}),
        'info': d['info'],
    }


def load_previous(where):
    if not where:
        return {}
    try:
        if re.match(r'https?://', where):
            with urllib.request.urlopen(where, timeout=20) as r:
                prev = json.load(r)
        else:
            prev = json.loads(Path(where).read_text())
        return {s['stock']: s.get('first_seen') for s in prev.get('stocks', [])}
    except Exception as e:  # first deploy, or the site is down: start fresh
        log(f"previous catalogue not read ({e}); every stock is dated today")
        return {}


# --------------------------------------------------------------------- main --

def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--sources', type=Path, default=HERE.parent / 'sources.json')
    ap.add_argument('--out', type=Path, default=HERE.parent / 'site' / 'data')
    ap.add_argument('--work', type=Path, default=HERE.parent / '.work')
    ap.add_argument('--previous', help='URL or path of the live catalog.json')
    args = ap.parse_args()

    sources = json.loads(args.sources.read_text())
    work = args.work
    work.mkdir(parents=True, exist_ok=True)
    today = dt.date.today().isoformat()
    build_log = []

    # 1. base pack
    b = sources['base']
    base_repo = work / 'base'
    base_git = clone(b['repo'], b.get('ref', 'main'), base_repo)
    base_dir, base_entry = pick_base_pack(base_repo, b.get('pack'))
    base_stocks = {json.loads(p.read_text())['info']['stock'] for p in (base_dir / 'profiles').glob('*.json')}
    source_meta = [{'name': b['name'], 'repo': b['repo'], 'ref': b.get('ref', 'main'), **base_git,
                    'role': 'base', 'pack': base_entry['base'], 'profiles': len(base_stocks)}]
    added_by = {st: b['name'] for st in base_stocks}

    # 2. extensions, folded in one after another
    cur = base_dir
    licence_files = [(base_repo / 'LICENSE', f"{b['name']}-LICENSE.txt")]
    for i, ext in enumerate(sources.get('extensions', [])):
        ext_dir = work / f"ext-{i}"
        ext_git = clone(ext['repo'], ext.get('ref', 'main'), ext_dir, sparse=['data'])
        stage = work / f"stage-{i}"
        if stage.exists():
            shutil.rmtree(stage)
        stage.mkdir()
        log(f"\nmerging {ext['name']} @ {ext_git['commit'][:8]}")
        r = subprocess.run([sys.executable, '-I', str(MERGE_SCRIPT), '--negs', str(ext_dir),
                            '--base', str(cur), '--out', str(stage), '--force'],
                           capture_output=True, text=True)
        build_log.append(f"===== {ext['name']} {ext['repo']} @ {ext_git['commit']}\n{r.stdout}{r.stderr}")
        if r.returncode:
            print(build_log[-1])
            sys.exit(f"merging {ext['name']} failed")
        before = {st for st in added_by}
        now = {json.loads(p.read_text())['info']['stock'] for p in (stage / 'profiles').glob('*.json')}
        for st in now - before:
            added_by[st] = ext['name']
        skipped = re.findall(r'^\s+skip (\S+): (.*)$', r.stdout, re.M)
        source_meta.append({'name': ext['name'], 'repo': ext['repo'], 'ref': ext.get('ref', 'main'), **ext_git,
                            'role': 'extension', 'profiles': len(now - before),
                            'skipped': [{'stock': s, 'reason': why} for s, why in skipped]})
        for lic in sorted((ext_dir / 'data').glob('*LICENSE*.txt')) + [ext_dir / 'data' / 'CHANGELOG.txt']:
            if lic.exists():
                licence_files.append((lic, f"{ext['name']}-{lic.name}"))
        cur = stage

    # 3. publish the pack
    out = args.out
    if out.exists():
        shutil.rmtree(out)
    pack_out = out / 'pack'
    shutil.copytree(cur, pack_out, ignore=shutil.ignore_patterns('backup-*', '.negs-build-*'))
    (pack_out / 'licenses').mkdir()
    for src, name in licence_files:
        shutil.copy2(src, pack_out / 'licenses' / name)
    (out / 'stocks').mkdir()
    (out / 'build-log.txt').write_text('\n'.join(build_log) or 'no extensions configured\n')

    pack = json.loads((pack_out / 'pack.json').read_text())
    first_seen = load_previous(args.previous)
    profiles = {}
    for p in sorted((pack_out / 'profiles').glob('*.json')):
        d = json.loads(p.read_text())
        profiles[d['info']['stock']] = (p, d)
    infos = [d['info'] for _, d in profiles.values()]

    stocks = []
    for st, (p, d) in profiles.items():
        info, meta = d['info'], d.get('metadata', {})
        brand, model = brand_model(info)
        wedge, rebate, steps = step_wedge(d['data'], pack, info.get('viewing_illuminant', 'D50'))
        stocks.append({
            'stock': st,
            'name': info.get('name') or st,
            'dt_name': merge.display_name(info),
            'brand': brand,
            'model': model,
            'kind': classify(info),
            'stage': info['stage'],
            'type': info['type'],
            'use': info.get('use'),
            'channel_model': info.get('channel_model'),
            'antihalation': info.get('antihalation'),
            'reference_illuminant': info.get('reference_illuminant'),
            'viewing_illuminant': info.get('viewing_illuminant'),
            'target_print': info.get('target_print'),
            'paper': merge.auto_paper(info, infos) if info['stage'] == 'filming' else None,
            'source': added_by.get(st, '?'),
            'in_base': st in base_stocks,
            'origin': origin_of(meta),
            'approximate': bool(meta.get('approximate')),
            'manufacturer_data': meta.get('manufacturer_data'),
            'copyright': meta.get('copyright'),
            'file': f"profiles/{p.name}",
            'size': p.stat().st_size,
            'sha256': sha256(p),
            'fnv': f'{fnv1a(p.read_bytes()):08x}',
            'wedge': wedge,
            'wedge_log_exposure': steps,
            'rebate': rebate,
            'first_seen': first_seen.get(st) or today,
            'sort': [str(x) for x in merge.nat_key(merge.display_name(info))],
        })
        (out / 'stocks' / f"{st}.json").write_text(json.dumps(detail(d), separators=(',', ':')))
    stocks.sort(key=lambda s: (s['brand'].lower(), merge.nat_key(s['model'])))
    for s in stocks:
        del s['sort']

    tables = table_list(pack_out, pack, base_entry)
    shared = {'pack.json': {'size': (pack_out / 'pack.json').stat().st_size,
                            'sha256': sha256(pack_out / 'pack.json')}}
    seed = None
    if pack.get('pack_format', 2) >= 3 and pack.get('pack_hash'):
        seed = pack_hash_seed(pack)
        # the recipe must reproduce the base pack's own pack_hash from its files,
        # or the hashes the page writes would not mean what darktable takes them for
        base_pack = json.loads((base_dir / 'pack.json').read_text())
        got = pack_hash(pack_hash_seed(base_pack), base_pack['spectral_upsampling'],
                        {p.name: p.read_bytes() for p in (base_dir / 'profiles').glob('*.json')})
        if got != base_pack['pack_hash']:
            sys.exit(f"pack_hash recipe gives {got} for the base pack, which declares {base_pack['pack_hash']}")
        full = pack_hash(seed, pack['spectral_upsampling'],
                         {p.name: p.read_bytes() for p in (pack_out / 'profiles').glob('*.json')})
        log(f"pack_hash recipe reproduces the base pack's {got}; the full merged pack is {full}")
    else:
        sys.exit("the merged pack.json lost its pack_format 3 or pack_hash, so the page "
                 "could not give a download an identity of its own")

    catalog = {
        'format': 1,
        'built_at': dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        'pack_format': pack.get('pack_format'),
        'spektrafilm_version': pack.get('spektrafilm_version'),
        'lut_hash': base_entry.get('lut_hash'),
        'lut_id': base_entry.get('lut_id'),
        'base_pack_hash': pack.get('pack_hash'),
        'pack_hash_seed': f'{seed:08x}' if seed is not None else None,
        'tables': tables,
        'sources': source_meta,
        'shared_files': shared,
        'licenses': [f"licenses/{name}" for _, name in licence_files],
        'stocks': stocks,
    }
    (out / 'catalog.json').write_text(json.dumps(catalog, indent=1))
    n_film = sum(s['stage'] == 'filming' for s in stocks)
    log(f"\nwrote {out}: {len(stocks)} stocks ({n_film} films, {len(stocks) - n_film} print stocks)")


if __name__ == '__main__':
    main()
