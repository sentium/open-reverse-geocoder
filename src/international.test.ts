import axios from 'axios'
import {
  reverseGeocode,
  UnsupportedRegionError,
  validateCatalog,
} from './international'
import { clearNearbyCache, validateManifest } from './search-data'
import { MultiPolygon } from './nearby-types'
import { polygonContains, polygonCoversTile } from './polygon'
import { tileAt, tileKey, lineDistanceM } from './spatial'
import { openReverseGeocoder } from './japan'

jest.mock('axios', () => ({ get: jest.fn() }))
jest.mock('./japan', () => ({ openReverseGeocoder: jest.fn() }))
const get = axios.get as jest.Mock
const japan = openReverseGeocoder as jest.Mock
const root = 'https://test.invalid/osm'
const position: [number, number] = [-77.006, 38.897]
const geometry: MultiPolygon = {
  type: 'MultiPolygon',
  coordinates: [
    [
      [
        [-78, 38],
        [-76, 38],
        [-76, 40],
        [-78, 40],
        [-78, 38],
      ],
    ],
  ],
}
let data: Map<string, unknown>
const key = (z: number) => tileKey(tileAt(position, z))
beforeEach(() => {
  clearNearbyCache()
  get.mockReset()
  japan.mockReset()
  data = new Map([
    [
      root + '/catalog.json',
      {
        schemaVersion: 1,
        regions: [
          {
            id: 'us',
            version: 'v1',
            countryCodes: ['US'],
            bounds: [[-78, 38, -76, 40]],
          },
        ],
      },
    ],
    [
      root + '/us/v1/manifest.json',
      {
        schemaVersion: 2,
        version: 'v1',
        generatedAt: '2026-09-06',
        source: 'OSM',
        attribution: '© OpenStreetMap contributors',
        license: 'ODbL-1.0',
        coverage: [[0, 0, 4095, 4095]],
        coverageGeometry: geometry,
        poiTiles: [],
        roadTiles: [],
        indexTiles: [key(6)],
      },
    ],
    [
      root + `/us/v1/index/6/${key(6)}.json`,
      {
        schemaVersion: 1,
        poiTiles: [key(12)],
        roadTiles: [],
        adminTiles: [key(8)],
      },
    ],
    [
      root + `/us/v1/poi/12/${key(12)}.json`,
      {
        schemaVersion: 1,
        points: [
          ['osm:node:1', 'station', 'Union Station', ...position],
          ['osm:node:2', 'attraction', 'Museum', -77.005, 38.897],
        ],
      },
    ],
    [
      root + `/us/v1/admin/8/${key(8)}.json`,
      {
        schemaVersion: 1,
        areas: [
          {
            id: 'osm:relation:1',
            level: 2,
            name: 'United States',
            code: 'US',
            countryCode: 'US',
            geometry,
          },
          {
            id: 'osm:relation:2',
            level: 8,
            name: 'Test city',
            code: null,
            countryCode: null,
            geometry,
          },
        ],
      },
    ],
  ])
  get.mockImplementation(async (url: string) => {
    if (!data.has(url)) throw Error('404')
    return { data: JSON.stringify(data.get(url)) }
  })
})
const options = {
  osmDataUrl: root,
  nearby: { rules: [{ kind: 'station' as const, radiusM: 5000, priority: 1 }] },
}
test('reads finer administrative tiles using the manifest zoom', async () => {
  const manifest = data.get(root + '/us/v1/manifest.json') as Record<
    string,
    unknown
  >
  data.set(root + '/us/v1/manifest.json', { ...manifest, adminZoom: 10 })
  const index = data.get(root + `/us/v1/index/6/${key(6)}.json`) as Record<
    string,
    unknown
  >
  data.set(root + `/us/v1/index/6/${key(6)}.json`, {
    ...index,
    adminTiles: [key(10)],
  })
  data.set(
    root + `/us/v1/admin/10/${key(10)}.json`,
    data.get(root + `/us/v1/admin/8/${key(8)}.json`),
  )
  data.delete(root + `/us/v1/admin/8/${key(8)}.json`)
  const result = await reverseGeocode(position, options)
  expect(result.countryCode).toBe('US')
  expect(result.nearby?.selected?.name).toBe('Union Station')
  expect(get.mock.calls.some(([url]) => url.includes('/admin/8/'))).toBe(false)
})
test.each([null, 7, 13, 8.5, '10'])(
  'rejects invalid administrative zoom %p',
  (adminZoom) => {
    const manifest = data.get(root + '/us/v1/manifest.json') as Record<
      string,
      unknown
    >
    expect(() => validateManifest({ ...manifest, adminZoom })).toThrow(
      'Invalid sharded manifest',
    )
  },
)
test('global API returns containing administrative hierarchy and nearby station, with a pinned version', async () => {
  const result = await reverseGeocode(position, options)
  expect(result.countryCode).toBe('US')
  expect(result.administrativeAreas.map((a) => a.level)).toEqual([2, 8])
  expect(result.nearby?.selected?.name).toBe('Union Station')
  expect(result.dataVersion).toBe('v1')
  expect(japan).not.toHaveBeenCalled()
  const calls = get.mock.calls.length
  await reverseGeocode(position, {
    ...options,
    nearby: { rules: [{ kind: 'station', radiusM: 1000, priority: 99 }] },
  })
  expect(get.mock.calls.length).toBe(calls)
  expect(get.mock.calls.some(([u]) => u.endsWith('/us/manifest.json'))).toBe(
    false,
  )
})
test('unknown region is distinct from failed downloads and known empty data', async () => {
  await expect(reverseGeocode([0, 0], options)).rejects.toBeInstanceOf(
    UnsupportedRegionError,
  )
  data.delete(root + `/us/v1/admin/8/${key(8)}.json`)
  await expect(reverseGeocode(position, options)).rejects.toThrow(
    'Could not load',
  )
  clearNearbyCache()
  data.set(root + `/us/v1/admin/8/${key(8)}.json`, {
    schemaVersion: 1,
    areas: [],
  })
  const result = await reverseGeocode(position, { ...options, nearby: false })
  expect(result.countryCode).toBeNull()
  expect(result.administrativeAreas).toEqual([])
})
test('priority and additional landmark categories use the same search engine', async () => {
  const result = await reverseGeocode(position, {
    ...options,
    nearby: {
      rules: [
        { kind: 'station', radiusM: 1000, priority: 1 },
        {
          kind: 'landmark',
          radiusM: 1000,
          priority: 2,
          categories: ['attraction'],
        },
      ],
    },
  })
  expect(result.nearby?.selected?.name).toBe('Museum')
})
test('Japan auto routing preserves the legacy result and does not fetch OSM', async () => {
  japan.mockResolvedValue({
    code: '13101',
    prefecture: '東京都',
    city: '千代田区',
  })
  const result = await reverseGeocode([139.767, 35.681], { nearby: false })
  expect(result.source).toBe('japan')
  expect(result.administrativeAreas.map((a) => a.name)).toEqual([
    '日本',
    '東京都',
    '千代田区',
  ])
  expect(result.attribution).toContain('国土数値情報')
  expect(result.japan).toEqual({
    code: '13101',
    prefecture: '東京都',
    city: '千代田区',
  })
  expect(get).not.toHaveBeenCalled()
})
test('a domestic request failure is never silently replaced by OSM', async () => {
  japan.mockRejectedValue(Error('Domestic network failure'))
  await expect(
    reverseGeocode([139.767, 35.681], { nearby: false }),
  ).rejects.toThrow('Domestic network failure')
  expect(get).not.toHaveBeenCalled()
})
test('polygon holes, winding and source coverage cuts are respected', () => {
  const hole = {
    ...geometry,
    coordinates: [
      [
        geometry.coordinates[0][0],
        [
          [-77.1, 38.8],
          [-77, 38.8],
          [-77, 39],
          [-77.1, 39],
          [-77.1, 38.8],
        ],
      ],
    ],
  } as MultiPolygon
  expect(polygonContains(hole, [-77.05, 38.9])).toBe(false)
  expect(polygonContains(geometry, [-77.05, 38.9])).toBe(true)
  expect(
    polygonContains(
      {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map((p) =>
          p.map((r) => [...r].reverse()),
        ),
      },
      position,
    ),
  ).toBe(true)
  expect(polygonCoversTile(geometry, tileAt(position, 12))).toBe(true)
  const smallHole = {
    type: 'MultiPolygon',
    coordinates: [
      [
        geometry.coordinates[0][0],
        [
          [-77.0061, 38.8971],
          [-77.0059, 38.8971],
          [-77.0059, 38.8972],
          [-77.0061, 38.8972],
          [-77.0061, 38.8971],
        ],
      ],
    ],
  } as MultiPolygon
  expect(polygonCoversTile(smallHole, tileAt(position, 12))).toBe(false)
})
test('catalog cannot select path-traversing dataset IDs', () => {
  expect(() =>
    validateCatalog({
      schemaVersion: 1,
      regions: [
        {
          id: '../data',
          version: 'v1',
          countryCodes: ['US'],
          bounds: [[-78, 38, -76, 40]],
        },
      ],
    }),
  ).toThrow()
})
test('a search crossing the extract coverage fails instead of reporting incomplete nearest results', async () => {
  await expect(
    reverseGeocode([-77.99, 38.897], {
      ...options,
      nearby: { rules: [{ kind: 'station', radiusM: 50000, priority: 1 }] },
    }),
  ).rejects.toThrow('coverage')
})

