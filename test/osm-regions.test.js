const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const {
  selectRegions,
  selectExtract,
  selectSources,
  build,
} = require('../bin/build-osm-regions')
const { prepare } = require('../bin/prepare-osm-catalog')
const { check } = require('../bin/check-osm-samples')

test('region selection rejects unknown IDs and mismatched source metadata', () => {
  assert.deepEqual(selectRegions().slice(0, 8), [
    'us',
    'taiwan',
    'south-korea',
    'indonesia',
    'india',
    'vietnam',
    'philippines',
    'thailand',
  ])
  assert.equal(selectRegions().length, 13)
  assert.deepEqual(selectRegions('europe'), ['germany', 'italy', 'romania'])
  for (const id of [
    'france',
    'norway',
    'europe-core',
    'europe-extra',
    'europe-adjacent',
  ])
    assert.throws(() => selectRegions(id), /Unknown region/)
  assert.deepEqual(selectRegions('americas'), ['brazil', 'mexico'])
  assert.deepEqual(selectRegions('taiwan'), ['taiwan'])
  assert.throws(() => selectRegions('../us'), /Unknown region/)
  assert.throws(() => selectRegions('constructor'), /Unknown region/)
  const feature = {
    properties: {
      id: 'taiwan',
      'iso3166-1:alpha2': ['TW'],
      urls: { pbf: 'https://download.geofabrik.de/asia/taiwan-latest.osm.pbf' },
    },
  }
  const index = { features: [feature] }
  assert.equal(selectExtract(index, 'taiwan'), feature)
  assert.throws(() => selectExtract(index, 'south-korea'), /Missing extract/)
  feature.properties['iso3166-1:alpha2'] = ['US']
  assert.throws(() => selectExtract(index, 'taiwan'), /unexpected country/)
  feature.properties['iso3166-1:alpha2'] = ['TW']
  feature.properties.urls.pbf = 'https://example.com/taiwan.osm.pbf'
  assert.throws(() => selectExtract(index, 'taiwan'), /Unexpected extract URL/)
})

test('multi-run previews require an exact non-overlapping mapping of selected regions', () => {
  assert.deepEqual(selectSources(['brazil', 'mexico']), [
    { region: 'brazil', source_run: '' },
    { region: 'mexico', source_run: '' },
  ])
  assert.deepEqual(selectSources(['brazil', 'mexico'], '{"americas":"123"}'), [
    { region: 'brazil', source_run: '123' },
    { region: 'mexico', source_run: '123' },
  ])
  assert.deepEqual(selectSources(['brazil'], '123'), [
    { region: 'brazil', source_run: '123' },
  ])
  assert.throws(
    () => selectSources(['brazil', 'mexico'], '{"brazil":"123"}'),
    /every selected/,
  )
  assert.throws(
    () =>
      selectSources(['brazil', 'mexico'], '{"americas":"123","brazil":"456"}'),
    /duplicate/,
  )
  assert.throws(
    () => selectSources(['brazil'], '{"mexico":"123"}'),
    /unselected/,
  )
  assert.throws(
    () => selectSources(['brazil'], '{"brazil":"../123"}'),
    /Invalid source/,
  )
})

