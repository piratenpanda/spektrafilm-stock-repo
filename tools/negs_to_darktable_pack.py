#!/usr/bin/env python3
"""Build a darktable spektrafilm data pack that adds the film profiles of Negs.

Negs (https://github.com/noahhaasis/negs) ships spektrafilm profiles in the same
JSON layout darktable reads, plus stocks darktable's pack lacks. This script
copies a downloaded darktable pack and adds every Negs stock it does not have,
changing nothing the base pack already defines:

  1. profiles: each new profile is checked against the shapes darktable's
     loader (sf_profile_load in src/common/spektra_sim.c) accepts. Single-channel
     B&W arrays are widened to the three-channel layout darktable's exporter
     writes (log_sensitivity copied, channel_density split into thirds,
     density_curves copied when there is no development-time family), and the
     log-exposure axis, which Negs rounds to 6 decimals, is snapped back to the
     pack's exact grid (darktable requires film and paper grids to agree to 1e-9)
  2. illuminants: BB<temperature> blackbodies a profile names are added to
     pack.json as Planck's law on the 380-780 nm / 5 nm grid, mean 1, as
     upstream's standard_illuminant computes them
  3. film_render_defaults: DIR couplers, grain and halation for each new film,
     built from upstream's presets as Negs ships them (data/presets/couplers.toml,
     data/presets/grain.toml) and upstream's halation table. The same rules are
     first run on the base pack's own films and every difference reported
  4. neutral_print_filters: Negs' entries for every (paper, lamp, film)
     combination the base pack lacks; existing entries are never replaced
  5. automatic paper: darktable picks the first B&W (or colour) paper by display
     name for a film that names none. A film of the base pack whose automatic
     paper would change because a new paper sorts first gets target_print set to
     the paper it used before

The result is written as a hand-installed pack, which darktable prefers over its
downloads: <user data>/darktable/spektrafilm/{pack.json,spectra_lut*.f32,profiles/}.
Every spectral upsampling table the base pack declares (pack_format 3) is copied
along unchanged.

Usage:
    python3 -I negs_to_darktable_pack.py --negs ~/src/negs [--base PACKDIR] [--out DIR] [--force]

--base defaults to the newest download under <user data>/darktable/spektrafilm/packs/,
--out to <user data>/darktable/spektrafilm. An existing pack in --out is only
replaced with --force, and is then moved into <out>/backup-<timestamp>/ first.
Requires Python 3.11 or newer (tomllib).
"""

import argparse
import copy
import json
import math
import os
import re
import shutil
import sys
import time
import tomllib
from pathlib import Path

N_WL, N_LE = 81, 256
GAMMAS = ['gamma_samelayer_rgb', 'gamma_interlayer_r_to_gb',
          'gamma_interlayer_g_to_rb', 'gamma_interlayer_b_to_rg']
GRAIN_KEYS = ['rms_granularity', 'uniformity', 'density_min', 'particle_scale_sublayers']
# upstream _HALATION_PRESETS (runtime/params_builder.py), as Negs ports it in
# crates/spektrafilm-core/src/pipeline.rs halation_preset()
HALATION_SIGMA = {'still': 65.0, 'cine': 50.0}
HALATION_STRENGTH = {'strong': [0.015, 0.005, 0.0], 'weak': [0.08, 0.02, 0.0], 'no': [0.30, 0.10, 0.015]}
# what darktable's _shorten_name() drops before sorting by display name
NAME_FILLER = [' Professional', ' Negative Film', ' Reversal Film']

warnings = []


def warn(msg):
    warnings.append(msg)
    print(f"  warning: {msg}")


# ------------------------------------------------------------------ helpers --

def user_data_dir():
    """GLib's g_get_user_data_dir(), which darktable uses for the pack."""
    if os.name == 'nt':
        return Path(os.environ.get('LOCALAPPDATA', Path.home() / 'AppData' / 'Local'))
    xdg = os.environ.get('XDG_DATA_HOME')
    return Path(xdg) if xdg else Path.home() / '.local' / 'share'


