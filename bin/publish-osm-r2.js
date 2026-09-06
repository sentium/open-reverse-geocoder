#!/usr/bin/env node
// Upload immutable versions first, verify public reads, then replace the catalog.
// Dry-run by default. Bucket creation, DNS and CORS are separate setup steps.
const fs = require('node:fs/promises')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { parseArgs } = require('node:util')
const { createHash } = require('node:crypto')
const { prepare } = require('./prepare-osm-catalog')
const { check } = require('./check-osm-samples')
const { selectRegions } = require('./build-osm-regions')

async function plan(root, { account, bucket, publicUrl }) {
  if (
    !/^[a-f0-9]{32}$/.test(account || '') ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket || '')
  )
    throw new Error('Expected an R2 account ID and bucket name')
  const url = new URL(publicUrl)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  )
    throw new Error(
      'Public URL must be the HTTPS origin of the bucket custom domain',
    )
  const catalog = JSON.parse(await fs.readFile(path.join(root, 'catalog.json')))
  let files = 0,
    bytes = 0
  const versions = []
  async function walk(directory, prefix = '') {
    const names = []
    for (const item of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name),
        key = prefix + item.name
      if (item.isDirectory()) names.push(...(await walk(file, key + '/')))
      else {
        if (!item.isFile())
          throw new Error('Only regular files may be uploaded')
        files++
        bytes += (await fs.stat(file)).size
        names.push(key)
      }
    }
    return names
  }
  for (const region of catalog.regions) {
    if (
      ![region.id, region.version].every((s) => /^[A-Za-z0-9_-]{1,80}$/.test(s))
    )
      throw new Error('Invalid immutable region path')
    const directory = path.join(root, region.id, region.version)
    const names = await walk(directory)
    const probe =
      names.find((n) => n.endsWith('.json.gz')) ??
      names.find((n) => /^poi\//.test(n))
    if (!probe) throw new Error('Missing region tiles')
    versions.push({ id: region.id, version: region.version, directory, probe })
  }
  return {
    account,
    bucket,
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    publicUrl: url.origin,
    versions,
    files,
    bytes,
  }
}

async function upload(
  root,
  plan,
  run = (args, capture = false) =>
    execFileSync('aws', args, {
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      encoding: 'utf8',
    }),
  fetcher = fetch,
) {
  const aws = (args) => [
    '--endpoint-url',
    plan.endpoint,
    '--region',
    'auto',
    ...args,
  ]
  const destination = (key) => `s3://${plan.bucket}/osm/${key}`
  const immutable = 'public,max-age=31536000,immutable'
  const mutable = 'public,max-age=60,must-revalidate'
  // Check every existing version before making any changes. Unique version
  // names plus matching manifests make an interrupted upload resumable.
  for (const v of plan.versions) {
    const temporary = path.join(root, `.r2-existing-${v.id}.json`)
    try {
      try {
        run(
          aws([
            's3api',
            'get-object',
            '--bucket',
            plan.bucket,
            '--key',
            `osm/${v.id}/${v.version}/manifest.json`,
            temporary,
          ]),
          true,
        )
      } catch (error) {
        if (/\(NoSuchKey\)|\(404\)/.test(String(error.stderr))) continue
        throw error
      }
      if (
        !(await fs.readFile(temporary)).equals(
          await fs.readFile(path.join(v.directory, 'manifest.json')),
        )
      )
        throw new Error(
          'Refusing to overwrite immutable version: ' + v.id + '/' + v.version,
        )
    } finally {
      await fs.rm(temporary, { force: true })
    }
  }
  for (const v of plan.versions) {
    const key = `${v.id}/${v.version}/`
    const common = [
      's3',
      'sync',
      v.directory + '/',
      destination(key),
      '--only-show-errors',
      '--cache-control',
      immutable,
    ]
    run(
      aws([...common, '--exclude', 'manifest.json', '--exclude', '*.json.gz']),
    )
    run(
      aws([
        ...common,
        '--exclude',
        '*',
        '--include',
        '*.json.gz',
        '--no-guess-mime-type',
        '--content-type',
        'application/gzip',
      ]),
    )
    run(
      aws([
        's3',
        'cp',
        path.join(v.directory, 'manifest.json'),
        destination(key + 'manifest.json'),
        '--only-show-errors',
        '--content-type',
        'application/json',
        '--cache-control',
        immutable,
      ]),
    )
  }
  // Public domain and browser CORS must work before either public catalog is
  // switched. Probe both JSON and gzip and compare the exact stored bytes.
  for (const v of plan.versions) {
    for (const key of ['manifest.json', v.probe]) {
      const expected = await fs.readFile(path.join(v.directory, key))
      const hash = createHash('sha256').update(expected).digest('hex')
      const response = await fetcher(
        `${plan.publicUrl}/osm/${v.id}/${v.version}/${key}?verify=${hash}`,
        {
          headers: { Origin: 'https://example.org' },
          signal: AbortSignal.timeout(60000),
        },
      )
      if (
        !response.ok ||
        response.headers.get('access-control-allow-origin') !== '*'
      )
        throw new Error(
          'Public read/CORS verification failed: ' + v.id + '/' + key,
        )
      const actual = Buffer.from(await response.arrayBuffer())
      if (!actual.equals(expected))
        throw new Error(
          'Public object differs from uploaded bytes: ' + v.id + '/' + key,
        )
    }
  }
  for (const v of plan.versions)
    run(
      aws([
        's3',
        'cp',
        path.join(v.directory, 'manifest.json'),
        destination(v.id + '/manifest.json'),
        '--only-show-errors',
        '--content-type',
        'application/json',
        '--cache-control',
        mutable,
      ]),
    )
  for (const name of ['verification.json', 'validation.json', 'catalog.json'])
    run(
      aws([
        's3',
        'cp',
        path.join(root, name),
        destination(name),
        '--only-show-errors',
        '--content-type',
        'application/json',
        '--cache-control',
        mutable,
      ]),
    )
}

module.exports = { plan, upload }
if (require.main === module) {
  const { values } = parseArgs({
    options: {
      source: { type: 'string' },
      account: { type: 'string' },
      bucket: { type: 'string' },
      'public-url': { type: 'string' },
      apply: { type: 'boolean', default: false },
    },
  })
  ;(async () => {
    const report = await prepare(values.source, selectRegions())
    await check(values.source)
    await fs.writeFile(
      path.join(values.source, 'validation.json'),
      JSON.stringify(report, null, 2),
    )
    const p = await plan(values.source, {
      ...values,
      publicUrl: values['public-url'],
    })
    console.log(
      JSON.stringify(
        {
          bucket: p.bucket,
          publicUrl: p.publicUrl,
          regions: p.versions.map((v) => v.id),
          versionFiles: p.files,
          versionBytes: p.bytes,
          apply: values.apply,
        },
        null,
        2,
      ),
    )
    if (values.apply) await upload(values.source, p)
  })().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
