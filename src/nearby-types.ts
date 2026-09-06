import { LngLat } from './spatial'

export type SearchKind = 'station' | 'landmark' | 'highway'
export type PlaceCategory =
  | 'station'
  | 'heritage'
  | 'park'
  | 'shrine'
  | 'temple'
  | 'ic'
  | 'sa'
  | 'pa'
  | 'smart-ic'
  | 'attraction'
  | 'viewpoint'
  | 'place-of-worship'

export interface SearchRule {
  kind: SearchKind
  radiusM: number
  /** Higher numbers win. Ties are resolved by distance, then stable ID. */
  priority: number
  categories?: PlaceCategory[]
}

export interface NearbyOptions {
  rules?: SearchRule[]
  resultMode?: 'best' | 'all'
  /** Base URL containing manifest.json. */
  dataUrl?: string
  /** Additional allowance beyond the road's estimated half width. Default 20m. */
  roadToleranceM?: number
  /** Safety budget across point and road tiles. Default 256. */
  maxTiles?: number
}

export interface NearbyPlace {
  id: string
  kind: SearchKind
  category: PlaceCategory
  name: string
  coordinates: LngLat
  distanceM: number
  priority: number
  relation: 'nearby'
}

export interface HighwayMatch {
  status: 'estimated-on-highway' | 'not-matched'
  distanceM: number | null
}

export interface NearbyResult {
  selected: NearbyPlace | null
  /** best: zero or one item; all: every matching record, sorted by priority/distance. */
  candidates: NearbyPlace[]
  highwayMatch?: HighwayMatch
  dataVersion: string
  attribution: string
}

export type PoiRecord = [string, PlaceCategory, string, number, number]
export type RoadRecord = [number, LngLat[]] // full width in metres, centerline

export interface SearchManifest {
  schemaVersion: 1 | 2
  version: string
  generatedAt: string
  source: string
  attribution: string
  /** Inclusive z12 tile rectangles: minX,minY,maxX,maxY. */
  coverage: [number, number, number, number][]
  poiTiles: string[]
  roadTiles: string[]
  /** v2 splits tile indexes into z6 shards. */
  indexTiles?: string[]
  /** Administrative tile zoom in v2 (8–12); omitted means legacy z8. */
  adminZoom?: number
  coverageGeometry?: MultiPolygon
  license?: string
}

export interface MultiPolygon {
  type: 'MultiPolygon'
  coordinates: LngLat[][][]
}

export interface SearchIndex {
  schemaVersion: 1
  poiTiles: string[]
  roadTiles: string[]
  adminTiles: string[]
}

export interface PoiTile {
  schemaVersion: 1
  points: PoiRecord[]
}
export interface RoadTile {
  schemaVersion: 1
  roads: RoadRecord[]
}

export function categoryKind(category: PlaceCategory): SearchKind {
  if (category === 'station') return 'station'
  if (
    [
      'heritage',
      'park',
      'shrine',
      'temple',
      'attraction',
      'viewpoint',
      'place-of-worship',
    ].includes(category)
  )
    return 'landmark'
  return 'highway'
}

export const PLACE_CATEGORIES: PlaceCategory[] = [
  'station',
  'heritage',
  'park',
  'shrine',
  'temple',
  'ic',
  'sa',
  'pa',
  'smart-ic',
  'attraction',
  'viewpoint',
  'place-of-worship',
]
