import {
  openReverseGeocoder,
  ReverseGeocodingOptions,
  ReverseGeocodingResult,
} from './japan'
import { NearbyOptions, NearbyResult, MultiPolygon } from './nearby-types'
import { LngLat, tileAt, tileKey, validatePosition } from './spatial'
import {
  loadJson,
  tileUrl,
  loadTileIndex,
  SearchDataError,
  SearchCoverageError,
  validateManifest,
} from './search-data'
import { polygonContains, validateGeometry } from './polygon'
import { searchNearby, searchNearbyWithManifest } from './nearby'
import { JAPAN_ADMIN_TILES } from './japan-tiles'

export const DEFAULT_OSM_DATA_URL =
  'https://sentium.github.io/open-reverse-geocoder/osm'

export interface AdministrativeArea {
  id: string
  /** OSM admin_level; null for Japanese areas from the domestic dataset. */
  level: number | null
  name: string
  code: string | null
  countryCode: string | null
}

export interface GlobalReverseGeocodingOptions {
  /** auto uses the existing Japanese administrative data to recognize Japan. */
  source?: 'auto' | 'japan' | 'osm'
  osmDataUrl?: string
  /** Optional published extract ID; normally selected from the catalog. */
  region?: string
  /** Defaults to the same distance/priority rules as searchNearby. */
  nearby?: NearbyOptions | false
  japan?: Partial<ReverseGeocodingOptions>
}

export interface GlobalReverseGeocodingResult {
  source: 'japan' | 'osm'
  countryCode: string | null
  countryName: string | null
  /** Containing polygons, broad to narrow. No nearest-city inference. */
  administrativeAreas: AdministrativeArea[]
  /** Original domestic result, retained without mapping it to foreign levels. */
  japan?: ReverseGeocodingResult
  nearby?: NearbyResult
  dataVersion: string
  attribution: string
}

export interface OsmRegion {
  id: string
  version: string
  countryCodes: string[]
  /** Bounding boxes only select candidate extracts; exact coverage is checked next. */
  bounds: [number, number, number, number][]
}
export interface OsmCatalog {
  schemaVersion: 1
  regions: OsmRegion[]
}
interface AdminFeature extends AdministrativeArea {
  level: number
  geometry: MultiPolygon
}
interface AdminTile {
  schemaVersion: 1
  areas: AdminFeature[]
}

export class UnsupportedRegionError extends SearchDataError {
  constructor(message = 'No published dataset covers this position') {
    super(message)
    this.name = 'UnsupportedRegionError'
  }
}

export function validateCatalog(value: unknown): OsmCatalog {
  const v = value as OsmCatalog
  const id = /^[a-zA-Z0-9_-]{1,80}$/
  if (
    !v ||
    v.schemaVersion !== 1 ||
    !Array.isArray(v.regions) ||
    new Set(v.regions.map((r) => r?.id)).size !== v.regions.length
  )
    throw new Error('Invalid OSM catalog')
  for (const r of v.regions)
    if (
      !r ||
      !id.test(r.id) ||
      !id.test(r.version) ||
      !Array.isArray(r.countryCodes) ||
      !r.countryCodes.length ||
      !r.countryCodes.every((c) => /^[A-Z]{2}$/.test(c)) ||
      !Array.isArray(r.bounds) ||
      !r.bounds.length ||
      !r.bounds.every(
        (b) =>
          Array.isArray(b) &&
          b.length === 4 &&
          b.every(Number.isFinite) &&
          b[0] >= -180 &&
          b[2] <= 180 &&
          b[1] >= -90 &&
          b[3] <= 90 &&
          b[0] < b[2] &&
          b[1] < b[3],
      )
    )
      throw new Error('Invalid OSM region')
  return v
}

export function validateAdminTile(value: unknown): AdminTile {
  const v = value as AdminTile
  if (!v || v.schemaVersion !== 1 || !Array.isArray(v.areas))
    throw new Error('Invalid administrative tile')
  for (const a of v.areas) {
    if (
      !a ||
      typeof a.id !== 'string' ||
      !a.id ||
      !Number.isInteger(a.level) ||
      a.level < 2 ||
      a.level > 12 ||
      typeof a.name !== 'string' ||
      !a.name ||
      !(a.code === null || typeof a.code === 'string') ||
      !(a.countryCode === null || /^[A-Z]{2}$/.test(a.countryCode))
    )
      throw new Error('Invalid administrative area')
    validateGeometry(a.geometry)
  }
  return v
}