def shape(v):
    s = []
    while isinstance(v, list):
        s.append(len(v))
        v = v[0] if v else None
    return tuple(s)


def nat_key(name):
    """darktable's _nat_cmp(): case-insensitive, digit runs compared as numbers,
    a digit sorting before a non-digit."""
    key = []
    for digits, other in re.findall(r'(\d+)|(\D)', name):
        key.append((0, int(digits), '') if digits else (1, 0, other.lower()))
    return key


def display_name(info):
    s = info.get('name') or info['stock']
    for f in NAME_FILLER:
        s = s.replace(f, '', 1)
    return s


def blackbody(temperature):
    """upstream black_body_spectrum(): colour's planck_law, CIE constants, n=1,
    normalized to mean 1 like the other standard illuminants."""
    c1, c2 = 3.741771e-16, 1.4388e-2
    v = []
    for i in range(N_WL):
        wl = (380 + 5 * i) * 1e-9
        v.append(c1 * wl ** -5 / math.pi / math.expm1(c2 / (wl * temperature)))
    mean = sum(v) / N_WL
    return [x / mean for x in v]


def close(a, b, tol=1e-9):
    if isinstance(a, dict):
        return isinstance(b, dict) and a.keys() == b.keys() and all(close(a[k], b[k], tol) for k in a)
    if isinstance(a, list):
        return isinstance(b, list) and len(a) == len(b) and all(close(x, y, tol) for x, y in zip(a, b))
    if a is None or b is None:
        return a is b
    return abs(a - b) <= tol


def replace_numbers_in_array(raw, key, values):
    """Rewrite the numbers of the one top-level-unique array `key` in a JSON text,
    keeping its layout, so the rest of the file stays byte-identical."""
    starts = [m.end() for m in re.finditer(r'"%s":\s*\[' % re.escape(key), raw)]
    if len(starts) != 1:
        raise ValueError(f"{len(starts)} '{key}' arrays")
    s = starts[0]
    e = raw.index(']', s)
    it = iter(values)
    body, n = re.subn(r'-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?', lambda _: repr(next(it)), raw[s:e])
    if n != len(values):
        raise ValueError(f"'{key}' holds {n} numbers, expected {len(values)}")
    return raw[:s] + body + raw[e:]


def set_target_print(raw, stock):
    hits = list(re.finditer(r'"target_print":\s*(null|"[^"]*")', raw))
    if len(hits) != 1:
        raise ValueError(f"{len(hits)} target_print fields")
    m = hits[0]
    return raw[:m.start()] + f'"target_print": "{stock}"' + raw[m.end():]


# ----------------------------------------------------------------- profiles --

