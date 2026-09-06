import axios from 'axios'
import {
  PLACE_CATEGORIES,
  PoiTile,
  RoadTile,
  SearchManifest,
  SearchIndex,
} from './nearby-types'
import { validatePosition, Tile, tileKey } from './spatial'
import { validateGeometry } from './polygon'

// Both decoded data and in-flight requests are shared by all callers.
const MAX_ENTRIES = 128
const MAX_BYTES = 16 * 1024 * 1024
const cache = new Map<
  string,
  { value: unknown; expires: number; bytes: number }
>()
const pending = new Map<string, Promise<unknown>>()
let bytes = 0
let active = 0
const queue: (() => void)[] = []

export class SearchDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SearchDataError'
  }
}

/** Internal subtype: a larger published extract may satisfy this request. */
export class SearchCoverageError extends SearchDataError {}

export function clearNearbyCache(): void {
  cache.clear()
  bytes = 0
}

async function acquire(): Promise<void> {
  if (active < 4) {
    active++
    return
  }
  if (queue.length >= 1024)
    throw new SearchDataError('Too many queued search data requests')
  await new Promise<void>((resolve) => queue.push(resolve))
}

function release(): void {
  const next = queue.shift()
  if (next) next()
  else active--
}

function remember(
  url: string,
  value: unknown,
  size: number,
  ttl: number,
): void {
  if (size > MAX_BYTES) return
  while (cache.size >= MAX_ENTRIES || bytes + size > MAX_BYTES) {
    const key = cache.keys().next().value as string
    const oldest = cache.get(key)
    if (!oldest) break
    bytes -= oldest.bytes
    cache.delete(key)
  }
  cache.set(url, { value, bytes: size, expires: Date.now() + ttl })
  bytes += size
}

export async function loadJson<T>(
  url: string,
  validate: (value: unknown) => T,
  ttl = 86400000,
): Promise<T> {
  const cached = cache.get(url)
  if (cached) {
    cache.delete(url)
    if (cached.expires > Date.now()) {
      cache.set(url, cached)
      return cached.value as T
    }
    bytes -= cached.bytes
  }
  if (pending.has(url)) return pending.get(url) as Promise<T>
  const request = (async () => {
    await acquire()
    try {
      const response = await axios.get(url, {
        responseType: 'text',
        timeout: 15000,
        transformResponse: [(data: string) => data],
        maxContentLength: MAX_BYTES,
      })
      const raw =
        typeof response.data === 'string'
          ? response.data
          : JSON.stringify(response.data)
      if (raw.length * 2 > MAX_BYTES)
        throw new SearchDataError(`Search data is too large: ${url}`)
      const value = validate(JSON.parse(raw))
      remember(url, value, raw.length * 2, ttl)
      return value
    } catch (error) {
      throw new SearchDataError(
        `Could not load search data ${url}: ${String(error)}`,
      )
    } finally {
      release()
    }
  })()
  pending.set(url, request)
  try {
    return await request
  } finally {
    pending.delete(url)
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an object')
  return value as Record<string, unknown>
}

function validKeys(value: unknown, zoom: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (key) =>
        typeof key === 'string' &&
        /^\d+\/\d+$/.test(key) &&
        key.split('/').every((v) => Number(v) < 2 ** zoom),
    )
  )
}

export function validateManifest(value: unknown): SearchManifest {
  const v = record(value)
  if (
    ![1, 2].includes(v.schemaVersion as number) ||
    typeof v.version !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(v.version) ||
    typeof v.generatedAt !== 'string' ||
    typeof v.source !== 'string' ||
    typeof v.attribution !== 'string' ||
    !validKeys(v.poiTiles, 12) ||
    !validKeys(v.roadTiles, 14) ||
    !Array.isArray(v.coverage) ||
    !v.coverage.length ||
    !v.coverage.every(
      (r) =>
        Array.isArray(r) &&
        r.length === 4 &&
        r.every((n) => Number.isInteger(n) && n >= 0 && n < 4096) &&
        r[0] <= r[2] &&
        r[1] <= r[3],
    )
  )
    throw new Error('Invalid search manifest')
  if (v.schemaVersion === 2) {
    if (
      !validKeys(v.indexTiles, 6) ||
      (v.adminZoom !== undefined &&
        (!Number.isInteger(v.adminZoom) ||
          (v.adminZoom as number) < 8 ||
          (v.adminZoom as number) > 12)) ||
      v.license !== 'ODbL-1.0' ||
      (v.poiTiles as string[]).length ||
      (v.roadTiles as string[]).length
    )
      throw new Error('Invalid sharded manifest')
    validateGeometry(v.coverageGeometry)
  }
  return v as unknown as SearchManifest
}