export async function reverseGeocode(
  position: LngLat,
  options: GlobalReverseGeocodingOptions = {},
): Promise<GlobalReverseGeocodingResult> {
  validatePosition(position)
  const source = options.source ?? 'auto'
  if (!['auto', 'japan', 'osm'].includes(source))
    throw new RangeError('Invalid source')
  if (
    options.region !== undefined &&
    !/^[a-zA-Z0-9_-]{1,80}$/.test(options.region)
  )
    throw new RangeError('Invalid region ID')
  const root = (options.osmDataUrl ?? DEFAULT_OSM_DATA_URL).replace(/\/+$/, '')
  if (!/^https?:\/\/[^?#]+$/.test(root))
    throw new RangeError('Invalid osmDataUrl')
  if (
    source === 'japan' ||
    (source === 'auto' && JAPAN_ADMIN_TILES.has(tileKey(tileAt(position, 10))))
  ) {
    const japan = await openReverseGeocoder(position, {
      ...options.japan,
      nearby: undefined,
    })
    if (japan.code) {
      const nearby =
        options.nearby === false
          ? undefined
          : await searchNearby(
              position,
              options.nearby ?? options.japan?.nearby,
            )
      return {
        source: 'japan',
        countryCode: 'JP',
        countryName: '日本',
        administrativeAreas: [
          {
            id: 'country:JP',
            level: null,
            name: '日本',
            code: 'JP',
            countryCode: 'JP',
          },
          {
            id: `jp-prefecture:${japan.code.slice(0, 2)}`,
            level: null,
            name: japan.prefecture,
            code: japan.code.slice(0, 2),
            countryCode: null,
          },
          {
            id: `jp-municipality:${japan.code}`,
            level: null,
            name: japan.city,
            code: japan.code,
            countryCode: null,
          },
        ],
        japan,
        ...(nearby ? { nearby } : {}),
        dataVersion: nearby?.dataVersion ?? '',
        attribution: [
          '国土数値情報（行政区域）を加工して作成 https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-v2_4.html',
          nearby?.attribution,
        ]
          .filter(Boolean)
          .join('\n'),
      }
    }
    if (source === 'japan')
      throw new UnsupportedRegionError(
        'Position is outside the Japanese administrative dataset',
      )
  }
  const catalog = await loadJson(`${root}/catalog.json`, validateCatalog, 60000)
  const candidates = catalog.regions
    .filter(
      (r) =>
        (!options.region || r.id === options.region) &&
        r.bounds.some(
          ([w, s, e, n]) =>
            position[0] >= w &&
            position[0] <= e &&
            position[1] >= s &&
            position[1] <= n,
        ),
    )
    .sort((a, b) => a.id.localeCompare(b.id))
  let coverageError: SearchCoverageError | undefined
  let unresolved: GlobalReverseGeocodingResult | undefined
  for (const region of candidates) {
    const dataUrl = `${root}/${region.id}`
    const base = `${dataUrl}/${region.version}`
    const manifest = await loadJson(`${base}/manifest.json`, validateManifest)
    if (
      manifest.version !== region.version ||
      manifest.schemaVersion !== 2 ||
      !manifest.coverageGeometry
    )
      throw new SearchDataError('Catalog and dataset version do not match')
    if (!polygonContains(manifest.coverageGeometry, position)) continue
    const adminZoom = manifest.adminZoom ?? 8
    const tile = tileAt(position, adminZoom),
      key = tileKey(tile)
    const index = await loadTileIndex(manifest, base, [tile])
    const admin = index.adminTiles.includes(key)
      ? await loadJson(
          tileUrl(base, `admin/${adminZoom}/${key}`, manifest),
          validateAdminTile,
        )
      : { areas: [] }
    const areas = admin.areas
      .filter((a) => polygonContains(a.geometry, position))
      .sort((a, b) => a.level - b.level || a.id.localeCompare(b.id))
    const country = areas.find((a) => a.level === 2 && a.countryCode)
    // Even explicit OSM queries must not replace the domestic source.
    if (country?.countryCode === 'JP')
      throw new UnsupportedRegionError('Use the Japanese data source for Japan')
    if (
      country?.countryCode &&
      !region.countryCodes.includes(country.countryCode)
    )
      continue
    let nearby: NearbyResult | undefined
    try {
      nearby =
        options.nearby === false
          ? undefined
          : await searchNearbyWithManifest(
              position,
              { ...options.nearby, dataUrl },
              manifest,
            )
    } catch (error) {
      if (error instanceof SearchCoverageError && !options.region) {
        coverageError = error
        continue
      }
      throw error
    }
    const result: GlobalReverseGeocodingResult = {
      source: 'osm',
      countryCode: country?.countryCode ?? null,
      countryName: country?.name ?? null,
      administrativeAreas: areas.map(
        ({ id, level, name, code, countryCode }) => ({
          id,
          level,
          name,
          code,
          countryCode,
        }),
      ),
      ...(nearby ? { nearby } : {}),
      dataVersion: manifest.version,
      attribution: manifest.attribution,
    }
    // An overlapping extract can contain local areas but lack the country's
    // boundary (e.g. Northern Ireland in an Ireland extract). Prefer another
    // extract that can identify the country; retain partial results if none can.
    if (country?.countryCode || options.region) return result
    if (!unresolved) unresolved = result
  }
  if (unresolved) return unresolved
  throw coverageError ?? new UnsupportedRegionError()
}
