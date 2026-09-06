const fs = require('node:fs/promises')
const { createWriteStream } = require('node:fs')
const path = require('node:path')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

// Retry temporary upstream failures without ever exposing a partial cache file.
async function downloadFile(url, filename, options = {}) {
  const request = options.fetch || fetch
  const sleep = options.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
  const temporary = filename + '.download'
  await fs.mkdir(path.dirname(filename), { recursive: true })
  for (let attempt = 0; attempt < 8; attempt++) {
    let retryable = true
    try {
      const response = await request(url, {
        signal: AbortSignal.timeout(60000),
      })
      if (!response.ok) {
        retryable =
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500
        await response.body?.cancel()
        throw new Error(`HTTP ${response.status}: ${url}`)
      }
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(temporary),
      )
      await fs.rename(temporary, filename)
      return
    } catch (error) {
      await fs.rm(temporary, { force: true })
      if (!retryable || attempt === 7) throw error
      await sleep(Math.min(60000, 1000 * 2 ** attempt))
    }
  }
}

module.exports = { downloadFile }
