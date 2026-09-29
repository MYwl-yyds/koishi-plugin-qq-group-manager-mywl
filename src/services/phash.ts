import { inflateSync } from 'zlib'

// 感知哈希（pHash）实现：仅依赖 Node 内置模块，不引入任何第三方图片库。
//
// 支持的输入格式：
//   - PNG（8 位真彩 / 灰度 / 带 alpha，支持非隔行；调色板 PNG 亦支持）
//   - JPEG 基线（含常见 4:4:4 / 4:2:2 / 4:2:0 采样）
// 其它格式（WebP / GIF / BMP）返回 null，由上层降级处理（提示管理员换图或转 PNG）。
//
// 算法：灰度化 → 缩放到 32x32 → 二维 DCT → 取左上 8x8 低频块（去掉直流分量）→ 与中位数比较得到 64 位指纹。

export interface ImageProbe {
  width: number
  height: number
  format: string
}

// 从图片二进制提取灰度像素（缩放到 size x size），失败返回 null
export function decodeGray(data: Uint8Array, size = 32): { pixels: Float64Array, probe: ImageProbe } | null {
  if (data.length < 8) return null
  if (isPng(data)) {
    const img = decodePng(data)
    if (!img) return null
    return { pixels: resizeGray(img.gray, img.width, img.height, size), probe: { width: img.width, height: img.height, format: 'png' } }
  }
  if (isJpeg(data)) {
    const img = decodeJpeg(data)
    if (!img) return null
    return { pixels: resizeGray(img.gray, img.width, img.height, size), probe: { width: img.width, height: img.height, format: 'jpeg' } }
  }
  return null
}

// 计算 64 位 pHash，返回 16 位十六进制字符串；无法解码时返回空串
export function pHash(data: Uint8Array): string {
  const decoded = decodeGray(data, 32)
  if (!decoded) return ''
  return hashFromGray(decoded.pixels, 32)
}

export function pHashWithProbe(data: Uint8Array): { hash: string, probe: ImageProbe | null } {
  const decoded = decodeGray(data, 32)
  if (!decoded) return { hash: '', probe: null }
  return { hash: hashFromGray(decoded.pixels, 32), probe: decoded.probe }
}

// 汉明距离：两个 16 位十六进制指纹的差异位数（0 表示完全一致）
export function hammingDistance(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64
  let dist = 0
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    // 统计 4 位中 1 的个数
    dist += (x & 1) + ((x >> 1) & 1) + ((x >> 2) & 1) + ((x >> 3) & 1)
  }
  return dist
}

// 从 32x32 灰度像素计算 pHash
function hashFromGray(gray: Float64Array, size: number): string {
  // 二维 DCT（分离式：先对行做一维 DCT，再对列做）
  const coeff = dct2d(gray, size)
  // 取左上 8x8 低频块，跳过直流分量 coeff[0]（它只反映整体亮度，参与比较会降低区分度）
  const low: number[] = []
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (x === 0 && y === 0) continue
      low.push(coeff[y * size + x])
    }
  }
  // 共 63 个系数：用中位数作阈值比均值更稳健
  const sorted = [...low].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  // 每 4 位打包为一个十六进制字符，共 63 位 → 16 个字符（末位补 0）
  let out = ''
  for (let i = 0; i < 64; i += 4) {
    let nibble = 0
    for (let b = 0; b < 4; b++) {
      const idx = i + b
      nibble = (nibble << 1) | (idx < low.length && low[idx] > median ? 1 : 0)
    }
    out += nibble.toString(16)
  }
  return out
}

// 二维 DCT-II（正交归一化），返回 size x size 系数矩阵
function dct2d(gray: Float64Array, size: number): Float64Array {
  const cosTable = new Float64Array(size * size)
  for (let u = 0; u < size; u++) {
    for (let x = 0; x < size; x++) {
      cosTable[u * size + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size))
    }
  }
  const c = (u: number) => (u === 0 ? Math.sqrt(1 / size) : Math.sqrt(2 / size))
  const tmp = new Float64Array(size * size)
  // 行变换
  for (let y = 0; y < size; y++) {
    for (let u = 0; u < size; u++) {
      let sum = 0
      for (let x = 0; x < size; x++) sum += gray[y * size + x] * cosTable[u * size + x]
      tmp[y * size + u] = sum * c(u)
    }
  }
  // 列变换
  const out = new Float64Array(size * size)
  for (let u = 0; u < size; u++) {
    for (let v = 0; v < size; v++) {
      let sum = 0
      for (let y = 0; y < size; y++) sum += tmp[y * size + u] * cosTable[v * size + y]
      out[v * size + u] = sum * c(v)
    }
  }
  return out
}

