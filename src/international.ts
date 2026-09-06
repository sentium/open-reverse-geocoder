import {
  openReverseGeocoder,
  ReverseGeocodingOptions,
  ReverseGeocodingResult,
} from './japan'
import { NearbyOptions, NearbyResult, MultiPolygon } from './nearby-types'
import { LngLat, tileAt, tileKey, validatePosition } from './spatial'
import {
  loadJson,
  loadTileIndex,
  SearchDataError,
  validateManifest,
} from './search-data'
import { polygonContains, validateGeometry } from './polygon'
import { searchNearby, searchNearbyWithManifest } from './nearby'
import { JAPAN_ADMIN_TILES } from './japan-tiles'

export const DEFAULT_OSM_DATA_URL =
  'https://sentium.github.io/open-reverse-geocoder/osm'

export interface AdministrativeArea {
  id: string
  /** OSM admin_level; meanings differ between countries. */
  level: number
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
  source: 'gsi' | 'osm'
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
        source: 'gsi',
        countryCode: 'JP',
        countryName: '日本',
        administrativeAreas: [],
        japan,
        ...(nearby ? { nearby } : {}),
        dataVersion: nearby?.dataVersion ?? '',
        attribution: nearby?.attribution ?? '国土地理院データを加工して作成',
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
    const tile = tileAt(position, 8),
      key = tileKey(tile)
    const index = await loadTileIndex(manifest, base, [tile])
    const admin = index.adminTiles.includes(key)
      ? await loadJson(`${base}/admin/8/${key}.json`, validateAdminTile)
      : { areas: [] }
    const areas = admin.areas
      .filter((a) => polygonContains(a.geometry, position))
      .sort((a, b) => a.level - b.level || a.id.localeCompare(b.id))
    const country = areas.find((a) => a.level === 2 && a.countryCode)
    // Even explicit OSM queries must not replace the domestic source.
    if (country?.countryCode === 'JP')
      throw new UnsupportedRegionError('Use the Japanese data source for Japan')
    const nearby =
      options.nearby === false
        ? undefined
        : await searchNearbyWithManifest(
            position,
            { ...options.nearby, dataUrl },
            manifest,
          )
    return {
      source: 'osm',
      countryCode: country?.countryCode ?? null,
      countryName: country?.name ?? null,
      administrativeAreas: areas.map(({ geometry: _geometry, ...a }) => a),
      ...(nearby ? { nearby } : {}),
      dataVersion: manifest.version,
      attribution: manifest.attribution,
    }
  }
  throw new UnsupportedRegionError()
}
