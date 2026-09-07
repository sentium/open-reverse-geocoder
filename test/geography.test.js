const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { extract } = require('../bin/lib/search-data')
const { VectorTile, PbfReader } = require('../dist/vector-tile')
const baseline = require('./fixtures/geography-baseline.json')
const root = path.join(__dirname, '..')
const hash = (value) =>
  createHash('sha256')
    .update(Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest('hex')

test('fixed GSI fixtures preserve every extracted name, coordinate and stable ID', async () => {
  for (const expected of baseline.extractions) {
    const bytes = await fs.readFile(
      path.join(__dirname, 'fixtures', expected.name),
    )
    assert.equal(hash(bytes), expected.inputSha256, expected.name)
    const actual = extract(bytes, expected.z, expected.x, expected.y)
    assert.equal(actual.points.length, expected.points)
    assert.equal(actual.roads.length, expected.roads)
    assert.equal(hash(actual), expected.outputSha256, expected.name)
    // A Buffer/subarray can have a nonzero byteOffset in Node and browsers.
    const padded = new Uint8Array(bytes.length + 13)
    padded.set(bytes, 7)
    assert.equal(
      hash(
        extract(
          padded.subarray(7, 7 + bytes.length),
          expected.z,
          expected.x,
          expected.y,
        ),
      ),
      expected.outputSha256,
    )
  }
})

test('all checked-in administrative tiles preserve GeoJSON and geoContains results', async () => {
  const { geoContains } = await import('d3-geo')
  for (const expected of baseline.administrative) {
    const bytes = await fs.readFile(path.join(root, expected.file))
    assert.equal(hash(bytes), expected.inputSha256, expected.file)
    const tile = new VectorTile(new PbfReader(bytes))
    const features = Object.values(tile.layers).flatMap((layer) =>
      Array.from({ length: layer.length }, (_, i) =>
        layer.feature(i).toGeoJSON(expected.x, expected.y, expected.z),
      ),
    )
    assert.equal(features.length, expected.features, expected.file)
    // vector-tile 3 rearranges inverse Mercator arithmetic; see the measured
    // < 1e-12 degree differences in design/dependency-update-review.md.
    const normalized = JSON.parse(
      JSON.stringify(features, (_key, value) =>
        typeof value === 'number' ? Math.round(value * 1e8) / 1e8 : value,
      ),
    )
    assert.equal(
      hash(normalized),
      expected.normalizedOutputSha256,
      expected.file,
    )
    assert.equal(
      hash(
        features.map((feature) =>
          baseline.samples.map((point) => geoContains(feature, point)),
        ),
      ),
      expected.containsSha256,
      expected.file,
    )
  }
})