// 双线性缩放为 size x size 灰度（输入为 0~255 的灰度数组）
function resizeGray(src: Float64Array, sw: number, sh: number, size: number): Float64Array {
  const out = new Float64Array(size * size)
  if (sw <= 0 || sh <= 0) return out
  for (let y = 0; y < size; y++) {
    // 用中心对齐采样，减少缩放偏移
    const sy = ((y + 0.5) * sh) / size - 0.5
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)))
    const y1 = Math.max(0, Math.min(sh - 1, y0 + 1))
    const wy = Math.max(0, Math.min(1, sy - Math.floor(sy)))
    for (let x = 0; x < size; x++) {
      const sx = ((x + 0.5) * sw) / size - 0.5
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)))
      const x1 = Math.max(0, Math.min(sw - 1, x0 + 1))
      const wx = Math.max(0, Math.min(1, sx - Math.floor(sx)))
      const p00 = src[y0 * sw + x0]
      const p01 = src[y0 * sw + x1]
      const p10 = src[y1 * sw + x0]
      const p11 = src[y1 * sw + x1]
      const top = p00 + (p01 - p00) * wx
      const bottom = p10 + (p11 - p10) * wx
      out[y * size + x] = top + (bottom - top) * wy
    }
  }
  return out
}

// ============================ PNG ============================

function isPng(d: Uint8Array): boolean {
  return d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47
}

interface GrayImage { gray: Float64Array, width: number, height: number }

function decodePng(data: Uint8Array): GrayImage | null {
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 8
  let colorType = 6
  let interlace = 0
  let palette: number[][] | null = null
  const idat: Uint8Array[] = []

  while (offset + 8 <= data.length) {
    const length = readU32(data, offset)
    const type = String.fromCharCode(data[offset + 4], data[offset + 5], data[offset + 6], data[offset + 7])
    const bodyStart = offset + 8
    if (bodyStart + length > data.length) break
    if (type === 'IHDR') {
      width = readU32(data, bodyStart)
      height = readU32(data, bodyStart + 4)
      bitDepth = data[bodyStart + 8]
      colorType = data[bodyStart + 9]
      interlace = data[bodyStart + 12]
    } else if (type === 'PLTE') {
      palette = []
      for (let i = 0; i + 2 < length; i += 3) {
        palette.push([data[bodyStart + i], data[bodyStart + i + 1], data[bodyStart + i + 2]])
      }
    } else if (type === 'IDAT') {
      idat.push(data.subarray(bodyStart, bodyStart + length))
    } else if (type === 'IEND') {
      break
    }
    offset = bodyStart + length + 4 // 跳过 CRC
  }

  if (!width || !height || interlace !== 0) return null
  if (idat.length === 0) return null

  let raw: Uint8Array
  try {
    raw = new Uint8Array(inflateSync(Buffer.concat(idat.map((b) => Buffer.from(b)))))
  } catch {
    return null
  }

  // 每像素通道数
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4
  let bpp = Math.max(1, Math.ceil((channels * bitDepth) / 8))
  const bytesPerLine = Math.ceil((channels * bitDepth * width) / 8)
  const expected = (bytesPerLine + 1) * height
  if (raw.length < expected) return null

  // 反过滤
  const out = new Uint8Array(bytesPerLine * height)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const line = raw.subarray(pos, pos + bytesPerLine)
    pos += bytesPerLine
    const cur = out.subarray(y * bytesPerLine, (y + 1) * bytesPerLine)
    const prev = y > 0 ? out.subarray((y - 1) * bytesPerLine, y * bytesPerLine) : null
    for (let i = 0; i < bytesPerLine; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= bpp ? prev[i - bpp] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) v += paeth(a, b, c)
      cur[i] = v & 0xff
    }
  }

  // 转灰度
  const gray = new Float64Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, bl = 0
      if (bitDepth === 8) {
        const base = y * bytesPerLine
        if (colorType === 0) {
          r = g = bl = out[base + x]
        } else if (colorType === 4) {
          r = g = bl = out[base + x * 2]
        } else if (colorType === 2) {
          r = out[base + x * 3]
          g = out[base + x * 3 + 1]
          bl = out[base + x * 3 + 2]
        } else if (colorType === 6) {
          r = out[base + x * 4]
          g = out[base + x * 4 + 1]
          bl = out[base + x * 4 + 2]
        } else if (colorType === 3 && palette) {
          const idx = out[base + x]
          const p = palette[idx] || [0, 0, 0]
          r = p[0]; g = p[1]; bl = p[2]
        }
      } else if (bitDepth === 16) {
        const base = y * bytesPerLine
        const step = channels * 2
        if (colorType === 0 || colorType === 4) {
          r = g = bl = out[base + x * step]
        } else {
          r = out[base + x * step]
          g = out[base + x * step + 2]
          bl = out[base + x * step + 4]
        }
      } else if (bitDepth === 1 || bitDepth === 2 || bitDepth === 4) {
        // 低位深灰度 / 调色板
        const base = y * bytesPerLine
        const perByte = 8 / bitDepth
        const byte = out[base + Math.floor(x / perByte)]
        const shift = 8 - bitDepth * ((x % perByte) + 1)
        const rawVal = (byte >> shift) & ((1 << bitDepth) - 1)
        if (colorType === 3 && palette) {
          const p = palette[rawVal] || [0, 0, 0]
          r = p[0]; g = p[1]; bl = p[2]
        } else {
          // 灰度按位深归一化到 0~255
          r = g = bl = Math.round((rawVal * 255) / ((1 << bitDepth) - 1))
        }
      }
      // 亮度加权（ITU-R BT.601）
      gray[y * width + x] = 0.299 * r + 0.587 * g + 0.114 * bl
    }
  }
  return { gray, width, height }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

