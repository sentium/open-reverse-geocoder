#!/usr/bin/env python3
"""Stream osmium-export GeoJSON sequence into immutable, indexed search tiles.

Memory is bounded by one source feature/tile, with records staged in SQLite.
Country/region source polygons are retained as coverage, never their bounding box.
"""
import argparse
import collections
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import sqlite3
import sys
import tempfile
from shapely.geometry import shape, mapping, Point, Polygon, MultiPolygon, LineString, box
from shapely.affinity import translate
from shapely.ops import unary_union

MAX_LAT = 85.0511287798066
ATTRIBUTION = '© OpenStreetMap contributors; https://www.openstreetmap.org/copyright'
LICENSE_URL = 'https://opendatacommons.org/licenses/odbl/1-0/'
CATEGORIES = {'station', 'heritage', 'park', 'shrine', 'temple', 'ic', 'sa', 'pa', 'smart-ic', 'attraction', 'viewpoint', 'place-of-worship'}


def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def tile_at(lng, lat, z):
    n = 2 ** z
    lat = max(-MAX_LAT, min(MAX_LAT, lat))
    return min(n - 1, max(0, math.floor((lng + 180) / 360 * n))), min(n - 1, max(0, math.floor((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)))


def tile_box(x, y, z):
    n = 2 ** z
    lat = lambda v: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * v / n))))
    return box(x / n * 360 - 180, lat(y + 1), (x + 1) / n * 360 - 180, lat(y))


def components(g, kind):
    if g.geom_type == kind:
        yield g
    elif hasattr(g, 'geoms'):
        for child in g.geoms:
            yield from components(child, kind)


def unwrap(coords):
    out = []
    for p in coords:
        x, y = p[:2]
        if not math.isfinite(x) or not math.isfinite(y) or abs(x) > 180 or abs(y) > 90:
            raise ValueError('Invalid source coordinate')
        if out:
            while x - out[-1][0] > 180: x -= 360
            while x - out[-1][0] < -180: x += 360
        out.append((x, y))
    return out


def normalize_geojson(value):
    """Split dateline-crossing objects into ordinary lon/lat geometries."""
    kind = value['type']
    if kind == 'Point':
        p = value['coordinates']
        unwrap([p])
        return Point(p[:2])
    if kind == 'LineString':
        source = [LineString(unwrap(value['coordinates']))]
    elif kind in ('Polygon', 'MultiPolygon'):
        polys = [value['coordinates']] if kind == 'Polygon' else value['coordinates']
        source = []
        for rings in polys:
            shell = unwrap(rings[0])
            holes = []
            for ring in rings[1:]:
                hole = unwrap(ring)
                offset = round((shell[0][0] - hole[0][0]) / 360) * 360
                holes.append([(x + offset, y) for x, y in hole])
            source.append(Polygon(shell, holes))
    else:
        raise ValueError('Unsupported source geometry: ' + kind)
    result = []
    world = box(-180, -MAX_LAT, 180, MAX_LAT)
    for g in source:
        if not g.is_valid:
            raise ValueError('Invalid source polygon/line')
        for offset in (-360, 0, 360):
            shifted = translate(g, xoff=offset)
            if shifted.intersects(world):
                part = shifted.intersection(world)
                if not part.is_empty: result.append(part)
    return unary_union(result)


def as_multipolygon(g):
    return mapping(MultiPolygon(list(components(g, 'Polygon'))))


def category(tags):
    if any(tags.get(k) in ('yes', 'true', '1') for k in ('disused', 'abandoned', 'construction')):
        return None
    if tags.get('railway') in ('station', 'halt') and tags.get('usage') not in ('industrial', 'military', 'test') and tags.get('station') != 'freight' and tags.get('access') not in ('no', 'private'):
        return 'station'
    if tags.get('highway') == 'motorway_junction': return 'ic'
    if tags.get('highway') == 'services': return 'sa'
    if tags.get('highway') == 'rest_area': return 'pa'
    if tags.get('historic') and tags['historic'] not in ('no', 'yes'): return 'heritage'
    if tags.get('tourism') == 'viewpoint': return 'viewpoint'
    if tags.get('tourism') in ('attraction', 'museum', 'gallery', 'zoo'): return 'attraction'
    if tags.get('leisure') == 'park': return 'park'
    if tags.get('amenity') == 'place_of_worship':
        return {'shinto': 'shrine', 'buddhist': 'temple'}.get(tags.get('religion'), 'place-of-worship')
    return None


def road_width(tags):
    match = re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*(m|ft|feet)?\s*', tags.get('width', ''))
    if match:
        width = float(match[1]) * (0.3048 if match[2] in ('ft', 'feet') else 1)
    else:
        lanes = tags.get('lanes', '')
        width = int(lanes) * 3.5 if lanes.isdigit() and 1 <= int(lanes) <= 20 else 14
    return round(max(1, min(200, width)), 2)


