import { Context, Session } from 'koishi'
import { Services } from '../types'
import { resolveTargetUser, idOf } from '../utils'

function guild(session: Session): string {
  return idOf(session.guildId)
}

function quotedId(session: Session): string {
  const q = session.quote as any
  return q ? String(q.id ?? q.messageId ?? '') : ''
}

// 精华消息与头衔
export function apply(ctx: Context, svc: Services) {
  ctx.command('设置精华', '将引用的消息设为精华消息')
    .alias('加精')
    .action(async ({ session }: any) => {
      if (!await svc.permission.check(session, '设置精华')) return '你没有权限使用此命令'
      const cfg = await svc.settings.getGroup(guild(session))
      if (cfg.enableGroupManagement === false) return '本群未启用群管功能'
      if (!cfg.essence.enabled) return '精华消息功能已被禁用'
      const mid = quotedId(session)
      if (!mid) return '请先「引用」要设为精华的消息，再发送本命令'
      try {
        await svc.onebot.setEssence(session, mid)
      } catch (e) {
        return (e as Error).message
      }
      await svc.log.operation('设置精华', { operatorId: idOf(session.userId), operatorName: session.username || '', targetId: mid, groupId: guild(session) })
      return '已将该消息设为精华'
    })

  ctx.command('取消精华', '取消引用的消息的精华')
    .alias('删精')
    .action(async ({ session }: any) => {
      if (!await svc.permission.check(session, '取消精华')) return '你没有权限使用此命令'
      const cfg = await svc.settings.getGroup(guild(session))
      if (cfg.enableGroupManagement === false) return '本群未启用群管功能'
      if (!cfg.essence.enabled) return '精华消息功能已被禁用'
      const mid = quotedId(session)
      if (!mid) return '请先「引用」要取消精华的消息，再发送本命令'
      try {
        await svc.onebot.deleteEssence(session, mid)
      } catch (e) {
        return (e as Error).message
      }
      await svc.log.operation('取消精华', { operatorId: idOf(session.userId), operatorName: session.username || '', targetId: mid, groupId: guild(session) })
      return '已取消该消息的精华'
    })

  ctx.command('设置头衔 <user:string> <title:text>', '设置指定用户的群专属头衔')
    .action(async ({ session }: any, user, title) => {
      if (!await svc.permission.check(session, '设置头衔')) return '你没有权限使用此命令'
      const cfg = await svc.settings.getGroup(guild(session))
      if (cfg.enableGroupManagement === false) return '本群未启用群管功能'
      if (!cfg.title.enabled) return '头衔功能已被禁用'
      const target = resolveTargetUser(session, user)
      if (!target) return '请 @ 要设置头衔的用户'
      if (!title || !title.trim()) return '头衔内容不能为空'
      try {
        await svc.onebot.setTitle(session, target, title.trim())
      } catch (e) {
        return (e as Error).message
      }
      await svc.log.operation('设置头衔', { operatorId: idOf(session.userId), operatorName: session.username || '', targetId: target, groupId: guild(session), detail: title.trim() })
      return `已为 ${target} 设置头衔「${title.trim()}」`
    })

  ctx.command('取消头衔 <user:string>', '取消指定用户的群专属头衔')
    .action(async ({ session }: any, user) => {
      if (!await svc.permission.check(session, '取消头衔')) return '你没有权限使用此命令'
      const cfg = await svc.settings.getGroup(guild(session))
      if (cfg.enableGroupManagement === false) return '本群未启用群管功能'
      if (!cfg.title.enabled) return '头衔功能已被禁用'
      const target = resolveTargetUser(session, user)
      if (!target) return '请 @ 要取消头衔的用户'
      try {
        await svc.onebot.setTitle(session, target, '')
      } catch (e) {
        return (e as Error).message
      }
      await svc.log.operation('取消头衔', { operatorId: idOf(session.userId), operatorName: session.username || '', targetId: target, groupId: guild(session) })
      return `已取消 ${target} 的头衔`
    })
}