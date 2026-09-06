import { LngLat, Tile } from './spatial'
import { MultiPolygon } from './nearby-types'

// GeoJSON ring orientation is deliberately irrelevant. Geometries are split
// at the antimeridian by the data builder before reaching this module.
function onSegment(p: LngLat, a: LngLat, b: LngLat): boolean {
  const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])
  return (
    Math.abs(cross) < 1e-10 &&
    p[0] >= Math.min(a[0], b[0]) &&
    p[0] <= Math.max(a[0], b[0]) &&
    p[1] >= Math.min(a[1], b[1]) &&
    p[1] <= Math.max(a[1], b[1])
  )
}

function ringContains(p: LngLat, ring: LngLat[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j],
      b = ring[i]
    if (onSegment(p, a, b)) return true
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside
  }
  return inside
}

export function polygonContains(geometry: MultiPolygon, p: LngLat): boolean {
  return geometry.coordinates.some(
    (rings) =>
      ringContains(p, rings[0]) &&
      !rings.slice(1).some((r) => ringContains(p, r)),
  )
}

export function validateGeometry(value: unknown): MultiPolygon {
  const g = value as MultiPolygon
  if (
    !g ||
    g.type !== 'MultiPolygon' ||
    !Array.isArray(g.coordinates) ||
    !g.coordinates.length
  )
    throw new Error('Invalid coverage geometry')
  for (const poly of g.coordinates) {
    if (!Array.isArray(poly) || !poly.length) throw new Error('Invalid polygon')
    for (const ring of poly) {
      if (!Array.isArray(ring) || ring.length < 4)
        throw new Error('Invalid ring')
      for (const p of ring)
        if (
          !Array.isArray(p) ||
          p.length !== 2 ||
          !p.every(Number.isFinite) ||
          Math.abs(p[0]) > 180 ||
          Math.abs(p[1]) > 90
        )
          throw new Error('Invalid polygon coordinate')
      if (
        ring[0][0] !== ring[ring.length - 1][0] ||
        ring[0][1] !== ring[ring.length - 1][1]
      )
        throw new Error('Unclosed ring')
    }
  }
  return g
}

export function tileBounds([z, x, y]: Tile): [number, number, number, number] {
  const n = 2 ** z
  const lat = (v: number) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * v) / n))) * 180) / Math.PI
  return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)]
}

/** Conservative coverage check: corners alone would miss holes and narrow cuts. */
export function polygonCoversTile(g: MultiPolygon, tile: Tile): boolean {
  return polygonCoversBounds(g, tileBounds(tile))
}

export function polygonCoversBounds(
  g: MultiPolygon,
  [w, s, e, n]: [number, number, number, number],
): boolean {
  const corners: LngLat[] = [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
  ]
  if (!corners.every((p) => polygonContains(g, p))) return false
  for (const poly of g.coordinates)
    for (const ring of poly) {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1],
          b = ring[i]
        // Liang–Barsky against the *open* rectangle: any boundary in its
        // interior means this rectangle cannot be certified as entirely covered.
        let lo = 0,
          hi = 1
        for (let axis = 0; axis < 2; axis++) {
          const min = axis ? s : w,
            max = axis ? n : e,
            d = b[axis] - a[axis]
          if (!d) {
            if (a[axis] <= min || a[axis] >= max) hi = -1
          } else {
            const t0 = (min - a[axis]) / d,
              t1 = (max - a[axis]) / d
            lo = Math.max(lo, Math.min(t0, t1))
            hi = Math.min(hi, Math.max(t0, t1))
          }
        }
        if (lo < hi && hi > 0 && lo < 1) return false
      }
    }
  return true
}
