import { Context } from 'koishi'
import { resolve } from 'path'
import { DataService } from '@koishijs/plugin-console'
import { Services, Config } from '../types'
import { ALL_COMMANDS, PERM_ITEMS } from '../services/permission'
import { parseLink, isWhitelisted } from '../services/link'
import { LOG_TYPES } from '../types'

export const DATA_KEY = 'qq-guanqun' as const

type MutateResponse = { ok: boolean, error?: string, snapshot?: any, scope?: string, data?: any }

// 构建某个「域」数据时的定位参数（如 groupDetail 需要 groupId）
type ScopeParams = Record<string, any>

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function clampInt(v: any, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

// ---------------- 概览（仪表盘） ----------------
// 只做聚合统计，不把明细日志传给前端，显著降低首屏体积
async function buildOverview(svc: Services, days = 7) {
  const [global, permissions, groups, pending, blacklistTotal, whitelistTotal] = await Promise.all([
    svc.settings.getGlobal(),
    svc.store.permissionGroups(),
    svc.store.groupConfigAll(),
    svc.store.joinRequestList('pending'),
    svc.store.blacklistCount(),
    svc.store.whitelistCount(),
  ])

  const since = new Date()
  since.setHours(0, 0, 0, 0)
  since.setDate(since.getDate() - (days - 1))

  const logs = await svc.store.logSince(since)

  // 趋势：按天 × 类型聚合
  const labels: string[] = []
  const trendMap: Record<string, any> = {}
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = formatDate(d)
    labels.push(key)
    trendMap[key] = { date: key, operation: 0, audit: 0, violation: 0, blacklist: 0 }
  }
  const violationDist: Record<string, number> = {}
  const typeTotals: Record<string, number> = { operation: 0, audit: 0, violation: 0, blacklist: 0 }
  for (const l of logs) {
    const key = formatDate(new Date(l.createdAt))
    if (trendMap[key] && trendMap[key][l.type] !== undefined) trendMap[key][l.type]++
    if (typeTotals[l.type] !== undefined) typeTotals[l.type]++
    if (l.type !== 'violation') continue
    let type = '其他'
    try {
      const parsed = JSON.parse(l.detail || '{}')
      if (parsed.type) type = parsed.type
    } catch { /* ignore */ }
    violationDist[type] = (violationDist[type] || 0) + 1
  }

  // 今日统计
  const todayKey = formatDate(new Date())
  const today = trendMap[todayKey] || { operation: 0, audit: 0, violation: 0, blacklist: 0 }

  return {
    updatedAt: Date.now(),
    stats: {
      configuredGroups: groups.length,
      permissionGroups: permissions.length,
      bannedWords: (global.bannedWords?.words || []).length,
      linkWhitelist: (global.bannedWords?.link?.whitelist || []).length,
      pendingReviews: pending.length,
      blacklistTotal: typeof blacklistTotal === 'number' ? blacklistTotal : 0,
      whitelistTotal: typeof whitelistTotal === 'number' ? whitelistTotal : 0,
      todayOperation: today.operation,
      todayViolation: today.violation,
    },
    typeTotals,
    logTrend: labels.map((d) => trendMap[d]),
    violationDist,
    // 群员检查：纯群级配置，这里统计「实际启用了检查的群数」与各检测项启用的群数
    memberCheck: await (async () => {
      const records = await svc.store.groupConfigAll()
      const kinds = { qqLevel: 0, card: 0, groupLevel: 0 }
      let enabledGroups = 0
      for (const rec of records) {
        const cfg = await svc.settings.getGroup(String(rec.groupId))
        const mc = cfg.memberCheck
        if (!mc?.enabled) continue
        const on = !!(mc.qqLevel?.enabled || mc.card?.enabled || mc.groupLevel?.enabled)
        if (!on) continue
        enabledGroups++
        if (mc.qqLevel?.enabled) kinds.qqLevel++
        if (mc.card?.enabled) kinds.card++
        if (mc.groupLevel?.enabled) kinds.groupLevel++
      }
      return {
        enabled: enabledGroups > 0,
        groupCount: enabledGroups,
        kinds,
        lastRunAt: svc.memberCheck?.getLastRunAt?.() ?? 0,
        lastResults: svc.memberCheck?.getLastResults?.() ?? [],
      }
    })(),
    pendingReviews: pending.slice(0, 50),
    recentLogs: (await svc.store.logPage({ page: 1, pageSize: 8 })).rows,
  }
}

