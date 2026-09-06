#!/usr/bin/env node
// Download only explicitly publishable artifacts from successful default-branch
// scheduled/manual/push builds in this repository. PR artifacts are never selected.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const repo = process.env.GITHUB_REPOSITORY
if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))
  throw new Error('GITHUB_REPOSITORY is required')
const api = (endpoint) =>
  JSON.parse(
    execFileSync(
      'gh',
      ['api', `repos/${repo}${endpoint ? '/' + endpoint : ''}`],
      {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      },
    ),
  )
class MissingArtifactError extends Error {}
async function download(workflow, names, destination, required) {
  const branch = api('').default_branch
  const runs = api(
    `actions/workflows/${workflow}/runs?status=success&branch=${encodeURIComponent(
      branch,
    )}&per_page=100`,
  ).workflow_runs
  for (const run of runs) {
    if (
      !['workflow_dispatch', 'schedule', 'push'].includes(run.event) ||
      run.head_repository.full_name !== repo
    )
      continue
    const artifacts = api(
      `actions/runs/${run.id}/artifacts?per_page=100`,
    ).artifacts
    const artifact = names
      .map((name) => artifacts.find((a) => a.name === name && !a.expired))
      .find(Boolean)
    if (!artifact) continue
    await fs.mkdir(destination, { recursive: true })
    execFileSync(
      'gh',
      [
        'run',
        'download',
        String(run.id),
        '--repo',
        repo,
        '--name',
        artifact.name,
        '--dir',
        destination,
      ],
      { stdio: 'inherit' },
    )
    if (artifact.name === 'github-pages') {
      const archive = path.join(destination, 'artifact.tar')
      const entries = execFileSync('tar', ['-tf', archive], {
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
      })
        .trim()
        .split('\n')
      if (entries.some((e) => e.startsWith('/') || e.split('/').includes('..')))
        throw new Error('Unsafe Pages archive')
      execFileSync('tar', ['-xf', archive, '-C', destination], {
        stdio: 'inherit',
      })
      await fs.unlink(archive)
    }
    console.log(`${workflow}: run ${run.id}, artifact ${artifact.name}`)
    return
  }
  if (required)
    throw new MissingArtifactError(
      `No retained publishable artifact for ${workflow}; run its nationwide publish build first`,
    )
  console.log(`${workflow}: no publishable data yet`)
}
;(async () => {
  await download(
    'search-data.yml',
    ['gsi-pages-data', 'github-pages'],
    'tmp/components/japan',
    true,
  )
  await download('osm-data.yml', ['osm-pages-data'], 'tmp/components/osm', true)
  if (process.env.GITHUB_OUTPUT)
    await fs.appendFile(process.env.GITHUB_OUTPUT, 'ready=true\n')
})().catch((e) => {
  if (e instanceof MissingArtifactError && process.env.GITHUB_OUTPUT) {
    fs.appendFile(process.env.GITHUB_OUTPUT, 'ready=false\n').catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
    console.log(
      'Waiting for both publishable datasets; the existing site is preserved. ' +
        e.message,
    )
    return
  }
  console.error(e)
  process.exitCode = 1
})
