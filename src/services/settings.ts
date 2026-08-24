import { Context } from 'koishi'
import { Store } from './store'
import { Config, GroupConfigRecord } from '../types'
import { DEFAULT_CONFIG } from '../constants'
import { mergeDeep, mergeEffective } from '../utils'

// 设置服务：解析「Schema 默认 → 全局覆盖 → 群级覆盖」三级配置
export class SettingsService {
  private store: Store
  private base: Config

  constructor(ctx: Context, store: Store, base: Config) {
    this.store = store
    this.base = base
  }

  private fallback(): Config {
    return mergeDeep(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), this.base)
  }

  // 全局生效配置（Schema + DB 全局覆盖）
  async getGlobal(): Promise<Config> {
    const override = await this.store.globalConfigGet()
    if (!override?.config) return this.fallback()
    return mergeEffective(this.fallback(), override.config)
  }

  async setGlobal(patch: Partial<Config>): Promise<void> {
    const current = await this.store.globalConfigGet()
    const merged = mergeDeep(current?.config ?? {}, patch)
    await this.store.globalConfigSet(merged)
  }

  // 某群生效配置（全局 + 群级覆盖，群级为空值则回退全局）
  async getGroup(groupId: string): Promise<Config> {
    const global = await this.getGlobal()
    const rec = await this.store.groupConfigGet(groupId)
    if (!rec?.config) return global
    return mergeEffective(global, rec.config)
  }

  async setGroup(groupId: string, patch: Partial<Config>): Promise<void> {
    const current = await this.store.groupConfigGet(groupId)
    const merged = mergeDeep(current?.config ?? {}, patch)
    await this.store.groupConfigSet(groupId, merged)
  }

  async clearGroup(groupId: string): Promise<void> {
    await this.store.groupConfigSet(groupId, {})
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