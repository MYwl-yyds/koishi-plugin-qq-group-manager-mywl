import { Context, Session } from 'koishi'

export function idOf(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return ''
  return String(value)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 受管定时器集合：延迟任务在插件卸载（ctx.on('dispose')）时统一清理，
// 避免热重载后仍触发回调而访问已销毁的 ctx / database。
export class TimerRegistry {
  private timers = new Set<any>()
  private disposed = false

  // 注册一个延迟任务；插件已卸载时直接忽略
  setTimeout(fn: () => void, ms: number): void {
    if (this.disposed) return
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      if (this.disposed) return
      try {
        fn()
      } catch { /* 由调用方内部处理 */ }
    }, ms)
    // 不阻止 Node 进程退出
    if (typeof timer === 'object' && timer && 'unref' in timer) (timer as any).unref?.()
    this.timers.add(timer)
  }

  dispose(): void {
    this.disposed = true
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
  }
}

// 并发映射：按指定并发数处理数组，返回与输入等长的结果数组。
// 单个任务抛错时该项结果为 undefined，不影响其它任务。
export async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const list = Array.isArray(items) ? items : []
  const size = Math.max(1, Math.floor(concurrency || 1))
  const results: R[] = new Array(list.length)
  let cursor = 0
  const workers = new Array(Math.min(size, list.length || 1)).fill(0).map(async () => {
    for (;;) {
      const index = cursor++
      if (index >= list.length) return
      try {
        results[index] = await fn(list[index], index)
      } catch {
        results[index] = undefined as unknown as R
      }
    }
  })
  await Promise.all(workers)
  return results
}

// 带超时的 Promise 包装，超时后抛出错误（用于避免群员检查卡死）
export async function withTimeout<T>(promise: Promise<T>, ms: number, message = '操作超时'): Promise<T> {
  let timer: any
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), Math.max(1, ms))
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// 多行/多分隔符文本 → 去重字符串数组
export function splitList(input: string | string[] | undefined | null): string[] {
  if (Array.isArray(input)) return [...new Set(input.map((x) => String(x).trim()).filter(Boolean))]
  const raw = String(input ?? '')
  if (!raw.trim()) return []
  return [...new Set(raw.split(/[\n,，;；\s]+/).map((x) => x.trim()).filter(Boolean))]
}

// 解析时长字符串为「分钟」数值。支持单位：s/秒、m/分/分钟、h/时/小时、d/天/日；纯数字默认为分钟
export function parseDuration(input: string | undefined, defaultMinutes = 10): number {
  if (!input) return defaultMinutes
  const raw = String(input).trim().toLowerCase()
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(秒|s|分|分钟|min|m|时|小时|hour|h|天|日|d)?$/)
  if (!match) return defaultMinutes
  const value = parseFloat(match[1])
  const unit = match[2] || 'm'
  let minutes = value
  if (unit === '秒' || unit === 's') minutes = value / 60
  else if (unit === '分' || unit === '分钟' || unit === 'min' || unit === 'm') minutes = value
  else if (unit === '时' || unit === '小时' || unit === 'hour' || unit === 'h') minutes = value * 60
  else if (unit === '天' || unit === '日' || unit === 'd') minutes = value * 24 * 60
  return Math.max(0, minutes)
}

export function formatDuration(minutes: number): string {
  if (minutes >= 60) {
    const h = minutes / 60
    return `${Number.isInteger(h) ? h : h.toFixed(1)} 小时`
  }
  return `${minutes} 分钟`
}

// 归一化用户 ID：剥离可能的「平台:ID」前缀（如 onebot:123456），返回纯 QQ 号
export function normalizeId(id: string | number | undefined | null): string {
  const s = String(id ?? '').trim()
  const i = s.lastIndexOf(':')
  return i >= 0 ? s.slice(i + 1) : s
}

// 从 session 中提取被 @ 的用户，其次取被引用（回复）消息的作者，最后从文本中提取首个数字 QQ。
// 顺序很重要：@ 最明确，引用次之，纯文本兜底最容易误判（例如把时长里的数字当成 QQ）。
export function extractUser(session: Session, raw?: string): string {
  for (const el of session.elements || []) {
    if (el.type === 'at' || el.type === 'mention') {
      const id = el.attrs?.id ?? el.attrs?.['user-id'] ?? el.attrs?.userId ?? el.attrs?.qq
      if (id) return normalizeId(id)
    }
  }
  // 引用（回复）目标消息时，优先以被引用消息的作者为目标
  const quoted = quotedUserId(session)
  if (quoted) return quoted
  const text = raw ?? session.content ?? ''
  const match = text.match(/\d{5,12}/)
  return match ? match[0] : ''
}

