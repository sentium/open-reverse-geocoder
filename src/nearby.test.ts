import axios from 'axios'
import { searchNearby } from './nearby'
import {
  clearNearbyCache,
  validateManifest,
  validatePoiTile,
  validateRoadTile,
} from './search-data'
import { LngLat, distanceM, tileAt, tileKey, tilesWithin } from './spatial'
import { PoiRecord, SearchManifest, SearchRule } from './nearby-types'

jest.mock('axios', () => ({ get: jest.fn() }))
const get = axios.get as jest.Mock
const position: LngLat = [139.75, 35.68]
const base = 'https://example.test/data'
const station: SearchRule = { kind: 'station', radiusM: 5000, priority: 50 }
const landmark: SearchRule = { kind: 'landmark', radiusM: 1000, priority: 80 }
const highway: SearchRule = { kind: 'highway', radiusM: 5000, priority: 100 }
const coverage: SearchManifest['coverage'] = [[0, 0, 4095, 4095]]
let manifest: SearchManifest
let responses: Map<string, unknown>
function addPoint(p: PoiRecord) {
  const key = tileKey(tileAt([p[3], p[4]], 12)),
    url = `${base}/v1/poi/12/${key}.json`
  if (!manifest.poiTiles.includes(key)) manifest.poiTiles.push(key)
  const value = (responses.get(url) ?? { schemaVersion: 1, points: [] }) as {
    schemaVersion: number
    points: PoiRecord[]
  }
  value.points.push(p)
  responses.set(url, value)
}
function addRoad(offsetLatitude = 0) {
  const key = tileKey(tileAt(position, 14))
  manifest.roadTiles.push(key)
  responses.set(`${base}/v1/road/14/${key}.json`, {
    schemaVersion: 1,
    roads: [
      [
        20,
        [
          [139.74, 35.68 + offsetLatitude],
          [139.76, 35.68 + offsetLatitude],
        ],
      ],
    ],
  })
}
beforeEach(() => {
  clearNearbyCache()
  get.mockReset()
  manifest = {
    schemaVersion: 1,
    version: 'v1',
    generatedAt: '2026-09-06',
    source: 'GSI',
    attribution: 'GSI processed',
    coverage,
    poiTiles: [],
    roadTiles: [],
  }
  responses = new Map([[`${base}/manifest.json`, manifest]])
  get.mockImplementation(async (url: string) => {
    if (!responses.has(url)) throw new Error('HTTP 404')
    return { data: JSON.stringify(responses.get(url)) }
  })
})
const search = (rules: SearchRule[], extra = {}) =>
  searchNearby(position, { dataUrl: base, rules, ...extra })

test('priority wins, best returns one result, all returns sorted candidates', async () => {
  addPoint(['station', 'station', '近い駅', 139.7501, 35.68])
  addPoint(['temple', 'temple', '離れた寺院', 139.754, 35.68])
  expect((await search([station, landmark])).selected?.id).toBe('temple')
  const all = await search([station, landmark], { resultMode: 'all' })
  expect(all.candidates.map((p) => p.id)).toEqual(['temple', 'station'])
  expect(all.selected).toEqual(all.candidates[0])
  expect(all.attribution).toBe('GSI processed')
})

test('equal priorities use distance, then stable ID, independent of rule order', async () => {
  addPoint(['z', 'station', '駅', ...position])
  addPoint(['a', 'heritage', '史跡', ...position])
  expect(
    (await search([station, { ...landmark, priority: 50 }])).selected?.id,
  ).toBe('a')
  expect(
    (await search([{ ...landmark, priority: 50 }, station])).selected?.id,
  ).toBe('a')
})

test('searches neighboring tiles and includes exact radius boundary', async () => {
  const other: LngLat = [139.7, 35.68]
  const radiusM = distanceM(position, other)
  expect(tileKey(tileAt(other, 12))).not.toBe(tileKey(tileAt(position, 12)))
  addPoint(['edge', 'station', '境界の駅', ...other])
  expect((await search([{ ...station, radiusM }])).selected?.id).toBe('edge')
  expect(
    (await search([{ ...station, radiusM: radiusM - 0.01 }])).selected,
  ).toBeNull()
})

test('category filtering and zero radius work', async () => {
  addPoint(['park', 'park', '公園', ...position])
  addPoint(['temple', 'temple', '寺院', 139.7501, 35.68])
  expect(
    (await search([{ ...landmark, radiusM: 0, categories: ['park'] }])).selected
      ?.id,
  ).toBe('park')
  expect(
    (await search([{ ...landmark, radiusM: 0, categories: ['temple'] }]))
      .selected,
  ).toBeNull()
})

test('best skips lower priority tiles while all evaluates them', async () => {
  addPoint(['park', 'park', '公園', ...position])
  addPoint(['station', 'station', '遠い駅', 139.84, 35.68])
  const distant = `${base}/v1/poi/12/${tileKey(
    tileAt([139.84, 35.68], 12),
  )}.json`
  await search([landmark, { ...station, radiusM: 10000 }])
  expect(get.mock.calls.map((c) => c[0])).not.toContain(distant)
  await search([landmark, { ...station, radiusM: 10000 }], {
    resultMode: 'all',
  })
  expect(get.mock.calls.map((c) => c[0])).toContain(distant)
})

