// Use the bundled CommonJS reader on every supported Node 22 version.
// Run npm run build before invoking the data generation tools.
const { VectorTile, PbfReader } = require('../../dist/vector-tile')
const { createHash } = require('crypto')
const fs = require('fs/promises')
const path = require('path')

const SOURCE = 'https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap'
const ATTRIBUTION =
  '国土地理院ベクトルタイル提供実験のデータを加工して作成（https://github.com/gsi-cyberjapan/gsimaps-vector-experiment）'
const LABELS = {
  422: 'station',
  532: 'heritage',
  534: 'park',
  661: 'shrine',
  662: 'temple',
}
const FACILITIES = { 2941: 'ic', 2943: 'sa', 2944: 'pa', 2945: 'smart-ic' }
function tileAt(lng, lat, z) {
  const n = 2 ** z
  return [
    Math.min(n - 1, Math.max(0, Math.floor(((lng + 180) / 360) * n))),
    Math.min(
      n - 1,
      Math.max(
        0,
        Math.floor(
          ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n,
        ),
      ),
    ),
  ]
}
function coverageFor(bbox) {
  if (
    !Array.isArray(bbox) ||
    bbox.length !== 4 ||
    !bbox.every(Number.isFinite) ||
    bbox[0] >= bbox[2] ||
    bbox[1] >= bbox[3] ||
    bbox[0] < -180 ||
    bbox[2] > 180 ||
    bbox[1] < -85 ||
    bbox[3] > 85
  )
    throw new Error(
      'bbox must be west,south,east,north within [-180,-85,180,85]',
    )
  const [x0, y0] = tileAt(bbox[0], bbox[3], 12)
  const [x1, y1] = tileAt(bbox[2], bbox[1], 12)
  return [x0, y0, x1, y1]
}
function belongs(lng, lat, coverage) {
  const [x, y] = tileAt(lng, lat, 12)
  return (
    x >= coverage[0] && x <= coverage[2] && y >= coverage[1] && y <= coverage[3]
  )
}
function normalizedName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
}
function pointRecord(category, name, coordinates) {
  name = normalizedName(name)
  if (
    !name ||
    !Array.isArray(coordinates) ||
    coordinates.length !== 2 ||
    !coordinates.every(Number.isFinite)
  )
    return null
  const [lng, lat] = coordinates.map((v) => +v.toFixed(6))
  const id = createHash('sha256')
    .update(JSON.stringify([category, name, lng, lat]))
    .digest('hex')
    .slice(0, 24)
  return [id, category, name, lng, lat]
}
function extract(buffer, z, x, y) {
  const tile = new VectorTile(new PbfReader(buffer)),
    points = [],
    roads = []
  if (!Object.keys(tile.layers).length)
    throw new Error('Source PBF contains no layers')
  const label = tile.layers.label
  if (z === 14 && label)
    for (let i = 0; i < label.length; i++) {
      const feature = label.feature(i),
        p = feature.properties
      let category = LABELS[p.annoCtg]
      if (p.annoCtg === 412) {
        const name = normalizedName(p.knj)
        category = /(?:スマートIC|SIC)$/.test(name)
          ? 'smart-ic'
          : /IC$/.test(name)
          ? 'ic'
          : /SA$/.test(name)
          ? 'sa'
          : /PA$/.test(name)
          ? 'pa'
          : undefined
      }
      if (category) {
        const g = feature.toGeoJSON(x, y, z).geometry
        const record =
          g.type === 'Point' && pointRecord(category, p.knj, g.coordinates)
        if (record) points.push(record)
      }
    }
  const transp = tile.layers.transp
  if (z === 11 && transp)
    for (let i = 0; i < transp.length; i++) {
      const feature = transp.feature(i),
        p = feature.properties,
        category = FACILITIES[p.ftCode]
      if (category) {
        const g = feature.toGeoJSON(x, y, z).geometry
        const record =
          g.type === 'Point' && pointRecord(category, p.name, g.coordinates)
        if (record) points.push(record)
      }
    }
  const road = tile.layers.road
  if (z === 14 && road)
    for (let i = 0; i < road.length; i++) {
      const feature = road.feature(i),
        p = feature.properties
      if (p.motorway !== 1) continue
      const g = feature.toGeoJSON(x, y, z).geometry
      const lines =
        g.type === 'LineString'
          ? [g.coordinates]
          : g.type === 'MultiLineString'
          ? g.coordinates
          : []
      const width =
        Number.isFinite(p.Width) && p.Width > 0
          ? Math.min(200, p.Width)
          : [3, 5.5, 13, 19.5, 30, 15, 15][p.rnkWidth] || 15
      for (const line of lines)
        if (line.length >= 2)
          roads.push([width, line.map((c) => c.map((v) => +v.toFixed(6)))])
    }
  return { points, roads }
}
async function writeJson(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true })
  await fs.writeFile(filename, JSON.stringify(value) + '\n')
}
async function buildDataset({
  bbox,
  outDir,
  version,
  fetchTile,
  catalog,
  concurrency = 4,
  sourceRevision = 'live; upstream snapshot not specified',
}) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(version))
    throw new Error('Invalid dataset version')
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
    throw new Error('concurrency must be 1–8')
  const coverage = coverageFor(bbox)
  const destination = path.join(outDir, version)
  try {
    await fs.access(destination)
    throw new Error(`Dataset version already exists: ${version}`)
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
  await fs.mkdir(outDir, { recursive: true })
  const stage = await fs.mkdtemp(path.join(outDir, '.building-'))
  const jobs = []
  if (catalog) {
    for (const t of catalog) {
      const [z, x, y] = t,
        scale = 2 ** (z - 12)
      if (![11, 14].includes(z)) continue
      if (
        x >= Math.floor(coverage[0] * scale) &&
        x <= Math.floor(coverage[2] * scale + (scale >= 1 ? scale - 1 : 0)) &&
        y >= Math.floor(coverage[1] * scale) &&
        y <= Math.floor(coverage[3] * scale + (scale >= 1 ? scale - 1 : 0))
      )
        jobs.push(t)
    }
  } else {
    for (let x = coverage[0] * 4; x <= coverage[2] * 4 + 3; x++)
      for (let y = coverage[1] * 4; y <= coverage[3] * 4 + 3; y++)
        jobs.push([14, x, y])
    for (
      let x = Math.floor(coverage[0] / 2);
      x <= Math.floor(coverage[2] / 2);
      x++
    )
      for (
        let y = Math.floor(coverage[1] / 2);
        y <= Math.floor(coverage[3] / 2);
        y++
      )
        jobs.push([11, x, y])
  }
  if (!jobs.length) {
    await fs.rm(stage, { recursive: true, force: true })
    throw new Error('No source tiles selected')
  }
  const groups = new Map(),
    roadKeys = [],
    stats = {
      sourceTiles: 0,
      sourceBytes: 0,
      missingSourceTiles: 0,
      points: 0,
      roads: 0,
    }
  let cursor = 0,
    failure
  try {
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (cursor < jobs.length && !failure) {
          const [z, x, y] = jobs[cursor++]
          try {
            const buffer = await fetchTile(z, x, y)
            if (!buffer) {
              if (catalog)
                throw new Error(
                  `Catalogued source tile is missing: ${z}/${x}/${y}`,
                )
              stats.missingSourceTiles++
              continue
            }
            stats.sourceTiles++
            stats.sourceBytes += buffer.length
            const { points, roads } = extract(buffer, z, x, y)
            for (const p of points)
              if (belongs(p[3], p[4], coverage)) {
                const key = tileAt(p[3], p[4], 12).join('/')
                if (!groups.has(key)) groups.set(key, new Map())
                groups.get(key).set(p[0], p)
              }
            if (roads.length) {
              const key = `${x}/${y}`
              roadKeys.push(key)
              stats.roads += roads.length
              await writeJson(path.join(stage, 'road/14', key + '.json'), {
                schemaVersion: 1,
                roads,
              })
            }
          } catch (e) {
            failure = e
          }
        }
      }),
    )
    if (failure) throw failure
    if (!stats.sourceTiles) throw new Error('No source data was downloaded')
    for (const [key, records] of groups) {
      const points = [...records.values()].sort((a, b) =>
        a[0].localeCompare(b[0]),
      )
      stats.points += points.length
      await writeJson(path.join(stage, 'poi/12', key + '.json'), {
        schemaVersion: 1,
        points,
      })
    }
    const manifest = {
      schemaVersion: 1,
      version,
      generatedAt: new Date().toISOString(),
      source: SOURCE,
      sourceRevision,
      attribution: ATTRIBUTION,
      coverage: [coverage],
      poiTiles: [...groups.keys()].sort(),
      roadTiles: roadKeys.sort(),
      stats,
    }
    await writeJson(path.join(stage, 'manifest.json'), manifest)
    await fs.rename(stage, destination)
    // Publish the pointer last; an interrupted build leaves the old manifest usable.
    const pointer = path.join(outDir, `.manifest-${version}.json`)
    await writeJson(pointer, manifest)
    await fs.rename(pointer, path.join(outDir, 'manifest.json'))
    return manifest
  } catch (e) {
    await fs.rm(stage, { recursive: true, force: true })
    throw e
  }
}
module.exports = {
  SOURCE,
  ATTRIBUTION,
  tileAt,
  coverageFor,
  pointRecord,
  extract,
  buildDataset,
}
