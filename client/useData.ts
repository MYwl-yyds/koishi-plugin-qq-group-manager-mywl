import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { send, store } from '@koishijs/client'

// 最近一次成功取数的时间（顶部状态栏展示用）
export const lastLoadedAt = ref(Date.now())

// ========== 数据域缓存 ==========
// 每个域单独缓存，页面切换时直接用缓存渲染，再在后台静默刷新，
// 避免旧版「切页重新拉全量快照」造成的卡顿。
export interface ScopeState<T = any> {
  data: Ref<T | null>
  loading: Ref<boolean>
  error: Ref<string>
  stale: Ref<boolean>
  /** 重新取数；extraParams 会覆盖 options.params 的同名字段，force=true 跳过缓存 */
  refresh: (extraParams?: any, force?: boolean) => Promise<T | null>
}

const cache = new Map<string, { data: any, at: number }>()
// 每个域「最后一次成功的数据」，仅用于切页时立即出画面（不参与命中判断，
// 因为带 params 的域缓存键不同，但用户回到该页时仍希望先看到上次内容）
const latest = new Map<string, any>()
// 缓存有效期：10 秒内的重复请求直接复用，切页不卡
const CACHE_TTL = 10_000

export function invalidateScope(scope?: string) {
  if (scope) {
    cache.delete(scope)
    latest.delete(scope)
    // 同时清掉该域带参数的历史缓存键（如 groupDetail:{"groupId":"123"}）
    for (const key of [...cache.keys()]) if (key.startsWith(scope + ':')) cache.delete(key)
  } else {
    cache.clear()
    latest.clear()
  }
}

const pending = new Map<string, Promise<any>>()

async function fetchScope(scope: string, params: any = {}, force = false): Promise<any> {
  const key = scope + (params && Object.keys(params).length ? ':' + JSON.stringify(params) : '')
  const hit = cache.get(key)
  if (!force && hit && Date.now() - hit.at < CACHE_TTL) return hit.data
  if (!force && pending.has(key)) return pending.get(key)
  const task = send('qq-guanqun/scope', { scope, params })
    .then((res: any) => {
      if (!res?.ok) throw new Error(res?.error || '加载失败')
      cache.set(key, { data: res.data, at: Date.now() })
      latest.set(scope, res.data)
      return res.data
    })
    .finally(() => { pending.delete(key) })
  pending.set(key, task)
  return task
}

// 通用域数据 Hook
export function useScope<T = any>(scope: string, options: {
  params?: () => any
  autoRefreshMs?: number
  immediate?: boolean
} = {}): ScopeState<T> {
  // 优先用「同参数」缓存，其次用该域上次的数据（切换页面时先出画面再静默刷新）。
  // 注意：带参数域（如 groupDetail / memberCheck 按群号取数）回退到 latest 时，
  // 拿到的可能是「别的参数」的数据。页面必须校验返回数据里的 groupId 是否等于当前群号，
  // 否则会用上一个群的内容回填表单 —— GroupDetail.vue / MemberCheck.vue 均已加该校验。
  const initParams = options.params?.() || {}
  const exactKey = scope + (Object.keys(initParams).length ? ':' + JSON.stringify(initParams) : '')
  const data = ref<T | null>((cache.get(exactKey)?.data ?? latest.get(scope) ?? null)) as Ref<T | null>
  const loading = ref(false)
  const error = ref('')
  // 有旧数据时标记为 stale，页面可显示「更新中」而不至于空白
  const stale = ref(!!data.value)
  let timer: any = null
  let disposed = false

  async function refresh(extraParams?: any, force = false) {
    // 组件已卸载：直接拒绝，不再发起请求（避免无意义的后台请求）
    if (disposed) return null
    const params = { ...(options.params?.() || {}), ...(extraParams || {}) }
    // 已有数据时视为「后台刷新」：页面继续展示旧内容，只标记更新中，避免骨架屏闪烁
    loading.value = true
    if (data.value) stale.value = true
    error.value = ''
    try {
      const result = await fetchScope(scope, params, force)
      // 卸载后就不要再写入 ref 了（Vue 会警告），但要保证 loading 归位
      if (disposed) return result
      data.value = result
      stale.value = false
      lastLoadedAt.value = Date.now()
      return result
    } catch (e) {
      // 有缓存时降级展示旧数据，只提示错误
      if (!disposed) {
        error.value = (e as Error).message || '加载失败'
        stale.value = !!data.value
      }
      return null
    } finally {
      if (!disposed) loading.value = false
    }
  }

  onMounted(() => {
    if (options.immediate !== false) refresh()
    if (options.autoRefreshMs) {
      timer = setInterval(() => {
        // 页面不可见时不轮询，减少无谓请求
        if (typeof document !== 'undefined' && document.hidden) return
        refresh(undefined, true)
      }, options.autoRefreshMs)
    }
  })
  onBeforeUnmount(() => {
    disposed = true
    if (timer) clearInterval(timer)
  })

  return { data, loading, error, stale, refresh }
}

