import { Context, Session } from 'koishi'
import { BannedImageEntry, ImageGuardConfig } from '../types'
import { pHashWithProbe, hammingDistance, ImageProbe } from './phash'
import { withTimeout } from '../utils'

// 单张图片下载上限（8MB），避免恶意大图拖垮进程
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const DOWNLOAD_TIMEOUT = 10 * 1000

export interface ImageHit {
  entry: BannedImageEntry
  distance: number
  // 命中的图片地址
  url: string
}

export interface ImageProbeResult {
  hash: string
  probe: ImageProbe | null
  error?: string
}

// 违规图片服务：负责样本入库（计算 pHash）与消息图片比对。
// 样本库分两级：全局样本（对所有群生效）+ 群专属样本（仅该群生效）。
export class ImageGuardService {
  private ctx: Context
  private store: any
  private log: any
  // OneBot 服务：用于在消息段只带 file 文件名/本地路径时，用 get_image 换取真实下载地址。
  // 由 services/index.ts 在构造后注入，避免与 OneBotService 形成构造期循环依赖。
  private onebot: any = null
  // 样本哈希缓存，避免每条消息都查一次数据库。
  // 按 groupId 分桶：'__global__' 存全局样本，其余按群号存「全局 + 本群」的合并结果。
  private cache = new Map<string, { at: number, rows: BannedImageEntry[] }>()
  private static readonly CACHE_TTL = 30 * 1000
  private static readonly GLOBAL_KEY = '__global__'

  constructor(ctx: Context, store: any) {
    this.ctx = ctx
    this.store = store
    this.log = ctx.logger('image-guard')
  }

  // 注入 OneBot 服务（在 createServices 中调用）
  attachOnebot(onebot: any): void {
    this.onebot = onebot
  }

  invalidate(): void {
    this.cache.clear()
  }

  // 取某群生效的全部样本（全局 + 该群专属）。groupId 为空时只取全局样本。
  private async samples(groupId = ''): Promise<BannedImageEntry[]> {
    const key = groupId ? String(groupId) : ImageGuardService.GLOBAL_KEY
    const hit = this.cache.get(key)
    const now = Date.now()
    if (hit && now - hit.at < ImageGuardService.CACHE_TTL) return hit.rows
    const global = await this.store.bannedImageList('')
    let rows = global
    if (groupId) {
      const own = await this.store.bannedImageList(String(groupId))
      rows = [...global, ...own]
    }
    this.cache.set(key, { at: now, rows })
    return rows
  }

  // 下载图片并计算 pHash。返回空 hash 表示解码失败（格式不支持或下载失败）
  async probe(url: string): Promise<ImageProbeResult> {
    const buf = await this.fetchImage(url)
    if (!buf) return { hash: '', probe: null, error: '图片下载失败或超出大小限制' }
    try {
      const { hash, probe } = pHashWithProbe(buf)
      if (!hash) return { hash: '', probe, error: '暂不支持该图片格式（仅支持 PNG / 基线 JPEG），请用 PNG 样本图' }
      return { hash, probe }
    } catch (e) {
      return { hash: '', probe: null, error: `图片解析失败：${(e as Error).message}` }
    }
  }

  // 下载图片二进制（仅 PNG/JPEG 走解析，其余格式仍会下载但会在 probe 中报不支持）
  private async fetchImage(url: string): Promise<Uint8Array | null> {
    if (!url) return null
    // 优先使用全局 fetch（Node 18+ / Koishi 运行环境均提供）
    const f = (globalThis as any).fetch
    if (typeof f !== 'function') return null
    try {
      const res: any = await withTimeout(f(url, { method: 'GET' }), DOWNLOAD_TIMEOUT)
      if (!res || !res.ok) return null
      // 声明长度过大时提前拒绝
      const declared = Number(res.headers?.get?.('content-length') || 0)
      if (declared && declared > MAX_IMAGE_BYTES) return null
      const ab = await withTimeout<ArrayBuffer>(res.arrayBuffer(), DOWNLOAD_TIMEOUT)
      const buf = new Uint8Array(ab)
      if (buf.length > MAX_IMAGE_BYTES) return null
      return buf
    } catch (e) {
      this.log.debug(`下载图片失败 ${url}：${(e as Error).message}`)
      return null
    }
  }

  // 从 OneBot 消息段数组里取出图片地址。
  // 各协议端字段名不统一：url / src / file 都可能是图片地址，
  // 部分实现还会把真实地址放在 data.url，或用 file:// 与 base64 表示本地图。
  // 这里只收集可直接下载的 http(s) 地址。
  static imageUrlsFromSegments(segments: any): string[] {
    const urls: string[] = []
    if (!Array.isArray(segments)) return urls
    for (const seg of segments) {
      if (!seg) continue
      // 兼容 { type:'image', data:{...} } 与 { type:'image', attrs:{...} } 两种形态
      if (seg.type !== 'image' && seg.type !== 'face' && seg.type !== 'mface') continue
      const d = seg.data ?? seg.attrs ?? {}
      for (const key of ['url', 'src', 'file', 'path']) {
        const v = d[key]
        if (typeof v === 'string' && /^https?:\/\//i.test(v)) {
          if (!urls.includes(v)) urls.push(v)
          break
        }
      }
    }
    return urls
  }