test('road distance works across the antimeridian', () => {
  expect(
    lineDistanceM(
      [-179.9999, 0],
      [
        [179.999, 0],
        [180, 0],
      ],
    ),
  ).toBeLessThan(12)
  expect(
    lineDistanceM(
      [179.9999, 0],
      [
        [-180, 0],
        [-179.999, 0],
      ],
    ),
  ).toBeLessThan(12)
})

test('automatic region selection tries a larger extract when a smaller one cannot cover the radius', async () => {
  const catalog = data.get(root + '/catalog.json') as {
    regions: {
      id: string
      version: string
      countryCodes: string[]
      bounds: number[][]
    }[]
  }
  catalog.regions.unshift({ ...catalog.regions[0], id: 'a-small' })
  for (const [url, value] of [...data.entries()]) {
    if (url.startsWith(root + '/us/'))
      data.set(
        url.replace('/us/', '/a-small/'),
        JSON.parse(JSON.stringify(value)),
      )
  }
  const small = data.get(root + '/a-small/v1/manifest.json') as {
    coverageGeometry: MultiPolygon
  }
  small.coverageGeometry = {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [-77.007, 38.896],
          [-77.005, 38.896],
          [-77.005, 38.898],
          [-77.007, 38.898],
          [-77.007, 38.896],
        ],
      ],
    ],
  }
  expect((await reverseGeocode(position, options)).nearby?.selected?.name).toBe(
    'Union Station',
  )
  await expect(
    reverseGeocode(position, { ...options, region: 'a-small' }),
  ).rejects.toThrow('coverage')
})

