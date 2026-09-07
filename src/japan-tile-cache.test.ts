import { loadJapanTile } from './japan-tile-cache'

const get = jest.fn()
globalThis.fetch = get
beforeEach(() => {
  get.mockReset()
  get.mockImplementation(async () => new Response(new Uint8Array([1, 2, 3])))
})

test('coalesces downloads and refreshes successful tiles after 24 hours', async () => {
  const url = 'https://example.test/ttl.pbf'
  await Promise.all([loadJapanTile(url), loadJapanTile(url)])
  expect(get).toHaveBeenCalledTimes(1)
  const now = Date.now()
  const clock = jest.spyOn(Date, 'now')
  try {
    clock.mockReturnValue(now + 86400001)
    await loadJapanTile(url)
    expect(get).toHaveBeenCalledTimes(2)
  } finally {
    clock.mockRestore()
  }
})

test('does not cache query URLs or failed requests', async () => {
  const query = 'https://example.test/query.pbf?version=1'
  await loadJapanTile(query)
  await loadJapanTile(query)
  expect(get).toHaveBeenCalledTimes(2)
  get.mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
  const url = 'https://example.test/retry.pbf'
  await expect(loadJapanTile(url)).rejects.toThrow('HTTP 503')
  await loadJapanTile(url)
  await loadJapanTile(url)
  expect(get).toHaveBeenCalledTimes(4)
})

test('evicts old tiles when the cache reaches its entry limit', async () => {
  for (let i = 0; i < 129; i++)
    await loadJapanTile(`https://example.test/entries/${i}.pbf`)
  await loadJapanTile('https://example.test/entries/128.pbf')
  expect(get).toHaveBeenCalledTimes(129)
  await loadJapanTile('https://example.test/entries/0.pbf')
  expect(get).toHaveBeenCalledTimes(130)
})

test('evicts tiles when their total byte size reaches the cache limit', async () => {
  get.mockImplementation(
    async () => new Response(new Uint8Array(9 * 1024 * 1024)),
  )
  await loadJapanTile('https://example.test/bytes/a.pbf')
  await loadJapanTile('https://example.test/bytes/b.pbf')
  await loadJapanTile('https://example.test/bytes/a.pbf')
  expect(get).toHaveBeenCalledTimes(3)
})
