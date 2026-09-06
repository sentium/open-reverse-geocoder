const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { writeFileSync } = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { plan, upload } = require('../bin/publish-osm-r2')

test('R2 publication commits the catalog only after all versions and public CORS checks succeed', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'osm-publish-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const regions = ['a', 'b'].map((id) => ({ id, version: 'v1' }))
  await fs.writeFile(
    path.join(root, 'catalog.json'),
    JSON.stringify({ regions }),
  )
  for (const { id } of regions) {
    await fs.mkdir(path.join(root, id, 'v1/poi'), { recursive: true })
    await fs.writeFile(
      path.join(root, id, 'v1/manifest.json'),
      JSON.stringify({ id, version: 'v1' }),
    )
    await fs.writeFile(
      path.join(root, id, 'v1/poi/tile.json.gz'),
      'test bytes ' + id,
    )
  }
  const p = await plan(root, {
    account: 'a'.repeat(32),
    bucket: 'test-bucket',
    publicUrl: 'https://data.example.org/',
  })
  assert.equal(p.files, 4)
  const calls = []
  const missing = (args) => {
    calls.push(args)
    if (args.includes('get-object')) {
      const error = new Error('missing')
      error.stderr = '(NoSuchKey)'
      throw error
    }
  }
  const publicRead = async (url) => {
    const key = new URL(url).pathname.slice('/osm/'.length)
    return {
      ok: true,
      headers: new Headers({ 'access-control-allow-origin': '*' }),
      arrayBuffer: () => fs.readFile(path.join(root, key)),
    }
  }
  await upload(root, p, missing, publicRead)
  assert.equal(
    calls.at(-1)[calls.at(-1).indexOf('cp') + 2],
    's3://test-bucket/osm/catalog.json',
  )
  assert.equal(calls.filter((a) => a.includes('application/gzip')).length, 2)
  assert.ok(calls.every((a) => !a.includes('--delete')))
  calls.length = 0
  await assert.rejects(
    upload(
      root,
      p,
      (args) => {
        missing(args)
        if (args.includes('sync') && args.some((a) => a.includes('/b/v1/')))
          throw new Error('upload failed')
      },
      publicRead,
    ),
    /upload failed/,
  )
  assert.ok(!calls.some((a) => a.includes('s3://test-bucket/osm/catalog.json')))
  assert.ok(
    !calls.some((a) => a.includes('s3://test-bucket/osm/a/manifest.json')),
  )
  calls.length = 0
  await assert.rejects(
    upload(root, p, missing, async (url) => {
      const response = await publicRead(url)
      response.headers = new Headers()
      return response
    }),
    /CORS/,
  )
  assert.ok(!calls.some((a) => a.includes('s3://test-bucket/osm/catalog.json')))
  calls.length = 0
  await assert.rejects(
    upload(
      root,
      p,
      (args) => {
        calls.push(args)
        if (args.includes('get-object'))
          writeFileSync(args.at(-1), 'different immutable manifest')
      },
      publicRead,
    ),
    /Refusing to overwrite immutable/,
  )
  assert.ok(calls.every((a) => a.includes('get-object')))
  await fs.symlink(
    path.join(root, 'catalog.json'),
    path.join(root, 'a/v1/linked.json'),
  )
  await assert.rejects(plan(root, p), /Only regular files/)
})
