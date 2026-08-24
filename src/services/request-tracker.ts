// 申请通知消息 ID -> 原始请求信息的内存映射。
// 用于「引用回复」审批时，通过被引用消息的 ID 反查 flag（通知中不再展示 flag）。
export interface TrackedRequest {
  flag: string
  type: 'friend' | 'join'
  source: 'forward' | 'manual'
}

const map = new Map<string, TrackedRequest>()

export function trackRequest(messageId: string, meta: TrackedRequest): void {
  if (!messageId) return
  map.set(messageId, meta)
  // 1 小时后自动清理，避免内存泄漏
  setTimeout(() => { map.delete(messageId) }, 60 * 60 * 1000)
}

export function lookupRequest(messageId: string): TrackedRequest | undefined {
  if (!messageId) return undefined
  return map.get(messageId)
}

// 从引用回复 session 中提取被引用消息的 ID
export function quotedMessageId(session: any): string {
  const q = session?.quote
  if (!q) return ''
  return String(q.id ?? q.messageId ?? '')
}