// ---------------- 群聊（列表，不含各群完整配置） ----------------
async function buildGroups(svc: Services) {
  const [global, records, blacklist, whitelist, knownGroups] = await Promise.all([
    svc.settings.getGlobal(),
    svc.store.groupConfigAll(),
    svc.store.blacklistList(),
    svc.store.whitelistList(),
    botGroups(svc),
  ])

  // 群名单数量按群聚合一次，避免每个群都过滤一遍全表
  const blackCount = new Map<string, number>()
  for (const b of blacklist) blackCount.set(String(b.groupId), (blackCount.get(String(b.groupId)) || 0) + 1)
  const whiteCount = new Map<string, number>()
  for (const w of whitelist) whiteCount.set(String(w.groupId), (whiteCount.get(String(w.groupId)) || 0) + 1)
  const nameMap = new Map(knownGroups.map((g) => [g.groupId, g.name]))

  const groups = records.map((r) => {
    const cfg = r.config || {}
    const effective = {
      enableGroupManagement: cfg.enableGroupManagement !== undefined ? cfg.enableGroupManagement : global.enableGroupManagement,
      welcome: cfg.welcome?.enabled ?? global.welcome.enabled,
      farewell: cfg.farewell?.enabled ?? global.farewell.enabled,
      joinReview: cfg.joinReview?.enabled ?? global.joinReview.enabled,
      bannedWords: cfg.bannedWords?.enabled ?? global.bannedWords.enabled,
      linkGuard: cfg.bannedWords?.link?.enabled ?? global.bannedWords.link?.enabled ?? false,
      memberCheck: cfg.memberCheck?.enabled ?? false,
      report: cfg.report?.enabled ?? global.report.enabled,
      autoBlacklist: cfg.autoBlacklist?.enabled ?? global.autoBlacklist.enabled,
      essence: cfg.essence?.enabled ?? global.essence.enabled,
      title: cfg.title?.enabled ?? global.title.enabled,
      applyGlobalBlacklist: cfg.applyGlobalBlacklist !== undefined ? cfg.applyGlobalBlacklist === true : global.applyGlobalBlacklist === true,
      applyGlobalWhitelist: cfg.applyGlobalWhitelist !== undefined ? cfg.applyGlobalWhitelist === true : global.applyGlobalWhitelist === true,
    }
    return {
      id: r.id,
      groupId: String(r.groupId),
      name: nameMap.get(String(r.groupId)) || '',
      hasConfig: !!r.config && Object.keys(r.config).length > 0,
      overriddenKeys: Object.keys(cfg),
      effective,
      blacklistCount: blackCount.get(String(r.groupId)) || 0,
      whitelistCount: whiteCount.get(String(r.groupId)) || 0,
    }
  })

  // 机器人已在但未配置的群，作为快捷添加入口
  const configured = new Set(groups.map((g) => g.groupId))
  const available = knownGroups
    .filter((g) => !configured.has(g.groupId))
    .map((g) => ({ groupId: g.groupId, name: g.name, memberCount: g.memberCount }))

  return {
    updatedAt: Date.now(),
    groups,
    available,
  }
}

// 机器人当前所在群（用于「快捷添加」与群员检查扫描范围）。
// 优先使用 OneBot 的 get_group_list（LLBot / NapCat 均支持，带群名），
// 结果缓存 10 分钟；接口不可用时回退到 bot.guilds。
interface BotGroup { groupId: string, name: string, memberCount: number }
const botGroupsCache = new Map<string, { at: number, groups: BotGroup[] }>()

// 从 bot.guilds 读取（部分适配器提供，作为兜底来源）
function groupsFromBotState(svc: Services): BotGroup[] {
  const seen = new Map<string, BotGroup>()
  for (const bot of svc.ctx.bots) {
    const guilds: any = (bot as any).guilds
    if (!guilds) continue
    const entries: Array<[string, any]> = typeof guilds.entries === 'function'
      ? [...guilds.entries()]
      : Object.entries(guilds)
    for (const [gid, val] of entries) {
      const id = String(gid).replace(/^[^:]+:/, '')
      if (!id || seen.has(id)) continue
      seen.set(id, { groupId: id, name: String(val?.name ?? ''), memberCount: 0 })
    }
  }
  return [...seen.values()]
}

