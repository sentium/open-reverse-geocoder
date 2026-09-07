/** Fetch a complete response with limits that also cover streaming bodies. */
export async function fetchBytes(
  url: string,
  { maxBytes = 16 * 1024 * 1024, timeoutMs = 15000 } = {},
): Promise<Uint8Array> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
    if (!response.body) return new Uint8Array(0)
    reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      size += value.byteLength
      if (size > maxBytes) throw new Error(`Response is too large: ${url}`)
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  } catch (error) {
    if (timedOut) throw new Error(`Request timed out: ${url}`)
    throw error
  } finally {
    clearTimeout(timer)
    controller.abort()
    reader?.releaseLock()
  }
}