// 取被引用消息的作者 QQ（OneBot v11 的 reply/quote 元素带 id，需再查一次消息）
export function quotedUserId(session: Session): string {
  for (const el of session.elements || []) {
    if (el.type !== 'quote' && el.type !== 'reply') continue
    // 部分适配器直接在元素上附带 userId
    const direct = el.attrs?.userId ?? el.attrs?.user_id ?? el.attrs?.qq
    if (direct) return normalizeId(direct)
    // 否则从 quote 快照对象里取
    const snap = el.attrs?.quote ?? el.attrs?.data
    const fromSnap = snap?.user_id ?? snap?.userId ?? snap?.sender?.user_id ?? snap?.sender?.userId
    if (fromSnap) return normalizeId(fromSnap)
  }
  return ''
}

// 取被引用消息的 message_id（用于精华/撤回等需要消息上下文的命令）
export function quotedMessageId(session: Session): string {
  for (const el of session.elements || []) {
    if (el.type !== 'quote' && el.type !== 'reply') continue
    const id = el.attrs?.id ?? el.attrs?.messageId ?? el.attrs?.message_id
    if (id) return String(id)
  }
  return ''
}

// 解析命令中的目标用户。
// 优先级：@ 提及 → 引用消息作者 → 参数本身是纯 QQ 号。
// 不再从自由文本里「捞出第一个数字」，避免把时长/价格/日期误当成 QQ 号而处罚错人。
export function resolveTargetUser(session: Session, value?: string): string {
  // 1) @ 提及（最可靠）
  for (const el of session.elements || []) {
    if (el.type === 'at' || el.type === 'mention') {
      const id = el.attrs?.id ?? el.attrs?.['user-id'] ?? el.attrs?.userId ?? el.attrs?.qq
      if (id) return normalizeId(id)
    }
  }
  // 2) 引用的消息作者
  const quoted = quotedUserId(session)
  if (quoted) return quoted
  // 3) 参数必须是「纯 QQ 号」才接受（允许分隔符与空白，但整串只能是数字/逗号/空格）
  const raw = String(value ?? '').trim()
  if (/^\d{5,12}$/.test(raw)) return raw
  const onlyNumbers = raw.replace(/[\s,，、]+/g, '')
  if (onlyNumbers && /^\d{5,12}$/.test(onlyNumbers)) return onlyNumbers
  return ''
}

export function extractAllUsers(session: Session): string[] {
  const set = new Set<string>()
  for (const el of session.elements || []) {
    if (el.type === 'at' || el.type === 'mention') {
      const id = el.attrs?.id ?? el.attrs?.['user-id'] ?? el.attrs?.userId ?? el.attrs?.qq
      if (id) set.add(normalizeId(id))
    }
  }
  return [...set]
}

// 深度合并：对象递归合并，数组与其它类型直接覆盖
export function mergeDeep<T>(base: T, override: any): T {
  if (override === undefined || override === null) return base
  if (Array.isArray(base) || Array.isArray(override)) return override as unknown as T
  if (typeof base === 'object' && typeof override === 'object') {
    const out: any = { ...base }
    for (const key of Object.keys(override)) {
      out[key] = mergeDeep((base as any)[key], override[key])
    }
    return out
  }
  return override as unknown as T
}

function isEmptyValue(value: any): boolean {
  if (value === undefined || value === null || value === '') return true
  if (Array.isArray(value) && value.length === 0) return true
  return false
}

// 生效配置合并：覆盖值若为空（空串/空数组）则回退到基础值（用于「群级空则用全局」）
export function mergeEffective<T>(base: T, override: any): T {
  if (isEmptyValue(override)) return base
  if (Array.isArray(base) || Array.isArray(override)) return override as unknown as T
  if (typeof base === 'object' && typeof override === 'object') {
    const out: any = { ...base }
    for (const key of Object.keys(override)) {
      out[key] = mergeEffective((base as any)[key], override[key])
    }
    return out
  }
  return override as unknown as T
}

export function template(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`)
}

// 校验目标是否是「私聊」（target 为 QQ 号而非群号）
export function isPrivateChat(session: Session): boolean {
  return (session as any).isDirect === true || (session.subtype === 'private') || (session.channelId === session.userId)
}

export function resolveTarget(session: Session): string {
  return idOf(session.guildId ?? session.channelId)
}

// 命令前缀统一使用
export const PREFIX = ''

export function logger(ctx: Context) {
  return ctx.logger('全方面QQ群管')
}