async function botGroups(svc: Services, force = false): Promise<BotGroup[]> {
  const session = anySession(svc, '')
  const key = String((session as any)?.bot?.selfId ?? 'default')
  const cached = botGroupsCache.get(key)
  if (!force && cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.groups

  const merged = new Map<string, BotGroup>()
  for (const g of groupsFromBotState(svc)) merged.set(g.groupId, g)

  if (session) {
    const list = await svc.onebot.getGroupList(session)
    for (const g of list) {
      const prev = merged.get(g.groupId)
      merged.set(g.groupId, {
        groupId: g.groupId,
        name: g.name || prev?.name || '',
        memberCount: g.memberCount || prev?.memberCount || 0,
      })
    }
  }
  const groups = [...merged.values()]
  // 接口完全不可用时不写缓存，避免把空结果缓存 10 分钟
  if (groups.length > 0) botGroupsCache.set(key, { at: Date.now(), groups })
  return groups
}

// 同步返回上一次缓存的群数量（供设置页展示，避免额外请求）
function cachedBotGroupCount(svc: Services): number {
  const session = anySession(svc, '')
  const key = String((session as any)?.bot?.selfId ?? 'default')
  return botGroupsCache.get(key)?.groups.length ?? groupsFromBotState(svc).length
}

// ---------------- 名单（黑/白名单） ----------------
async function buildLists(svc: Services) {
  const [global, records, blacklist, whitelist, knownGroups] = await Promise.all([
    svc.settings.getGlobal(),
    svc.store.groupConfigAll(),
    svc.store.blacklistList(),
    svc.store.whitelistList(),
    botGroups(svc),
  ])
  const groupIds = new Set<string>()
  for (const r of records) groupIds.add(String(r.groupId))
  for (const b of blacklist) if (b.groupId) groupIds.add(String(b.groupId))
  for (const w of whitelist) if (w.groupId) groupIds.add(String(w.groupId))
  for (const g of knownGroups) groupIds.add(g.groupId)

  // 群级「应用全局名单」开关，按群一次算好（避免前端每行都遍历配置）
  const applyMap = new Map<string, any>()
  for (const r of records) applyMap.set(String(r.groupId), r.config || {})
  const scopeApply: Record<string, { blacklist: boolean, whitelist: boolean }> = {}
  for (const gid of groupIds) {
    const cfg = applyMap.get(gid) || {}
    scopeApply[gid] = {
      blacklist: cfg.applyGlobalBlacklist !== undefined ? cfg.applyGlobalBlacklist === true : global.applyGlobalBlacklist === true,
      whitelist: cfg.applyGlobalWhitelist !== undefined ? cfg.applyGlobalWhitelist === true : global.applyGlobalWhitelist === true,
    }
  }

  return {
    updatedAt: Date.now(),
    global,
    groupIds: [...groupIds].sort(),
    groupNames: Object.fromEntries(knownGroups.map((g) => [g.groupId, g.name])),
    scopeApply,
    blacklist,
    whitelist,
  }
}

// ---------------- 日志（服务端分页 + 检索） ----------------
async function buildLogs(svc: Services, params: any = {}) {
  const type = LOG_TYPES.includes(params.type) ? params.type : undefined
  const page = clampInt(params.page, 1, 100000, 1)
  const pageSize = clampInt(params.pageSize, 5, 200, 20)
  const keyword = String(params.keyword || '').trim()
  let since: Date | undefined
  if (params.sinceDays) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - (clampInt(params.sinceDays, 1, 365, 7) - 1))
    since = d
  }
  const { total, rows } = await svc.store.logPage({ type, keyword, page, pageSize, since })
  const counts: Record<string, number> = {}
  await Promise.all(LOG_TYPES.map(async (t) => {
    counts[t] = await svc.store.logCount(t)
  }))
  return {
    updatedAt: Date.now(),
    type: type || '',
    keyword,
    page,
    pageSize,
    total,
    counts,
    totalAll: Object.values(counts).reduce((a, b) => a + b, 0),
    rows,
  }
}

// ---------------- 权限组 ----------------
async function buildPermissions(svc: Services) {
  const groups = await svc.store.permissionGroups()
  return {
    updatedAt: Date.now(),
    permissions: groups,
    commands: ALL_COMMANDS,
    // 权限项分组元数据，供 WebUI 按功能域折叠展示并标出高危项
    permItems: PERM_ITEMS,
  }
}

// ---------------- 全局设置 ----------------
async function buildSettings(svc: Services) {
  const global = await svc.settings.getGlobal()
  // 顺带刷新一次群列表缓存（10 分钟 TTL），使「协议端状态」的群数不过期
  const known = await botGroups(svc).catch(() => [] as BotGroup[])
  return {
    updatedAt: Date.now(),
    global,
    onebotFramework: svc.config?.onebotFramework ?? 'auto',
    bots: svc.ctx.bots.map((b: any) => ({
      selfId: String(b.selfId ?? b.userId ?? ''),
      platform: b.platform,
      status: (() => {
        try { return String(b.status ?? '') } catch { return '' }
      })(),
      groups: known.length || cachedBotGroupCount(svc),
    })),
    // 群员检查运行状态（供「群员检查」与「总览」页展示）
    lastRunAt: svc.memberCheck?.getLastRunAt?.() ?? 0,
    lastResults: svc.memberCheck?.getLastResults?.() ?? [],
    // 全局违规图片样本库（群专属样本不在此列，由群配置页单独展示）
    imageSamples: await svc.store.bannedImageList('').catch(() => []),
  }
}