class Builder:
    def __init__(self, stage, coverage):
        self.stage = stage
        self.coverage = coverage
        self.db = sqlite3.connect(stage / 'records.sqlite')
        self.db.execute('PRAGMA journal_mode=OFF')
        self.db.execute('PRAGMA synchronous=OFF')
        self.db.execute('CREATE TABLE records(kind TEXT,z INTEGER,x INTEGER,y INTEGER,id TEXT,value TEXT, PRIMARY KEY(kind,z,x,y,id)) WITHOUT ROWID')
        self.stats = collections.Counter()

    def put(self, kind, z, x, y, identifier, value):
        self.db.execute('INSERT OR REPLACE INTO records VALUES(?,?,?,?,?,?)', (kind, z, x, y, identifier, dump(value)))

    def tiled(self, geometry, zoom):
        # Iterate components separately: Alaska and the lower 48 must not make
        # a bounding rectangle spanning most of the planet.
        kinds = ('Polygon', 'LineString')
        for kind in kinds:
            for part in components(geometry, kind):
                w, s, e, n = part.bounds
                x0, y0 = tile_at(w, n, zoom)
                x1, y1 = tile_at(e, s, zoom)
                for x in range(x0, x1 + 1):
                    for y in range(y0, y1 + 1):
                        cell = tile_box(x, y, zoom)
                        if part.intersects(cell):
                            clipped = part.intersection(cell)
                            if not clipped.is_empty:
                                yield x, y, clipped

    def add(self, feature):
        tags = feature.get('properties') or {}
        name = tags.get('name') or tags.get('name:en') or tags.get('official_name')
        cat = category(tags)
        is_admin = tags.get('boundary') == 'administrative' and str(tags.get('admin_level', '')).isdigit() and 2 <= int(tags['admin_level']) <= 12 and bool(name)
        is_road = tags.get('highway') == 'motorway' and feature['geometry']['type'] == 'LineString'
        if not (cat or is_admin or is_road): return
        # OSM object identity survives coordinate/name edits and overlapping extracts.
        if tags.get('@type') not in ('node', 'way', 'relation') or not isinstance(tags.get('@id'), int):
            raise ValueError('osmium export must include type,id attributes')
        identifier = f"osm:{tags['@type']}:{tags['@id']}"
        geometry = normalize_geojson(feature['geometry'])
        self.stats['sourceFeatures'] += 1
        if is_admin and list(components(geometry, 'Polygon')):
            code = tags.get('ISO3166-2') or tags.get('ISO3166-1:alpha2') or tags.get('ISO3166-1')
            country = (tags.get('ISO3166-1:alpha2') or tags.get('ISO3166-1')) if int(tags['admin_level']) == 2 else None
            if country and not re.fullmatch('[A-Z]{2}', country): country = None
            if country == 'JP': return
            # Coalesce all pieces of an area within a tile (islands and holes).
            cells = collections.defaultdict(list)
            for x, y, clipped in self.tiled(geometry.intersection(self.coverage), 8):
                cells[x, y].extend(components(clipped, 'Polygon'))
            for (x, y), polys in cells.items():
                self.put('admin', 8, x, y, identifier, dict(id=identifier, level=int(tags['admin_level']), name=name, code=code, countryCode=country, geometry=as_multipolygon(unary_union(polys))))
            self.stats['administrativeAreas'] += 1
            if country: self.stats['country:' + country] += 1
        if is_road:
            number = 0
            for x, y, clipped in self.tiled(geometry.intersection(self.coverage), 14):
                for line in components(clipped, 'LineString'):
                    number += 1
                    self.put('road', 14, x, y, identifier + ':' + str(number), [road_width(tags), list(line.coords)])
        if cat:
            if not name and cat == 'ic' and tags.get('ref'): name = 'Exit ' + tags['ref']
            if not name:
                self.stats['unnamedPlaces'] += 1
                return
            # A representative point is comparable to the domestic label-point
            # contract. Entrance/path-distance searches remain out of scope.
            p = geometry.representative_point()
            if p.is_empty or not self.coverage.covers(p): return
            x, y = tile_at(p.x, p.y, 12)
            self.put('poi', 12, x, y, identifier, [identifier, cat, name, p.x, p.y])

    def finish(self):
        self.db.commit()
        shards = collections.defaultdict(lambda: dict(schemaVersion=1, poiTiles=[], roadTiles=[], adminTiles=[]))
        sizes = collections.Counter()
        for kind, z, x, y in self.db.execute('SELECT DISTINCT kind,z,x,y FROM records ORDER BY kind,z,x,y'):
            records = [json.loads(row[0]) for row in self.db.execute('SELECT value FROM records WHERE kind=? AND z=? AND x=? AND y=? ORDER BY id', (kind,z,x,y))]
            label = {'poi': 'points', 'road': 'roads', 'admin': 'areas'}[kind]
            value = dict(schemaVersion=1, **{label: records})
            dest = self.stage / kind / str(z) / str(x) / f'{y}.json'
            dest.parent.mkdir(parents=True, exist_ok=True)
            content = dump(value)
            if len(content) * 2 > 16 * 1024 * 1024:
                raise ValueError(f'Tile exceeds client memory budget: {kind}/{z}/{x}/{y}')
            dest.write_text(content, encoding='utf8')
            sizes[label] += len(records)
            sizes['tileBytes'] += len(content.encode('utf8'))
            shard = f'{x // 2 ** (z - 6)}/{y // 2 ** (z - 6)}'
            shards[shard][kind + 'Tiles'].append(f'{x}/{y}')
        self.db.close()
        (self.stage / 'records.sqlite').unlink()
        for key, value in shards.items():
            dest = self.stage / 'index/6' / (key + '.json')
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(dump(value), encoding='utf8')
        self.stats.update(sizes)
        return sorted(shards)


