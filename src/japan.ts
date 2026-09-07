import { geoContains } from 'd3-geo'
import { lngLatToGoogle } from 'global-mercator'
import { PbfReader } from 'pbf'
import { loadJapanTile } from './japan-tile-cache'
import { VectorTile } from '@mapbox/vector-tile'
import { searchNearby } from './nearby'
import { NearbyOptions, NearbyResult } from './nearby-types'
export interface ReverseGeocodingResult {
  code: string
  prefecture: string
  city: string
  nearby?: NearbyResult
}

type LngLat = [number, number]

export interface ReverseGeocodingOptions {
  /** どのズームを使うか。デフォルトは 10 */
  zoomBase: number

  /** タイルが入ってるURLフォーマット。 */
  tileUrl: string

  // 検索するレイヤーのID
  layer: string
  /** Enable optional nearby searches; omitted preserves the legacy API. */
  nearby?: NearbyOptions
}

const DEFAULT_OPTIONS: ReverseGeocodingOptions = {
  zoomBase: 10,
  tileUrl: `https://sentium.github.io/open-reverse-geocoder/tiles/{z}/{x}/{y}.pbf`,
  layer: 'japanese-admins',
}

export const openReverseGeocoder: (
  input: LngLat,
  options?: Partial<ReverseGeocodingOptions>,
) => Promise<ReverseGeocodingResult> = async (lnglat, inputOptions = {}) => {
  const options: ReverseGeocodingOptions = {
    ...DEFAULT_OPTIONS,
    ...inputOptions,
  }
  const [x, y] = lngLatToGoogle(lnglat, options.zoomBase)
  const tileUrl = options.tileUrl
    .replace('{z}', String(options.zoomBase))
    .replace('{x}', String(x))
    .replace('{y}', String(y))

  const geocodingResult: ReverseGeocodingResult = {
    code: '',
    prefecture: '',
    city: '',
  }

  const buffer = await loadJapanTile(tileUrl)
  const tile = new VectorTile(new PbfReader(buffer))
  let layers = Object.keys(tile.layers)

  if (!Array.isArray(layers)) layers = [layers]

  layers.forEach((layerID) => {
    const layer = tile.layers[layerID]
    if (layer && options.layer === layer.name) {
      for (let i = 0; i < layer.length; i++) {
        const feature = layer.feature(i).toGeoJSON(x, y, options.zoomBase)
        if (!feature.properties) continue
        if (layers.length > 1) feature.properties.vt_layer = layerID

        const res = geoContains(feature, lnglat)
        if (res) {
          geocodingResult.code =
            5 === String(feature.id).length
              ? String(feature.id)
              : `0${String(feature.id)}`
          geocodingResult.prefecture = feature.properties.prefecture as string
          geocodingResult.city = feature.properties.city as string
        }
      }
    }
  })

  if (options.nearby)
    geocodingResult.nearby = await searchNearby(lnglat, options.nearby)
  return geocodingResult
}