test('multiple countries survive catalog composition and each must pass HTTP search checks', async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'osm-regions-'))
  t.after(() => fs.rm(tmp, { recursive: true, force: true }))
  const output = path.join(tmp, 'data')
  const configs = {}
  // Deliberately synthetic, including names and boundaries; real country
  // acceptance samples live in bin/osm-regions.json and run on full extracts.
  for (const [id, country, code, coordinates] of [
    ['taiwan', 'TW', 'TW-TPE', [121.517, 25.048]],
    ['south-korea', 'KR', 'KR-11', [126.971, 37.555]],
  ]) {
    const [x, y] = coordinates
    const geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [x - 0.2, y - 0.2],
          [x + 0.2, y - 0.2],
          [x + 0.2, y + 0.2],
          [x - 0.2, y + 0.2],
          [x - 0.2, y - 0.2],
        ],
      ],
    }
    const regionFile = path.join(tmp, id + '.json')
    await fs.writeFile(
      regionFile,
      JSON.stringify({
        type: 'Feature',
        geometry,
        properties: { id, 'iso3166-1:alpha2': [country] },
      }),
    )
    const sequence = path.join(tmp, id + '.geojsonseq')
    await fs.writeFile(
      sequence,
      [
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [x - 0.01, y],
              [x + 0.01, y],
            ],
          },
          properties: { '@type': 'way', '@id': 3, highway: 'motorway' },
        },
        {
          type: 'Feature',
          geometry,
          properties: {
            '@type': 'relation',
            '@id': 1,
            boundary: 'administrative',
            admin_level: '4',
            'ISO3166-2': code,
            name: 'Synthetic subdivision',
          },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates },
          properties: {
            '@type': 'node',
            '@id': 2,
            railway: 'station',
            name: 'Synthetic station ' + country,
          },
        },
      ]
        // Exercise a country with no motorways, as in Andorra's real extract.
        .filter((f) => id !== 'taiwan' || f.properties.highway !== 'motorway')
        .map((f) => JSON.stringify(f))
        .join('\n') + '\n',
    )
    execFileSync(process.env.OSM_PYTHON || 'python3', [
      'bin/build-osm-data.py',
      '--input',
      sequence,
      '--region-file',
      regionFile,
      '--output',
      output,
      '--version',
      'fixture',
      '--admin-zoom',
      id === 'south-korea' ? '10' : '8',
      ...(id === 'south-korea' ? ['--compress'] : []),
      '--source-revision',
      'synthetic test',
    ])
    configs[id] = {
      countryCode: country,
      administrativeSamples: [[id, coordinates, code]],
      nearbySamples: [
        [id, coordinates, 'station', '^Synthetic station ' + country + '$'],
      ],
    }
  }
  const report = await prepare(output)
  assert.deepEqual(
    report.regions.map((r) => r.region),
    ['south-korea', 'taiwan'],
  )
  await check(output, configs)
  const verified = JSON.parse(
    await fs.readFile(path.join(output, 'verification.json')),
  )
  assert.equal(verified.results.length, 4)
  assert.equal(new Set(verified.results.map((r) => r.region)).size, 2)
  configs.taiwan.administrativeSamples[0][2] = 'TW-KHH'
  await assert.rejects(check(output, configs), /expected TW-KHH/)
  delete configs.taiwan
  await assert.rejects(
    check(output, configs),
    /Missing real-data verification samples: taiwan/,
  )
  // A damaged second country must block catalog replacement, preserving the
  // previously validated catalog byte for byte.
  const catalog = await fs.readFile(path.join(output, 'catalog.json'), 'utf8')
  await assert.rejects(
    prepare(output, ['taiwan', 'south-korea', 'germany']),
    /requested set/,
  )
  await assert.rejects(prepare(output, ['taiwan']), /requested set/)
  assert.equal(
    await fs.readFile(path.join(output, 'catalog.json'), 'utf8'),
    catalog,
  )
  await fs.unlink(path.join(output, 'taiwan/fixture/LICENSE.txt'))
  await assert.rejects(prepare(output), /ENOENT/)
  assert.equal(
    await fs.readFile(path.join(output, 'catalog.json'), 'utf8'),
    catalog,
  )
})

test('reused inputs must belong to the requested region and output must be fresh', async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'osm-reuse-'))
  t.after(() => fs.rm(tmp, { recursive: true, force: true }))
  await fs.mkdir(path.join(tmp, 'source/taiwan'), { recursive: true })
  await fs.writeFile(
    path.join(tmp, 'source/taiwan/region.json'),
    JSON.stringify({
      properties: { id: 'us', 'iso3166-1:alpha2': ['US'] },
    }),
  )
  const options = {
    region: 'taiwan',
    source: path.join(tmp, 'source'),
    output: path.join(tmp, 'nested/output'),
    version: 'preview',
    reuseInput: true,
  }
  await assert.rejects(build(options), /Missing extract/)
  await assert.rejects(build(options), /EEXIST/)
})
