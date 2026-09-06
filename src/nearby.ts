import {
  categoryKind,
  HighwayMatch,
  NearbyOptions,
  NearbyPlace,
  NearbyResult,
  PLACE_CATEGORIES,
  SearchManifest,
  SearchRule,
} from './nearby-types'
import {
  distanceM,
  lineDistanceM,
  LngLat,
  Tile,
  tileKey,
  tilesWithin,
  validatePosition,
  boundsWithin,
} from './spatial'
import {
  loadJson,
  tileUrl,
  SearchCoverageError,
  validateManifest,
  validatePoiTile,
  validateRoadTile,
  loadTileIndex,
} from './search-data'
import { polygonCoversBounds } from './polygon'

export const DEFAULT_SEARCH_DATA_URL =
  'https://sentium.github.io/open-reverse-geocoder/data'
export const DEFAULT_SEARCH_RULES: SearchRule[] = [
  { kind: 'highway', radiusM: 5000, priority: 100 },
  { kind: 'landmark', radiusM: 1000, priority: 80 },
  { kind: 'station', radiusM: 5000, priority: 50 },
]

function validateOptions(options: NearbyOptions): void {
  const rules = options.rules ?? DEFAULT_SEARCH_RULES
  if (
    !Array.isArray(rules) ||
    rules.length > 3 ||
    new Set(rules.map((r) => r?.kind)).size !== rules.length
  )
    throw new RangeError('Specify at most one rule per kind')
  for (const rule of rules) {
    if (
      !rule ||
      !['station', 'landmark', 'highway'].includes(rule.kind) ||
      !Number.isFinite(rule.radiusM) ||
      rule.radiusM < 0 ||
      rule.radiusM > 50000 ||
      !Number.isFinite(rule.priority)
    )
      throw new RangeError('Invalid search rule (radiusM must be 0–50000)')
    if (
      rule.categories !== undefined &&
      (!Array.isArray(rule.categories) ||
        !rule.categories.length ||
        rule.categories.some(
          (c) => !PLACE_CATEGORIES.includes(c) || categoryKind(c) !== rule.kind,
        ))
    )
      throw new RangeError('Invalid categories for search kind')
  }
  if (
    options.resultMode !== undefined &&
    !['best', 'all'].includes(options.resultMode)
  )
    throw new RangeError('Invalid resultMode')
  if (
    options.roadToleranceM !== undefined &&
    (!Number.isFinite(options.roadToleranceM) ||
      options.roadToleranceM < 0 ||
      options.roadToleranceM > 100)
  )
    throw new RangeError('roadToleranceM must be 0–100')
  if (
    options.maxTiles !== undefined &&
    (!Number.isInteger(options.maxTiles) ||
      options.maxTiles < 1 ||
      options.maxTiles > 1024)
  )
    throw new RangeError('maxTiles must be 1–1024')
  if (
    options.dataUrl !== undefined &&
    (typeof options.dataUrl !== 'string' ||
      !/^https?:\/\/[^?#]+$/.test(options.dataUrl))
  )
    throw new RangeError(
      'dataUrl must be an HTTP(S) base URL without query or fragment',
    )
}

function covered(manifest: SearchManifest, tile: Tile): boolean {
  const scale = 2 ** (tile[0] - 12)
  const x = Math.floor(tile[1] / scale),
    y = Math.floor(tile[2] / scale)
  return manifest.coverage.some(
    ([left, top, right, bottom]) =>
      x >= left && x <= right && y >= top && y <= bottom,
  )
}

export async function searchNearby(
  position: LngLat,
  options: NearbyOptions = {},
): Promise<NearbyResult> {
  return searchNearbyWithManifest(position, options)
}

/** Internal entry point for a catalog-pinned immutable international version. */
export async function searchNearbyWithManifest(
  position: LngLat,
  options: NearbyOptions = {},
  pinnedManifest?: SearchManifest,
): Promise<NearbyResult> {
  validatePosition(position)
  validateOptions(options)
  const rules = (options.rules ?? DEFAULT_SEARCH_RULES)
    .map((r) => ({ ...r, categories: r.categories && [...r.categories] }))
    .sort((a, b) => b.priority - a.priority)
  if (!rules.length)
    return { selected: null, candidates: [], dataVersion: '', attribution: '' }
  const dataUrl = (options.dataUrl ?? DEFAULT_SEARCH_DATA_URL).replace(
    /\/+$/,
    '',
  )
  const manifest =
    pinnedManifest ??
    (await loadJson(`${dataUrl}/manifest.json`, validateManifest, 60000))
  const base = `${dataUrl}/${manifest.version}`
  const visited = new Set<string>()
  function prepare(tiles: Tile[], radiusM: number): void {
    const geometry = manifest.schemaVersion === 2 && manifest.coverageGeometry
    // Edge tiles contain clipped source data. Only the requested search area
    // must be complete; requiring the whole tile excludes narrow countries.
    if (
      geometry &&
      !boundsWithin(position, radiusM).every((bounds) =>
        polygonCoversBounds(geometry, bounds),
      )
    )
      throw new SearchCoverageError(
        'Search radius extends outside the published dataset coverage',
      )
    for (const t of tiles) {
      if (!geometry && !covered(manifest, t))
        throw new SearchCoverageError(
          'Search radius extends outside the published dataset coverage',
        )
      visited.add(`${t[0]}/${tileKey(t)}`)
    }
    if (visited.size > (options.maxTiles ?? 256))
      throw new RangeError('Search exceeds maxTiles; reduce the search radius')
  }
  let highwayMatch: HighwayMatch | undefined
  async function matchHighway(): Promise<boolean> {
    const tiles = tilesWithin(position, 200, 14)
    prepare(tiles, 200)
    const roadKeys = new Set(
      (await loadTileIndex(manifest, base, tiles)).roadTiles,
    )
    const roads = (
      await Promise.all(
        tiles
          .filter((t) => roadKeys.has(tileKey(t)))
          .map((t) =>
            loadJson(
              tileUrl(base, `road/14/${tileKey(t)}`, manifest),
              validateRoadTile,
            ),
          ),
      )
    ).flatMap((t) => t.roads)
    let nearest = Infinity,
      matched = Infinity
    for (const [width, line] of roads) {
      const d = lineDistanceM(position, line)
      nearest = Math.min(nearest, d)
      if (d <= width / 2 + (options.roadToleranceM ?? 20))
        matched = Math.min(matched, d)
    }
    highwayMatch = {
      status: Number.isFinite(matched) ? 'estimated-on-highway' : 'not-matched',
      distanceM: Number.isFinite(matched)
        ? matched
        : Number.isFinite(nearest)
        ? nearest
        : null,
    }
    return Number.isFinite(matched)
  }
  const candidates = new Map<string, NearbyPlace>()
  // Equal-priority rules must all be searched before selecting by distance.
  for (const priority of [...new Set(rules.map((r) => r.priority))]) {
    for (const rule of rules.filter((r) => r.priority === priority)) {
      if (rule.kind === 'highway' && !(await matchHighway())) continue
      const tiles = tilesWithin(position, rule.radiusM, 12)
      prepare(tiles, rule.radiusM)
      const poiKeys = new Set(
        (await loadTileIndex(manifest, base, tiles)).poiTiles,
      )
      const pointTiles = await Promise.all(
        tiles
          .filter((t) => poiKeys.has(tileKey(t)))
          .map((t) =>
            loadJson(
              tileUrl(base, `poi/12/${tileKey(t)}`, manifest),
              validatePoiTile,
            ),
          ),
      )
      for (const tile of pointTiles)
        for (const [id, category, name, lng, lat] of tile.points) {
          if (
            categoryKind(category) !== rule.kind ||
            (rule.categories && !rule.categories.includes(category))
          )
            continue
          const coordinates: LngLat = [lng, lat],
            distance = distanceM(position, coordinates)
          if (distance <= rule.radiusM)
            candidates.set(id, {
              id,
              category,
              kind: rule.kind,
              name,
              coordinates,
              distanceM: distance,
              priority,
              relation: 'nearby',
            })
        }
    }
    if ((options.resultMode ?? 'best') === 'best' && candidates.size) break
  }
  const sorted = [...candidates.values()].sort(
    (a, b) =>
      b.priority - a.priority ||
      a.distanceM - b.distanceM ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  const result: NearbyResult = {
    selected: sorted[0] ?? null,
    candidates: options.resultMode === 'all' ? sorted : sorted.slice(0, 1),
    dataVersion: manifest.version,
    attribution: manifest.attribution,
  }
  if (highwayMatch) result.highwayMatch = highwayMatch
  return result
}
