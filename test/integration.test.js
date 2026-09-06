const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { buildDataset, extract } = require('../bin/lib/search-data')
const {
  searchNearby,
  openReverseGeocoder,
  clearNearbyCache,
} = require('../dist/main')

// Deliberately limited fixture catalogue; these outputs are never published.
test('real PBF -> generated JSON -> HTTP -> packaged library, including cache and legacy API', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'geocoder-integration-'),
  )
  const tokyo = await fs.readFile(
    path.join(__dirname, 'fixtures/gsi-tokyo-14.pbf'),
  )
  const ebina14 = await fs.readFile(
    path.join(__dirname, 'fixtures/gsi-ebina-14.pbf'),
  )
  const ebina11 = await fs.readFile(
    path.join(__dirname, 'fixtures/gsi-ebina-11.pbf'),
  )
  await buildDataset({
    bbox: [139.74, 35.66, 139.79, 35.7],
    outDir: path.join(directory, 'tokyo'),
    version: 'v1',
    catalog: [[14, 14552, 6451]],
    fetchTile: async () => tokyo,
  })
  await buildDataset({
    bbox: [139.38, 35.41, 139.43, 35.46],
    outDir: path.join(directory, 'ebina'),
    version: 'v1',
    catalog: [
      [14, 14536, 6465],
      [11, 1817, 808],
    ],
    fetchTile: async (z) => (z === 14 ? ebina14 : ebina11),
  })
  let requests = 0
  const server = http.createServer(async (req, res) => {
    requests++
    try {
      const url = new URL(req.url, 'http://localhost')
      const filename = url.pathname.startsWith('/tiles/')
        ? path.join(__dirname, '../docs', url.pathname)
        : path.join(directory, url.pathname)
      const buffer = await fs.readFile(filename)
      res.setHeader(
        'Content-Type',
        filename.endsWith('.json')
          ? 'application/json'
          : 'application/octet-stream',
      )
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.end(buffer)
    } catch {
      res.statusCode = 404
      res.end('Not found')
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    clearNearbyCache()
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(directory, { recursive: true, force: true })
  })
  const root = `http://127.0.0.1:${server.address().port}`
  const options = {
    dataUrl: root + '/tokyo',
    rules: [{ kind: 'station', radiusM: 1000, priority: 1 }],
  }
  const nearby = await searchNearby([139.7673068, 35.6809591], options)
  assert.equal(nearby.selected.name, '東京駅')
  assert.ok(nearby.selected.distanceM < 100)
  const initial = requests
  await searchNearby([139.7673068, 35.6809591], {
    ...options,
    rules: [{ kind: 'station', radiusM: 500, priority: 100 }],
  })
  assert.equal(requests, initial)
  const admin = await openReverseGeocoder([139.7673068, 35.6809591], {
    tileUrl: root + '/tiles/{z}/{x}/{y}.pbf',
  })
  assert.deepEqual(admin, {
    code: '13101',
    prefecture: '東京都',
    city: '千代田区',
  })
  const combined = await openReverseGeocoder([139.7673068, 35.6809591], {
    tileUrl: root + '/tiles/{z}/{x}/{y}.pbf',
    nearby: options,
  })
  assert.equal(combined.nearby.selected.name, '東京駅')
  assert.equal(combined.city, '千代田区')
  const onRoad = extract(ebina14, 14, 14536, 6465)
    .roads.flatMap((r) => r[1])
    .sort(
      (a, b) =>
        Math.hypot(a[0] - 139.4002, a[1] - 35.4316) -
        Math.hypot(b[0] - 139.4002, b[1] - 35.4316),
    )[0]
  const highway = await searchNearby(onRoad, {
    dataUrl: root + '/ebina',
    rules: [{ kind: 'highway', radiusM: 1000, priority: 1 }],
  })
  assert.equal(highway.highwayMatch.status, 'estimated-on-highway')
  assert.equal(highway.selected.name, '海老名SA')
})
