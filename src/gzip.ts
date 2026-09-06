import { Gunzip, strFromU8 } from 'fflate'

const LIMIT = 16 * 1024 * 1024
const crcTable = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let value = i
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  crcTable[i] = value >>> 0
}

/** Bounded, single-member gzip decoding with CRC and length verification. */
export function decodeGzip(input: Uint8Array): string {
  if (
    input.length < 18 ||
    input.length > LIMIT ||
    input[0] !== 31 ||
    input[1] !== 139
  )
    throw new Error('Invalid or oversized gzip data')
  const trailer = new DataView(
    input.buffer,
    input.byteOffset + input.length - 8,
    8,
  )
  const expectedSize = trailer.getUint32(4, true)
  if (expectedSize > LIMIT) throw new Error('Decompressed data is too large')
  const chunks: Uint8Array[] = []
  let size = 0,
    crc = 0xffffffff
  const stream = new Gunzip((chunk) => {
    size += chunk.length
    if (size > LIMIT) throw new Error('Decompressed data is too large')
    for (const byte of chunk) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]
    chunks.push(chunk)
  })
  stream.onmember = () => {
    throw new Error('Multiple gzip members are not supported')
  }
  // A small compressed chunk bounds the decoder's temporary expansion buffer.
  for (let start = 0; start < input.length; start += 1024)
    stream.push(
      input.subarray(start, start + 1024),
      start + 1024 >= input.length,
    )
  if (
    size !== expectedSize ||
    (crc ^ 0xffffffff) >>> 0 !== trailer.getUint32(0, true)
  )
    throw new Error('Gzip checksum or length mismatch')
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return strFromU8(bytes)
}

export function decodeJsonBytes(input: Uint8Array): string {
  if (input.length > LIMIT) throw new Error('Search data is too large')
  // HTTP Content-Encoding may already have decoded the stored gzip member.
  return input[0] === 31 && input[1] === 139
    ? decodeGzip(input)
    : strFromU8(input)
}
