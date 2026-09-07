const NodeEnvironment = require('jest-environment-node')

// Jest 26 predates Node's Web APIs. Use the runtime's implementations in its VM.
module.exports = class extends NodeEnvironment {
  constructor(config, context) {
    super(config, context)
    for (const name of ['fetch', 'Response', 'AbortController']) {
      this.global[name] = globalThis[name]
    }
  }
}
