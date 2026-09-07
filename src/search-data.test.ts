import { clearNearbyCache, loadJson, validatePoiTile } from './search-data'

const get = jest.fn()
globalThis.fetch = get
beforeEach(() => {
  clearNearbyCache()
  get.mockReset()
})

test('evicts the least recently used entry when cache reaches 128 entries', async () => {
  get.mockImplementation(
    async () => new Response('{"schemaVersion":1,"points":[]}'),
  )
  for (let i = 0; i < 129; i++)
    await loadJson(`https://example.test/${i}`, validatePoiTile)
  await loadJson('https://example.test/128', validatePoiTile)
  expect(get).toHaveBeenCalledTimes(129)
  await loadJson('https://example.test/0', validatePoiTile)
  expect(get).toHaveBeenCalledTimes(130)
})

test('limits download concurrency and releases slots after failures', async () => {
  let active = 0,
    peak = 0
  get.mockImplementation(async (url: string) => {
    active++
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active--
    if (url.endsWith('/0')) throw new Error('failure')
    return new Response('{"schemaVersion":1,"points":[]}')
  })
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) =>
      loadJson(`https://example.test/${i}`, validatePoiTile),
    ),
  )
  expect(peak).toBe(4)
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(11)
  expect(results[0].status).toBe('rejected')
})

test('invalid JSON is not cached and cache clearing causes a new request', async () => {
  get
    .mockResolvedValueOnce(new Response('<html>Not JSON</html>'))
    .mockImplementation(
      async () => new Response('{"schemaVersion":1,"points":[]}'),
    )
  await expect(
    loadJson('https://example.test/tile', validatePoiTile),
  ).rejects.toThrow()
  await loadJson('https://example.test/tile', validatePoiTile)
  clearNearbyCache()
  await loadJson('https://example.test/tile', validatePoiTile)
  expect(get).toHaveBeenCalledTimes(3)
})