def check_and_convert(d, grid, illuminants, new_illuminants):
    """Return a list of reasons darktable would not load this profile, after
    converting what can be converted in place. Mirrors sf_profile_load() and the
    illuminant lookups of sf_sim_build()."""
    info, a = d['info'], d['data']
    errs = []
    bw = info.get('channel_model') == 'bw'
    for k in ('stock', 'stage', 'type', 'reference_illuminant', 'viewing_illuminant'):
        if not info.get(k):
            errs.append(f"info.{k} missing")
    if errs:
        return errs, False

    dev = a.get('development_time')
    n_dev = len(dev) if isinstance(dev, list) else 0
    widened = False
    if bw:
        for k in ('log_sensitivity', 'channel_density'):
            if shape(a.get(k)) == (N_WL, 1):
                col = [r[0] for r in a[k]]
                if k == 'channel_density':  # three identical layers adding up to the measured density
                    col = [None if x is None else x / 3.0 for x in col]
                a[k] = [[x] * 3 for x in col]
                widened = True
        if n_dev <= 1 and shape(a.get('density_curves')) == (N_LE, 1):
            a['density_curves'] = [[r[0]] * 3 for r in a['density_curves']]
            widened = True

    if shape(a.get('wavelengths')) != (N_WL,):
        errs.append(f"wavelengths {shape(a.get('wavelengths'))}")
    for k in ('log_sensitivity', 'channel_density'):
        if shape(a.get(k)) != (N_WL, 3):
            errs.append(f"{k} {shape(a.get(k))}")
    le = a.get('log_exposure')
    if shape(le) != (N_LE,):
        errs.append(f"log_exposure {shape(le)}")
    elif max(abs(x - y) for x, y in zip(le, grid)) > 1e-6:
        errs.append("log_exposure is not the pack's grid")
    if n_dev > 1:
        for k, n in (('base_density', N_WL), ('density_curves', N_LE)):
            if shape(a.get(k)) != (n, n_dev):
                errs.append(f"{k} {shape(a.get(k))} for {n_dev} development times")
    else:
        if shape(a.get('base_density')) not in ((N_WL,), (N_WL, 1)):
            errs.append(f"base_density {shape(a.get('base_density'))}")
        if shape(a.get('density_curves')) != (N_LE, 3):
            errs.append(f"density_curves {shape(a.get('density_curves'))}")
    surf = a.get('hanatos2025_adaptation_surface_params')
    if surf is not None and shape(surf) not in ((3, 15),):
        warn(f"{info['stock']}: surface coefficients {shape(surf)}, darktable skips them")

    for k in ('reference_illuminant', 'viewing_illuminant'):
        name = info[k]
        if name in illuminants or name in new_illuminants:
            continue
        m = re.fullmatch(r'BB(\d+(?:\.\d+)?)', name)
        if m and float(m.group(1)) > 0:
            new_illuminants[name] = blackbody(float(m.group(1)))
        else:
            errs.append(f"illuminant {name} unknown")
    return errs, widened


# ----------------------------------------------------------- render defaults --

def render_defaults(info, couplers, grain, dc_const, scatter):
    """darktable film_render_defaults entry, by upstream's rules as Negs applies
    them in apply_film_specific_params()."""
    st, bw = info['stock'], info.get('channel_model') == 'bw'
    cm, pol = ('bw' if bw else 'color'), info['type']
    g = {k: v for k, v in couplers['defaults'][cm][pol].items() if k in GAMMAS}
    if cm == 'color' and pol == 'negative' and info.get('use') == 'cine':
        # upstream: tungsten when the reference illuminant's name starts with T
        branch = 'tungsten' if info['reference_illuminant'].upper().startswith('T') else 'daylight'
        g.update({k: v for k, v in couplers['defaults'][cm][pol]['cine'][branch].items() if k in GAMMAS})
    g.update({k: v for k, v in couplers.get(st, {}).items() if k in GAMMAS})
    if bw:  # one emulsion: channel 0 self-inhibition, no interlayer terms
        g = {'gamma_samelayer_rgb': [g['gamma_samelayer_rgb'][0]] * 3,
             'gamma_interlayer_r_to_gb': [0.0, 0.0], 'gamma_interlayer_g_to_rb': [0.0, 0.0],
             'gamma_interlayer_b_to_rg': [0.0, 0.0]}

    gr = dict(grain['defaults'][cm][pol])
    gr.update(grain.get(st, {}))
    gr = {k: (v * 3 if k != 'particle_scale_sublayers' and len(v) == 1 else v) for k, v in gr.items()}

    use, ah = info.get('use'), info.get('antihalation')
    if use not in HALATION_SIGMA or ah not in HALATION_STRENGTH:
        return None
    strength = list(HALATION_STRENGTH[ah])
    sc = {k: list(v) for k, v in scatter.items()}
    if bw:
        strength = [strength[0]] * 3
        sc = {k: [v[0]] * 3 for k, v in sc.items()}
    return {'dir_couplers': {**g, **copy.deepcopy(dc_const)},
            'grain': {k: gr[k] for k in GRAIN_KEYS},
            'halation': {'strength': strength, 'first_sigma_um': [HALATION_SIGMA[use]] * 3, **sc}}