export function validateIndex(value: unknown, adminZoom = 8): SearchIndex {
  const v = record(value)
  if (
    v.schemaVersion !== 1 ||
    !validKeys(v.poiTiles, 12) ||
    !validKeys(v.roadTiles, 14) ||
    !validKeys(v.adminTiles, adminZoom)
  )
    throw new Error('Invalid search index')
  return v as unknown as SearchIndex
}

/** Load only the z6 index shards that intersect the query. */
export async function loadTileIndex(
  manifest: SearchManifest,
  base: string,
  tiles: Tile[],
): Promise<SearchIndex> {
  if (manifest.schemaVersion === 1)
    return {
      schemaVersion: 1,
      poiTiles: manifest.poiTiles,
      roadTiles: manifest.roadTiles,
      adminTiles: [],
    }
  const available = new Set(manifest.indexTiles)
  const shards = new Set(
    tiles.map(([z, x, y]) =>
      tileKey([6, Math.floor(x / 2 ** (z - 6)), Math.floor(y / 2 ** (z - 6))]),
    ),
  )
  const values = await Promise.all(
    [...shards]
      .filter((k) => available.has(k))
      .map(async (key) => {
        const index = await loadJson(`${base}/index/6/${key}.json`, (value) =>
          validateIndex(value, manifest.adminZoom ?? 8),
        )
        for (const [zoom, keys] of [
          [12, index.poiTiles],
          [14, index.roadTiles],
          [manifest.adminZoom ?? 8, index.adminTiles],
        ] as [number, string[]][])
          if (
            keys.some(
              (k) =>
                k
                  .split('/')
                  .map((v) => Math.floor(Number(v) / 2 ** (zoom - 6)))
                  .join('/') !== key,
            )
          )
            throw new SearchDataError('Index contains tiles outside its shard')
        return index
      }),
  )
  return {
    schemaVersion: 1,
    poiTiles: values.flatMap((v) => v.poiTiles),
    roadTiles: values.flatMap((v) => v.roadTiles),
    adminTiles: values.flatMap((v) => v.adminTiles),
  }
}

export function validatePoiTile(value: unknown): PoiTile {
  const v = record(value)
  if (v.schemaVersion !== 1 || !Array.isArray(v.points))
    throw new Error('Invalid point tile')
  for (const p of v.points) {
    if (
      !Array.isArray(p) ||
      p.length !== 5 ||
      typeof p[0] !== 'string' ||
      !p[0] ||
      !PLACE_CATEGORIES.includes(p[1]) ||
      typeof p[2] !== 'string' ||
      !p[2]
    )
      throw new Error('Invalid place record')
    validatePosition([p[3], p[4]])
  }
  return v as unknown as PoiTile
}

export function validateRoadTile(value: unknown): RoadTile {
  const v = record(value)
  if (v.schemaVersion !== 1 || !Array.isArray(v.roads))
    throw new Error('Invalid road tile')
  for (const r of v.roads) {
    if (
      !Array.isArray(r) ||
      r.length !== 2 ||
      !Number.isFinite(r[0]) ||
      r[0] < 0 ||
      r[0] > 200 ||
      !Array.isArray(r[1]) ||
      r[1].length < 2
    )
      throw new Error('Invalid road record')
    r[1].forEach(validatePosition)
  }
  return v as unknown as RoadTile
}
