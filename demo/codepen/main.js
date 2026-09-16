import { reverseGeocode } from '../../src/main'

// This repository's library is bundled below the demo when building for CodePen.
// All search data comes from sentium's published GitHub Pages datasets.
const DATA = 'https://sentium.github.io/open-reverse-geocoder'
const $ = (id) => document.getElementById(id)
const samples = [
  ['東京駅 / 日本', 139.7673068, 35.6809591],
  ['Union Station / 米国', -77.0065, 38.8977],
  ['台北駅 / 台湾', 121.517, 25.0478],
  ['ソウル駅 / 韓国', 126.9707, 37.5547],
  ['Gambir / インドネシア', 106.8303, -6.1767],
  ['New Delhi / インド', 77.2195, 28.6428],
  ['Hanoi / ベトナム', 105.8412, 21.025],
  ['Doroteo Jose / フィリピン', 120.9826, 14.6054],
  ['Hua Lamphong / タイ', 100.5172, 13.7383],
  ['Luz / ブラジル', -46.6353, -23.535],
  ['Buenavista / メキシコ', -99.1524, 19.447],
  ['Berlin Hauptbahnhof / ドイツ', 13.3695, 52.5251],
  ['Roma Termini / イタリア', 12.5018, 41.901],
  ['Romanian Athenaeum / ルーマニア', 26.0971, 44.4413],
  ['Exit 10 / 米国・高速道路', -77.0140866, 38.8938824],
]
for (const [index, sample] of samples.entries()) {
  $('sample').add(new Option(sample[0], String(index)))
}
const map = L.map('map').setView([35.6809591, 139.7673068], 15)
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map)
const origin = L.circleMarker([35.6809591, 139.7673068], {
  radius: 8,
  color: '#fff',
  weight: 3,
  fillColor: '#223b67',
  fillOpacity: 1,
}).addTo(map)
const facilities = L.layerGroup().addTo(map)
const labels = {
  station: '駅',
  landmark: '名所・施設',
  highway: '高速道路施設',
}
let requestId = 0

async function search(coordinates, recenter = false) {
  const id = ++requestId
  const [lng, lat] = coordinates
  $('longitude').value = lng.toFixed(7)
  $('latitude').value = lat.toFixed(7)
  $('coordinates').textContent =
    `経度 ${lng.toFixed(6)} / 緯度 ${lat.toFixed(6)}`
  origin.setLatLng([lat, lng])
  if (recenter) map.setView([lat, lng], 15)
  facilities.clearLayers()
  $('areas').replaceChildren()
  $('nearby').replaceChildren()
  $('place').textContent = '検索しています…'
  $('version').textContent = ''
  $('attribution').textContent = ''
  $('json').textContent = ''
  $('status').textContent = '検索中'
  $('status').dataset.state = 'loading'
  document.querySelector('.results').setAttribute('aria-busy', 'true')
  const kind = $('kind').value
  const rules = [
    { kind: 'highway', radiusM: 5000, priority: 100 },
    { kind: 'landmark', radiusM: 1000, priority: 80 },
    { kind: 'station', radiusM: 5000, priority: 50 },
  ].filter((rule) => kind === 'all' || kind === rule.kind)
  try {
    const result = await reverseGeocode(coordinates, {
      osmDataUrl: `${DATA}/osm`,
      japan: { tileUrl: `${DATA}/tiles/{z}/{x}/{y}.pbf` },
      nearby:
        kind === 'none'
          ? false
          : { dataUrl: `${DATA}/data`, rules, resultMode: 'all' },
    })
    if (id !== requestId) return
    const areas = result.administrativeAreas
    $('place').textContent = result.japan
      ? `${result.japan.prefecture} ${result.japan.city}`.trim() ||
        '行政地名なし'
      : areas.at(-1)?.name || result.countryName || '行政地名なし'
    for (const area of areas) {
      const li = document.createElement('li')
      const name = document.createElement('span')
      name.textContent = area.name
      const code = document.createElement('small')
      code.textContent =
        area.code || (area.level === null ? '' : `level ${area.level}`)
      li.append(name, code)
      $('areas').append(li)
    }
    for (const category of Object.keys(labels)) {
      const candidates = (result.nearby?.candidates || [])
        .filter((p) => p.kind === category)
        .slice(0, 3)
      for (const point of candidates) {
        const li = document.createElement('li')
        li.textContent = point.name
        const meta = document.createElement('small')
        meta.textContent = `${labels[point.kind]} · ${Math.round(point.distanceM).toLocaleString()} m · ${point.category}`
        li.append(meta)
        $('nearby').append(li)
        const popup = document.createElement('span')
        popup.textContent = `${point.name} (${Math.round(point.distanceM)} m)`
        L.circleMarker([point.coordinates[1], point.coordinates[0]], {
          radius: 6,
          color: '#fff',
          weight: 2,
          fillColor: '#239567',
          fillOpacity: 1,
        })
          .bindPopup(popup)
          .addTo(facilities)
      }
    }
    if (!$('nearby').childElementCount) {
      const li = document.createElement('li')
      li.textContent =
        kind === 'none'
          ? '近傍検索はオフです。'
          : '指定範囲に該当する施設はありません。'
      $('nearby').append(li)
    }
    $('version').textContent =
      `国: ${result.countryCode || '不明'} / データ版: ${result.dataVersion}`
    $('attribution').textContent = result.attribution
    $('json').textContent = JSON.stringify(result, null, 2)
    $('status').textContent = '検索完了'
    $('status').dataset.state = 'success'
  } catch (error) {
    if (id !== requestId) return
    $('place').textContent =
      error.name === 'UnsupportedRegionError'
        ? '未公開の地域です'
        : '検索できませんでした'
    $('json').textContent = `${error.name}: ${error.message}`
    $('version').textContent =
      '別の地点を選ぶか、時間をおいて再度お試しください。'
    $('status').textContent = '検索エラー'
    $('status').dataset.state = 'error'
  } finally {
    if (id === requestId)
      document.querySelector('.results').setAttribute('aria-busy', 'false')
  }
}

$('search-form').addEventListener('submit', (event) => {
  event.preventDefault()
  $('sample').selectedIndex = -1
  search([Number($('longitude').value), Number($('latitude').value)], true)
})
$('sample').addEventListener('change', () => {
  const [, lng, lat] = samples[Number($('sample').value)]
  search([lng, lat], true)
})
$('kind').addEventListener('change', () => {
  if ($('search-form').reportValidity())
    search([Number($('longitude').value), Number($('latitude').value)])
})
map.on('click', ({ latlng }) => {
  $('sample').selectedIndex = -1
  const wrapped = latlng.wrap()
  if (Math.abs(wrapped.lat) <= 85.05) search([wrapped.lng, wrapped.lat])
})
search([139.7673068, 35.6809591])
