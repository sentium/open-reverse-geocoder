const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { execFileSync } = require('node:child_process')
const { prepare } = require('../bin/prepare-osm-catalog')
const { assemble } = require('../bin/assemble-pages')
const { buildDataset } = require('../bin/lib/search-data')
const { prepare: prepareJapan } = require('../bin/prepare-pages')
const { reverseGeocode, clearNearbyCache } = require('../dist/main')

test('real Washington OSM PBF -> export -> tiled data -> HTTP global API; publication preserves Japan', async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'osm-integration-'))
  const source = path.join(tmp, 'features.geojsonseq')
  execFileSync('osmium', [
    'export',
    'test/fixtures/osm-washington.pbf',
    '-c',
    'bin/osm-export.json',
    '-f',
    'geojsonseq',
    '-o',
    source,
  ])
  // Administrative polygons below are explicitly synthetic: the small OSM
  // fixture covers transport/attractions only and must never be published.
  const ring = [
    [-77.2, 38.7],
    [-76.8, 38.7],
    [-76.8, 39.1],
    [-77.2, 39.1],
    [-77.2, 38.7],
  ]
  const geometry = { type: 'MultiPolygon', coordinates: [[ring]] }
  await fs.appendFile(
    source,
    [2, 4, 8]
      .map((level) =>
        JSON.stringify({
          type: 'Feature',
          geometry,
          properties: {
            '@type': 'relation',
            '@id': 9000000000 + level,
            boundary: 'administrative',
            admin_level: String(level),
            name: `Fixture level ${level}`,
            ...(level === 2 ? { 'ISO3166-1:alpha2': 'US' } : {}),
          },
        }),
      )
      .join('\n') + '\n',
  )
  const regionFile = path.join(tmp, 'region.json')
  await fs.writeFile(
    regionFile,
    JSON.stringify({
      type: 'Feature',
      properties: { id: 'test-us', 'iso3166-1:alpha2': ['US'] },
      geometry,
    }),
  )
  const output = path.join(tmp, 'osm')
  execFileSync(
    process.env.OSM_PYTHON || 'python3',
    [
      'bin/build-osm-data.py',
      '--input',
      source,
      '--region-file',
      regionFile,
      '--output',
      output,
      '--version',
      'fixture',
      '--source-revision',
      '2026-09-06 Washington fixture; synthetic administrative polygons',
    ],
    { stdio: 'pipe' },
  )
  const report = await prepare(output)
  assert.ok(report.regions[0].points > 10)
  assert.ok(report.regions[0].roads > 0)
  const japanData = path.join(tmp, 'japan-data')
  await buildDataset({
    bbox: [139.74, 35.66, 139.79, 35.7],
    outDir: japanData,
    version: 'fixture',
    catalog: [[14, 14552, 6451]],
    fetchTile: () => fs.readFile('test/fixtures/gsi-tokyo-14.pbf'),
  })
  const japanSite = path.join(tmp, 'japan-site')
  await prepareJapan(japanData, japanSite)
  const site = path.join(tmp, 'site')
  await assemble(japanSite, output, site)
  let requests = 0
  const server = http.createServer(async (req, res) => {
    requests++
    try {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.end(
        await fs.readFile(
          path.join(site, new URL(req.url, 'http://test').pathname),
        ),
      )
    } catch {
      res.statusCode = 404
      res.end('missing')
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    clearNearbyCache()
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(tmp, { recursive: true, force: true })
  })
  const root = `http://127.0.0.1:${server.address().port}`
  const options = {
    osmDataUrl: root + '/osm',
    nearby: { rules: [{ kind: 'station', radiusM: 5000, priority: 1 }] },
  }
  const station = await reverseGeocode([-77.0065, 38.8977], options)
  assert.equal(station.countryCode, 'US')
  assert.deepEqual(
    station.administrativeAreas.map((a) => a.level),
    [2, 4, 8],
  )
  assert.match(station.nearby.selected.name, /Union Station/)
  const initial = requests
  await reverseGeocode([-77.0065, 38.8977], {
    ...options,
    nearby: { rules: [{ kind: 'station', radiusM: 1000, priority: 99 }] },
  })
  assert.equal(requests, initial)
  const highway = await reverseGeocode([-77.0140866, 38.8938824], {
    ...options,
    nearby: { rules: [{ kind: 'highway', radiusM: 1000, priority: 1 }] },
  })
  assert.equal(highway.nearby.highwayMatch.status, 'estimated-on-highway')
  assert.equal(highway.nearby.selected.name, 'Exit 10')
  const landmark = await reverseGeocode([-77.009, 38.8898], {
    ...options,
    nearby: { rules: [{ kind: 'landmark', radiusM: 1000, priority: 1 }] },
  })
  assert.equal(landmark.nearby.selected.name, 'United States Capitol')
  const domestic = await reverseGeocode([139.7673068, 35.6809591], {
    japan: { tileUrl: root + '/tiles/{z}/{x}/{y}.pbf' },
    nearby: {
      dataUrl: root + '/data',
      rules: [{ kind: 'station', radiusM: 1000, priority: 1 }],
    },
  })
  assert.equal(domestic.source, 'japan')
  assert.equal(domestic.japan.city, '千代田区')
  assert.equal(domestic.nearby.selected.name, '東京駅')
  // A corrupt/missing foreign file must prevent publication, never erase OSM.
  const manifest = JSON.parse(
    await fs.readFile(path.join(output, 'test-us/fixture/manifest.json')),
  )
  const index = JSON.parse(
    await fs.readFile(
      path.join(
        output,
        'test-us/fixture/index/6',
        manifest.indexTiles[0] + '.json',
      ),
    ),
  )
  await fs.unlink(
    path.join(output, 'test-us/fixture/poi/12', index.poiTiles[0] + '.json'),
  )
  await assert.rejects(
    assemble(japanSite, output, path.join(tmp, 'broken-site')),
  )
})
