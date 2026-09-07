const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const {
  extract,
  pointRecord,
  coverageFor,
  buildDataset,
} = require('../bin/lib/search-data')
const { validate } = require('../bin/validate-search-data')
const { downloadFile } = require('../bin/lib/download-file')
const fixture = (name) =>
  fs.readFile(path.join(__dirname, 'fixtures', `gsi-${name}.pbf`))
const ebina = {
  bbox: [139.4, 35.43, 139.401, 35.431],
  catalog: [
    [14, 14536, 6465],
    [11, 1817, 808],
  ],
}
const fetchTile = (z) => fixture(`ebina-${z}`)

test('waits through temporary upstream failures and saves a complete download', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'download-retry-'))
  const filename = path.join(directory, 'tile.pbf')
  const delays = []
  let requests = 0
  try {
    await downloadFile('https://test.invalid/tile', filename, {
      fetch: async () =>
        ++requests <= 3
          ? new Response('Unavailable', { status: 503 })
          : new Response('complete tile'),
      sleep: async (ms) => {
        delays.push(ms)
      },
    })
    assert.equal(await fs.readFile(filename, 'utf8'), 'complete tile')
    assert.deepEqual(delays, [1000, 2000, 4000])
    assert.equal(requests, 4)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('does not retry a missing upstream tile or replace the previous cache', async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'download-missing-'),
  )
  const filename = path.join(directory, 'tile.pbf')
  try {
    await fs.writeFile(filename, 'previous')
    await assert.rejects(
      downloadFile('https://test.invalid/tile', filename, {
        fetch: async () => new Response('Missing', { status: 404 }),
        sleep: async () => {
          assert.fail('404 must not be retried')
        },
      }),
      /HTTP 404/,
    )
    assert.equal(await fs.readFile(filename, 'utf8'), 'previous')
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('bounds retries and removes partial downloads after stream failures', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'download-broken-'))
  const filename = path.join(directory, 'tile.pbf')
  let requests = 0
  const delays = []
  try {
    await assert.rejects(
      downloadFile('https://test.invalid/tile', filename, {
        fetch: async () => {
          requests++
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array([1, 2]))
                controller.error(new Error('Connection interrupted'))
              },
            }),
          )
        },
        sleep: async (ms) => {
          delays.push(ms)
        },
      }),
      /Connection interrupted/,
    )
    assert.equal(requests, 8)
    assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000, 32000, 60000])
    assert.deepEqual(await fs.readdir(directory), [])
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})

test('extracts stations and heritage categories from real GSI data', async () => {
  const data = extract(await fixture('tokyo-14'), 14, 14552, 6451)
  assert.ok(data.points.some((p) => p[1] === 'station' && p[2] === '東京駅'))
  assert.ok(data.roads.length > 0)
  assert.ok(data.points.every((p) => p.length === 5 && Number.isFinite(p[3])))
})

test('extracts typed facilities, excludes JCT, and handles fullwidth names', async () => {
  const data = extract(await fixture('ebina-11'), 11, 1817, 808)
  assert.ok(data.points.some((p) => p[1] === 'sa' && p[2] === '海老名SA'))
  assert.ok(data.points.some((p) => p[1] === 'smart-ic' && p[2] === '綾瀬SIC'))
  assert.ok(data.points.every((p) => !p[2].endsWith('JCT')))
  const detailed = extract(await fixture('ebina-14'), 14, 14536, 6465)
  assert.ok(detailed.points.some((p) => p[1] === 'sa' && p[2] === '海老名SA'))
})

test('stable IDs normalize names and remove exact duplicates without merging remote namesakes', () => {
  assert.deepEqual(
    pointRecord('sa', '海老名ＳＡ', [139.4, 35.43]),
    pointRecord('sa', '海老名SA', [139.4, 35.43]),
  )
  assert.notEqual(
    pointRecord('station', '中央駅', [139, 35])[0],
    pointRecord('station', '中央駅', [140, 35])[0],
  )
  assert.throws(() => coverageFor([140, 36, 139, 35]))
})

