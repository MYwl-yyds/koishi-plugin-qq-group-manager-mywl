import { Context } from 'koishi'
import {
  PermissionGroup, GroupConfigRecord, GlobalConfigRecord, BlacklistEntry,
  WhitelistEntry, LogEntry, JoinRequestRecord,
} from '../types'

// 注册数据库表结构
let modelsInited = false
export function initModels(ctx: Context): void {
  if (modelsInited) return
  modelsInited = true
  ctx.model.extend('gm_permission_group', {
    id: 'unsigned',
    name: 'string',
    priority: 'integer',
    isDefault: 'boolean',
    members: 'json',
    groupIds: 'json',
    perms: 'json',
  }, { autoInc: true })

  ctx.model.extend('gm_group_config', {
    id: 'unsigned',
    groupId: 'string',
    config: 'json',
  }, { autoInc: true })

  ctx.model.extend('gm_global_config', {
    id: 'unsigned',
    config: 'json',
  }, { autoInc: true })

  ctx.model.extend('gm_blacklist', {
    id: 'unsigned',
    userId: 'string',
    groupId: 'string',
    source: 'string',
    createdAt: 'date',
  }, { autoInc: true })

  ctx.model.extend('gm_whitelist', {
    id: 'unsigned',
    userId: 'string',
    groupId: 'string',
    exemptReport: 'boolean',
    exemptJoin: 'boolean',
    exemptBannedWord: 'boolean',
    createdAt: 'date',
  }, { autoInc: true })

  ctx.model.extend('gm_log', {
    id: 'unsigned',
    type: 'string',
    action: 'string',
    operatorId: 'string',
    operatorName: 'string',
    targetId: 'string',
    groupId: 'string',
    detail: 'text',
    result: 'string',
    createdAt: 'date',
  }, { autoInc: true })

  ctx.model.extend('gm_join_request', {
    id: 'unsigned',
    flag: 'string',
    subType: 'string',
    groupId: 'string',
    userId: 'string',
    nickname: 'string',
    comment: 'text',
    status: 'string',
    reviewers: 'json',
    notified: 'json',
    createdAt: 'date',
    expireAt: 'date',
  }, { autoInc: true })
}

// 通用存储服务：封装数据库 CRUD
export class Store {
  private db: any
  private log: any

  constructor(ctx: Context) {
    this.db = ctx.database
    this.log = ctx.logger('store')
  }

  // ---------- 黑名单 ----------
  async blacklistAdd(userId: string, source: BlacklistEntry['source'] = 'manual', groupId = ''): Promise<void> {
    // 白名单本身豁免被加入黑名单（全局白名单或本群白名单命中即跳过）
    const wlGlobal = await this.db.get('gm_whitelist', { userId, groupId: '' })
    const wlGroup = groupId ? await this.db.get('gm_whitelist', { userId, groupId }) : []
    if (wlGlobal.length > 0 || wlGroup.length > 0) return

    const existing = await this.db.get('gm_blacklist', { userId, groupId })
    if (existing.length > 0) {
      await this.db.set('gm_blacklist', { userId, groupId }, { source, createdAt: new Date() })
      return
    }
    await this.db.create('gm_blacklist', { userId, groupId, source, createdAt: new Date() })
  }

  async blacklistRemove(userId: string, groupId = ''): Promise<boolean> {
    const res = await this.db.remove('gm_blacklist', { userId, groupId })
    return (res as any)?.removed > 0 || (res as any)?.[0]?.removed > 0 || !!res
  }

  async blacklistList(groupId?: string): Promise<BlacklistEntry[]> {
    const query = groupId === undefined ? {} : { groupId }
    return this.db.get('gm_blacklist', query, { sort: { createdAt: 'desc' } })
  }

  // 命中黑名单：applyGlobal 为 true 时仅检查全局黑名单，否则仅检查该群黑名单
  async blacklistHas(userId: string, groupId = '', applyGlobal = true): Promise<boolean> {
    const query: any = applyGlobal ? { userId, groupId: '' } : { userId, groupId }
    const res = await this.db.get('gm_blacklist', query)
    return res.length > 0
  }

