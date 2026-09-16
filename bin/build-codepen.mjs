import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve as resolvePath } from 'node:path'
import { execFileSync } from 'node:child_process'
import { rollup } from 'rollup'
import typescript from '@rollup/plugin-typescript'
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const read = (name) => readFile(resolvePath(root, name), 'utf8')
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim()
const bundle = await rollup({
  input: resolvePath(root, 'demo/codepen/main.js'),
  plugins: [
    typescript({
      tsconfig: resolvePath(root, 'tsconfig.json'),
      module: 'ESNext',
      declaration: false,
      declarationDir: undefined,
    }),
    resolve({ browser: true }),
    commonjs(),
  ],
})
const notices = await Promise.all(
  [
    'LICENSE.txt',
    'THIRD_PARTY_LICENSES.txt',
    'node_modules/global-mercator/LICENSE',
  ].map(read),
)
const { output } = await bundle.generate({
  format: 'iife',
  banner: `/*! sentium/open-reverse-geocoder @ ${revision}\n${notices.join('\n\n').replaceAll('*/', '* /')}\n*/`,
})
await bundle.close()
const html = await read('demo/codepen/index.html')
const css = await read('demo/codepen/style.css')
const js = output[0].code
const payload = {
  title: 'Open Reverse Geocoder — sentium / 日本・海外の地名と近傍検索',
  description: `Interactive demo for https://github.com/sentium/open-reverse-geocoder (revision ${revision}). Uses sentium GitHub Pages data for Japan and published OSM regions. Library and dependency license notices are included in script.js.`,
  html,
  css,
  js,
  layout: 'left',
}
const out = resolvePath(root, 'tmp/codepen')
await mkdir(out, { recursive: true })
await Promise.all([
  writeFile(resolvePath(out, 'pen.json'), JSON.stringify(payload, null, 2)),
  writeFile(resolvePath(out, 'script.js'), js),
  writeFile(resolvePath(out, 'style.css'), css),
  writeFile(
    resolvePath(out, 'index.html'),
    `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Open Reverse Geocoder · sentium</title><link rel="stylesheet" href="./style.css"></head><body>${html}<script src="./script.js"></script></body></html>`,
  ),
])
console.log(
  `CodePen files written to ${out} (${Buffer.byteLength(js)} bytes of JavaScript)`,
)
