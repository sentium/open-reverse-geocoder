import { gzipSync } from 'zlib'
import { decodeGzip } from './gzip'
import { clearNearbyCache, loadJson, validatePoiTile } from './search-data'

const get = jest.fn()
globalThis.fetch = get

test('decodes Unicode and rejects truncated, corrupt and concatenated gzip', () => {
  const json = '{"name":"กรุงเทพ・Hà Nội・नई दिल्ली"}'
  const encoded = gzipSync(Buffer.from(json))
  expect(decodeGzip(encoded)).toBe(json)
  expect(() => decodeGzip(encoded.subarray(0, encoded.length - 3))).toThrow()
  const corrupt = Buffer.from(encoded)
  corrupt[corrupt.length - 8] ^= 1
  expect(() => decodeGzip(corrupt)).toThrow(/checksum/)
  expect(() => decodeGzip(Buffer.concat([encoded, encoded]))).toThrow(
    /Multiple/,
  )
})

test('bounds decompression even when the footer understates the expanded size', () => {
  const encoded = gzipSync(Buffer.alloc(16 * 1024 * 1024 + 1, 65))
  expect(() => decodeGzip(encoded)).toThrow(/too large/)
  encoded.writeUInt32LE(1, encoded.length - 4)
  expect(() => decodeGzip(encoded)).toThrow(/too large/)
})

test('loads and caches gzip tiles, including HTTP-decoded responses', async () => {
  clearNearbyCache()
  get.mockReset()
  const json = '{"schemaVersion":1,"points":[]}'
  get.mockResolvedValueOnce(new Response(gzipSync(Buffer.from(json))))
  await loadJson('https://test.invalid/one.json.gz', validatePoiTile)
  await loadJson('https://test.invalid/one.json.gz', validatePoiTile)
  expect(get).toHaveBeenCalledTimes(1)
  get.mockResolvedValueOnce(new Response(json))
  await expect(
    loadJson('https://test.invalid/two.json.gz', validatePoiTile),
  ).resolves.toEqual({ schemaVersion: 1, points: [] })
  clearNearbyCache()
})
