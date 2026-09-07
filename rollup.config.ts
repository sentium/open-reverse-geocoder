import typescript from '@rollup/plugin-typescript'
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'

export default {
  input: ['src/main.ts', 'src/data-validation.ts'],
  output: {
    dir: 'dist',
    format: 'cjs',
  },
  plugins: [typescript({ module: 'ESNext' }), resolve(), commonjs()],
  external: ['d3-geo', 'global-mercator', 'pbf', '@mapbox/vector-tile'],
}
