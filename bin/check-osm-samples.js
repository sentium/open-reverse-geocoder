#!/usr/bin/env node
// Run against generated real datasets, not synthetic test fixtures.
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')
const { reverseGeocode, clearNearbyCache } = require('../dist/main')
const regionConfigs = require('./osm-regions.json')
async function check(directory, configs = regionConfigs) {
  const root = path.resolve(directory)
  const catalog = JSON.parse(await fs.readFile(path.join(root, 'catalog.json')))
  for (const region of catalog.regions) {
    if (
      !configs[region.id]?.administrativeSamples?.length ||
      !configs[region.id]?.nearbySamples?.length
    )
      throw new Error('Missing real-data verification samples: ' + region.id)
  }
  const server = http.createServer(async (req, res) => {
    const filename = path.resolve(
      root,
      '.' + new URL(req.url, 'http://test').pathname,
    )
    if (!filename.startsWith(root + path.sep)) {
      res.writeHead(400).end()
      return
    }
    try {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.end(await fs.readFile(filename))
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const results = []
  try {
    for (const region of catalog.regions) {
      const config = configs[region.id]
      assert.deepEqual(region.countryCodes, [config.countryCode])
      for (const [name, coordinates, code] of config.administrativeSamples) {
        const result = await reverseGeocode(coordinates, {
          source: 'osm',
          osmDataUrl: url,
          nearby: false,
          region: region.id,
        })
        assert.equal(result.countryCode, config.countryCode, name)
        assert.ok(
          result.administrativeAreas.some((a) => a.code === code),
          `${name}: expected ${code}`,
        )
        const automatic = await reverseGeocode(coordinates, {
          source: 'osm',
          osmDataUrl: url,
          nearby: false,
        })
        assert.equal(
          automatic.countryCode,
          config.countryCode,
          name + ' (automatic region)',
        )
        assert.ok(
          automatic.administrativeAreas.some((a) => a.code === code),
          `${name}: automatic region selection expected ${code}`,
        )
        results.push({
          region: region.id,
          name,
          coordinates,
          administrativeAreas: result.administrativeAreas,
          automaticCountryCode: automatic.countryCode,
        })
      }
      for (const [name, coordinates, kind, pattern] of config.nearbySamples) {
        const result = await reverseGeocode(coordinates, {
          source: 'osm',
          osmDataUrl: url,
          nearby: { rules: [{ kind, radiusM: 1000, priority: 1 }] },
          region: region.id,
        })
        assert.equal(result.countryCode, config.countryCode, name)
        assert.match(
          result.nearby.selected?.name ?? '',
          new RegExp(pattern),
          name,
        )
        results.push({
          region: region.id,
          name,
          coordinates,
          selected: result.nearby.selected,
          highwayMatch: result.nearby.highwayMatch,
        })
      }
    }
    await fs.writeFile(
      path.join(root, 'verification.json'),
      JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2),
    )
    console.log(JSON.stringify(results, null, 2))
  } finally {
    clearNearbyCache()
    await new Promise((resolve) => server.close(resolve))
  }
}
module.exports = { check }
if (require.main === module)
  check(process.argv[2]).catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