// ---------------- 群员检查 ----------------
// 群员检查已改为纯群级配置：每个群一份独立配置，无全局回退。
async function buildMemberCheck(svc: Services, params: any = {}) {
  const gid = String(params.groupId || '')
  let hits: any[] = []
  let previewError = ''
  let config: any = null
  if (gid) {
    // 直接取该群的生效配置（群员检查不再从全局合并）
    config = (await svc.settings.getGroup(gid)).memberCheck
    try {
      hits = await svc.memberCheck.preview(gid)
    } catch (e) {
      previewError = (e as Error).message
    }
  }
  return {
    updatedAt: Date.now(),
    config,
    groupId: gid,
    hits,
    previewError,
    lastRunAt: svc.memberCheck?.getLastRunAt?.() ?? 0,
    lastResults: svc.memberCheck?.getLastResults?.() ?? [],
  }
}

// ---------------- 单个群的配置详情（按需加载，避免列表页传输全部群配置） ----------------
async function buildGroupDetail(svc: Services, groupId: string) {
  const gid = String(groupId || '')
  const [global, record, groupSamples] = await Promise.all([
    svc.settings.getGlobal(),
    gid ? svc.store.groupConfigGet(gid) : Promise.resolve(undefined),
    gid ? svc.store.bannedImageList(gid).catch(() => []) : Promise.resolve([]),
  ])
  return {
    updatedAt: Date.now(),
    groupId: gid,
    global,
    config: record?.config ?? {},
    exists: !!record,
    // 该群的专属违规图样本（全局样本在 settings 域中，此处只返回本群自己的）
    groupImageSamples: groupSamples,
  }
}

// 按需构建某个 scope 的数据
async function buildScope(svc: Services, scope: string, params: any = {}): Promise<any> {
  switch (scope) {
    case 'overview': return buildOverview(svc, clampInt(params.days, 1, 30, 7))
    case 'groups': return buildGroups(svc)
    case 'groupDetail': return buildGroupDetail(svc, params.groupId)
    case 'lists': return buildLists(svc)
    case 'logs': return buildLogs(svc, params)
    case 'permissions': return buildPermissions(svc)
    case 'settings': return buildSettings(svc)
    case 'memberCheck': return buildMemberCheck(svc, params)
    default: return { updatedAt: Date.now() }
  }
}

