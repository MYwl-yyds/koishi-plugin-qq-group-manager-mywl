import { Context } from 'koishi'
import {
  PermissionGroup, GroupConfigRecord, GlobalConfigRecord, BlacklistEntry,
  WhitelistEntry, LogEntry, JoinRequestRecord, MemberCheckState, BannedImageEntry,
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

  // 群员检查状态：成员最近活跃时间 / 最近处理时间（冷却去重）
  ctx.model.extend('gm_member_state', {
    id: 'unsigned',
    groupId: 'string',
    userId: 'string',
    activeAt: 'date',
    checkedAt: 'date',
    lastAction: 'string',
  }, { autoInc: true })

  // 违规图片样本库（感知哈希）
  // groupId 为空串 = 全局样本；非空 = 该群专属样本
  ctx.model.extend('gm_banned_image', {
    id: 'unsigned',
    hash: 'string',
    groupId: 'string',
    source: 'string',
    origin: 'text',
    label: 'string',
    width: 'integer',
    height: 'integer',
    format: 'string',
    createdAt: 'date',
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
  // 加入黑名单。返回是否实际写入（若命中白名单则被豁免，返回 false）
  async blacklistAdd(userId: string, source: BlacklistEntry['source'] = 'manual', groupId = ''): Promise<boolean> {
    // 白名单本身豁免被加入黑名单（全局白名单或本群白名单命中即跳过）
    const wlGlobal = await this.db.get('gm_whitelist', { userId, groupId: '' })
    const wlGroup = groupId ? await this.db.get('gm_whitelist', { userId, groupId }) : []
    if (wlGlobal.length > 0 || wlGroup.length > 0) return false

    const existing = await this.db.get('gm_blacklist', { userId, groupId })
    if (existing.length > 0) {
      await this.db.set('gm_blacklist', { userId, groupId }, { source, createdAt: new Date() })
      return true
    }
    await this.db.create('gm_blacklist', { userId, groupId, source, createdAt: new Date() })
    return true
  }

  async blacklistRemove(userId: string, groupId = ''): Promise<boolean> {
    const before = await this.db.get('gm_blacklist', { userId, groupId })
    if (!Array.isArray(before) || before.length === 0) return false
    await this.db.remove('gm_blacklist', { userId, groupId })
    return true
  }

  async blacklistList(groupId?: string): Promise<BlacklistEntry[]> {
    const query = groupId === undefined ? {} : { groupId }
    return this.db.get('gm_blacklist', query, { sort: { createdAt: 'desc' } })
  }

  // 仅统计数量（WebUI 概览用，避免把整张表传给前端）
  async blacklistCount(groupId?: string): Promise<number> {
    const query = groupId === undefined ? {} : { groupId }
    const rows = await this.db.get('gm_blacklist', query)
    return Array.isArray(rows) ? rows.length : 0
  }

  // 命中黑名单：applyGlobal 为 true 时仅检查全局黑名单，否则仅检查该群黑名单
  async blacklistHas(userId: string, groupId = '', applyGlobal = true): Promise<boolean> {
    const query: any = applyGlobal ? { userId, groupId: '' } : { userId, groupId }
    const res = await this.db.get('gm_blacklist', query)
    return res.length > 0
  }

  // 将某群的黑名单迁移到全局黑名单。
  // 只有全局写入成功才删除原记录，避免「命中白名单被豁免」时静默丢数据。
  async blacklistMoveToGlobal(userId: string, groupId: string): Promise<boolean> {
    const res = await this.db.get('gm_blacklist', { userId, groupId })
    if (res.length === 0) return false
    const ok = await this.blacklistAdd(userId, res[0].source, '')
    if (!ok) return false
    await this.blacklistRemove(userId, groupId)
    return true
  }

  // ---------- 白名单 ----------
  async whitelistAdd(
    userId: string,
    groupId = '',
    flags: Partial<Pick<WhitelistEntry, 'exemptReport' | 'exemptJoin' | 'exemptBannedWord'>> = {},
    // 迁移场景下保留原始加入时间，避免审计信息丢失
    createdAt?: Date,
  ): Promise<void> {
    const existing = await this.db.get('gm_whitelist', { userId, groupId })
    // 仅当调用方显式传入时才覆盖，未传的字段保持既有值（避免误把豁免项重置为全开）
    const data = {
      exemptReport: flags.exemptReport ?? existing[0]?.exemptReport ?? true,
      exemptJoin: flags.exemptJoin ?? existing[0]?.exemptJoin ?? true,
      exemptBannedWord: flags.exemptBannedWord ?? existing[0]?.exemptBannedWord ?? true,
    }
    if (existing.length > 0) {
      await this.db.set('gm_whitelist', { userId, groupId }, {
        ...data,
        createdAt: createdAt ?? existing[0]?.createdAt ?? new Date(),
      })
      return
    }
    await this.db.create('gm_whitelist', {
      userId, groupId, ...data,
      createdAt: createdAt ?? new Date(),
    })
  }

  async whitelistUpdate(userId: string, groupId: string, patch: Partial<WhitelistEntry>): Promise<boolean> {
    const before = await this.db.get('gm_whitelist', { userId, groupId })
    if (!Array.isArray(before) || before.length === 0) return false
    await this.db.set('gm_whitelist', { userId, groupId }, patch as any)
    return true
  }

  async whitelistRemove(userId: string, groupId = ''): Promise<boolean> {
    const before = await this.db.get('gm_whitelist', { userId, groupId })
    if (!Array.isArray(before) || before.length === 0) return false
    await this.db.remove('gm_whitelist', { userId, groupId })
    return true
  }

  async whitelistList(groupId?: string): Promise<WhitelistEntry[]> {
    const query = groupId === undefined ? {} : { groupId }
    return this.db.get('gm_whitelist', query, { sort: { createdAt: 'desc' } })
  }

  async whitelistCount(groupId?: string): Promise<number> {
    const query = groupId === undefined ? {} : { groupId }
    const rows = await this.db.get('gm_whitelist', query)
    return Array.isArray(rows) ? rows.length : 0
  }

  // 获取某用户的白名单条目（applyGlobal 为 true 查全局，否则查该群）
  async whitelistEntry(userId: string, groupId = '', applyGlobal = true): Promise<WhitelistEntry | undefined> {
    const scope = applyGlobal ? '' : groupId
    const res = await this.db.get('gm_whitelist', { userId, groupId: scope })
    return res[0]
  }

  // 将某群的白名单迁移到全局白名单（保留原始加入时间）
  async whitelistMoveToGlobal(userId: string, groupId: string): Promise<boolean> {
    const res = await this.db.get('gm_whitelist', { userId, groupId })
    if (res.length === 0) return false
    await this.whitelistAdd(userId, '', res[0], res[0].createdAt)
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

  // 清空全部权限组（导入 replace 模式使用）
  async permissionGroupClear(): Promise<void> {
    const rows = await this.db.get('gm_permission_group', {})
    for (const row of rows) await this.db.remove('gm_permission_group', { id: row.id })
  }

  // 按名称写入或更新权限组（导入使用，保证同名不重复）
  async permissionGroupUpsert(data: Omit<PermissionGroup, 'id'>): Promise<void> {
    const existing = await this.db.get('gm_permission_group', { name: data.name })
    if (existing.length > 0) {
      await this.db.set('gm_permission_group', { id: existing[0].id }, data as any)
      return
    }
    await this.db.create('gm_permission_group', data as any)
  }

  // 清空名单（导入 replace 模式使用）
  async blacklistClear(): Promise<void> {
    const rows = await this.db.get('gm_blacklist', {})
    for (const row of rows) await this.db.remove('gm_blacklist', { id: row.id })
  }

  async whitelistClear(): Promise<void> {
    const rows = await this.db.get('gm_whitelist', {})
    for (const row of rows) await this.db.remove('gm_whitelist', { id: row.id })
  }

  // 直接写入黑名单（导入使用）。绕过「白名单豁免」守卫，忠实还原导出内容。
  async blacklistUpsert(userId: string, groupId: string, source: string, createdAt?: Date): Promise<void> {
    const existing = await this.db.get('gm_blacklist', { userId, groupId })
    if (existing.length > 0) {
      await this.db.set('gm_blacklist', { id: existing[0].id }, { source, createdAt: createdAt ?? new Date() } as any)
      return
    }
    await this.db.create('gm_blacklist', { userId, groupId, source, createdAt: createdAt ?? new Date() } as any)
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
  private static readonly MAX_LOG_COUNT = 2000

  async logAdd(entry: Omit<LogEntry, 'id' | 'createdAt'>): Promise<void> {
    await this.db.create('gm_log', { ...entry, createdAt: new Date() } as any)
    // 清理按写入次数抽样执行，避免每条日志都做一次全表统计
    if (++this.logWriteCount % 50 === 0) {
      await this.pruneLogs().catch((e) => this.log.warn('清理日志失败', e))
    }
  }

  private logWriteCount = 0

  // 删除最早的日志，保持总量不超过 MAX_LOG_COUNT（直接按条数上限查询，避免全表加载）
  async pruneLogs(): Promise<void> {
    const total = await this.logCount()
    if (total <= Store.MAX_LOG_COUNT) return
    const overflow = await this.db.get('gm_log', {}, {
      sort: { createdAt: 'asc' },
      limit: total - Store.MAX_LOG_COUNT,
    })
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

  // ---------- 日志：分页 / 统计（WebUI 使用，避免一次性拉取全部日志） ----------
  async logCount(type?: string, since?: Date): Promise<number> {
    const query: any = {}
    if (type) query.type = type
    if (since) query.createdAt = { $gte: since }
    const arr = await this.db.get('gm_log', query)
    return Array.isArray(arr) ? arr.length : 0
  }

  async logPage(options: { type?: string, keyword?: string, page?: number, pageSize?: number, since?: Date } = {}): Promise<{ total: number, rows: LogEntry[] }> {
    const page = Math.max(1, Math.floor(options.page || 1))
    const pageSize = Math.min(200, Math.max(1, Math.floor(options.pageSize || 20)))
    const query: any = {}
    if (options.type) query.type = options.type
    if (options.since) query.createdAt = { $gte: options.since }
    const all = await this.db.get('gm_log', query, { sort: { createdAt: 'desc' } })
    let rows: LogEntry[] = Array.isArray(all) ? all : []
    const kw = String(options.keyword || '').trim()
    if (kw) {
      rows = rows.filter((l) => `${l.action} ${l.operatorId} ${l.operatorName} ${l.targetId} ${l.groupId} ${l.detail}`.includes(kw))
    }
    const total = rows.length
    return { total, rows: rows.slice((page - 1) * pageSize, page * pageSize) }
  }

  // 按时间范围取日志（用于趋势图统计，服务端聚合后仅返回汇总结果）
  async logSince(since: Date): Promise<LogEntry[]> {
    return this.db.get('gm_log', { createdAt: { $gte: since } }, { sort: { createdAt: 'asc' } })
  }

  // ---------- 群员检查状态 ----------
  async memberStateGet(groupId: string, userId: string): Promise<MemberCheckState | undefined> {
    const res = await this.db.get('gm_member_state', { groupId, userId })
    return res[0]
  }

  async memberStateList(groupId: string): Promise<MemberCheckState[]> {
    return this.db.get('gm_member_state', { groupId })
  }

  async memberStateSet(groupId: string, userId: string, patch: Partial<MemberCheckState>): Promise<void> {
    const existing = await this.db.get('gm_member_state', { groupId, userId })
    if (existing.length > 0) {
      await this.db.set('gm_member_state', { id: existing[0].id }, patch as any)
      return
    }
    await this.db.create('gm_member_state', { groupId, userId, activeAt: new Date(), checkedAt: new Date(0), lastAction: '', ...patch } as any)
  }

  // 记录成员活跃（发言）时间，供「只检查活跃成员」使用
  async memberTouch(groupId: string, userId: string): Promise<void> {
    await this.memberStateSet(groupId, userId, { activeAt: new Date() })
  }

  // ---------- 违规图片样本库 ----------
  // groupId 为空 = 全局样本（对所有群生效）；非空 = 该群专属样本。
  async bannedImageList(groupId?: string): Promise<BannedImageEntry[]> {
    const query = groupId === undefined ? {} : { groupId: String(groupId) }
    const rows = await this.db.get('gm_banned_image', query, { sort: { createdAt: 'desc' } })
    return Array.isArray(rows) ? rows : []
  }

  async bannedImageCount(): Promise<number> {
    const rows = await this.db.get('gm_banned_image', {})
    return Array.isArray(rows) ? rows.length : 0
  }

  // 新增样本图。同一哈希 + 同一归属只保留一条，避免重复入库导致比对开销增长
  async bannedImageAdd(entry: Omit<BannedImageEntry, 'id' | 'createdAt'>): Promise<boolean> {
    const groupId = String(entry.groupId || '')
    const existing = await this.db.get('gm_banned_image', { hash: entry.hash, groupId })
    if (Array.isArray(existing) && existing.length > 0) return false
    await this.db.create('gm_banned_image', { ...entry, groupId, createdAt: new Date() } as any)
    return true
  }

  async bannedImageRemove(id: number): Promise<boolean> {
    const rows = await this.db.get('gm_banned_image', { id })
    if (!Array.isArray(rows) || rows.length === 0) return false
    await this.db.remove('gm_banned_image', { id })
    return true
  }

  // 清空：不传 groupId 清空全部；传 groupId 只清该群的专属样本（不动全局样本）
  async bannedImageClear(groupId?: string): Promise<void> {
    const query = groupId === undefined ? {} : { groupId: String(groupId) }
    const rows = await this.db.get('gm_banned_image', query)
    for (const row of rows) await this.db.remove('gm_banned_image', { id: row.id })
  }
}