  // 将某群的黑名单迁移到全局黑名单
  async blacklistMoveToGlobal(userId: string, groupId: string): Promise<boolean> {
    const res = await this.db.get('gm_blacklist', { userId, groupId })
    if (res.length === 0) return false
    await this.blacklistAdd(userId, res[0].source, '')
    await this.blacklistRemove(userId, groupId)
    return true
  }

  // ---------- 白名单 ----------
  async whitelistAdd(userId: string, groupId = '', flags: Partial<Pick<WhitelistEntry, 'exemptReport' | 'exemptJoin' | 'exemptBannedWord'>> = {}): Promise<void> {
    const existing = await this.db.get('gm_whitelist', { userId, groupId })
    const data = {
      exemptReport: flags.exemptReport ?? true,
      exemptJoin: flags.exemptJoin ?? true,
      exemptBannedWord: flags.exemptBannedWord ?? true,
    }
    if (existing.length > 0) {
      await this.db.set('gm_whitelist', { userId, groupId }, { ...data, createdAt: new Date() })
      return
    }
    await this.db.create('gm_whitelist', { userId, groupId, ...data, createdAt: new Date() })
  }

  async whitelistUpdate(userId: string, groupId: string, patch: Partial<WhitelistEntry>): Promise<void> {
    await this.db.set('gm_whitelist', { userId, groupId }, patch as any)
  }

  async whitelistRemove(userId: string, groupId = ''): Promise<boolean> {
    const res = await this.db.remove('gm_whitelist', { userId, groupId })
    return (res as any)?.removed > 0 || (res as any)?.[0]?.removed > 0 || !!res
  }

  async whitelistList(groupId?: string): Promise<WhitelistEntry[]> {
    const query = groupId === undefined ? {} : { groupId }
    return this.db.get('gm_whitelist', query, { sort: { createdAt: 'desc' } })
  }

  // 获取某用户的白名单条目（applyGlobal 为 true 查全局，否则查该群）
  async whitelistEntry(userId: string, groupId = '', applyGlobal = true): Promise<WhitelistEntry | undefined> {
    const scope = applyGlobal ? '' : groupId
    const res = await this.db.get('gm_whitelist', { userId, groupId: scope })
    return res[0]
  }

  // 将某群的白名单迁移到全局白名单
  async whitelistMoveToGlobal(userId: string, groupId: string): Promise<boolean> {
    const res = await this.db.get('gm_whitelist', { userId, groupId })
    if (res.length === 0) return false
    await this.whitelistAdd(userId, '', res[0])
    await this.whitelistRemove(userId, groupId)
    return true
  }

  // ---------- 权限组 ----------
  async permissionGroups(): Promise<PermissionGroup[]> {
    return this.db.get('gm_permission_group', {}, { sort: { priority: 'desc' } })
  }

  async permissionGroupByName(name: string): Promise<PermissionGroup | undefined> {
    const res = await this.db.get('gm_permission_group', { name })
    return res[0]
  }

  async permissionGroupCreate(data: Omit<PermissionGroup, 'id'>): Promise<PermissionGroup> {
    return (await this.db.create('gm_permission_group', data as any)) as unknown as PermissionGroup
  }

  async permissionGroupUpdate(id: number, patch: Partial<PermissionGroup>): Promise<void> {
    await this.db.set('gm_permission_group', { id }, patch as any)
  }

  async permissionGroupRemove(id: number): Promise<void> {
    await this.db.remove('gm_permission_group', { id })
  }

  // ---------- 群级配置 ----------
  async groupConfigGet(groupId: string): Promise<GroupConfigRecord | undefined> {
    const res = await this.db.get('gm_group_config', { groupId })
    return res[0]
  }

  async groupConfigSet(groupId: string, config: any): Promise<void> {
    const existing = await this.db.get('gm_group_config', { groupId })
    if (existing.length > 0) {
      await this.db.set('gm_group_config', { id: existing[0].id }, { config })
    } else {
      await this.db.create('gm_group_config', { groupId, config })
    }
  }

