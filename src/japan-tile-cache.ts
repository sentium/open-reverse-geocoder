import { fetchBytes } from './http'

const MAX_BYTES = 16 * 1024 * 1024
const MAX_ENTRIES = 128
const TTL = 86400000
const cache = new Map<string, { value: Uint8Array; expires: number }>()
const pending = new Map<string, Promise<Uint8Array>>()
let bytes = 0

/** Preserve the legacy 24-hour cache and its exclusion of query URLs. */
export async function loadJapanTile(url: string): Promise<Uint8Array> {
  if (url.includes('?')) return fetchBytes(url)
  const cached = cache.get(url)
  if (cached) {
    cache.delete(url)
    if (cached.expires > Date.now()) {
      cache.set(url, cached)
      return cached.value
    }
    bytes -= cached.value.byteLength
  }
  const existing = pending.get(url)
  if (existing) return existing
  const request = fetchBytes(url).then((value) => {
    while (cache.size >= MAX_ENTRIES || bytes + value.byteLength > MAX_BYTES) {
      const key = cache.keys().next().value as string
      const oldest = cache.get(key)
      if (!oldest) break
      bytes -= oldest.value.byteLength
      cache.delete(key)
    }
    cache.set(url, { value, expires: Date.now() + TTL })
    bytes += value.byteLength
    return value
  })
  pending.set(url, request)
  try {
    return await request
  } finally {
    pending.delete(url)
  }
}
