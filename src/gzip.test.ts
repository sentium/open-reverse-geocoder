import { gzipSync } from 'zlib'
import axios from 'axios'
import { decodeGzip } from './gzip'
import { clearNearbyCache, loadJson, validatePoiTile } from './search-data'

jest.mock('axios', () => ({ get: jest.fn() }))
const get = axios.get as jest.Mock

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
  get.mockResolvedValueOnce({ data: gzipSync(Buffer.from(json)) })
  await loadJson('https://test.invalid/one.json.gz', validatePoiTile)
  await loadJson('https://test.invalid/one.json.gz', validatePoiTile)
  expect(get).toHaveBeenCalledTimes(1)
  expect(get.mock.calls[0][1].responseType).toBe('arraybuffer')
  get.mockResolvedValueOnce({ data: Buffer.from(json) })
  await expect(
    loadJson('https://test.invalid/two.json.gz', validatePoiTile),
  ).resolves.toEqual({ schemaVersion: 1, points: [] })
  clearNearbyCache()
})