// ---------------- 变更处理 ----------------
async function handleMutate(svc: Services, action: string, data: any, operatorName = ''): Promise<MutateResponse> {
  // WebUI 操作统一附带操作者名称（auth 插件登录用户名）
  const log = {
    operation: (a: string, p: any = {}) => svc.log.operation(a, { ...p, operatorName }),
    audit: (a: string, p: any = {}) => svc.log.audit(a, { ...p, operatorName }),
    blacklist: (a: string, p: any = {}) => svc.log.blacklist(a, { ...p, operatorName }),
  }
  // 声明受影响的数据域，前端只刷新这些域，避免整表重载
  let scope = 'groups'
  try {
    switch (action) {
      case 'setGlobal': {
        scope = 'settings'
        // 通知转发不能设置为群聊管理中已配置的群聊
        const fw = (data as Partial<Config>)?.requestForward
        if (fw?.enabled && fw.mode === 'group' && fw.targetId) {
          const groups = await svc.store.groupConfigAll()
          if (groups.some((g) => String(g.groupId) === String(fw.targetId))) {
            return { ok: false, error: '通知转发目标不能设置为已在「群聊管理」中配置的群聊' }
          }
        }
        await svc.settings.setGlobal(data as Partial<Config>)
        await log.operation('WebUI修改全局设置', {})
        break
      }
      case 'setGroup': {
        scope = 'groupDetail'
        await svc.settings.setGroup(data.groupId, data.patch)
        await log.operation('WebUI修改群配置', { groupId: data.groupId })
        break
      }
      case 'group.add': {
        scope = 'groups'
        const ids: string[] = Array.isArray(data.groupIds) ? data.groupIds : [data.groupId].filter(Boolean)
        for (const gid of ids) {
          await svc.settings.setGroup(String(gid), {})
          await log.operation('WebUI添加群聊', { groupId: String(gid) })
        }
        break
      }
      case 'group.remove': {
        scope = 'groups'
        await svc.store.groupConfigRemove(data.groupId)
        await log.operation('WebUI删除群配置', { groupId: data.groupId })
        break
      }
      case 'group.clear': {
        scope = 'groupDetail'
        await svc.settings.clearGroup(data.groupId)
        await log.operation('WebUI重置群配置', { groupId: data.groupId })
        break
      }

      case 'permission.create':
        scope = 'permissions'
        await svc.permission.createGroup(data.name)
        await log.operation('WebUI创建权限组', { detail: data.name })
        break
      case 'permission.remove':
        scope = 'permissions'
        await svc.permission.removeGroup(data.name)
        await log.operation('WebUI删除权限组', { detail: data.name })
        break
      case 'permission.setDefault':
        scope = 'permissions'
        await svc.permission.setDefault(data.name)
        await log.operation('WebUI设置默认权限组', { detail: data.name })
        break
      case 'permission.setPriority':
        scope = 'permissions'
        await svc.permission.setPriority(data.name, Number(data.priority))
        break
      case 'permission.rename':
        scope = 'permissions'
        await svc.permission.renameGroup(data.name, data.nextName)
        await log.operation('WebUI重命名权限组', { detail: `${data.name} → ${data.nextName}` })
        break
      case 'permission.addMember':
        scope = 'permissions'
        await svc.permission.addMember(data.name, data.userId)
        await log.operation('WebUI权限组添加成员', { detail: data.name, targetId: data.userId })
        break
      case 'permission.removeMember':
        scope = 'permissions'
        await svc.permission.removeMember(data.name, data.userId)
        await log.operation('WebUI权限组移除成员', { detail: data.name, targetId: data.userId })
        break
      case 'permission.setPerm':
        scope = 'permissions'
        await svc.permission.setPerm(data.name, data.command, data.enabled)
        break
      case 'permission.setGroups':
        scope = 'permissions'
        await svc.permission.setGroups(data.name, data.groupIds)
        break
      case 'permission.clearGroups':
        scope = 'permissions'
        await svc.permission.clearGroups(data.name)
        break
      case 'permission.import': {
        scope = 'permissions'
        const session = anySession(svc, data.groupId)
        if (!session) return { ok: false, error: '未找到 OneBot 协议机器人' }
        const members = await svc.onebot.getMemberList(session, data.groupId, 0)
        const count = await svc.permission.importFromGroup(data.name, members, data.role || 'member')
        await log.operation('WebUI导入权限组成员', { detail: data.name, groupId: data.groupId, result: `+${count}` })
        break
      }

      case 'blacklist.add': {
        scope = 'lists'
        const groupId = data.groupId || ''
        const users = Array.isArray(data.users) ? data.users : [data.userId].filter(Boolean)
        for (const u of users) {
          await svc.store.blacklistAdd(String(u), data.source || 'manual', groupId)
          await log.blacklist('添加黑名单', { targetId: String(u), groupId })
        }
        break
      }
      case 'blacklist.remove': {
        scope = 'lists'
        const groupId = data.groupId || ''
        const users = Array.isArray(data.users) ? data.users : [data.userId].filter(Boolean)
        for (const u of users) {
          await svc.store.blacklistRemove(String(u), groupId)
          await log.blacklist('移除黑名单', { targetId: String(u), groupId })
        }
        break
      }
      case 'blacklist.moveGlobal': {
        scope = 'lists'
        const users = Array.isArray(data.users) ? data.users : [data.userId].filter(Boolean)
        for (const u of users) {
          await svc.store.blacklistMoveToGlobal(String(u), data.groupId || '')
          await log.blacklist('转移黑名单至全局', { targetId: String(u), groupId: data.groupId || '' })
        }
        break
      }

      case 'whitelist.add': {
        scope = 'lists'
        const groupId = data.groupId || ''
        const users = Array.isArray(data.users) ? data.users : [data.userId].filter(Boolean)
        // 只有显式传 true 才开启豁免项：避免调用方未传字段时被静默授予全部豁免
        const flags = {
          exemptReport: data.exemptReport === true,
          exemptJoin: data.exemptJoin === true,
          exemptBannedWord: data.exemptBannedWord === true,
        }
        for (const u of users) {
          await svc.store.whitelistAdd(String(u), groupId, flags)
          await log.operation('WebUI添加白名单', { targetId: String(u), groupId })
        }
        break
      }
      case 'whitelist.remove': {
        scope = 'lists'
        const groupId = data.groupId || ''
        const users = Array.isArray(data.users) ? data.users : [data.userId].filter(Boolean)
        for (const u of users) {
          await svc.store.whitelistRemove(String(u), groupId)
          await log.operation('WebUI移除白名单', { targetId: String(u), groupId })
        }
        break
      }
      case 'whitelist.moveGlobal': {
        scope = 'lists'
        const users = Array.isArray(data.users) ? data.users : [data.userId].filter(Boolean)
        for (const u of users) {
          await svc.store.whitelistMoveToGlobal(String(u), data.groupId || '')
          await log.operation('WebUI转移白名单至全局', { targetId: String(u), groupId: data.groupId || '' })
        }
        break
      }
      case 'whitelist.update': {
        scope = 'lists'
        await svc.store.whitelistUpdate(String(data.userId), data.groupId || '', data.patch)
        break
      }

      case 'bannedword.add': {
        scope = data.scope === 'group' ? 'groups' : 'settings'
        if (data.scope === 'group' && data.groupId) {
          const g = await svc.settings.getGroup(data.groupId)
          const words = [...(g.bannedWords.words || [])]
          const list = Array.isArray(data.words) ? data.words : [data.word].filter(Boolean)
          for (const w of list) if (w && !words.includes(w)) words.push(w)
          await svc.settings.setGroup(data.groupId, { bannedWords: { words } })
        } else {
          const g = await svc.settings.getGlobal()
          const words = [...g.bannedWords.words]
          const list = Array.isArray(data.words) ? data.words : [data.word].filter(Boolean)
          for (const w of list) if (w && !words.includes(w)) words.push(w)
          await svc.settings.setGlobal({ bannedWords: { words } })
        }
        break
      }
      case 'bannedword.remove': {
        scope = data.scope === 'group' ? 'groups' : 'settings'
        const list = Array.isArray(data.words) ? data.words : [data.word].filter(Boolean)
        if (data.scope === 'group' && data.groupId) {
          const g = await svc.settings.getGroup(data.groupId)
          await svc.settings.setGroup(data.groupId, { bannedWords: { words: (g.bannedWords.words || []).filter((w: string) => !list.includes(w)) } })
        } else {
          const g = await svc.settings.getGlobal()
          await svc.settings.setGlobal({ bannedWords: { words: g.bannedWords.words.filter((w) => !list.includes(w)) } })
        }
        break
      }
      // 链接白名单（全局，支持完整链接 / 域名 / 泛域名）
      case 'link.test': {
        // 不落库，仅用于前端「试一试」判断某条链接是否命中白名单
        const g = await svc.settings.getGlobal()
        const hit = parseLink(String(data.url || ''))
        const wl = Array.isArray(data.whitelist) ? data.whitelist : (g.bannedWords.link?.whitelist || [])
        return {
          ok: true,
          data: {
            parsed: hit ? { host: hit.host, path: hit.path, url: hit.url } : null,
            whitelisted: hit ? isWhitelisted(hit, wl) : false,
          },
        }
      }
      case 'linkWhitelist.add': {
        scope = 'settings'
        const g = await svc.settings.getGlobal()
        const entries = [...(g.bannedWords.link?.whitelist || [])]
        const list = Array.isArray(data.entries) ? data.entries : [data.entry].filter(Boolean)
        for (const e of list) {
          const v = String(e).trim()
          if (v && !entries.includes(v)) entries.push(v)
        }
        await svc.settings.setGlobal({ bannedWords: { link: { whitelist: entries } } as any })
        await log.operation('WebUI添加链接白名单', { detail: list.join('、') })
        break
      }
      case 'linkWhitelist.remove': {
        scope = 'settings'
        const g = await svc.settings.getGlobal()
        const list = (Array.isArray(data.entries) ? data.entries : [data.entry]).map((x: any) => String(x))
        await svc.settings.setGlobal({ bannedWords: { link: { whitelist: (g.bannedWords.link?.whitelist || []).filter((e: string) => !list.includes(e)) } } as any })
        break
      }

      // 群员检查
      case 'memberCheck.scan': {
        scope = 'memberCheck'
        const result = await svc.memberCheck.manualCheck(data.groupId, data.kind)
        await log.operation('WebUI手动群员检查', {
          groupId: data.groupId,
          result: `扫描 ${result.scanned}，命中 ${result.hits}，禁言 ${result.actions.mute}，踢出 ${result.actions.kick}`,
        })
        break
      }
      case 'memberCheck.scanAll': {
        scope = 'memberCheck'
        const results = await svc.memberCheck.scanAll()
        const total = results.reduce((a: number, r: any) => a + r.hits, 0)
        await log.operation('WebUI全量群员检查', { result: `共 ${results.length} 个群，命中 ${total}` })
        break
      }

      // 禁发指定图片（样本库管理 + 比对测试）
      // groupId 为空 = 全局样本；非空 = 该群专属样本
      case 'image.sample.add': {
        scope = 'settings'
        const url = String(data.url || '').trim()
        const gid = String(data.groupId || '')
        if (!/^https?:\/\//i.test(url)) return { ok: false, error: '请填写以 http(s):// 开头的图片地址' }
        const res = await svc.imageGuard.addSample(url, String(data.label || ''), 'url', gid)
        if (!res.ok) return { ok: false, error: res.message }
        await log.operation('WebUI添加违规图样本', {
          groupId: gid,
          detail: `${url}${data.label ? `（${data.label}）` : ''}${gid ? ` → 群 ${gid}` : ' → 全局'}`,
        })
        break
      }
      case 'image.sample.addBase64': {
        scope = 'settings'
        // WebUI 上传的图片以 data URL 传入，直接解码为二进制入库
        const raw = String(data.dataUrl || '')
        const gid = String(data.groupId || '')
        const m = raw.match(/^data:([^;]+);base64,(.+)$/)
        if (!m) return { ok: false, error: '图片数据格式不正确' }
        let buf: Uint8Array
        try {
          buf = new Uint8Array(Buffer.from(m[2], 'base64'))
        } catch {
          return { ok: false, error: '图片 base64 解码失败' }
        }
        if (buf.length > 8 * 1024 * 1024) return { ok: false, error: '图片过大（上限 8MB）' }
        const res = await svc.imageGuard.addSampleFromBuffer(buf, String(data.label || ''), String(data.filename || '本地上传'), gid)
        if (!res.ok) return { ok: false, error: res.message }
        await log.operation('WebUI上传违规图样本', {
          groupId: gid,
          detail: `${data.filename || '本地上传'}${data.label ? `（${data.label}）` : ''}${gid ? ` → 群 ${gid}` : ' → 全局'}`,
        })
        break
      }
      case 'image.sample.remove': {
        scope = 'settings'
        const id = Number(data.id)
        const rows = await svc.store.bannedImageList().catch(() => [])
        const target = Array.isArray(rows) ? rows.find((r: any) => Number(r.id) === id) : undefined
        if (!target) return { ok: false, error: '样本不存在或已被删除' }
        // 群配置页只能删本群自己的样本；全局样本必须在「违禁词与链接」页删除，
        // 避免在群页面误删对所有群生效的样本（页面上全局样本是只读展示的）
        if (data.groupId !== undefined && String(target.groupId || '') !== String(data.groupId || '')) {
          return { ok: false, error: '全局样本不可在群配置页删除，请到「违禁词与链接」页面操作' }
        }
        const ok = await svc.store.bannedImageRemove(id)
        if (!ok) return { ok: false, error: '样本不存在或已被删除' }
        svc.imageGuard.invalidate()
        await log.operation('WebUI删除违规图样本', { detail: `#${id}` })
        break
      }
      case 'image.sample.clear': {
        scope = 'settings'
        // 传了 groupId 只清该群的专属样本，不动全局样本库
        const gid = data.groupId === undefined || data.groupId === '' ? undefined : String(data.groupId)
        await svc.store.bannedImageClear(gid)
        svc.imageGuard.invalidate()
        await log.operation(gid ? `WebUI清空群 ${gid} 的违规图样本` : 'WebUI清空全局违规图样本库', { groupId: gid || '' })
        break
      }
      case 'image.test': {
        // 一次性比对结果，不写入 scope 缓存
        const url = String(data.url || '').trim()
        if (!/^https?:\/\//i.test(url)) return { ok: false, error: '请填写以 http(s):// 开头的图片地址' }
        const best = await svc.imageGuard.compare(url, String(data.groupId || ''))
        if (!best) return { ok: false, error: '无法解析该图片（仅支持 PNG / 基线 JPEG）' }
        const threshold = clampInt(data.threshold, 0, 64, 8)
        return {
          ok: true,
          data: {
            distance: best.distance,
            threshold,
            matched: best.distance <= threshold,
            sample: { label: best.entry.label, origin: best.entry.origin, hash: best.entry.hash },
          },
        }
      }

      // 配置 / 名单导出导入
      case 'export.config': {
        // 返回文件内容由前端下载，不写缓存
        const bundle = await svc.exporter.exportConfig(
          data.includeGroups !== false,
          data.includePermissionGroups !== false,
        )
        return { ok: true, data: { bundle } }
      }
      case 'export.list': {
        const type = data.type === 'whitelist' ? 'whitelist' : 'blacklist'
        const bundle = await svc.exporter.exportList(type)
        return { ok: true, data: { bundle } }
      }
      case 'import.config': {
        scope = 'settings'
        const res = await svc.exporter.importConfig(data.bundle, {
          mode: data.mode === 'replace' ? 'replace' : 'merge',
          includeGroups: data.includeGroups !== false,
          includePermissionGroups: data.includePermissionGroups !== false,
        })
        await log.operation('WebUI导入配置', { result: res.message })
        if (!res.ok) return { ok: false, error: res.message, data: res.detail }
        break
      }
      case 'import.list': {
        scope = 'lists'
        const type = data.type === 'whitelist' ? 'whitelist' : 'blacklist'
        const res = await svc.exporter.importList(data.bundle, type, data.mode === 'replace' ? 'replace' : 'merge')
        await log.operation('WebUI导入名单', { result: res.message })
        if (!res.ok) return { ok: false, error: res.message, data: res.detail }
        break
      }

      case 'join.approve':
        scope = 'overview'
        return await approveJoin(svc, data.flag, true, data.reason || '审核通过', operatorName)
      case 'join.reject':
        scope = 'overview'
        return await approveJoin(svc, data.flag, false, data.reason || '审核拒绝', operatorName)

      case 'log.clear':
        scope = 'logs'
        await svc.store.logClear()
        break

      // AI 接口连通性测试（不写入配置）
      case 'ai.test': {
        const cfg = {
          enabled: true,
          baseURL: String(data.baseURL || '').trim(),
          apiKey: String(data.apiKey || '').trim(),
          model: String(data.model || '').trim(),
          temperature: 0.1,
          maxTokens: 16,
          timeout: clampInt(data.timeout, 1000, 60000, 15000),
          prompts: { joinReview: '', reportReview: '' },
        }
        if (!cfg.baseURL || !cfg.apiKey || !cfg.model) {
          return { ok: false, error: '请填写完整的 baseURL、API Key 与模型后再测试' }
        }
        const started = Date.now()
        try {
          const reply = await svc.ai.chat(cfg as any, '你是一个测试助手，请直接回复「OK」。', 'ping')
          return {
            ok: true,
            data: { message: `连接成功（${Date.now() - started} ms）：${String(reply).slice(0, 60)}` },
          }
        } catch (e) {
          return { ok: false, error: `连接失败：${(e as Error).message}` }
        }
      }

      default:
        return { ok: false, error: `未知操作 ${action}` }
    }
    return { ok: true, scope, data: await buildScope(svc, scope, data?.params || {}) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

function anySession(svc: Services, groupId: string): any {
  const bot: any = svc.ctx.bots.find((b: any) => b.internal || b.onebot) || svc.ctx.bots[0]
  if (!bot) return null
  const s = bot.session?.({ guildId: groupId, channelId: groupId } as any) ?? { bot }
  ;(s as any).bot = bot
  ;(s as any).guildId = groupId
  ;(s as any).channelId = groupId
  return s
}

async function approveJoin(svc: Services, flag: string, approve: boolean, reason: string, operatorName = ''): Promise<MutateResponse> {
  const record = await svc.store.joinRequestByFlag(flag)
  if (!record) return { ok: false, error: '未找到该入群申请记录' }
  const session = anySession(svc, record.groupId)
  if (!session) return { ok: false, error: '未找到 OneBot 协议机器人' }
  try {
    await svc.onebot.handleJoinRequest(session, flag, record.subType || 'add', approve, reason)
  } catch (e) {
    return { ok: false, error: `调用 OneBot 失败：${(e as Error).message}` }
  }
  await svc.store.joinRequestUpdate(flag, { status: approve ? 'approved' : 'rejected' })
  await svc.log.audit(approve ? '入群审核通过' : '入群审核拒绝', { targetId: record.userId, groupId: record.groupId, detail: reason, operatorName })
  return { ok: true, scope: 'overview', data: await buildScope(svc, 'overview') }
}

export function applyWebUI(ctx: Context, svc: Services) {
  const consoleService = (ctx as any).console
  if (!consoleService) return

  // 主数据域：兼容旧的整体快照（fields: ['qq-guanqun']），首次进入时按 overview 返回
  class GmData extends DataService<any> {
    constructor(cctx: any) {
      // immediate: true 让服务在插件加载时即启动并向客户端推送初始数据
      super(cctx, DATA_KEY as any, { immediate: true })
    }
    async get(): Promise<any> {
      return buildScope(svc, 'overview')
    }
  }
  ctx.plugin(GmData as any)

  // 变更入口：返回受影响的数据域，前端只刷新该域
  consoleService.addListener('qq-guanqun/mutate', async function (this: any, payload: any) {
    const operatorName = this?.auth?.name || ''
    const res = await handleMutate(svc, payload.action, payload.data, operatorName)
    return res
  })

  // 按需取数入口：scope + params
  consoleService.addListener('qq-guanqun/scope', async function (this: any, payload: any) {
    const scope = String(payload?.scope || 'overview')
    try {
      const data = await buildScope(svc, scope, payload?.params || {})
      return { ok: true, scope, data }
    } catch (e) {
      return { ok: false, scope, error: (e as Error).message }
    }
  })

  // 手动刷新：广播主域快照，保持多端一致
  consoleService.addListener('qq-guanqun/refresh', async () => {
    const snapshot = await buildScope(svc, 'overview')
    await consoleService.broadcast('patch', { key: DATA_KEY, value: snapshot })
    return snapshot
  })

  consoleService.addEntry({
    dev: resolve(__dirname, '../../client/index.ts'),
    prod: resolve(__dirname, '../../dist'),
  })
}
