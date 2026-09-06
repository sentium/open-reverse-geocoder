#!/usr/bin/env node
// Obtain a complete machine-readable OSM-derived version for reuse under ODbL.
const fs = require('node:fs/promises')
const path = require('node:path')
const {
  validateManifest,
  validateIndex,
  validatePoiTile,
  validateRoadTile,
  validateAdminTile,
} = require('../dist/data-validation')
async function download(base, output) {
  if (!/^https?:\/\/[^?#]+$/.test(base || ''))
    throw new Error('Expected immutable version URL')
  base = base.replace(/\/+$/, '')
  await fs.mkdir(output, { recursive: false })
  async function get(key, validator) {
    const response = await fetch(base + '/' + key, {
      signal: AbortSignal.timeout(60000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${key}`)
    const chunks = []
    let bytes = 0
    for await (const chunk of response.body) {
      bytes += chunk.length
      if (bytes > 16 * 1024 * 1024)
        throw new Error('Oversized data file: ' + key)
      chunks.push(chunk)
    }
    const buffer = Buffer.concat(chunks)
    if (validator) validator(JSON.parse(buffer))
    const dest = path.join(output, key)
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.writeFile(dest, buffer)
    return buffer
  }
  const manifest = validateManifest(JSON.parse(await get('manifest.json')))
  if (manifest.schemaVersion !== 2) throw new Error('Expected OSM dataset')
  await get('LICENSE.txt')
  await get('region.json')
  const files = []
  for (const key of manifest.indexTiles) {
    const index = validateIndex(JSON.parse(await get(`index/6/${key}.json`)))
    for (const [kind, z, keys, validator] of [
      ['poi', 12, index.poiTiles, validatePoiTile],
      ['road', 14, index.roadTiles, validateRoadTile],
      ['admin', 8, index.adminTiles, validateAdminTile],
    ])
      for (const tile of keys)
        files.push([`${kind}/${z}/${tile}.json`, validator])
  }
  let cursor = 0
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < files.length) await get(...files[cursor++])
    }),
  )
  console.log(
    `Downloaded ${manifest.version}: ${files.length} tiles; ${manifest.attribution}`,
  )
}
if (require.main === module)
  download(process.argv[2], process.argv[3]).catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
