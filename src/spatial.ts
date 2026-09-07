export type LngLat = [number, number]
export type Tile = [number, number, number]
export const EARTH_RADIUS = 6371008.8
const RAD = Math.PI / 180
const MAX_LAT = 85.0511287798066

export function validatePosition(position: LngLat): void {
  if (
    !Array.isArray(position) ||
    position.length !== 2 ||
    !position.every(Number.isFinite) ||
    Math.abs(position[0]) > 180 ||
    Math.abs(position[1]) > MAX_LAT
  ) {
    throw new RangeError(
      'Expected [longitude, latitude] within Web Mercator bounds',
    )
  }
}

export function tileAt([lng, lat]: LngLat, zoom: number): Tile {
  const n = 2 ** zoom
  return [
    zoom,
    Math.min(n - 1, Math.max(0, Math.floor(((lng + 180) / 360) * n))),
    Math.min(
      n - 1,
      Math.max(
        0,
        Math.floor(((1 - Math.asinh(Math.tan(lat * RAD)) / Math.PI) / 2) * n),
      ),
    ),
  ]
}

export function tileKey(tile: Tile): string {
  return `${tile[1]}/${tile[2]}`
}

export function tilesWithin(
  position: LngLat,
  radiusM: number,
  zoom: number,
): Tile[] {
  const output = new Map<string, Tile>()
  for (const [left, south, right, north] of boundsWithin(position, radiusM)) {
    const [, x0, y0] = tileAt([left, north], zoom)
    const [, x1, y1] = tileAt([right, south], zoom)
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const t: Tile = [zoom, x, y]
        output.set(tileKey(t), t)
      }
  }
  return [...output.values()]
}

/** Rectangles enclosing a search circle, split at the antimeridian. */
export function boundsWithin(
  position: LngLat,
  radiusM: number,
): [number, number, number, number][] {
  const [lng, lat] = position
  const angular = radiusM / EARTH_RADIUS
  const latDelta = angular / RAD
  const lonDelta =
    Math.asin(Math.min(1, Math.sin(angular) / Math.cos(lat * RAD))) / RAD
  const west = lng - lonDelta
  const east = lng + lonDelta
  const intervals =
    west < -180
      ? [
          [west + 360, 180],
          [-180, east],
        ]
      : east > 180
        ? [
            [west, 180],
            [-180, east - 360],
          ]
        : [[west, east]]
  const north = Math.min(MAX_LAT, lat + latDelta)
  const south = Math.max(-MAX_LAT, lat - latDelta)
  return intervals.map(([left, right]) => [left, south, right, north])
}

export function distanceM(a: LngLat, b: LngLat): number {
  const h =
    Math.sin(((b[1] - a[1]) * RAD) / 2) ** 2 +
    Math.cos(a[1] * RAD) *
      Math.cos(b[1] * RAD) *
      Math.sin(((b[0] - a[0]) * RAD) / 2) ** 2
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(Math.min(1, h)))
}

/** Local projection for nearby road segments, not a route distance. */
export function lineDistanceM(position: LngLat, line: LngLat[]): number {
  const kx = EARTH_RADIUS * RAD * Math.cos(position[1] * RAD)
  const ky = EARTH_RADIUS * RAD
  let best = Infinity
  const longitudeDelta = (longitude: number) =>
    ((longitude - position[0] + 540) % 360) - 180
  for (let i = 1; i < line.length; i++) {
    const ax = longitudeDelta(line[i - 1][0]) * kx
    const ay = (line[i - 1][1] - position[1]) * ky
    const bx = longitudeDelta(line[i][0]) * kx
    const by = (line[i][1] - position[1]) * ky
    const dx = bx - ax,
      dy = by - ay
    const length = dx * dx + dy * dy
    const t = length
      ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length))
      : 0
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
  }
  return best
}
