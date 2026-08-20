function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let k=0;k<8;k++) c = (c>>>1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}
function u16(n){ return [n&255,(n>>>8)&255]; }
function u32(n){ return [n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]; }

export function makeZip(files) {
  // Important: do not use Array.push(...multiMegabyteFile) here.
  // Expanding a large byte array as function arguments causes
  // "Maximum call stack size exceeded" in Chromium/Vivaldi.
  const localChunks = [];
  const centralChunks = [];
  let localLength = 0;
  let centralLength = 0;
  let offset = 0;

  for (const f of files) {
    const nameBytes = new TextEncoder().encode(f.name);
    const data = f.bytes instanceof Uint8Array ? f.bytes : Uint8Array.from(f.bytes);
    const crc = crc32(data);

    const header = Uint8Array.from([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0), ...nameBytes
    ]);

    localChunks.push(header, data);
    localLength += header.length + data.length;

    const ch = Uint8Array.from([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset), ...nameBytes
    ]);

    centralChunks.push(ch);
    centralLength += ch.length;
    offset += header.length + data.length;
  }

  const end = Uint8Array.from([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(centralLength), ...u32(localLength), ...u16(0)
  ]);

  const out = new Uint8Array(localLength + centralLength + end.length);
  let pos = 0;

  for (const chunk of localChunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  for (const chunk of centralChunks) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  out.set(end, pos);

  return out;
}

