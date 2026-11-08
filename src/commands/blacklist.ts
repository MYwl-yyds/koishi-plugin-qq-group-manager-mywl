import { Context, Session } from 'koishi'
import { Services } from '../types'
import { resolveTargetUser, idOf } from '../utils'

function guild(session: Session): string {
  return idOf(session.guildId)
}

// 统一的名单渲染：避免两处格式不一致
function formatEntries(list: any[]): string {
  return list.map((e, i) => `${i + 1}. ${e.userId}${e.groupId ? `（群 ${e.groupId}）` : '（全局）'}`).join('\n')
}

// 黑名单管理
export function apply(ctx: Context, svc: Services) {
  ctx.command('添加黑名单 <user:string>', '将指定用户加入黑名单（加 -q 加入全局黑名单）')
    .option('global', '-q 加入全局黑名单')
    .action(async ({ session, options }: any, user) => {
      if (!await svc.permission.check(session, '黑名单管理')) return '你没有权限使用此命令'
      const target = resolveTargetUser(session, user)
      if (!target) return '请 @ 要加入黑名单的用户，或提供对方 QQ 号'
      const cfg = await svc.settings.getGroup(guild(session))
      const applyGlobal = cfg.applyGlobalBlacklist === true
      const groupId = options?.global ? '' : (applyGlobal ? '' : guild(session))
      await svc.store.blacklistAdd(target, 'manual', groupId)
      await svc.log.blacklist('添加黑名单', { operatorId: idOf(session.userId), operatorName: session.username || '', targetId: target, groupId })
      return `已将 ${target} 加入${groupId ? '本群' : '全局'}黑名单`
    })

  ctx.command('移除黑名单 <user:string>', '将指定用户移出黑名单（加 -q 移出全局黑名单）')
    .option('global', '-q 移出全局黑名单')
    .action(async ({ session, options }: any, user) => {
      if (!await svc.permission.check(session, '黑名单管理')) return '你没有权限使用此命令'
      const target = resolveTargetUser(session, user)
      if (!target) return '请提供要移出黑名单的用户 QQ'
      // 与「添加黑名单」保持同一范围判定：未加 -q 时，若本群启用全局名单则移除全局条目
      const cfg = await svc.settings.getGroup(guild(session))
      const groupId = options?.global ? '' : (cfg.applyGlobalBlacklist === true ? '' : guild(session))
      const removed = await svc.store.blacklistRemove(target, groupId)
      if (!removed) {
        // 回退：本群启用全局名单时，也允许移除本群条目，避免历史数据无法清理
        const fallbackGroup = guild(session)
        if (!options?.global && groupId === '' && fallbackGroup) {
          const ok = await svc.store.blacklistRemove(target, fallbackGroup)
          if (ok) {
            await svc.log.blacklist('移除黑名单', { operatorId: idOf(session.userId), operatorName: session.username || '', targetId: target, groupId: fallbackGroup })
            return `已将 ${target} 移出本群黑名单`
          }
        }
        return `${target} 不在${groupId ? '本群' : '全局'}黑名单中`
      }
      await svc.log.blacklist('移除黑名单', { operatorId: idOf(session.userId), operatorName: session.username || '', targetId: target, groupId })
      return `已将 ${target} 移出${groupId ? '本群' : '全局'}黑名单`
    })

  ctx.command('黑名单列表', '查看黑名单（加 -q 仅查看全局黑名单）')
    .option('global', '-q 仅查看全局黑名单')
    .action(async ({ session, options }: any) => {
      if (!await svc.permission.check(session, '黑名单查看')) return '你没有权限使用此命令'
      // 修复：原实现先取全表再按 groupId 过滤，一旦 guildId 取不到（私聊调用、
      // 或适配器把群号放在 channelId 上），过滤条件就退化成「只保留全局条目」，
      // 表现为「命令拿不到本群名单」。这里改为按范围分别查询，并兼容 channelId。
      const gid = idOf(session.guildId ?? (session as any).channelId)
      const globalList = await svc.store.blacklistList('')
      if (options?.global) {
        if (globalList.length === 0) return '全局黑名单为空'
        return `全局黑名单（共 ${globalList.length} 人）：\n${formatEntries(globalList)}`
      }
      const groupList = gid ? await svc.store.blacklistList(gid) : []
      const scoped = [...groupList, ...globalList]
      if (scoped.length > 0) {
        const head = gid ? `群 ${gid} 黑名单（含全局）` : '黑名单'
        return `${head}（共 ${scoped.length} 人）：\n${formatEntries(scoped)}`
      }
      // 本群与全局都为空：若数据存在其它群名下，明确指出，避免被误判成「功能坏了」
      const all = await svc.store.blacklistList()
      const others = all.filter((e: any) => e.groupId && e.groupId !== gid)
      if (others.length > 0) {
        const gids = Array.from(new Set(others.map((e: any) => String(e.groupId))))
        return `群 ${gid || '(未知)'} 与全局黑名单均为空。\n其它群存在 ${others.length} 条记录：${gids.join('、')}\n`
          + '如需查看请到对应群内执行，或到 WebUI「名单中心 → 黑名单」查看。'
      }
      return gid ? `群 ${gid} 的黑名单为空（全局黑名单也为空）` : '当前不在群聊中，且全局黑名单为空'
    })
}