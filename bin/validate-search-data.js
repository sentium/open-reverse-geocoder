#!/usr/bin/env node
const fs = require('fs/promises')
const path = require('path')
const { tileAt } = require('./lib/search-data')
async function validate(directory) {
  const m = JSON.parse(
    await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'),
  )
  if (
    m.schemaVersion !== 1 ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(m.version) ||
    !m.attribution ||
    !Array.isArray(m.coverage) ||
    !m.coverage.length
  )
    throw new Error('Invalid manifest')
  let totalBytes = Buffer.byteLength(JSON.stringify(m)),
    points = 0,
    roads = 0
  const ids = new Set()
  const covered = (x, y) =>
    m.coverage.some(
      ([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1,
    )
  for (const [kind, zoom, keys] of [
    ['poi', 12, m.poiTiles],
    ['road', 14, m.roadTiles],
  ]) {
    if (!Array.isArray(keys) || new Set(keys).size !== keys.length)
      throw new Error('Invalid tile index')
    for (const key of keys) {
      if (!/^\d+\/\d+$/.test(key)) throw new Error('Invalid tile key')
      const [x, y] = key.split('/').map(Number)
      if (
        !covered(
          Math.floor(x / 2 ** (zoom - 12)),
          Math.floor(y / 2 ** (zoom - 12)),
        )
      )
        throw new Error('Tile outside coverage')
      const buffer = await fs.readFile(
        path.join(directory, m.version, kind, String(zoom), key + '.json'),
      )
      totalBytes += buffer.length
      const tile = JSON.parse(buffer)
      if (tile.schemaVersion !== 1) throw new Error('Invalid tile schema')
      if (kind === 'poi')
        for (const p of tile.points) {
          if (
            !Array.isArray(p) ||
            p.length !== 5 ||
            !p[0] ||
            !p[2] ||
            ![
              'station',
              'heritage',
              'park',
              'shrine',
              'temple',
              'ic',
              'sa',
              'pa',
              'smart-ic',
            ].includes(p[1]) ||
            !p.slice(3).every(Number.isFinite) ||
            tileAt(p[3], p[4], 12).join('/') !== key ||
            ids.has(p[0])
          )
            throw new Error('Invalid/duplicate place or tile ownership')
          ids.add(p[0])
          points++
        }
      else
        for (const r of tile.roads) {
          if (
            !Array.isArray(r) ||
            !Number.isFinite(r[0]) ||
            r[0] <= 0 ||
            r[0] > 200 ||
            !Array.isArray(r[1]) ||
            r[1].length < 2 ||
            !r[1].every(
              (c) =>
                c.length === 2 &&
                c.every(Number.isFinite) &&
                Math.abs(c[0]) <= 180 &&
                Math.abs(c[1]) <= 85.052,
            )
          )
            throw new Error('Invalid road')
          roads++
        }
    }
  }
  if (points !== m.stats.points || roads !== m.stats.roads)
    throw new Error('Manifest counts do not match data')
  if (totalBytes > 900000000)
    throw new Error('Dataset exceeds the 900MB Pages data budget')
  return { version: m.version, totalBytes, points, roads }
}
module.exports = { validate }
if (require.main === module)
  validate(process.argv[2] || 'docs/data')
    .then((result) => console.log(result))
    .catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
