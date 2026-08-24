import { Context } from 'koishi'
import { resolve } from 'path'
import { DataService } from '@koishijs/plugin-console'
import { Services, Config } from '../types'

type MutateResponse = { ok: boolean, error?: string, snapshot?: any }

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// 构建看板快照（全部来自插件自身存储的数据，不调用外部慢接口，保证实时）
async function buildSnapshot(svc: Services): Promise<any> {
  const [global, permissions, blacklist, whitelist, groups, pending, logs] = await Promise.all([
    svc.settings.getGlobal(),
    svc.store.permissionGroups(),
    svc.store.blacklistList(),
    svc.store.whitelistList(),
    svc.store.groupConfigAll(),
    svc.store.joinRequestList('pending'),
    svc.store.logQuery(undefined, 500),
  ])

  // 操作日志趋势（近 7 天）
  const days: string[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    days.push(formatDate(d))
  }
  const trendMap: Record<string, any> = {}
  for (const day of days) trendMap[day] = { date: day, operation: 0, audit: 0, violation: 0, blacklist: 0 }
  for (const l of logs) {
    const day = formatDate(new Date(l.createdAt))
    if (trendMap[day] && trendMap[day][l.type] !== undefined) trendMap[day][l.type]++
  }

  // 违规类型分布
  const violationDist: Record<string, number> = {}
  for (const l of logs) {
    if (l.type !== 'violation') continue
    let type = '其他'
    try {
      const parsed = JSON.parse(l.detail || '{}')
      if (parsed.type) type = parsed.type
    } catch { /* ignore */ }
    violationDist[type] = (violationDist[type] || 0) + 1
  }

  // 仅统计插件真实维护的数据
  const stats = {
    configuredGroups: groups.length,
    permissionGroups: permissions.length,
    bannedWords: (global.bannedWords?.words || []).length,
    pendingReviews: pending.length,
    blacklistTotal: blacklist.length,
    logTrend: days.map((d) => trendMap[d]),
    violationDist,
  }

  return {
    global,
    schema: svc.config,
    permissions,
    blacklist,
    whitelist,
    groups,
    pendingReviews: pending,
    logs: logs.slice(0, 100),
    stats,
    commands: [
      '禁言', '解除禁言', '全体禁言', '全体解禁', '踢出', '退群', '入群审核',
      '设置精华', '取消精华', '设置头衔', '取消头衔',
      '添加黑名单', '移除黑名单', '添加白名单', '移除白名单', '添加违禁词', '移除违禁词', '权限组',
    ],
  }
}

