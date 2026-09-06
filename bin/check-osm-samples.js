#!/usr/bin/env node
// Run against the generated *US* dataset, not the synthetic test fixtures.
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const assert = require('node:assert/strict')
const { reverseGeocode, clearNearbyCache } = require('../dist/main')
async function check(directory) {
  const root = path.resolve(directory)
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
    for (const [name, coordinates, code] of [
      ['Washington', [-77.0065, 38.8977], 'US-DC'],
      ['New York', [-73.9772, 40.7527], 'US-NY'],
      ['San Francisco', [-122.3966, 37.7934], 'US-CA'],
      ['Anchorage', [-149.89, 61.222], 'US-AK'],
      ['Honolulu', [-157.8583, 21.3069], 'US-HI'],
    ]) {
      const result = await reverseGeocode(coordinates, {
        source: 'osm',
        osmDataUrl: url,
        nearby: false,
        region: 'us',
      })
      assert.equal(result.countryCode, 'US', name)
      assert.ok(
        result.administrativeAreas.some((a) => a.code === code),
        `${name}: expected ${code}`,
      )
      results.push({
        name,
        coordinates,
        administrativeAreas: result.administrativeAreas,
      })
    }
    for (const [name, coordinates, kind, pattern] of [
      ['Washington station', [-77.0065, 38.8977], 'station', /Union Station/],
      ['US Capitol', [-77.009, 38.8898], 'landmark', /United States Capitol/],
      [
        'Washington motorway exit',
        [-77.0140866, 38.8938824],
        'highway',
        /Exit 10/,
      ],
    ]) {
      const result = await reverseGeocode(coordinates, {
        source: 'osm',
        osmDataUrl: url,
        nearby: { rules: [{ kind, radiusM: 1000, priority: 1 }] },
        region: 'us',
      })
      assert.match(result.nearby.selected?.name ?? '', pattern, name)
      results.push({
        name,
        coordinates,
        selected: result.nearby.selected,
        highwayMatch: result.nearby.highwayMatch,
      })
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
