#!/usr/bin/env node
const fs = require('node:fs/promises')
const path = require('node:path')
const {
  validateManifest,
  validateIndex,
  validatePoiTile,
  validateRoadTile,
  validateAdminTile,
  validateCatalog,
  tileAt,
  tileKey,
  tileBounds,
} = require('../dist/data-validation')

async function validateOsm(root, candidateCatalog) {
  const catalog = validateCatalog(
    candidateCatalog ??
      JSON.parse(await fs.readFile(path.join(root, 'catalog.json'), 'utf8')),
  )
  let bytes = 0
  const reports = []
  async function read(filename, validator) {
    const raw = await fs.readFile(filename, 'utf8')
    bytes += Buffer.byteLength(raw)
    if (raw.length * 2 > 16 * 1024 * 1024)
      throw new Error('Client size limit exceeded: ' + filename)
    return validator(JSON.parse(raw))
  }
  for (const region of catalog.regions) {
    const base = path.join(root, region.id, region.version)
    const m = await read(path.join(base, 'manifest.json'), validateManifest)
    if (
      m.schemaVersion !== 2 ||
      m.version !== region.version ||
      !m.sourceRevision
    )
      throw new Error('Invalid OSM version/source provenance')
    const ids = new Set(),
      counts = { points: 0, roads: 0, areas: 0 },
      countries = new Set()
    await fs.access(path.join(base, 'LICENSE.txt'))
    for (const shard of m.indexTiles) {
      const index = await read(
        path.join(base, 'index/6', shard + '.json'),
        (value) => validateIndex(value, m.adminZoom ?? 8),
      )
      for (const [kind, z, keys, validator] of [
        ['poi', 12, index.poiTiles, validatePoiTile],
        ['road', 14, index.roadTiles, validateRoadTile],
        ['admin', m.adminZoom ?? 8, index.adminTiles, validateAdminTile],
      ]) {
        if (new Set(keys).size !== keys.length)
          throw new Error('Duplicate tile index')
        for (const key of keys) {
          const [x, y] = key.split('/').map(Number)
          if (
            key
              .split('/')
              .map((v) => Math.floor(Number(v) / 2 ** (z - 6)))
              .join('/') !== shard
          )
            throw new Error('Index ownership mismatch')
          const tile = await read(
            path.join(base, kind, String(z), key + '.json'),
            validator,
          )
          const [w, s, e, n] = tileBounds([z, x, y])
          const inside = (p) =>
            p[0] >= w - 1e-8 &&
            p[0] <= e + 1e-8 &&
            p[1] >= s - 1e-8 &&
            p[1] <= n + 1e-8
          if (kind === 'poi')
            for (const p of tile.points) {
              if (ids.has(p[0]) || tileKey(tileAt(p.slice(3), 12)) !== key)
                throw new Error('Duplicate point or tile ownership mismatch')
              ids.add(p[0])
              counts.points++
            }
          if (kind === 'road')
            for (const r of tile.roads) {
              if (!r[1].every(inside)) throw new Error('Unclipped road')
              counts.roads++
            }
          if (kind === 'admin')
            for (const a of tile.areas) {
              if (!a.geometry.coordinates.flat(2).every(inside))
                throw new Error('Unclipped administrative polygon')
              if (a.countryCode) countries.add(a.countryCode)
              counts.areas++
            }
        }
      }
    }
    for (const field of Object.keys(counts))
      if (counts[field] !== m.stats[field])
        throw new Error('Manifest count mismatch: ' + field)
    if (
      !counts.points ||
      !counts.areas ||
      region.countryCodes.some((c) => !countries.has(c))
    )
      throw new Error('Incomplete country/administrative dataset')
    reports.push({
      region: region.id,
      version: m.version,
      ...counts,
      countries: [...countries],
    })
  }
  return { bytes, regions: reports }
}
module.exports = { validateOsm }
if (require.main === module)
  validateOsm(process.argv[2])
    .then(console.log)
    .catch((e) => {
      console.error(e)
      process.exitCode = 1
    })