test('builds versioned sparse tiles, validates indexes, and keeps old data on source failure', async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'geocoder-build-test-'),
  )
  t.after(() => fs.rm(outDir, { recursive: true, force: true }))
  const first = await buildDataset({
    ...ebina,
    outDir,
    version: 'v1',
    fetchTile,
  })
  const report = await validate(outDir)
  assert.ok(report.points > 0)
  assert.ok(report.roads > 0)
  assert.deepEqual(first.coverage, [coverageFor(ebina.bbox)])
  await assert.rejects(
    buildDataset({ ...ebina, outDir, version: 'v1', fetchTile }),
    /already exists/,
  )
  await assert.rejects(
    buildDataset({
      ...ebina,
      outDir,
      version: 'v2',
      fetchTile: async () => {
        throw new Error('source offline')
      },
    }),
    /source offline/,
  )
  assert.equal(
    JSON.parse(await fs.readFile(path.join(outDir, 'manifest.json'))).version,
    'v1',
  )
  assert.ok(!(await fs.readdir(outDir)).some((p) => p.startsWith('.building-')))
  await buildDataset({ ...ebina, outDir, version: 'v2', fetchTile })
  assert.equal(
    JSON.parse(await fs.readFile(path.join(outDir, 'manifest.json'))).version,
    'v2',
  )
  assert.ok((await fs.readdir(outDir)).includes('v1'))
})

test('fails on missing catalogued source, corrupt data and missing output tiles', async (t) => {
  const outDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'geocoder-invalid-test-'),
  )
  t.after(() => fs.rm(outDir, { recursive: true, force: true }))
  await assert.rejects(
    buildDataset({
      ...ebina,
      outDir,
      version: 'bad',
      fetchTile: async () => null,
    }),
    /missing/,
  )
  await assert.rejects(
    buildDataset({
      ...ebina,
      outDir,
      version: 'bad',
      fetchTile: async () => Buffer.from('broken'),
    }),
  )
  const m = await buildDataset({ ...ebina, outDir, version: 'v1', fetchTile })
  await fs.unlink(path.join(outDir, 'v1/poi/12', m.poiTiles[0] + '.json'))
  await assert.rejects(validate(outDir), /ENOENT/)
})

test('Pages staging keeps existing admin tiles and the validated manifest together', async (t) => {
  const { prepare } = require('../bin/prepare-pages')
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'geocoder-pages-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const outDir = path.join(root, 'data'),
    siteDir = path.join(root, 'site')
  const m = await buildDataset({ ...ebina, outDir, version: 'v1', fetchTile })
  await prepare(outDir, siteDir)
  assert.equal(
    JSON.parse(await fs.readFile(path.join(siteDir, 'data/manifest.json')))
      .version,
    'v1',
  )
  assert.ok(
    (await fs.stat(path.join(siteDir, 'tiles/10/909/403.pbf'))).size > 0,
  )
  const admin = JSON.parse(
    await fs.readFile(path.join(siteDir, 'tiles/manifest.json'), 'utf8'),
  )
  assert.equal(admin.sourceDate, '2026-01-01')
  assert.equal(admin.license, 'CC-BY-4.0')
  assert.match(
    await fs.readFile(path.join(siteDir, 'tiles/README.txt'), 'utf8'),
    /creativecommons\.org\/licenses\/by\/4\.0/,
  )
  assert.match(
    await fs.readFile(path.join(siteDir, 'data/README.txt'), 'utf8'),
    /kikakuchousei40182\.html/,
  )
  assert.ok(
    (
      await fs.stat(
        path.join(siteDir, 'data/v1/poi/12', m.poiTiles[0] + '.json'),
      )
    ).size > 0,
  )
  await assert.rejects(prepare(outDir, siteDir), /EEXIST/)
})