function readU32(d: Uint8Array, o: number): number {
  return ((d[o] << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3]) >>> 0
}

// ============================ JPEG ============================

function isJpeg(d: Uint8Array): boolean {
  return d[0] === 0xff && d[1] === 0xd8
}

// 标准 JPEG 量化/霍夫曼表由段中给出，这里只解析基线（SOF0）与渐进（SOF2）的帧头、
// 以及 SOS + 熵编码数据。渐进式 JPEG 需要多次扫描，实现复杂且收益有限，直接返回 null。
function decodeJpeg(data: Uint8Array): GrayImage | null {
  let offset = 2
  let width = 0, height = 0
  let components: Array<{ id: number, h: number, v: number, tq: number }> = []
  let quantTables: Record<number, Int32Array> = {}
  let huffDC: Record<number, HuffTable> = {}
  let huffAC: Record<number, HuffTable> = {}
  // 分量 ID -> 该分量在扫描中使用的霍夫曼表号（由 SOS 段给出）
  const scanTables: Record<number, { dc: number, ac: number }> = {}
  let scanStart = -1
  let progressive = false

  const zigzag = [
    0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
  ]

  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) { offset++; continue }
    const marker = data[offset + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue }
    if (marker === 0xd9) break
    const len = (data[offset + 2] << 8) | data[offset + 3]
    const seg = offset + 4
    if (marker === 0xc0 || marker === 0xc1) {
      height = (data[seg + 1] << 8) | data[seg + 2]
      width = (data[seg + 3] << 8) | data[seg + 4]
      const n = data[seg + 5]
      components = []
      for (let i = 0; i < n; i++) {
        const o = seg + 6 + i * 3
        components.push({ id: data[o], h: data[o + 1] >> 4, v: data[o + 1] & 15, tq: data[o + 2] })
      }
    } else if (marker === 0xc2) {
      progressive = true
    } else if (marker === 0xdb) {
      let p = seg
      const end = seg + len - 2
      while (p < end) {
        const pq = data[p] >> 4
        const tq = data[p] & 15
        p++
        const table = new Int32Array(64)
        for (let i = 0; i < 64; i++) {
          if (pq === 0) { table[zigzag[i]] = data[p++]; } else { table[zigzag[i]] = (data[p] << 8) | data[p + 1]; p += 2 }
        }
        quantTables[tq] = table
      }
    } else if (marker === 0xc4) {
      let p = seg
      const end = seg + len - 2
      while (p < end) {
        const tc = data[p] >> 4
        const th = data[p] & 15
        p++
        // 16 个长度计数 + 符号值
        const counts = new Array(17).fill(0)
        let total = 0
        for (let i = 1; i <= 16; i++) { counts[i] = data[p + i - 1]; total += counts[i] }
        p += 16
        const symbols = data.subarray(p, p + total)
        p += total
        const table = buildHuffTable(counts, symbols)
        if (tc === 0) huffDC[th] = table
        else huffAC[th] = table
      }
    } else if (marker === 0xda) {
      // SOS：记录每个分量使用的 DC / AC 霍夫曼表号
      const n = data[seg]
      for (let i = 0; i < n; i++) {
        const o = seg + 1 + i * 2
        const cid = data[o]
        const tables = data[o + 1]
        scanTables[cid] = { dc: tables >> 4, ac: tables & 15 }
      }
      scanStart = seg + len - 2
      break
    }
    offset = seg + len - 2
  }

  if (progressive) return null
  if (!width || !height || components.length === 0 || scanStart < 0) return null
  // 至少要有一张 DC 与一张 AC 表（表号由 SOS 指定，通常为 0）
  if (Object.keys(huffDC).length === 0 || Object.keys(huffAC).length === 0) return null

  const maxH = Math.max(...components.map((c) => c.h))
  const maxV = Math.max(...components.map((c) => c.v))
  const mcuW = 8 * maxH
  const mcuH = 8 * maxV
  const mcusX = Math.ceil(width / mcuW)
  const mcusY = Math.ceil(height / mcuH)

  // 为每个分量分配像素平面
  const planes = components.map((c) => ({
    comp: c,
    pw: mcusX * c.h * 8,
    ph: mcusY * c.v * 8,
    data: new Float64Array(mcusX * c.h * 8 * mcusY * c.v * 8),
  }))

  const reader = new BitReader(data, scanStart)
  const preds = new Int32Array(components.length)

  outer:
  for (let my = 0; my < mcusY; my++) {
    for (let mx = 0; mx < mcusX; mx++) {
      for (let ci = 0; ci < components.length; ci++) {
        const plane = planes[ci]
        const qt = quantTables[plane.comp.tq] || quantTables[0]
        if (!qt) return null
        // 每个分量使用 SOS 中指定的表；缺省回退到表 0（绝大多数编码器的选择）
        const sel = scanTables[plane.comp.id] || { dc: 0, ac: 0 }
        const dcTable = huffDC[sel.dc] || huffDC[0]
        const acTable = huffAC[sel.ac] || huffAC[0]
        if (!dcTable || !acTable) return null
        for (let by = 0; by < plane.comp.v; by++) {
          for (let bx = 0; bx < plane.comp.h; bx++) {
            const block = new Float64Array(64)
            // DC
            const dcLen = reader.decode(dcTable)
            if (dcLen < 0) break outer
            let diff = dcLen === 0 ? 0 : reader.receiveExtend(dcLen)
            preds[ci] += diff
            block[0] = preds[ci] * qt[0]
            // AC
            let k = 1
            while (k < 64) {
              const rs = reader.decode(acTable)
              if (rs < 0) break outer
              if (rs === 0) break
              const run = rs >> 4
              const size = rs & 15
              if (size === 0) {
                // ZRL：跳过 16 个零
                if (run === 15) { k += 16; continue }
                break
              }
              k += run
              if (k > 63) break
              const val = reader.receiveExtend(size)
              block[zigzag[k]] = val * qt[k]
              k++
            }
            // 反 DCT 后写入平面
            idct8x8(block, plane.data, plane.pw, (my * plane.comp.v + by) * 8, (mx * plane.comp.h + bx) * 8)
          }
        }
      }
    }
  }

  // 合成灰度：按采样比放大各分量，3 分量按 YCbCr 转 RGB 再加权，单分量直接取 Y
  const gray = new Float64Array(width * height)
  const hasColor = planes.length >= 3
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const Y = samplePlane(planes[0], x, y)
      let r: number, g: number, bl: number
      if (hasColor) {
        const Cb = samplePlane(planes[1], x, y) - 128
        const Cr = samplePlane(planes[2], x, y) - 128
        r = Y + 1.402 * Cr
        g = Y - 0.344136 * Cb - 0.714136 * Cr
        bl = Y + 1.772 * Cb
      } else {
        r = g = bl = Y
      }
      gray[y * width + x] = Math.max(0, Math.min(255, 0.299 * r + 0.587 * g + 0.114 * bl))
    }
  }
  return { gray, width, height }
}

