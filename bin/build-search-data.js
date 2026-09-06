#!/usr/bin/env node
// Build tooling requires Node.js >=22. The library remains compatible with its existing target.
const fs = require('fs/promises')
const { createReadStream, createWriteStream } = require('fs')
const path = require('path')
const { parseArgs } = require('util')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')
const { createGunzip } = require('zlib')
const readline = require('readline')
const { SOURCE, buildDataset, coverageFor } = require('./lib/search-data')

async function main() {
  const { values } = parseArgs({
    options: {
      all: { type: 'boolean' },
      bbox: { type: 'string' },
      output: { type: 'string', default: 'docs/data' },
      version: {
        type: 'string',
        default: new Date().toISOString().replace(/[^0-9]/g, ''),
      },
      'source-revision': { type: 'string' },
      'cache-dir': { type: 'string', default: 'tmp/gsi-cache' },
      refresh: { type: 'boolean' },
      'discard-source-cache': { type: 'boolean' },
      concurrency: { type: 'string', default: '4' },
      help: { type: 'boolean' },
    },
  })
  if (values.help) {
    console.log(
      'npm run build:data -- (--all | --bbox west,south,east,north) [--version ID] [--output docs/data] [--source-revision TEXT] [--refresh] [--concurrency 1..8]',
    )
    return
  }
  if (Boolean(values.all) === Boolean(values.bbox))
    throw new Error('Choose exactly one of --all or --bbox')
  const bbox = values.all
    ? [122, 20, 154, 46]
    : values.bbox.split(',').map(Number)
  coverageFor(bbox)
  if (
    !Number.isInteger(Number(values.concurrency)) ||
    Number(values.concurrency) < 1 ||
    Number(values.concurrency) > 8
  )
    throw new Error('concurrency must be 1–8')
  const cacheDir = path.resolve(values['cache-dir'])
  await fs.mkdir(cacheDir, { recursive: true })
  async function cachedFile(relative, url) {
    const filename = path.join(cacheDir, relative)
    try {
      const stat = await fs.stat(filename)
      if (!values.refresh && Date.now() - stat.mtimeMs < 86400000)
        return filename
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
    let lastError
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(60000),
        })
        if (!response.ok) {
          await response.body?.cancel()
          throw new Error(`HTTP ${response.status}: ${url}`)
        }
        await fs.mkdir(path.dirname(filename), { recursive: true })
        const temporary = filename + '.download'
        await pipeline(
          Readable.fromWeb(response.body),
          createWriteStream(temporary),
        )
        await fs.rename(temporary, filename)
        return filename
      } catch (e) {
        lastError = e
        if (attempt < 2)
          await new Promise((resolve) =>
            setTimeout(resolve, (attempt + 1) * 1000),
          )
      }
    }
    throw lastError
  }
  // The catalogue avoids requesting hundreds of thousands of empty ocean tiles.
  const catalogueFile = await cachedFile(
    'mokuroku.csv.gz',
    SOURCE + '/mokuroku.csv.gz',
  )
  const lines = readline.createInterface({
    input: createReadStream(catalogueFile).pipe(createGunzip()),
    crlfDelay: Infinity,
  })
  const catalog = [],
    seen = new Set()
  for await (const line of lines) {
    const match = /^(11|14)\/(\d+)\/(\d+)\.pbf,/.exec(line)
    if (match && !seen.has(match[0])) {
      seen.add(match[0])
      catalog.push(match.slice(1).map(Number))
    }
  }
  if (!catalog.some((t) => t[0] === 11) || !catalog.some((t) => t[0] === 14))
    throw new Error('Invalid or incomplete GSI catalogue')
  let count = 0
  const manifest = await buildDataset({
    bbox,
    outDir: path.resolve(values.output),
    version: values.version,
    concurrency: Number(values.concurrency),
    catalog,
    sourceRevision: values['source-revision'],
    fetchTile: async (z, x, y) => {
      const file = await cachedFile(
        `${z}/${x}/${y}.pbf`,
        `${SOURCE}/${z}/${x}/${y}.pbf`,
      )
      if (++count % 1000 === 0)
        console.log(`Downloaded/read ${count} source tiles`)
      const buffer = await fs.readFile(file)
      if (values['discard-source-cache']) await fs.unlink(file)
      return buffer
    },
  })
  console.log(JSON.stringify(manifest.stats, null, 2))
  console.log(
    `Created ${values.output}/${manifest.version}; manifest.json updated`,
  )
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
