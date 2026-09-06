#!/usr/bin/env node
const fs = require('node:fs/promises')
const path = require('node:path')
const { validate } = require('./validate-search-data')
const { validateOsm } = require('./validate-osm-data')
async function assemble(japan, osm, destination) {
  const domestic = await validate(path.join(japan, 'data'))
  const international = await validateOsm(osm)
  if (domestic.totalBytes + international.bytes > 880000000)
    throw new Error(
      'Combined data exceeds the Pages budget; use a larger static data host',
    )
  async function size(directory) {
    let bytes = 0
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, item.name)
      if (item.isSymbolicLink())
        throw new Error('Dataset must not contain symbolic links')
      bytes += item.isDirectory()
        ? await size(filename)
        : (await fs.stat(filename)).size
    }
    return bytes
  }
  const totalBytes =
    (await size(path.join(japan, 'data'))) +
    (await size(path.join(japan, 'tiles'))) +
    (await size(osm))
  if (totalBytes > 900000000)
    throw new Error('Complete Pages artifact exceeds the 900MB budget')
  await fs.mkdir(destination, { recursive: false })
  await fs.cp(path.join(japan, 'data'), path.join(destination, 'data'), {
    recursive: true,
  })
  await fs.cp(path.join(japan, 'tiles'), path.join(destination, 'tiles'), {
    recursive: true,
  })
  await fs.cp(osm, path.join(destination, 'osm'), { recursive: true })
  await fs.writeFile(path.join(destination, '.nojekyll'), '')
  const report = {
    japan: domestic,
    osm: international,
    totalBytes,
  }
  await fs.writeFile(
    path.join(destination, 'datasets.json'),
    JSON.stringify(report, null, 2),
  )
  return report
}
module.exports = { assemble }
if (require.main === module)
  assemble(process.argv[2], process.argv[3], process.argv[4])
    .then(console.log)
    .catch((e) => {
      console.error(e)
      process.exitCode = 1
    })