def build(sequence, region_file, output, version, source_revision, region_id=None):
    if not re.fullmatch('[A-Za-z0-9_-]{1,80}', version): raise ValueError('Invalid version')
    region = json.loads(Path(region_file).read_text())
    properties = region['properties']
    region_id = region_id or properties['id']
    if not re.fullmatch('[A-Za-z0-9_-]{1,80}', region_id): raise ValueError('Invalid region ID')
    codes = properties.get('iso3166-1:alpha2', [])
    if not codes or any(not re.fullmatch('[A-Z]{2}', c) or c == 'JP' for c in codes):
        raise ValueError('Region requires non-Japanese ISO country codes')
    coverage = normalize_geojson(region['geometry'])
    region_root = Path(output) / region_id
    dest = region_root / version
    if dest.exists(): raise ValueError('Immutable version already exists')
    region_root.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.building-', dir=region_root))
    builder = Builder(stage, coverage)
    try:
        with open(sequence, encoding='utf8') as stream:
            for i, line in enumerate(stream, 1):
                builder.add(json.loads(line.lstrip('\x1e')))
                if i % 10000 == 0: print(f'Processed {i} exported features', flush=True)
        indexes = builder.finish()
        if not builder.stats['points'] or not builder.stats['administrativeAreas']:
            raise ValueError('Dataset must contain places and administrative polygons')
        bounds = [list(p.bounds) for p in components(coverage, 'Polygon')]
        rectangles = []
        for w,s,e,n in bounds:
            x0,y0 = tile_at(w,n,12); x1,y1 = tile_at(e,s,12)
            rectangles.append([x0,y0,x1,y1])
        manifest = dict(schemaVersion=2, version=version, generatedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(), source=properties.get('urls', {}).get('pbf', 'OpenStreetMap'), sourceRevision=source_revision, attribution=ATTRIBUTION, license='ODbL-1.0', licenseUrl=LICENSE_URL, coverage=rectangles, coverageGeometry=as_multipolygon(coverage), poiTiles=[], roadTiles=[], indexTiles=indexes, stats=dict(builder.stats))
        (stage / 'manifest.json').write_text(dump(manifest), encoding='utf8')
        (stage / 'LICENSE.txt').write_text(f'{ATTRIBUTION}\nThis OpenStreetMap-derived database is available under the Open Database License 1.0.\n{LICENSE_URL}\nDownload this version directory to obtain the machine-readable derived database.\n', encoding='utf8')
        stage.rename(dest)
        # The catalog pins versions, so it can be replaced atomically after all
        # datasets have been validated and composed for publication.
        pointer = region_root / '.manifest.json'
        pointer.write_text(dump(manifest), encoding='utf8')
        pointer.replace(region_root / 'manifest.json')
        entry = dict(id=region_id, version=version, countryCodes=codes, bounds=bounds)
        (dest / 'region.json').write_text(dump(entry), encoding='utf8')
        print(dump(dict(region=entry, stats=dict(builder.stats))), flush=True)
        return manifest
    except BaseException:
        try: builder.db.close()
        except Exception: pass
        shutil.rmtree(stage, ignore_errors=True)
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', required=True, help='osmium export -f geojsonseq -c bin/osm-export.json output')
    parser.add_argument('--region-file', required=True, help='Geofabrik index Feature with exact extraction polygon and ISO country codes')
    parser.add_argument('--output', default='tmp/osm-data')
    parser.add_argument('--version', required=True)
    parser.add_argument('--source-revision', required=True, help='PBF snapshot timestamp and/or SHA-256')
    parser.add_argument('--region-id')
    args = parser.parse_args()
    build(args.input, args.region_file, args.output, args.version, args.source_revision, args.region_id)