test('highway facilities require an estimated road match', async () => {
  addPoint(['sa', 'sa', '海老名SA', 139.751, 35.68])
  addPoint(['station', 'station', '駅', ...position])
  expect((await search([highway, station])).selected?.id).toBe('station')
  clearNearbyCache()
  addRoad()
  const result = await search([highway, station])
  expect(result.selected?.id).toBe('sa')
  expect(result.highwayMatch).toEqual({
    status: 'estimated-on-highway',
    distanceM: 0,
  })
})

test('road width and tolerance influence highway matching', async () => {
  addRoad(0.0004)
  addPoint(['ic', 'ic', 'IC', ...position])
  expect((await search([highway], { roadToleranceM: 20 })).selected).toBeNull()
  expect((await search([highway], { roadToleranceM: 40 })).selected?.id).toBe(
    'ic',
  )
})

test('empty index inside coverage is a successful no-match, listed missing file is an error', async () => {
  expect((await search([station])).selected).toBeNull()
  clearNearbyCache()
  manifest.poiTiles = [tileKey(tileAt(position, 12))]
  await expect(search([station])).rejects.toThrow('HTTP 404')
})

test('rejects a radius extending beyond dataset coverage', async () => {
  const [, x, y] = tileAt(position, 12)
  manifest.coverage = [[x, y, x, y]]
  await expect(search([station])).rejects.toThrow('outside')
})

test('does not cache failures and coalesces concurrent successful downloads', async () => {
  get.mockRejectedValueOnce(new Error('temporary failure'))
  await expect(search([station])).rejects.toThrow('temporary failure')
  addPoint(['s', 'station', '駅', ...position])
  const results = await Promise.all([search([station]), search([station])])
  expect(results.every((r) => r.selected?.id === 's')).toBe(true)
  expect(get).toHaveBeenCalledTimes(3)
  await search([{ ...station, priority: 200, radiusM: 1000 }])
  expect(get).toHaveBeenCalledTimes(3)
})

test('refreshes the manifest after its TTL and isolates dataset URLs', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(100000)
  try {
    await search([station])
    now.mockReturnValue(161000)
    await search([station])
    expect(get).toHaveBeenCalledTimes(2)
    await expect(
      searchNearby(position, {
        rules: [station],
        dataUrl: 'https://another.test/data',
      }),
    ).rejects.toThrow('another.test')
  } finally {
    now.mockRestore()
  }
})

test('tile budget is enforced before fetching point tiles', async () => {
  await expect(search([station], { maxTiles: 1 })).rejects.toThrow('maxTiles')
  expect(get).toHaveBeenCalledTimes(1)
})

test.each([NaN, Infinity, -1, 50001])(
  'rejects invalid radius %s before I/O',
  async (radiusM) => {
    await expect(search([{ ...station, radiusM }])).rejects.toThrow(RangeError)
    expect(get).not.toHaveBeenCalled()
  },
)

test('rejects invalid coordinates, rule combinations and options', async () => {
  await expect(searchNearby([181, 35], {})).rejects.toThrow(RangeError)
  await expect(search([station, station])).rejects.toThrow(RangeError)
  await expect(
    search([{ ...station, categories: ['temple'] }]),
  ).rejects.toThrow(RangeError)
  await expect(search([station], { roadToleranceM: 101 })).rejects.toThrow(
    RangeError,
  )
  await expect(search([station], { resultMode: 'wrong' })).rejects.toThrow(
    RangeError,
  )
  expect(get).not.toHaveBeenCalled()
})

test('empty rules perform no requests', async () => {
  expect((await search([])).selected).toBeNull()
  expect(get).not.toHaveBeenCalled()
})

test('deduplicates identical IDs across repeated records', async () => {
  addPoint(['s', 'station', '駅', ...position])
  addPoint(['s', 'station', '駅', ...position])
  expect(
    (await search([station], { resultMode: 'all' })).candidates,
  ).toHaveLength(1)
})

test('validates external dataset schemas and rejects path traversal', () => {
  expect(() => validateManifest({ ...manifest, version: '../bad' })).toThrow()
  expect(() =>
    validateManifest({ ...manifest, roadTiles: ['../bad'] }),
  ).toThrow()
  expect(() =>
    validatePoiTile({
      schemaVersion: 1,
      points: [['id', 'station', '駅', NaN, 0]],
    }),
  ).toThrow()
  expect(() =>
    validateRoadTile({ schemaVersion: 1, roads: [[Infinity, []]] }),
  ).toThrow()
})

test('handles antimeridian and bounds correctly', () => {
  const tiles = tilesWithin([179.999, 35], 5000, 12)
  expect(tiles.some((t) => t[1] === 0)).toBe(true)
  expect(tiles.some((t) => t[1] === 4095)).toBe(true)
  expect(distanceM([179.999, 0], [-179.999, 0])).toBeLessThan(223)
  expect(tileAt([180, 0], 12)[1]).toBe(4095)
})
