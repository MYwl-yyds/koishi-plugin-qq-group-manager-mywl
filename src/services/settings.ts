import { Context } from 'koishi'
import { Store } from './store'
import { Config, GroupConfigRecord } from '../types'
import { DEFAULT_CONFIG } from '../constants'
import { mergeDeep, mergeEffective } from '../utils'

// 设置服务：解析「Schema 默认 → 全局覆盖 → 群级覆盖」三级配置
//
// 为避免违禁词等高频事件每次都读库，这里对全局配置与群级配置做短时缓存：
// - 任何写操作（setGlobal / setGroup / clearGroup）立即失效对应缓存
// - 读缓存的 TTL 很短（默认 5 秒），保证多进程/命令修改后仍能较快生效
export class SettingsService {
  private store: Store
  private base: Config
  private globalCache: { at: number, data: Config } | null = null
  private groupCache = new Map<string, { at: number, data: Config }>()
  private ttl = 5000

  constructor(ctx: Context, store: Store, base: Config) {
    this.store = store
    this.base = base
  }

  private fallback(): Config {
    return mergeDeep(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), this.base)
  }

  // 全局生效配置（Schema + DB 全局覆盖）
  async getGlobal(): Promise<Config> {
    if (this.globalCache && Date.now() - this.globalCache.at < this.ttl) return this.globalCache.data
    const override = await this.store.globalConfigGet()
    const data = !override?.config ? this.fallback() : mergeEffective(this.fallback(), override.config)
    this.globalCache = { at: Date.now(), data }
    return data
  }

  async setGlobal(patch: Partial<Config>): Promise<void> {
    const current = await this.store.globalConfigGet()
    const merged = mergeDeep(current?.config ?? {}, patch)
    await this.store.globalConfigSet(merged)
    this.invalidate()
  }

  // 整体替换全局覆盖配置（导入 replace 模式使用，不保留原有字段）
  async replaceGlobal(config: Partial<Config>): Promise<void> {
    await this.store.globalConfigSet(config ?? {})
    this.invalidate()
  }

  // 某群生效配置（全局 + 群级覆盖，群级为空值则回退全局）
  async getGroup(groupId: string): Promise<Config> {
    const gid = String(groupId ?? '')
    const hit = this.groupCache.get(gid)
    if (hit && Date.now() - hit.at < this.ttl) return hit.data
    const global = await this.getGlobal()
    const rec = await this.store.groupConfigGet(gid)
    const data = !rec?.config ? global : mergeEffective(global, rec.config)
    this.groupCache.set(gid, { at: Date.now(), data })
    if (this.groupCache.size > 500) {
      const first = this.groupCache.keys().next().value
      if (first !== undefined && first !== gid) this.groupCache.delete(first)
    }
    return data
  }

  // replace 为 true 时整体替换该群覆盖配置（导入使用），否则按字段合并
  async setGroup(groupId: string, patch: Partial<Config>, replace = false): Promise<void> {
    const current = await this.store.groupConfigGet(groupId)
    const merged = replace ? (patch ?? {}) : mergeDeep(current?.config ?? {}, patch)
    await this.store.groupConfigSet(groupId, merged)
    this.invalidate(groupId)
  }

  async clearGroup(groupId: string): Promise<void> {
    await this.store.groupConfigSet(groupId, {})
    this.invalidate(groupId)
  }

  // 失效缓存：不传 groupId 时清空全部
  invalidate(groupId?: string): void {
    this.globalCache = null
    if (groupId === undefined) this.groupCache.clear()
    else this.groupCache.delete(String(groupId))
  }

  async allGroups(): Promise<GroupConfigRecord[]> {
    return this.store.groupConfigAll()
  }

  // 判断某群是否启用了群管总开关（群级可用 enableGroupManagement 覆盖）
  async isEnabled(groupId: string): Promise<boolean> {
    const cfg = await this.getGroup(groupId)
    return cfg.enableGroupManagement !== false
  }
}