def shared_constants(rd):
    """The coupler diffusion/Langmuir and scatter values every base colour entry
    carries; they are not per-film in upstream's presets."""
    dc_keys = ['diffusion_size_um', 'diffusion_tail_um', 'diffusion_tail_weight',
               'langmuir_donor_k_rgb', 'langmuir_receiver_k_rgb']
    sc_keys = ['scatter_core_um', 'scatter_tail_um', 'scatter_tail_weight']
    dc = sc = None
    for st, e in rd.items():
        if e['halation']['scatter_core_um'][0] == e['halation']['scatter_core_um'][-1]:
            continue  # B&W entries carry channel 0 broadcast
        this_dc = {k: e['dir_couplers'][k] for k in dc_keys}
        this_sc = {k: e['halation'][k] for k in sc_keys}
        if dc is None:
            dc, sc = this_dc, this_sc
        elif not (close(dc, this_dc) and close(sc, this_sc)):
            raise SystemExit(f"base pack: {st} has its own coupler diffusion or scatter values; "
                             "this script assumes they are shared")
    return dc, sc


# --------------------------------------------------------------- auto paper --

def auto_paper(film, entries):
    """darktable _resolve_stock() for paper_hash 0: the film's target_print, else
    the first paper with the film's channel model, else the first paper."""
    papers = sorted((e for e in entries if e['stage'] == 'printing'), key=lambda e: nat_key(display_name(e)))
    tp = film.get('target_print')
    for e in papers:
        if tp and e['stock'] == tp:
            return e['stock']
    for e in papers:
        if (e.get('channel_model') == 'bw') == (film.get('channel_model') == 'bw'):
            return e['stock']
    return papers[0]['stock'] if papers else None


# --------------------------------------------------------------------- main --

