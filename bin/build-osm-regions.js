#!/usr/bin/env node
// Generate a complete catalog, or a single-region preview, from pinned inputs.
const fs = require('node:fs/promises')
const { createReadStream, openSync, closeSync } = require('node:fs')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { parseArgs } = require('node:util')
const path = require('node:path')
const configs = require('./osm-regions.json')
const { prepare } = require('./prepare-osm-catalog')
const { check } = require('./check-osm-samples')

function selectRegions(region = 'all') {
  if (region === 'all') return Object.keys(configs)
  if (!Object.hasOwn(configs, region))
    throw new Error('Unknown region: ' + region)
  return [region]
}

function selectExtract(index, id) {
  const feature = index.features.find((f) => f.properties.id === id)
  if (
    !feature ||
    JSON.stringify(feature.properties['iso3166-1:alpha2']) !==
      JSON.stringify([configs[id].countryCode])
  )
    throw new Error('Missing extract or unexpected country codes: ' + id)
  const url = new URL(feature.properties.urls.pbf)
  if (
    url.origin !== 'https://download.geofabrik.de' ||
    !url.pathname.endsWith('.osm.pbf')
  )
    throw new Error('Unexpected extract URL: ' + id)
  return feature
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options })
}

async function checksum(filename) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filename)) hash.update(chunk)
  return `${hash.digest('hex')}  ${path.basename(filename)}\n`
}

function download(url, filename) {
  run('curl', [
    '--fail',
    '--silent',
    '--show-error',
    '--location',
    '--retry',
    '3',
    '--max-time',
    '14400',
    '--output',
    filename,
    url,
  ])
}

async function build({
  region = 'all',
  source,
  output,
  version,
  reuseInput = false,
}) {
  const regions = selectRegions(region)
  if (!source || !output || !/^[A-Za-z0-9_-]{1,80}$/.test(version || ''))
    throw new Error('Source, output and a valid immutable version are required')
  // Fresh output prevents old or partial regions entering a release.
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.mkdir(output, { recursive: false })
  await fs.mkdir(source, { recursive: true })
  let index
  if (!reuseInput) {
    const filename = path.join(source, 'regions.json')
    download('https://download.geofabrik.de/index-v1.json', filename)
    index = JSON.parse(await fs.readFile(filename))
  }
  for (const id of regions) {
    console.log('Generating region: ' + id)
    let input = path.join(source, id)
    if (reuseInput) {
      // Older US preview artifacts stored their files directly at the root.
      if (id === 'us' && !(await fs.stat(input).catch(() => null)))
        input = source
      const feature = JSON.parse(
        await fs.readFile(path.join(input, 'region.json')),
      )
      selectExtract({ features: [feature] }, id)
    } else {
      const feature = selectExtract(index, id)
      await fs.mkdir(input, { recursive: false })
      await fs.writeFile(
        path.join(input, 'region.json'),
        JSON.stringify(feature),
      )
      const pbf = path.join(input, 'source.osm.pbf')
      const filtered = path.join(input, 'filtered.osm.pbf')
      download(feature.properties.urls.pbf, pbf)
      await fs.writeFile(path.join(input, 'SHA256SUMS'), await checksum(pbf))
      await fs.writeFile(
        path.join(input, 'snapshot.txt'),
        execFileSync('osmium', ['fileinfo', pbf], { encoding: 'utf8' }),
      )
      run('osmium', [
        'tags-filter',
        pbf,
        'nwr/railway=station,halt',
        'nwr/highway=motorway,motorway_junction,services,rest_area',
        'nwr/tourism=attraction,museum,gallery,zoo,viewpoint',
        'nwr/historic',
        'nwr/leisure=park',
        'nwr/amenity=place_of_worship',
        'wr/boundary=administrative',
        '-o',
        filtered,
      ])
      await fs.unlink(pbf)
      const errors = openSync(path.join(input, 'geometry-errors.log'), 'w')
      try {
        run(
          'osmium',
          [
            'export',
            filtered,
            '-c',
            path.join(__dirname, 'osm-export.json'),
            '-f',
            'geojsonseq',
            '-o',
            path.join(input, 'features.geojsonseq'),
            '--show-errors',
          ],
          { stdio: ['ignore', 'inherit', errors] },
        )
      } finally {
        closeSync(errors)
      }
      await fs.unlink(filtered)
    }
    const sequence = path.join(input, 'features.geojsonseq')
    const python = process.env.OSM_PYTHON || 'python3'
    if (configs[id].boundaryConfig)
      run(python, [
        path.join(__dirname, 'complete-osm-boundaries.py'),
        '--input',
        sequence,
        '--config',
        path.join(__dirname, configs[id].boundaryConfig),
      ])
    const exportHash = await checksum(sequence)
    await fs.writeFile(path.join(input, 'EXPORT-SHA256SUMS'), exportHash)
    run(python, [
      path.join(__dirname, 'build-osm-data.py'),
      '--input',
      sequence,
      '--region-file',
      path.join(input, 'region.json'),
      '--version',
      version,
      '--source-revision',
      (await fs.readFile(path.join(input, 'SHA256SUMS'), 'utf8')) + exportHash,
      '--output',
      output,
    ])
    const provenance = path.join(output, id, version, 'provenance')
    await fs.mkdir(provenance)
    for (const name of [
      'region.json',
      'snapshot.txt',
      'SHA256SUMS',
      'geometry-errors.log',
      'EXPORT-SHA256SUMS',
      'boundary-sources.json',
    ]) {
      if (
        name === 'boundary-sources.json' &&
        !(await fs.stat(path.join(input, name)).catch(() => null))
      )
        continue
      await fs.copyFile(path.join(input, name), path.join(provenance, name))
    }
  }
  const report = await prepare(output)
  await check(output)
  await fs.writeFile(
    path.join(output, 'validation.json'),
    JSON.stringify(report, null, 2),
  )
  return report
}

module.exports = { build, selectRegions, selectExtract }
if (require.main === module) {
  const { values } = parseArgs({
    options: {
      region: { type: 'string', default: 'all' },
      source: { type: 'string' },
      output: { type: 'string' },
      version: { type: 'string' },
      'reuse-input': { type: 'boolean', default: false },
    },
  })
  build({ ...values, reuseInput: values['reuse-input'] })
    .then(console.log)
    .catch((e) => {
      console.error(e)
      process.exitCode = 1
    })
}