  async groupConfigAll(): Promise<GroupConfigRecord[]> {
    return this.db.get('gm_group_config', {})
  }

  // 删除某群的全部配置记录（彻底移除，区别于「重置为全局」）
  async groupConfigRemove(groupId: string): Promise<void> {
    await this.db.remove('gm_group_config', { groupId })
  }

  // ---------- 全局覆盖配置 ----------
  async globalConfigGet(): Promise<GlobalConfigRecord | undefined> {
    const res = await this.db.get('gm_global_config', {})
    return res[0]
  }

  async globalConfigSet(config: any): Promise<void> {
    const existing = await this.db.get('gm_global_config', {})
    if (existing.length > 0) {
      await this.db.set('gm_global_config', { id: existing[0].id }, { config })
    } else {
      await this.db.create('gm_global_config', { config })
    }
  }

  // ---------- 入群申请 ----------
  async joinRequestCreate(data: Omit<JoinRequestRecord, 'id'>): Promise<JoinRequestRecord> {
    return (await this.db.create('gm_join_request', data as any)) as unknown as JoinRequestRecord
  }

  async joinRequestByFlag(flag: string): Promise<JoinRequestRecord | undefined> {
    const res = await this.db.get('gm_join_request', { flag })
    return res[0]
  }

  async joinRequestUpdate(flag: string, patch: Partial<JoinRequestRecord>): Promise<void> {
    await this.db.set('gm_join_request', { flag }, patch as any)
  }

  async joinRequestList(status?: string): Promise<JoinRequestRecord[]> {
    const query = status ? { status } : {}
    return this.db.get('gm_join_request', query, { sort: { createdAt: 'desc' } })
  }

  async joinRequestRemove(flag: string): Promise<void> {
    await this.db.remove('gm_join_request', { flag })
  }

  async joinRequestCountRecent(userId: string, groupId: string, since: Date): Promise<number> {
    const res = await this.db.get('gm_join_request', { userId, groupId, createdAt: { $gte: since } })
    return res.length
  }

  // 清理过期申请（由定时器调用）
  async joinRequestCleanup(): Promise<void> {
    await this.db.remove('gm_join_request', { status: 'pending', expireAt: { $lt: new Date() } })
  }

  // ---------- 日志 ----------
  // 日志最大保留条数，超出自动删除最早日志
  private static readonly MAX_LOG_COUNT = 500

  async logAdd(entry: Omit<LogEntry, 'id' | 'createdAt'>): Promise<void> {
    await this.db.create('gm_log', { ...entry, createdAt: new Date() } as any)
    await this.pruneLogs().catch((e) => this.log.warn('清理日志失败', e))
  }

  // 删除最早的日志，保持总量不超过 MAX_LOG_COUNT
  async pruneLogs(): Promise<void> {
    const all = await this.db.get('gm_log', {}, { sort: { createdAt: 'asc' } })
    if (all.length <= Store.MAX_LOG_COUNT) return
    const overflow = all.slice(0, all.length - Store.MAX_LOG_COUNT)
    for (const l of overflow) {
      await this.db.remove('gm_log', { id: l.id })
    }
  }

  // 清空全部日志（空查询在部分驱动下不生效，逐个按主键删除保证可靠）
  async logClear(): Promise<void> {
    const all = await this.db.get('gm_log', {})
    for (const row of all) {
      await this.db.remove('gm_log', { id: row.id })
    }
  }

  // 统计某用户在某群、某时间段内的某类日志数量
  async logCountRecent(type: string, operatorId: string, groupId: string, since: Date): Promise<number> {
    const res = await this.db.get('gm_log', { type, operatorId, groupId, createdAt: { $gte: since } })
    return Array.isArray(res) ? res.length : 0
  }

  async logQuery(type?: string, limit = 200): Promise<LogEntry[]> {
    const query: any = {}
    if (type) query.type = type
    return this.db.get('gm_log', query, { sort: { createdAt: 'desc' }, limit })
  }
}