  // 从 session 中收集所有图片地址（同步可得的 http 地址）
  static imageUrls(session: Session): string[] {
    return ImageGuardService.imageUrlsFromSegments((session as any).elements)
  }

  // 收齐一条消息里所有可下载的图片地址：
  // 先取段里直接给出的 http 地址，再对「只有 file 文件名/本地路径」的图片段
  // 调用 get_image 换取真实地址（QQ 表情、转发图片常见这种形态）。
  private async collectUrls(session: Session): Promise<string[]> {
    const urls = ImageGuardService.imageUrls(session)
    const segs = ((session as any).elements || []) as any[]
    for (const el of segs) {
      const t = el?.type
      if (t !== 'image' && t !== 'face' && t !== 'mface') continue
      // 该段已经提供了 http 地址就跳过
      const d = el?.attrs ?? el?.data ?? {}
      const hasHttp = ['url', 'src', 'file', 'path'].some(
        (k) => typeof d[k] === 'string' && /^https?:\/\//i.test(d[k]),
      )
      if (hasHttp) continue
      const f = d.file ?? d.url
      if (typeof f !== 'string' || !f || !this.onebot?.resolveImageUrl) continue
      const real = await this.onebot.resolveImageUrl(session, f)
      if (real && !urls.includes(real)) urls.push(real)
    }
    return urls
  }

  // 检查消息中的所有图片，返回第一个命中的样本（未命中返回 null）
  async check(session: Session, cfg: ImageGuardConfig, groupId = ''): Promise<ImageHit | null> {
    if (!cfg?.enabled) return null
    const samples = await this.samples(groupId)
    if (samples.length === 0) return null
    const urls = await this.collectUrls(session)
    if (urls.length === 0) return null

    const threshold = Math.max(0, Math.min(64, Number(cfg.threshold ?? 8)))
    for (const url of urls) {
      const { hash } = await this.probe(url)
      if (!hash) continue
      let best: { entry: BannedImageEntry, distance: number } | null = null
      for (const entry of samples) {
        const distance = hammingDistance(hash, entry.hash)
        // 阈值 0 表示必须完全一致
        if (distance <= threshold && (!best || distance < best.distance)) {
          best = { entry, distance }
        }
      }
      if (best) return { entry: best.entry, distance: best.distance, url }
    }
    return null
  }

  // 把一张图片加入样本库（groupId 为空 = 全局样本，非空 = 该群专属）
  async addSample(url: string, label: string, source: string, groupId = ''): Promise<{ ok: boolean, message: string }> {
    const { hash, probe, error } = await this.probe(url)
    if (!hash) return { ok: false, message: error || '无法解析该图片' }
    const added = await this.store.bannedImageAdd({
      hash,
      groupId: String(groupId || ''),
      source,
      origin: url,
      label: label || '',
      width: probe?.width ?? 0,
      height: probe?.height ?? 0,
      format: probe?.format ?? '',
    })
    this.invalidate()
    if (!added) return { ok: false, message: '该图片已在样本库中（感知哈希重复）' }
    const scope = groupId ? `群 ${groupId}` : '全局'
    return { ok: true, message: `已加入${scope}样本库（${probe?.width}×${probe?.height} ${probe?.format}）` }
  }

  // 直接以二进制加入样本库（WebUI 上传）
  async addSampleFromBuffer(buf: Uint8Array, label: string, origin: string, groupId = ''): Promise<{ ok: boolean, message: string }> {
    const { hash, probe } = pHashWithProbe(buf)
    if (!hash) return { ok: false, message: '暂不支持该图片格式（仅支持 PNG / 基线 JPEG）' }
    const added = await this.store.bannedImageAdd({
      hash,
      groupId: String(groupId || ''),
      source: 'upload',
      origin,
      label: label || '',
      width: probe?.width ?? 0,
      height: probe?.height ?? 0,
      format: probe?.format ?? '',
    })
    this.invalidate()
    const scope = groupId ? `群 ${groupId}` : '全局'
    return added
      ? { ok: true, message: `已加入${scope}样本库（${probe?.width}×${probe?.height} ${probe?.format}）` }
      : { ok: false, message: '该图片已在样本库中（感知哈希重复）' }
  }

  // 比对一张图与样本库的相似度，用于 WebUI「试一试」
  async compare(url: string, groupId = ''): Promise<{ distance: number, entry: BannedImageEntry } | null> {
    const { hash } = await this.probe(url)
    if (!hash) return null
    const samples = await this.samples(groupId)
    let best: { distance: number, entry: BannedImageEntry } | null = null
    for (const entry of samples) {
      const distance = hammingDistance(hash, entry.hash)
      if (!best || distance < best.distance) best = { distance, entry }
    }
    return best
  }
}
