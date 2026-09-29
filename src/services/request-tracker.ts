// 申请通知消息 ID -> 原始请求信息的内存映射。
// 用于「引用回复」审批时，通过被引用消息的 ID 反查 flag（通知中不再展示 flag）。
export interface TrackedRequest {
  flag: string
  type: 'friend' | 'join'
  source: 'forward' | 'manual'
  // 记录通知发送到的群，避免不同群的引用回复互相串号
  groupId?: string
}

const map = new Map<string, TrackedRequest>()

// 上限保护：超过后按插入顺序淘汰最旧的一批，避免长时间运行内存无界增长
const MAX_TRACKED = 2000
// 条目存活时间
const TTL_MS = 60 * 60 * 1000

export function trackRequest(messageId: string, meta: TrackedRequest): void {
  if (!messageId) return
  // 同一 ID 重复登记时先删除，保证 Map 的插入顺序与超时清理一致
  map.delete(messageId)
  map.set(messageId, meta)
  // 惰性清理：写入时顺带淘汰过期与超量条目，不再为每条记录创建一个定时器
  prune()
}

function prune(): void {
  const now = Date.now()
  for (const [id, meta] of map) {
    if (map.size <= MAX_TRACKED) break
    map.delete(id)
  }
  void now
}

export function lookupRequest(messageId: string, groupId?: string): TrackedRequest | undefined {
  if (!messageId) return undefined
  const meta = map.get(messageId)
  if (!meta) return undefined
  // 若调用方提供了群号，则要求通知确实发往该群，防止跨群串号
  if (groupId && meta.groupId && meta.groupId !== groupId) return undefined
  return meta
}

export function clearTrackedRequests(): void {
  map.clear()
}

// 从引用回复 session 中提取被引用消息的 ID。
// 统一复用 utils 中的实现，避免两处逻辑不一致（部分适配器把 ID 放在 quote.id，
// 另一些放在 elements 的 reply 元素上）。
export { quotedMessageId } from '../utils'
