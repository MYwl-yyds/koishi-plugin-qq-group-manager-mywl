import { Context, Session } from 'koishi'
import { Services } from '../types'
import { resolveTargetUser, idOf } from '../utils'

function guild(session: Session): string {
  return idOf(session.guildId)
}

// 白名单管理
export function apply(ctx: Context, svc: Services) {
  ctx.command('添加白名单 <user:string>', '将指定用户加入白名单（加 -q 加入全局白名单）')
    .option('global', '-q 加入全局白名单')
    .action(async ({ session, options }: any, user) => {
      if (!await svc.permission.check(session, '白名单管理')) return '你没有权限使用此命令'
      const target = resolveTargetUser(session, user)
      if (!target) return '请 @ 要加入白名单的用户，或提供对方 QQ 号'
      const cfg = await svc.settings.getGroup(guild(session))
      const applyGlobal = cfg.applyGlobalWhitelist === true
      const groupId = options?.global ? '' : (applyGlobal ? '' : guild(session))
      await svc.store.whitelistAdd(target, groupId)
      await svc.log.operation('添加白名单', { operatorId: idOf(session.userId), operatorName: session.username || '', targetId: target, groupId })
      return `已将 ${target} 加入${groupId ? '本群' : '全局'}白名单`
    })

  ctx.command('移除白名单 <user:string>', '将指定用户移出白名单（加 -q 移出全局白名单）')
    .option('global', '-q 移出全局白名单')
    .action(async ({ session, options }: any, user) => {
      if (!await svc.permission.check(session, '白名单管理')) return '你没有权限使用此命令'
      const target = resolveTargetUser(session, user)
      if (!target) return '请提供要移出白名单的用户 QQ'
      // 与「添加白名单」保持同一范围判定
      const cfg = await svc.settings.getGroup(guild(session))
      const groupId = options?.global ? '' : (cfg.applyGlobalWhitelist === true ? '' : guild(session))
      const removed = await svc.store.whitelistRemove(target, groupId)
      if (!removed) {
        // 回退：本群启用全局名单时，也允许移除本群历史条目
        const fallbackGroup = guild(session)
        if (!options?.global && groupId === '' && fallbackGroup) {
          const ok = await svc.store.whitelistRemove(target, fallbackGroup)
          if (ok) {
            await svc.log.operation('移除白名单', { operatorId: idOf(session.userId), operatorName: session.username || '', targetId: target, groupId: fallbackGroup })
            return `已将 ${target} 移出本群白名单`
          }
        }
        return `${target} 不在${groupId ? '本群' : '全局'}白名单中`
      }
      await svc.log.operation('移除白名单', { operatorId: idOf(session.userId), operatorName: session.username || '', targetId: target, groupId })
      return `已将 ${target} 移出${groupId ? '本群' : '全局'}白名单`
    })

  ctx.command('白名单列表', '查看白名单（加 -q 仅查看全局白名单）')
    .option('global', '-q 仅查看全局白名单')
    .action(async ({ session, options }: any) => {
      if (!await svc.permission.check(session, '白名单查看')) return '你没有权限使用此命令'
      const list = await svc.store.whitelistList()
      const scoped = options?.global
        ? list.filter((e) => !e.groupId)
        : list.filter((e) => !e.groupId || e.groupId === guild(session))
      if (scoped.length === 0) return '白名单为空'
      const lines = scoped.map((e, i) => `${i + 1}. ${e.userId}${e.groupId ? `（群 ${e.groupId}）` : '（全局）'}`)
      return `白名单（共 ${scoped.length} 人）：\n${lines.join('\n')}`
    })
}