import { URL } from 'url'
import fs from 'fs'
import path from 'path'

const get = jest.fn(async (input: RequestInfo | URL) => {
  const url = String(input)
  const tile = new URL(url).pathname.split('/tiles/')[1]
  if (!tile) throw new Error(`Unexpected search data request: ${url}`)
  return new Response(
    fs.readFileSync(path.join(__dirname, '../docs/tiles', tile)),
  )
})
globalThis.fetch = get

import { openReverseGeocoder as geocoder } from './main'

test('東京駅 [139.7673068, 35.6809591]', async () => {
  const res = await geocoder([139.7673068, 35.6809591])
  expect(res).toStrictEqual({
    code: '13101',
    prefecture: '東京都',
    city: '千代田区',
  })
})

test('大阪駅 [135.4983028, 34.7055051]', async () => {
  const res = await geocoder([135.4983028, 34.7055051])
  expect(res).toStrictEqual({
    code: '27127',
    prefecture: '大阪府',
    city: '大阪市北区',
  })
})

test('串本町 [135.781478, 33.472551]', async () => {
  const res = await geocoder([135.781478, 33.472551])
  expect(res).toStrictEqual({
    code: '30428',
    prefecture: '和歌山県',
    city: '東牟婁郡串本町',
  })
})

test('北海道羅臼町 [145.189681, 44.021866]', async () => {
  const res = await geocoder([145.189681, 44.021866])
  expect(res).toStrictEqual({
    code: '01694',
    prefecture: '北海道',
    city: '目梨郡羅臼町',
  })
})

test('八丈町 [139.785231, 33.115122]', async () => {
  const res = await geocoder([139.785231, 33.115122])
  expect(res).toStrictEqual({
    code: '13401',
    prefecture: '東京都',
    city: '八丈町',
  })
})

test('2024年の区再編後の浜松駅は浜松市中央区（22138）', async () => {
  const res = await geocoder([137.7345, 34.7038])
  expect(res).toStrictEqual({
    code: '22138',
    prefecture: '静岡県',
    city: '浜松市中央区',
  })
})

test('旧浜北区の浜北駅は浜松市浜名区（22139）', async () => {
  const res = await geocoder([137.7845, 34.7917])
  expect(res).toStrictEqual({
    code: '22139',
    prefecture: '静岡県',
    city: '浜松市浜名区',
  })
})

test('legacy calls do not request optional search data', async () => {
  await geocoder([139.7673068, 35.6809591])
  expect(get.mock.calls.every(([url]) => String(url).includes('/tiles/'))).toBe(
    true,
  )
})

test('optional nearby result is included only when requested', async () => {
  const result = await geocoder([139.7673068, 35.6809591], {
    nearby: { rules: [] },
  })
  expect(result.city).toBe('千代田区')
  expect(result.nearby?.selected).toBeNull()
})
