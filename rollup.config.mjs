import typescript from '@rollup/plugin-typescript'
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import { readFileSync } from 'node:fs'

export default {
  input: ['src/main.ts', 'src/data-validation.ts', 'src/vector-tile.ts'],
  output: {
    dir: 'dist',
    format: 'cjs',
    banner: '/*! Bundled dependencies: see THIRD_PARTY_LICENSES.txt. */',
  },
  plugins: [
    typescript({ module: 'ESNext' }),
    resolve(),
    commonjs(),
    {
      name: 'third-party-notices',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'THIRD_PARTY_LICENSES.txt',
          source: readFileSync(
            new URL('./THIRD_PARTY_LICENSES.txt', import.meta.url),
            'utf8',
          ),
        })
      },
    },
  ],
  external: ['global-mercator'],
}
