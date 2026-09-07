#!/usr/bin/env python3
"""Build pinned N03 municipal tiles without loading nationwide geometry in RAM."""
import argparse
import hashlib
import json
import re
import shutil
import sqlite3
import subprocess
import tempfile
import urllib.request
import zipfile
from pathlib import Path

import shapefile

ROOT = Path(__file__).resolve().parent.parent


def properties(record):
    required = ("N03_001", "N03_003", "N03_004", "N03_005", "N03_007")
    if any(key not in record for key in required):
        raise ValueError("Expected the N03 2024+ municipal schema")
    code = str(record["N03_007"] or "").strip()
    if not re.fullmatch(r"[0-9]{5}", code):
        raise ValueError(f"Invalid municipal code: {code!r}")

    def name(key):
        value = record[key]
        if value is None or value == "所属未定地":
            return ""
        if not isinstance(value, str):
            raise ValueError(f"Invalid name: {key}")
        return value.strip()

    prefecture = name("N03_001")
    # 2024+ separates designated-city names and ward names into N03_004/005.
    city = name("N03_003") + name("N03_004") + name("N03_005")
    unassigned = code.endswith("000") and record["N03_004"] == "所属未定地"
    if not prefecture or (not city and not unassigned):
        raise ValueError(f"Missing administrative name: {code}")
    return int(code), {"prefecture": prefecture, "city": city}


def digest(filename):
    value = hashlib.sha256()
    with open(filename, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def build(archive, output, index, tippecanoe):
    source = json.loads((ROOT / "bin/japan-admin-source.json").read_text())
    if digest(archive) != source["sourceSha256"]:
        raise ValueError("Source checksum changed; review the upstream revision before updating the lock file")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="n03-build-", dir=output.parent) as temporary:
        work = Path(temporary)
        # Never use the separate prefecture dataset included in the same ZIP.
        with zipfile.ZipFile(archive) as z:
            for suffix in ("shp", "shx", "dbf", "prj", "cpg"):
                filename = source["shapefile"] + "." + suffix
                with z.open(filename) as src, (work / filename).open("wb") as dst:
                    shutil.copyfileobj(src, dst)
        if (work / (source["shapefile"] + ".cpg")).read_text().strip().upper() != "UTF-8":
            raise ValueError("Unexpected source encoding")
        prj = (work / (source["shapefile"] + ".prj")).read_text()
        if "JGD_2011" not in prj and "JGD2011" not in prj:
            raise ValueError("Unexpected coordinate reference system")
        count = 0
        municipalities = {}
        geojson = work / "admins.geojsonl"
        with shapefile.Reader(str(work / source["shapefile"]), encoding="utf-8") as reader, geojson.open("w") as stream:
            for item in reader.iterShapeRecords():
                identifier, props = properties(item.record.as_dict())
                code = str(identifier).zfill(5)
                if code in municipalities and municipalities[code] != props:
                    raise ValueError(f"Conflicting names for {code}")
                municipalities[code] = props
                geometry = item.shape.__geo_interface__
                if geometry["type"] not in ("Polygon", "MultiPolygon"):
                    raise ValueError("Expected administrative polygon")
                feature = {"type": "Feature", "id": identifier, "properties": props, "geometry": geometry}
                stream.write(json.dumps(feature, ensure_ascii=False, separators=(",", ":")) + "\n")
                count += 1
        if len({code[:2] for code in municipalities}) != 47:
            raise ValueError("Nationwide dataset must contain all 47 prefectures")
        database = work / "admins.mbtiles"
        subprocess.run([
            tippecanoe, "--quiet", "--no-tile-compression", "--maximum-zoom=10",
            "--minimum-zoom=10", "--no-feature-limit", "--no-tile-size-limit",
            "--no-tiny-polygon-reduction", "-l", "japanese-admins",
            "-o", str(database), str(geojson),
        ], check=True)
        stage = work / "tiles"
        stage.mkdir()
        keys = []
        size = 0
        with sqlite3.connect(database) as db:
            for z, x, tms_y, data in db.execute("SELECT zoom_level,tile_column,tile_row,tile_data FROM tiles"):
                y = (1 << z) - 1 - tms_y
                tile = stage / str(z) / str(x) / f"{y}.pbf"
                tile.parent.mkdir(parents=True, exist_ok=True)
                tile.write_bytes(data)
                keys.append(f"{x}/{y}")
                size += len(data)
        if not keys:
            raise ValueError("No administrative tiles generated")
        shutil.copyfile(ROOT / "data-licenses/japan-admin.txt", stage / "README.txt")
        metadata = {**source, "zoom": 10, "layer": "japanese-admins", "sourceFeatures": count,
                    "municipalities": sum(not code.endswith("000") for code in municipalities),
                    "unassignedAreas": sum(code.endswith("000") for code in municipalities),
                    "tileCount": len(keys), "tileBytes": size,
                    "generator": subprocess.check_output([tippecanoe, "--version"], text=True, stderr=subprocess.STDOUT).strip()}
        (stage / "manifest.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
        # Preserve the previous output until generation succeeds.
        backup = work / "previous-tiles"
        if output.exists():
            output.rename(backup)
        try:
            stage.rename(output)
        except BaseException:
            if backup.exists():
                backup.rename(output)
            raise
        index.write_text(
            "// Generated by bin/build-japan-admin.py from N03 2026 municipal tiles.\n"
            "// Used to avoid requests outside the Japanese administrative dataset.\n"
            "export const JAPAN_ADMIN_TILES = new Set([\n" +
            "".join(f"  '{key}',\n" for key in sorted(keys)) + "])\n")
        print(json.dumps(metadata, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, help="Previously downloaded source ZIP")
    parser.add_argument("--output", type=Path, default=ROOT / "docs/tiles")
    parser.add_argument("--index", type=Path, default=ROOT / "src/japan-tiles.ts")
    parser.add_argument("--tippecanoe", default="tippecanoe")
    args = parser.parse_args()
    source = json.loads((ROOT / "bin/japan-admin-source.json").read_text())
    archive = args.archive or ROOT / "tmp/n03-2026/N03-20260101_GML.zip"
    if args.archive is None and not archive.exists():
        archive.parent.mkdir(parents=True, exist_ok=True)
        partial = archive.with_suffix(".part")
        with urllib.request.urlopen(source["sourceUrl"], timeout=120) as response, partial.open("wb") as stream:
            shutil.copyfileobj(response, stream)
        if digest(partial) != source["sourceSha256"]:
            raise ValueError("Downloaded archive does not match the pinned checksum")
        partial.rename(archive)
    build(archive.resolve(), args.output.resolve(), args.index.resolve(), args.tippecanoe)


if __name__ == "__main__":
    main()
