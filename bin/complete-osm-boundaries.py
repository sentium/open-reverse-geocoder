#!/usr/bin/env python3
"""Restore required administrative relations missing from a regional extract.

Only generation contacts the OSM API, sequentially for missing relations. The
library still uses static tiles. Full relation geometry is never approximated.
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
from shapely.geometry import Point

spec = importlib.util.spec_from_file_location('osm_builder', Path(__file__).with_name('build-osm-data.py'))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def features(filename):
    with Path(filename).open(encoding='utf8') as stream:
        for line in stream:
            yield json.loads(line.lstrip('\x1e'))


def suitable(feature, code, relation, sample):
    p = feature.get('properties', {})
    if p.get('@type') != 'relation' or p.get('@id') != relation or p.get('ISO3166-2') != code or p.get('boundary') != 'administrative' or str(p.get('admin_level')) != '4':
        return False
    if feature['geometry']['type'] not in ('Polygon', 'MultiPolygon'):
        return False
    geometry = builder.normalize_geojson(feature['geometry'])
    return not geometry.is_empty and (sample is None or geometry.covers(Point(sample)))


def fetch_boundary(code, relation):
    url = f'https://www.openstreetmap.org/api/0.6/relation/{relation}/full'
    with tempfile.TemporaryDirectory() as directory:
        raw = Path(directory) / 'boundary.osm'
        exported = Path(directory) / 'boundary.geojsonseq'
        subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location', '--retry', '3', '--max-time', '120', '--max-filesize', '50000000', '--user-agent', 'open-reverse-geocoder data builder (https://github.com/sentium/open-reverse-geocoder)', '--output', str(raw), url], check=True)
        digest = hashlib.sha256(raw.read_bytes()).hexdigest()
        subprocess.run(['osmium', 'export', str(raw), '-c', str(Path(__file__).with_name('osm-export.json')), '-f', 'geojsonseq', '-o', str(exported)], check=True)
        for feature in features(exported):
            p = feature.get('properties', {})
            if p.get('@type') == 'relation' and p.get('@id') == relation:
                return feature, dict(code=code, relation=relation, url=url, sha256=digest, fetchedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    raise ValueError('OSM API did not yield the required full boundary: ' + code)


def complete(sequence, config, fetch=fetch_boundary):
    sequence = Path(sequence)
    relations = config['relations']
    samples = config.get('samples', {})
    found = set()
    for feature in features(sequence):
        code = feature.get('properties', {}).get('ISO3166-2')
        if code in relations and suitable(feature, code, relations[code], samples.get(code)):
            found.add(code)
    missing = sorted(set(relations) - found)
    print('Required boundaries present:', len(found), '; missing:', missing, flush=True)
    if not missing:
        return []
    replacements, provenance = {}, []
    for code in missing:
        feature, source = fetch(code, relations[code])
        if not suitable(feature, code, relations[code], samples.get(code)):
            raise ValueError('Incomplete supplemental boundary: ' + code)
        replacements[relations[code]] = feature
        provenance.append(source)
    temporary = sequence.with_suffix('.completed')
    try:
        with temporary.open('w', encoding='utf8') as out, sequence.open(encoding='utf8') as stream:
            for line in stream:
                p = json.loads(line.lstrip('\x1e')).get('properties', {})
                if p.get('@type') == 'relation' and p.get('@id') in replacements:
                    continue
                out.write(line.rstrip('\n') + '\n')
            for feature in replacements.values():
                out.write('\x1e' + builder.dump(feature) + '\n')
        source_file = sequence.parent / 'boundary-sources.json'
        prior = json.loads(source_file.read_text()) if source_file.exists() else []
        source_file.write_text(builder.dump(prior + provenance), encoding='utf8')
        temporary.replace(sequence)
    finally:
        temporary.unlink(missing_ok=True)
    return provenance


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True)
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    print(builder.dump(complete(args.input, json.loads(Path(args.config).read_text()))))