def table_files(pack):
    """The spectral upsampling table files a pack reads: the one fixed name below
    pack_format 3, every file the spectral_upsampling block declares from 3 on."""
    if pack.get('pack_format', 2) < 3:
        return ['spectra_lut.f32']
    files = [e['file'] for e in pack.get('spectral_upsampling', [])]
    if not files or any('/' in f or '\\' in f or f in ('', '.', '..') for f in files):
        sys.exit("base pack.json declares no usable spectral_upsampling files")
    return files


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--negs', required=True, type=Path, help='a Negs checkout')
    ap.add_argument('--base', type=Path, help='darktable pack to extend (default: newest download)')
    ap.add_argument('--out', type=Path, help='where to write the pack (default: the hand-installed location)')
    ap.add_argument('--force', action='store_true', help='replace a pack already in --out, keeping a backup')
    args = ap.parse_args()

    sf_dir = user_data_dir() / 'darktable' / 'spektrafilm'
    base = args.base
    if base is None:
        packs = [p for p in (sf_dir / 'packs').glob('*') if re.fullmatch(r'[0-9a-f]{8}', p.name)]
        if not packs:
            sys.exit(f"no downloaded pack under {sf_dir / 'packs'}; pass --base")
        base = max(packs, key=lambda p: (p / 'pack.json').stat().st_mtime)
    out = args.out or sf_dir
    negs = args.negs
    for p in (base / 'pack.json', base / 'profiles',
              negs / 'data' / 'profiles', negs / 'data' / 'presets' / 'couplers.toml',
              negs / 'data' / 'presets' / 'grain.toml', negs / 'data' / 'filters' / 'neutral_print_filters.json'):
        if not p.exists():
            sys.exit(f"missing {p}")
    if out.resolve() == base.resolve():
        sys.exit("--out must not be the base pack")
    print(f"base pack: {base}\nnegs:      {negs}\noutput:    {out}\n")

    pack_raw = (base / 'pack.json').read_text()
    pack = json.loads(pack_raw)
    if pack.get('pack_format') not in (2, 3):
        sys.exit(f"base pack_format {pack.get('pack_format')} is not one this script knows")
    tables = table_files(pack)
    for t in tables:
        if not (base / t).exists():
            sys.exit(f"missing {base / t}")
    rd = pack['film_render_defaults']
    couplers = tomllib.loads((negs / 'data/presets/couplers.toml').read_text())
    grain = tomllib.loads((negs / 'data/presets/grain.toml').read_text())
    negs_filters = json.loads((negs / 'data/filters/neutral_print_filters.json').read_text())

    base_profiles = {}
    for p in sorted((base / 'profiles').glob('*.json')):
        d = json.loads(p.read_text())
        base_profiles[d['info']['stock']] = (p, d)
    grid = base_profiles[next(iter(base_profiles))][1]['data']['log_exposure']
    for st, (_, d) in base_profiles.items():
        if not close(d['data']['log_exposure'], grid):
            sys.exit(f"base pack: {st} uses a different log-exposure grid")

    # 3. validate the render-default rules on the base pack's own films
    print("checking the render-default rules against the base pack:")
    dc_const, scatter = shared_constants(rd)
    matched = 0
    for st, want in rd.items():
        got = render_defaults(base_profiles[st][1]['info'], couplers, grain, dc_const, scatter)
        diffs = [f"{sec}.{k}" for sec in want for k in want[sec]
                 if got is None or not close(got[sec].get(k), want[sec][k])]
        if diffs:
            warn(f"{st}: the base pack's {', '.join(diffs)} differ from the presets (kept as they are)")
        else:
            matched += 1
    print(f"  {matched} of {len(rd)} base entries reproduced exactly\n")

    # 1./2. profiles and illuminants
    print("converting Negs profiles:")
    new_profiles, new_illuminants, skipped = {}, {}, {}
    for p in sorted((negs / 'data' / 'profiles').glob('*.json')):
        raw = p.read_text()
        d = json.loads(raw)
        st = d.get('info', {}).get('stock')
        if not st or st in base_profiles:
            continue
        errs, widened = check_and_convert(d, grid, pack['illuminants'], new_illuminants)
        if errs:
            skipped[st] = errs
            print(f"  skip {st}: {'; '.join(errs)}")
            continue
        if widened:
            d['data']['log_exposure'] = list(grid)
            indent = 2 if raw.startswith('{\n  ') else 1
            text = json.dumps(d, indent=indent) + ('\n' if raw.endswith('\n') else '')
        else:
            text = raw
            if not close(d['data']['log_exposure'], grid):
                text = replace_numbers_in_array(raw, 'log_exposure', grid)
            check = json.loads(text)
            if not close(check['data']['log_exposure'], grid):
                sys.exit(f"{st}: could not snap the log-exposure grid")
        new_profiles[st] = (p.name, text, json.loads(text))
        print(f"  add  {st}{' (B&W widened to 3 channels)' if widened else ''}")
    print(f"  {len(new_profiles)} added, {len(skipped)} skipped\n")

    all_profiles = {st: d for st, (_, d) in base_profiles.items()}
    all_profiles.update({st: d for st, (_, _, d) in new_profiles.items()})
    entries = [d['info'] for d in all_profiles.values()]
    printing = {i['stock'] for i in entries if i['stage'] == 'printing'}
    for st, (_, _, d) in new_profiles.items():
        tp = d['info'].get('target_print')
        if d['info']['stage'] == 'filming' and tp and tp not in printing:
            warn(f"{st} names paper {tp}, which the pack does not carry")

    out_pack = copy.deepcopy(pack)
    out_pack['illuminants'].update(new_illuminants)
    if new_illuminants:
        print(f"illuminants added: {', '.join(new_illuminants)}\n")

    # 3. render defaults for new films
    added_rd = 0
    for st, (_, _, d) in new_profiles.items():
        if d['info']['stage'] != 'filming':
            continue
        e = render_defaults(d['info'], couplers, grain, dc_const, scatter)
        if e is None:
            warn(f"{st}: no halation class for use={d['info'].get('use')} "
                 f"antihalation={d['info'].get('antihalation')}; left on darktable's generic defaults")
            continue
        out_pack['film_render_defaults'][st] = e
        added_rd += 1
    print(f"render defaults added: {added_rd}")

    # 4. neutral print filters for combinations the base lacks
    db = out_pack['neutral_print_filters']
    added_nf = 0
    for paper, by_lamp in negs_filters.items():
        if paper not in printing:
            continue
        for lamp, by_film in by_lamp.items():
            for film, cmy in by_film.items():
                if film not in all_profiles or film in db.get(paper, {}).get(lamp, {}):
                    continue
                if film in base_profiles and paper in base_profiles:
                    continue  # a combination of the base pack: leave it on its own fallback
                if len(cmy) != 3:
                    continue
                db.setdefault(paper, {}).setdefault(lamp, {})[film] = cmy
                added_nf += 1
    print(f"neutral print filter entries added: {added_nf}")

    # 5. keep the base films' automatic paper
    base_entries = [d['info'] for _, d in base_profiles.values()]
    pinned = {}
    for st, (_, d) in base_profiles.items():
        info = d['info']
        if info['stage'] != 'filming':
            continue
        before, after = auto_paper(info, base_entries), auto_paper(info, entries)
        if before != after:
            pinned[st] = before
            print(f"automatic paper of {st} would change from {before} to {after}: pinned to {before}")
    print()

    # write: build in a temporary directory, then move into place
    tmp = out / f".negs-build-{os.getpid()}"
    if tmp.exists():
        shutil.rmtree(tmp)
    (tmp / 'profiles').mkdir(parents=True)
    for t in tables:
        shutil.copy2(base / t, tmp / t)
    for st, (p, d) in base_profiles.items():
        if st in pinned:
            (tmp / 'profiles' / p.name).write_text(set_target_print(p.read_text(), pinned[st]))
        else:
            shutil.copy2(p, tmp / 'profiles' / p.name)
    for st, (name, text, _) in new_profiles.items():
        if (tmp / 'profiles' / name).exists():
            sys.exit(f"{name} exists in the base pack under another stock name")
        (tmp / 'profiles' / name).write_text(text)
    sep = (', ', ': ') if ', "' in pack_raw[:200] else (',', ':')
    (tmp / 'pack.json').write_text(json.dumps(out_pack, separators=sep) + ('\n' if pack_raw.endswith('\n') else ''))

    # everything the base pack defined is still there, unchanged
    chk = json.loads((tmp / 'pack.json').read_text())
    for sec in ('illuminants', 'film_render_defaults'):
        for k, v in pack[sec].items():
            assert chk[sec][k] == v, (sec, k)
    for paper, by_lamp in pack['neutral_print_filters'].items():
        for lamp, by_film in by_lamp.items():
            for film, v in by_film.items():
                assert chk['neutral_print_filters'][paper][lamp][film] == v
    for k in pack:
        if k not in ('illuminants', 'film_render_defaults', 'neutral_print_filters'):
            assert chk[k] == pack[k], k

    pack_files = ['pack.json', *tables, 'profiles']
    stale = sorted(p.name for p in out.glob('spectra_lut*.f32') if p.name not in tables)
    existing = [n for n in (*pack_files, *stale) if (out / n).exists()]
    if existing:
        if not args.force:
            shutil.rmtree(tmp)
            sys.exit(f"{out} already holds a pack ({', '.join(existing)}); rerun with --force to replace it")
        backup = out / time.strftime('backup-%Y%m%d-%H%M%S')
        backup.mkdir()
        for n in existing:
            shutil.move(str(out / n), str(backup / n))
        print(f"previous pack moved to {backup}")
    for n in pack_files:
        shutil.move(str(tmp / n), str(out / n))
    tmp.rmdir()

    print(f"wrote {out}: {len(base_profiles) + len(new_profiles)} profiles "
          f"({len(new_profiles)} from Negs)")
    if skipped:
        print(f"skipped {len(skipped)} Negs profiles darktable could not load: {', '.join(skipped)}")
    if warnings:
        print(f"{len(warnings)} warnings, see above")
    print("restart darktable to pick up the new profiles")


if __name__ == '__main__':
    main()