// 处理 WebUI 变更请求
async function handleMutate(svc: Services, action: string, data: any, operatorName = ''): Promise<MutateResponse> {
  // WebUI 操作统一附带操作者名称（auth 插件登录用户名）
  const log = {
    operation: (a: string, p: any = {}) => svc.log.operation(a, { ...p, operatorName }),
    audit: (a: string, p: any = {}) => svc.log.audit(a, { ...p, operatorName }),
    blacklist: (a: string, p: any = {}) => svc.log.blacklist(a, { ...p, operatorName }),
  }
  try {
    switch (action) {
      case 'setGlobal': {
        // 通知转发不能设置为群聊管理中已配置的群聊
        const fw = (data as Partial<Config>)?.requestForward
        if (fw?.enabled && fw.mode === 'group' && fw.targetId) {
          const groups = await svc.store.groupConfigAll()
          if (groups.some((g) => g.groupId === fw.targetId)) {
            return { ok: false, error: '通知转发目标不能设置为已在「群聊管理」中配置的群聊' }
          }
        }
        await svc.settings.setGlobal(data as Partial<Config>)
        await log.operation('WebUI修改全局设置', {})
        break
      }
      case 'setGroup':
        await svc.settings.setGroup(data.groupId, data.patch)
        await log.operation('WebUI修改群配置', { groupId: data.groupId })
        break
      case 'clearGroup':
        await svc.settings.clearGroup(data.groupId)
        await log.operation('WebUI重置群配置', { groupId: data.groupId })
        break

      case 'permission.create':
        await svc.permission.createGroup(data.name)
        await log.operation('WebUI创建权限组', { detail: data.name })
        break
      case 'permission.remove':
        await svc.permission.removeGroup(data.name)
        await log.operation('WebUI删除权限组', { detail: data.name })
        break
      case 'permission.setDefault':
        await svc.permission.setDefault(data.name)
        await log.operation('WebUI设置默认权限组', { detail: data.name })
        break
      case 'permission.setPriority':
        await svc.permission.setPriority(data.name, Number(data.priority))
        break
      case 'permission.addMember':
        await svc.permission.addMember(data.name, data.userId)
        await log.operation('WebUI权限组添加成员', { detail: data.name, targetId: data.userId })
        break
      case 'permission.removeMember':
        await svc.permission.removeMember(data.name, data.userId)
        await log.operation('WebUI权限组移除成员', { detail: data.name, targetId: data.userId })
        break
      case 'permission.setPerm':
        await svc.permission.setPerm(data.name, data.command, data.enabled)
        break
      case 'permission.setGroups':
        await svc.permission.setGroups(data.name, data.groupIds)
        break
      case 'permission.clearGroups':
        await svc.permission.clearGroups(data.name)
        break
      case 'permission.import': {
        const bot = svc.ctx.bots.find((b: any) => b.internal || b.onebot) || svc.ctx.bots[0]
        if (!bot) return { ok: false, error: '未找到 OneBot 协议机器人' }
        const members = await svc.onebot.getGroupMemberList({ bot } as any, data.groupId)
        const count = await svc.permission.importFromGroup(data.name, members, data.role || 'member')
        await log.operation('WebUI导入权限组成员', { detail: data.name, groupId: data.groupId, result: `+${count}` })
        break
      }

      case 'blacklist.add': {
        const groupId = data.groupId || ''
        const users = Array.isArray(data.users) ? data.users : [data.userId].filter(Boolean)
        for (const u of users) {
          await svc.store.blacklistAdd(String(u), data.source || 'manual', groupId)
          await log.blacklist('添加黑名单', { targetId: String(u), groupId })
        }
        break
      }
      case 'blacklist.remove': {
        const groupId = data.groupId || ''
        const users = Array.isArray(data.users) ? data.users : [data.userId].filter(Boolean)
        for (const u of users) {
          await svc.store.blacklistRemove(String(u), groupId)
          await log.blacklist('移除黑名单', { targetId: String(u), groupId })
        }
        break
      }
      case 'blacklist.moveGlobal': {
        const users = Array.isArray(data.users) ? data.users : [data.userId].filter(Boolean)
        for (const u of users) {
          await svc.store.blacklistMoveToGlobal(String(u), data.groupId || '')
          await log.blacklist('转移黑名单至全局', { targetId: String(u), groupId: data.groupId || '' })
        }
        break
      }

      case 'whitelist.add': {
        const groupId = data.groupId || ''
        const users = Array.isArray(data.users) ? data.users : [data.userId].filter(Boolean)
        for (const u of users) {
          await svc.store.whitelistAdd(String(u), groupId, {
            exemptReport: data.exemptReport !== false,
            exemptJoin: data.exemptJoin !== false,
            exemptBannedWord: data.exemptBannedWord !== false,
          })
          await log.operation('WebUI添加白名单', { targetId: String(u), groupId })
        }
        break
      }
      case 'whitelist.remove': {
        const groupId = data.groupId || ''
        const users = Array.isArray(data.users) ? data.users : [data.userId].filter(Boolean)
        for (const u of users) {
          await svc.store.whitelistRemove(String(u), groupId)
          await log.operation('WebUI移除白名单', { targetId: String(u), groupId })
        }
        break
      }
      case 'whitelist.moveGlobal': {
        const users = Array.isArray(data.users) ? data.users : [data.userId].filter(Boolean)
        for (const u of users) {
          await svc.store.whitelistMoveToGlobal(String(u), data.groupId || '')
          await log.operation('WebUI转移白名单至全局', { targetId: String(u), groupId: data.groupId || '' })
        }
        break
      }
      case 'whitelist.update': {
        await svc.store.whitelistUpdate(String(data.userId), data.groupId || '', data.patch)
        break
      }

      case 'bannedword.add': {
        const g = await svc.settings.getGlobal()
        const words = [...g.bannedWords.words]
        const list = Array.isArray(data.words) ? data.words : [data.word].filter(Boolean)
        for (const w of list) if (w && !words.includes(w)) words.push(w)
        await svc.settings.setGlobal({ bannedWords: { words } })
        break
      }
      case 'bannedword.remove': {
        const g = await svc.settings.getGlobal()
        const list = Array.isArray(data.words) ? data.words : [data.word].filter(Boolean)
        await svc.settings.setGlobal({ bannedWords: { words: g.bannedWords.words.filter((w) => !list.includes(w)) } })
        break
      }

      case 'join.approve':
        return await approveJoin(svc, data.flag, true, data.reason || '审核通过', operatorName)
      case 'join.reject':
        return await approveJoin(svc, data.flag, false, data.reason || '审核拒绝', operatorName)

      case 'log.clear':
        await svc.store.logClear()
        break

      default:
        return { ok: false, error: `未知操作 ${action}` }
    }
    return { ok: true, snapshot: await buildSnapshot(svc) }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

async function approveJoin(svc: Services, flag: string, approve: boolean, reason: string, operatorName = ''): Promise<MutateResponse> {
  const record = await svc.store.joinRequestByFlag(flag)
  if (!record) return { ok: false, error: '未找到该入群申请记录' }
  const bot = svc.ctx.bots.find((b) => (b as any).onebot ?? (b as any).internal) || svc.ctx.bots[0]
  if (!bot) return { ok: false, error: '未找到 OneBot 协议机器人' }
  try {
    const fw = svc.config.onebotFramework ?? 'auto'
    const raw = (bot as any).onebot
    if (raw && fw !== 'auto') {
      await raw('set_group_add_request', { flag, sub_type: record.subType || 'add', approve, reason })
    } else {
      await (bot as any).internal.setGroupAddRequest(flag, record.subType || 'add', approve, reason)
    }
  } catch (e) {
    return { ok: false, error: `调用 OneBot 失败：${(e as Error).message}` }
  }
  await svc.store.joinRequestUpdate(flag, { status: approve ? 'approved' : 'rejected' })
  await svc.log.audit(approve ? '入群审核通过' : '入群审核拒绝', { targetId: record.userId, groupId: record.groupId, detail: reason, operatorName })
  return { ok: true, snapshot: await buildSnapshot(svc) }
}

export function applyWebUI(ctx: Context, svc: Services) {
  const consoleService = (ctx as any).console
  if (!consoleService) return

  class GmData extends DataService<any> {
    constructor(cctx: any) {
      super(cctx, 'qq-guanqun' as any)
    }
    async get(): Promise<any> {
      return buildSnapshot(svc)
    }
  }
  ctx.plugin(GmData as any)

  consoleService.addListener('qq-guanqun/mutate', async function (this: any, payload: any) {
    // auth 插件登录后，Client.auth 携带当前管理员用户名
    const operatorName = this?.auth?.name || ''
    const res = await handleMutate(svc, payload.action, payload.data, operatorName)
    // 变更成功后广播最新快照，实时更新所有客户端缓存的 store['qq-guanqun']，
    // 否则切换页面时 DataService 缓存未刷新会回显旧数据
    if (res?.ok && res.snapshot) {
      await consoleService.broadcast('patch', { key: 'qq-guanqun', value: res.snapshot })
    }
    return res
  })

  consoleService.addListener('qq-guanqun/refresh', async () => {
    const snapshot = await buildSnapshot(svc)
    // 同步刷新所有客户端的 DataService 缓存，保证切页 / 多端数据一致
    await consoleService.broadcast('patch', { key: 'qq-guanqun', value: snapshot })
    return snapshot
  })

  consoleService.addEntry({
    dev: resolve(__dirname, '../../client/index.ts'),
    prod: resolve(__dirname, '../../dist'),
  })
}