test('small searches in narrow extracts do not require a whole POI tile, but still reject holes', async () => {
  const manifest = data.get(root + '/us/v1/manifest.json') as {
    coverageGeometry: MultiPolygon
  }
  const [x, y] = position
  manifest.coverageGeometry = {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [x - 0.002, y - 0.002],
          [x + 0.002, y - 0.002],
          [x + 0.002, y + 0.002],
          [x - 0.002, y + 0.002],
          [x - 0.002, y - 0.002],
        ],
      ],
    ],
  }
  const nearby = {
    rules: [{ kind: 'station' as const, radiusM: 100, priority: 1 }],
  }
  expect(
    polygonCoversTile(manifest.coverageGeometry, tileAt(position, 12)),
  ).toBe(false)
  expect(
    (await reverseGeocode(position, { ...options, nearby })).nearby?.selected
      ?.name,
  ).toBe('Union Station')
  clearNearbyCache()
  manifest.coverageGeometry.coordinates[0].push([
    [x + 0.0005, y + 0.0005],
    [x + 0.0006, y + 0.0005],
    [x + 0.0006, y + 0.0006],
    [x + 0.0005, y + 0.0006],
    [x + 0.0005, y + 0.0005],
  ])
  await expect(
    reverseGeocode(position, { ...options, nearby }),
  ).rejects.toThrow('coverage')
})

test('catalog entries can point to another static origin without fetching country files from Pages', async () => {
  const catalog = data.get(root + '/catalog.json') as {
    regions: { dataUrl?: string }[]
  }
  const origin = 'https://tiles.invalid/osm/us'
  catalog.regions[0].dataUrl = origin
  for (const [url, value] of [...data.entries()]) {
    if (url.startsWith(root + '/us/')) {
      data.set(url.replace(root + '/us', origin), value)
      data.delete(url)
    }
  }
  expect((await reverseGeocode(position, options)).nearby?.selected?.name).toBe(
    'Union Station',
  )
  expect(get.mock.calls.some(([url]) => url.startsWith(origin))).toBe(true)
  expect(get.mock.calls.some(([url]) => url.startsWith(root + '/us/'))).toBe(
    false,
  )
  catalog.regions[0].dataUrl = 'https://tiles.invalid/osm?secret=value'
  expect(() => validateCatalog(catalog)).toThrow('Invalid OSM region')
})