// 从分量平面按采样比取样（h/v 为相对最大采样比的倍数）
function samplePlane(plane: { pw: number, ph: number, data: Float64Array, comp: { h: number, v: number } }, x: number, y: number): number {
  const sx = Math.min(plane.pw - 1, Math.floor(x * plane.comp.h))
  const sy = Math.min(plane.ph - 1, Math.floor(y * plane.comp.v))
  return plane.data[sy * plane.pw + sx]
}

// 反 DCT（8x8），直接把结果加到目标平面的指定块位置
function idct8x8(block: Float64Array, dst: Float64Array, stride: number, oy: number, ox: number): void {
  const tmp = new Float64Array(64)
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let sum = 0
      for (let u = 0; u < 8; u++) {
        sum += C8[u] * block[y * 8 + u] * COS8[u * 8 + x]
      }
      tmp[y * 8 + x] = sum
    }
  }
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let sum = 0
      for (let v = 0; v < 8; v++) {
        sum += C8[v] * tmp[v * 8 + x] * COS8[v * 8 + y]
      }
      dst[(oy + y) * stride + (ox + x)] = sum + 128
    }
  }
}

const COS8 = (() => {
  const t = new Float64Array(64)
  for (let u = 0; u < 8; u++) {
    for (let x = 0; x < 8; x++) t[u * 8 + x] = Math.cos(((2 * x + 1) * u * Math.PI) / 16)
  }
  return t
})()
const C8 = (() => {
  const t = new Float64Array(8)
  for (let u = 0; u < 8; u++) t[u] = u === 0 ? Math.SQRT1_2 : 1
  return t
})()

