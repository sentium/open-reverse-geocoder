#!/usr/bin/env node
const fs = require('node:fs/promises')
const path = require('node:path')
const { validateOsm } = require('./validate-osm-data')
async function prepare(root, expectedRegions) {
  const regions = []
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[A-Za-z0-9_-]{1,80}$/.test(entry.name))
      continue
    const m = JSON.parse(
      await fs.readFile(path.join(root, entry.name, 'manifest.json'), 'utf8'),
    )
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(m.version))
      throw new Error('Invalid version')
    regions.push(
      JSON.parse(
        await fs.readFile(
          path.join(root, entry.name, m.version, 'region.json'),
          'utf8',
        ),
      ),
    )
  }
  if (!regions.length) throw new Error('No datasets')
  if (
    expectedRegions &&
    JSON.stringify(regions.map((r) => r.id).sort()) !==
      JSON.stringify([...expectedRegions].sort())
  )
    throw new Error('Generated regions do not match the requested set')
  const catalog = {
    schemaVersion: 1,
    regions: regions.sort((a, b) => a.id.localeCompare(b.id)),
  }
  const report = await validateOsm(root, catalog)
  const pending = path.join(root, '.catalog.json')
  await fs.writeFile(pending, JSON.stringify(catalog))
  await fs.rename(pending, path.join(root, 'catalog.json'))
  return report
}
module.exports = { prepare }
if (require.main === module)
  prepare(process.argv[2])
    .then(console.log)
    .catch((e) => {
      console.error(e)
      process.exitCode = 1
    })