// ========== 变更 ==========
// 变更成功后后端会重建受影响的数据域并连同数据一起返回（见 webui 的 handleMutate 末尾），
// 因此这里应当**直接采用**返回的数据，而不是丢弃后再发一次 scope 请求 ——
// 后者会让每次保存都变成两次串行往返，是「保存时很慢」的主因。
//
// 缓存写入规则：
// - 无参数域（groups / settings / lists …）：写入以域名为键的缓存；
// - 带参数域（groupDetail / memberCheck）：后端返回的是「本次操作对应的那份数据」，
//   按 mutate 时传入的 params（或 groupId）拼出同样的键写入，这样页面下次读到的就是它。
const PARAM_SCOPES: Record<string, string> = {
  groupDetail: 'groupId',
  memberCheck: 'groupId',
}

export async function mutate(action: string, payload: any = {}, extraParams: any = {}): Promise<any> {
  try {
    const res = await send('qq-guanqun/mutate', { action, data: payload })
    if (res?.ok && res.scope) {
      if (res.data !== undefined) {
        // 带参数域：用 groupId 重建与 useScope 完全一致的缓存键
        const paramKey = PARAM_SCOPES[res.scope]
        if (paramKey) {
          const gid = payload?.[paramKey]
          if (gid !== undefined && gid !== null && gid !== '') {
            cache.set(`${res.scope}:${JSON.stringify({ [paramKey]: String(gid) })}`, { data: res.data, at: Date.now() })
          }
          latest.set(res.scope, res.data)
        } else {
          cache.set(res.scope, { data: res.data, at: Date.now() })
          latest.set(res.scope, res.data)
        }
      } else {
        invalidateScope(res.scope)
      }
    }
    return res
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// 把某个变更返回的数据直接喂给页面（免去保存后再发一次请求）。
// 只有「响应里的 scope 与目标域一致」时才采用，避免把 A 域的数据塞进 B 域的 ref
// （例如 setGroup 返回的是 groupDetail，不能拿去填 lists）。
// 用法：const res = await mutate(...); applyMutated(res, 'lists', myDataRef)
export function applyMutated(res: any, scope: string, ...targets: Array<{ value: any } | undefined>) {
  if (!res?.ok || res.data === undefined || res.scope !== scope) return false
  for (const t of targets) if (t) t.value = res.data
  return true
}

// 变更后再按需重新拉取（用于列表类域，保证分页/筛选条件正确）
export async function mutateAnd(scope: string, action: string, payload: any, params: any = {}): Promise<any> {
  const res = await mutate(action, payload)
  if (res?.ok) invalidateScope(scope)
  return res
}

// 兼容旧接口（首页 fields 提供的初始快照）
export function initialSnapshot(): any {
  return (store as any)[DATA_KEY] ?? null
}

export const DATA_KEY = 'qq-guanqun'

// ========== 工具函数 ==========
export function formatTime(v: string | Date | number | undefined): string {
  if (!v) return '-'
  const d = new Date(v)
  if (isNaN(d.getTime())) return String(v)
  return d.toLocaleString()
}

export function formatDate(v: string | Date | number | undefined): string {
  if (!v) return '-'
  const d = new Date(v)
  if (isNaN(d.getTime())) return String(v)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '-'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  return `${h} 小时 ${m % 60} 分`
}

export function relativeTime(v: string | Date | number | undefined): string {
  if (!v) return '-'
  const t = new Date(v).getTime()
  if (!Number.isFinite(t) || t <= 0) return '-'
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

// 文本 → 去重数组（支持逗号 / 空格 / 换行 / 分号分隔）
export function splitList(input: any): string[] {
  if (Array.isArray(input)) return [...new Set(input.map((x) => String(x).trim()).filter(Boolean))]
  const raw = String(input ?? '')
  if (!raw.trim()) return []
  return [...new Set(raw.split(/[\n,，;；\s]+/).map((x) => x.trim()).filter(Boolean))]
}

export function useDebouncedRef<T>(source: Ref<T>, delay = 300): Ref<T> {
  const out = ref(source.value) as Ref<T>
  let timer: any = null
  watch(source, (v) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { out.value = v }, delay)
  })
  return out
}

export function useCountdown() {
  const now = ref(Date.now())
  const timer = setInterval(() => { now.value = Date.now() }, 1000)
  onBeforeUnmount(() => clearInterval(timer))
  return now
}

export { computed, ref }
