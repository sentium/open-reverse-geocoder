const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')

test('publication finds artifacts after the first 100 and ignores PR and expired artifacts', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'data-artifacts-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const fake = path.join(root, 'gh')
  await fs.writeFile(
    fake,
    `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
if (args[0] === 'api') {
  const endpoint = args[1]
  if (endpoint === 'repos/test/geocoder') console.log(JSON.stringify({default_branch:'main'}))
  else if (endpoint.includes('/workflows/')) {
    if (!endpoint.includes('status=success&branch=main')) throw new Error('Must select successful main runs')
    console.log(JSON.stringify({workflow_runs:[
      {id:30,event:'pull_request',head_repository:{full_name:'test/geocoder'}},
      {id:20,event:'push',head_repository:{full_name:'test/geocoder'}},
      {id:10,event:'push',head_repository:{full_name:'test/geocoder'}}
    ]}))
  } else if (endpoint.includes('/runs/20/')) {
    if (!args.includes('--paginate') || !args.includes('--slurp')) throw new Error('Pagination required')
    console.log(JSON.stringify([{artifacts:[{name:'osm-pages-data',expired:true}]}]))
  } else if (endpoint.includes('/runs/10/')) {
    if (!args.includes('--paginate') || !args.includes('--slurp')) throw new Error('Pagination required')
    console.log(JSON.stringify([
      {artifacts:Array.from({length:100}, (_,i)=>({name:'preview-'+i,expired:false}))},
      {artifacts:[{name:'gsi-pages-data',expired:false},{name:'osm-pages-data',expired:false}]}
    ]))
  } else throw new Error('Unexpected or ineligible run: '+endpoint)
} else if (args[0] === 'run' && args[1] === 'download') {
  fs.appendFileSync('downloads.jsonl', JSON.stringify(args)+'\\n')
} else throw new Error('Unexpected command')
`,
    { mode: 0o755 },
  )
  const output = path.join(root, 'outputs')
  execFileSync(
    process.execPath,
    [path.resolve('bin/fetch-data-artifacts.js')],
    {
      cwd: root,
      env: {
        ...process.env,
        PATH: root + path.delimiter + process.env.PATH,
        GITHUB_REPOSITORY: 'test/geocoder',
        GITHUB_OUTPUT: output,
      },
      stdio: 'pipe',
    },
  )
  const downloads = (
    await fs.readFile(path.join(root, 'downloads.jsonl'), 'utf8')
  )
    .trim()
    .split('\n')
    .map(JSON.parse)
  assert.equal(downloads.length, 2)
  assert.ok(downloads.every((args) => args[2] === '10'))
  assert.deepEqual(
    downloads.map((args) => args[args.indexOf('--name') + 1]),
    ['gsi-pages-data', 'osm-pages-data'],
  )
  assert.equal(await fs.readFile(output, 'utf8'), 'ready=true\n')
})