interface HuffTable { minCode: Int32Array, maxCode: Int32Array, valPtr: Int32Array, symbols: Uint8Array }

// 由「每长度码字数」与符号表构建解码表（JPEG 附录 F 的标准做法）
function buildHuffTable(counts: number[], symbols: Uint8Array): HuffTable {
  const minCode = new Int32Array(17).fill(-1)
  const maxCode = new Int32Array(18).fill(-1)
  const valPtr = new Int32Array(17)
  let code = 0
  let k = 0
  for (let len = 1; len <= 16; len++) {
    if (counts[len] > 0) {
      valPtr[len] = k
      minCode[len] = code
      code += counts[len]
      maxCode[len] = code - 1
      k += counts[len]
    }
    code <<= 1
  }
  maxCode[17] = 0x7fffffff
  return { minCode, maxCode, valPtr, symbols }
}

class BitReader {
  private data: Uint8Array
  private pos: number
  private bits = 0
  private count = 0

  constructor(data: Uint8Array, pos: number) {
    this.data = data
    this.pos = pos
  }

  private nextByte(): number {
    if (this.pos >= this.data.length) return 0
    let b = this.data[this.pos++]
    if (b === 0xff) {
      const n = this.data[this.pos]
      if (n === 0x00) this.pos++
      else return 0 // 遇到标记，视作填充
    }
    return b
  }

  private ensure(n: number): void {
    while (this.count < n) {
      this.bits = ((this.bits << 8) | this.nextByte()) >>> 0
      this.count += 8
    }
  }

  getBit(): number {
    this.ensure(1)
    this.count--
    return (this.bits >> this.count) & 1
  }

  decode(table: HuffTable): number {
    let code = 0
    for (let len = 1; len <= 16; len++) {
      code = (code << 1) | this.getBit()
      if (table.maxCode[len] >= 0 && code <= table.maxCode[len] && code >= table.minCode[len]) {
        const idx = table.valPtr[len] + (code - table.minCode[len])
        return table.symbols[idx] ?? -1
      }
    }
    return -1
  }

  // 读取 n 位并做符号扩展（JPEG 的 EXTEND）
  receiveExtend(n: number): number {
    if (n === 0) return 0
    let v = 0
    for (let i = 0; i < n; i++) v = (v << 1) | this.getBit()
    const vt = 1 << (n - 1)
    return v < vt ? v - (1 << n) + 1 : v
  }
}
