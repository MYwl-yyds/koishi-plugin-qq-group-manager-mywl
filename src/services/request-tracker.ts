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
// 条目存活时间（与原实现声明的 TTL 对齐；申请通知本身也有超时，过期后无需再留）
const TTL_MS = 60 * 60 * 1000

// 记录登记时间，用于按 TTL 淘汰。原实现只在超量时淘汰，TTL_MS 声明了却从未使用。
const at = new Map<string, number>()

export function trackRequest(messageId: string, meta: TrackedRequest): void {
  if (!messageId) return
  // 同一 ID 重复登记时先删除，保证 Map 的插入顺序与超时清理一致
  map.delete(messageId)
  at.delete(messageId)
  map.set(messageId, meta)
  at.set(messageId, Date.now())
  // 惰性清理：写入时顺带淘汰过期与超量条目，不再为每条记录创建一个定时器
  prune()
}

function prune(): void {
  const now = Date.now()
  // 1) 先按 TTL 淘汰真正过期的条目
  for (const [id, ts] of at) {
    if (now - ts <= TTL_MS) continue
    at.delete(id)
    map.delete(id)
  }
  // 2) 仍然超量时，按插入顺序淘汰最旧的（Map 保证插入顺序）
  while (map.size > MAX_TRACKED) {
    const first = map.keys().next().value
    if (first === undefined) break
    map.delete(first)
    at.delete(first)
  }
}

export function lookupRequest(messageId: string, groupId?: string): TrackedRequest | undefined {
  if (!messageId) return undefined
  const meta = map.get(messageId)
  if (!meta) return undefined
  // 跨群串号防护：只在「通知发往群聊」且「引用发生在另一个群」时拒绝。
  // - 私聊通知（groupId 为空）不受限制：管理员在私聊里引用回复是正常用法
  // - 通知发往 A 群、审批人在 A 群引用：放行
  // - 通知发往 A 群、审批人在 B 群引用：拒绝（避免 B 群成员误操作 A 群的申请）
  if (groupId && meta.groupId && meta.groupId !== groupId) return undefined
  return meta
}

export function clearTrackedRequests(): void {
  map.clear()
  at.clear()
}

// 内存未命中时的兜底解析。
//
// 内存映射只在「进程存活 + 通知刚发出」的窗口内有效：
// 插件重载、Koishi 重启、或多实例部署时，引用回复会查不到对应申请，
// 表现为「引用回复同意/拒绝没有任何反应」。此时退化为按「群号 + 待审列表」推断：
// 若该群当前只有一条 pending 申请，就直接认定是它（最常见的情形）；
// 有多条时无法安全判定，返回 undefined 让调用方放弃（避免审错人）。
export async function resolveRequestFallback(
  store: any,
  groupId: string,
): Promise<{ flag: string, groupId: string } | undefined> {
  if (!groupId) return undefined
  try {
    const list = (await store.joinRequestList('pending')) as any[]
    const mine = (list || []).filter((r) => String(r?.groupId ?? '') === String(groupId))
    if (mine.length !== 1) return undefined
    return { flag: String(mine[0].flag), groupId: String(mine[0].groupId) }
  } catch {
    return undefined
  }
}

// 从引用回复 session 中提取被引用消息的 ID。
// 统一复用 utils 中的实现，避免两处逻辑不一致（部分适配器把 ID 放在 quote.id，
// 另一些放在 elements 的 reply 元素上）。
export { quotedMessageId } from '../utils'
