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
      if (!await svc.permission.check(session, '添加黑名单')) return '你没有权限使用此命令'
      const target = resolveTargetUser(session, user)
      if (!target) return '请 @ 要加入黑名单的用户，或提供对方 QQ 号'
      const cfg = await svc.settings.getGroup(guild(session))
      const applyGlobal = cfg.applyGlobalBlacklist !== false
      const groupId = options?.global ? '' : (applyGlobal ? '' : guild(session))
      await svc.store.blacklistAdd(target, 'manual', groupId)
      await svc.log.blacklist('添加黑名单', { operatorId: idOf(session.userId), operatorName: session.username || '', targetId: target, groupId })
      return `已将 ${target} 加入${groupId ? '本群' : '全局'}黑名单`
    })

  ctx.command('移除黑名单 <user:string>', '将指定用户移出黑名单')
    .action(async ({ session }: any, user) => {
      if (!await svc.permission.check(session, '移除黑名单')) return '你没有权限使用此命令'
      const target = resolveTargetUser(session, user)
      if (!target) return '请提供要移出黑名单的用户 QQ'
      const removed = await svc.store.blacklistRemove(target)
      if (!removed) return `${target} 不在黑名单中`
      await svc.log.blacklist('移除黑名单', { operatorId: idOf(session.userId), operatorName: session.username || '', targetId: target, groupId: guild(session) })
      return `已将 ${target} 移出黑名单`
    })

  ctx.command('黑名单列表', '查看黑名单')
    .action(async ({ session }: any) => {
      if (!await svc.permission.check(session, '移除黑名单')) return '你没有权限使用此命令'
      const list = await svc.store.blacklistList()
      if (list.length === 0) return '黑名单为空'
      const lines = list.map((e, i) => `${i + 1}. ${e.userId}${e.groupId ? `（群 ${e.groupId}）` : '（全局）'}`)
      return `黑名单（共 ${list.length} 人）：\n${lines.join('\n')}`
    })
}