import { Context, Session } from 'koishi'
import { Services } from '../types'
import { resolveTargetUser, idOf } from '../utils'

function guild(session: Session): string {
  return idOf(session.guildId)
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
      // 默认仅展示本群 + 全局条目，避免把其它群的名单也刷出来
      const list = options?.global
        ? await svc.store.blacklistList('')
        : await svc.store.blacklistList()
      const scoped = options?.global
        ? list
        : list.filter((e) => !e.groupId || e.groupId === guild(session))
      if (scoped.length === 0) return '黑名单为空'
      const lines = scoped.map((e, i) => `${i + 1}. ${e.userId}${e.groupId ? `（群 ${e.groupId}）` : '（全局）'}`)
      return `黑名单（共 ${scoped.length} 人）：\n${lines.join('\n')}`
    })
}