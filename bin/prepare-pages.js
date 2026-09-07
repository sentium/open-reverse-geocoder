#!/usr/bin/env node
const fs = require('fs/promises')
const path = require('path')
const { validate } = require('./validate-search-data')
async function prepare(dataDir, siteDir) {
  const report = await validate(dataDir)
  // A fresh staging directory prevents accidental mixing with older generations.
  await fs.mkdir(siteDir, { recursive: false })
  await fs.cp(
    path.join(__dirname, '../docs/tiles'),
    path.join(siteDir, 'tiles'),
    { recursive: true },
  )
  await fs.cp(
    path.join(dataDir, report.version),
    path.join(siteDir, 'data', report.version),
    { recursive: true },
  )
  await fs.copyFile(
    path.join(dataDir, 'manifest.json'),
    path.join(siteDir, 'data/manifest.json'),
  )
  await fs.writeFile(path.join(siteDir, '.nojekyll'), '')
  await fs.copyFile(
    path.join(__dirname, '../data-licenses/japan-nearby.txt'),
    path.join(siteDir, 'data/README.txt'),
  )
  return report
}
module.exports = { prepare }
if (require.main === module)
  prepare(process.argv[2] || 'docs/data', process.argv[3] || 'tmp/pages')
    .then(console.log)
    .catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
