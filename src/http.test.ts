import http from 'http'
import { AddressInfo, Socket } from 'net'
import { gzipSync } from 'zlib'
import { fetchBytes } from './http'
import { clearNearbyCache, loadJson, validatePoiTile } from './search-data'

const sockets = new Set<Socket>()
let root: string
let failures = 0
let aborted = 0
const server = http.createServer((req, res) => {
  if (req.url === '/retry' && failures++ === 0) {
    res.writeHead(503)
    res.end('unavailable')
  } else if (req.url === '/retry') {
    res.end('{"schemaVersion":1,"points":[]}')
  } else if (req.url === '/missing') {
    res.writeHead(404)
    res.end('missing')
  } else if (req.url === '/slow') {
    res.writeHead(200)
    res.write('first chunk')
    res.on('close', () => aborted++)
  } else if (req.url === '/oversized') {
    res.writeHead(200)
    res.write('too many bytes')
    res.on('close', () => aborted++)
  } else if (req.url === '/encoded') {
    const bytes = gzipSync(Buffer.alloc(1024, 65))
    res.writeHead(200, {
      'Content-Encoding': 'gzip',
      'Content-Length': bytes.length,
    })
    res.end(bytes)
  } else if (req.url === '/broken') {
    res.writeHead(200, { 'Content-Length': 100 })
    res.write('partial')
    res.destroy()
  } else {
    res.end('日本語')
  }
})
beforeAll(async () => {
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  clearNearbyCache()
  const closed = new Promise<void>((resolve) => server.close(() => resolve()))
  for (const socket of sockets) socket.destroy()
  await closed
})

test('reads bytes at the limit without corrupting Unicode', async () => {
  expect(await fetchBytes(root, { maxBytes: 9 })).toEqual(
    new Uint8Array(Buffer.from('日本語')),
  )
})

test('rejects HTTP errors and retries failed JSON downloads without caching them', async () => {
  await expect(fetchBytes(root + '/missing')).rejects.toThrow('HTTP 404')
  await expect(loadJson(root + '/retry', validatePoiTile)).rejects.toThrow(
    'HTTP 503',
  )
  await loadJson(root + '/retry', validatePoiTile)
  await loadJson(root + '/retry', validatePoiTile)
  expect(failures).toBe(2)
})

test('times out during body reception and aborts the connection', async () => {
  const initial = aborted
  await expect(fetchBytes(root + '/slow', { timeoutMs: 100 })).rejects.toThrow(
    'timed out',
  )
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(aborted).toBeGreaterThan(initial)
})

test('bounds chunked bodies without Content-Length and aborts the connection', async () => {
  const initial = aborted
  await expect(
    fetchBytes(root + '/oversized', { maxBytes: 4 }),
  ).rejects.toThrow('too large')
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(aborted).toBeGreaterThan(initial)
})

test('applies the byte limit after HTTP decompression', async () => {
  await expect(
    fetchBytes(root + '/encoded', { maxBytes: 100 }),
  ).rejects.toThrow('too large')
})

test('rejects interrupted bodies instead of returning partial data', async () => {
  await expect(fetchBytes(root + '/broken')).rejects.toThrow()
})
