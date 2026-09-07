const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createRequire } = require('node:module')

test('packed CommonJS package and public declarations work in an isolated consumer', async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'geocoder-consumer-'),
  )
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const run = (command, args, cwd = directory) =>
    execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  const [packed] = JSON.parse(
    run(
      'npm',
      ['pack', '--json', '--pack-destination', directory],
      path.join(__dirname, '..'),
    ),
  )
  await fs.writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify({ private: true }),
  )
  run('npm', [
    'install',
    '--ignore-scripts',
    '--no-package-lock',
    path.join(directory, packed.filename),
  ])
  const consumerRequire = createRequire(path.join(directory, 'consumer.cjs'))
  const notices = await fs.readFile(
    path.join(
      directory,
      'node_modules',
      '@geolonia',
      'open-reverse-geocoder',
      'dist',
      'THIRD_PARTY_LICENSES.txt',
    ),
    'utf8',
  )
  for (const dependency of [
    '@mapbox/vector-tile',
    '@mapbox/point-geometry',
    'pbf',
    'd3-geo',
    'd3-array',
    'fflate',
  ])
    assert.ok(notices.includes(dependency), dependency)
  const api = consumerRequire('@geolonia/open-reverse-geocoder')
  for (const name of [
    'openReverseGeocoder',
    'reverseGeocode',
    'searchNearby',
    'clearNearbyCache',
  ])
    assert.equal(typeof api[name], 'function', name)
  await fs.writeFile(
    path.join(directory, 'consumer.ts'),
    `
import geocoder = require('@geolonia/open-reverse-geocoder')
const domestic: Promise<geocoder.ReverseGeocodingResult> = geocoder.openReverseGeocoder([139.767, 35.681])
const global: Promise<geocoder.GlobalReverseGeocodingResult> = geocoder.reverseGeocode([139.767, 35.681])
const nearby: Promise<geocoder.NearbyResult> = geocoder.searchNearby([139.767, 35.681])
void [domestic, global, nearby]
`,
  )
  run(process.execPath, [
    require.resolve('typescript/bin/tsc'),
    '--strict',
    '--noEmit',
    '--module',
    'commonjs',
    '--target',
    'es2020',
    '--lib',
    'es2020,dom',
    'consumer.ts',
  ])
  run('npm', ['install', '--package-lock-only', '--ignore-scripts'])
  const audit = JSON.parse(run('npm', ['audit', '--omit=dev', '--json']))
  assert.equal(audit.metadata.vulnerabilities.total, 0)
})
