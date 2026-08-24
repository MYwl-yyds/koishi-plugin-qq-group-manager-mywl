import { Context, Session } from 'koishi'
import { Services } from '../types'
import { idOf } from '../utils'

function guild(session: Session): string {
  return idOf(session.guildId)
}

// 入群审核相关命令：通过/拒绝入群申请、查看待审核列表
export function apply(ctx: Context, svc: Services) {
  ctx.command('通过入群申请 <flag:text>', '同意一个入群申请')
    .action(async ({ session }: any, flag) => {
      if (!await svc.permission.check(session, '入群审核')) return '你没有权限使用此命令'
      if (!flag) return '请提供入群申请的 flag（见审核通知）'
      const record = await svc.store.joinRequestByFlag(flag)
      try {
        await svc.onebot.handleJoinRequest(session, flag, record?.subType || 'add', true)
      } catch (e) {
        return (e as Error).message
      }
      if (record) await svc.store.joinRequestUpdate(flag, { status: 'approved' })
      await svc.log.audit('通过入群申请', { operatorId: idOf(session.userId), targetId: record?.userId ?? '', groupId: record?.groupId ?? guild(session), detail: flag })
      return '已同意该入群申请'
    })

  ctx.command('拒绝入群申请 <flag:text> [reason:text]', '拒绝一个入群申请')
    .action(async ({ session }: any, flag, reason) => {
      if (!await svc.permission.check(session, '入群审核')) return '你没有权限使用此命令'
      if (!flag) return '请提供入群申请的 flag（见审核通知）'
      const record = await svc.store.joinRequestByFlag(flag)
      try {
        await svc.onebot.handleJoinRequest(session, flag, record?.subType || 'add', false, reason?.trim() || '未通过审核')
      } catch (e) {
        return (e as Error).message
      }
      if (record) await svc.store.joinRequestUpdate(flag, { status: 'rejected' })
      await svc.log.audit('拒绝入群申请', { operatorId: idOf(session.userId), targetId: record?.userId ?? '', groupId: record?.groupId ?? guild(session), detail: reason?.trim() || '' })
      return '已拒绝该入群申请'
    })

  ctx.command('入群审核列表', '查看待人工审核的入群申请')
    .action(async ({ session }: any) => {
      if (!await svc.permission.check(session, '入群审核')) return '你没有权限使用此命令'
      const list = await svc.store.joinRequestList('pending')
      if (list.length === 0) return '当前没有待审核的入群申请'
      const lines = list.map((r, i) => {
        return `${i + 1}. 【${r.flag}】申请人 ${r.userId}${r.nickname ? `（${r.nickname}）` : ''} 内容：${r.comment || '无'}`
      })
      return `待审核申请（共 ${list.length} 条）：\n${lines.slice(0, 20).join('\n')}${list.length > 20 ? '\n…仅显示前 20 条' : ''}`
    })

  ctx.command('通过加好友申请 <flag:text> [remark:text]', '同意加好友申请（仅超级管理员）')
    .action(async ({ session }: any, flag, remark) => {
      if (!await svc.permission.isSuperAdmin(session)) return '仅超级管理员可操作'
      if (!flag) return '请提供好友申请的 flag（见通知）'
      try {
        await svc.onebot.handleFriendRequest(session, flag, true, remark?.trim() || '同意')
      } catch (e) {
        return (e as Error).message
      }
      await svc.log.audit('通过加好友申请', { operatorId: idOf(session.userId), detail: flag })
      return '已同意该加好友申请'
    })

  ctx.command('拒绝加好友申请 <flag:text> [remark:text]', '拒绝加好友申请（仅超级管理员）')
    .action(async ({ session }: any, flag, remark) => {
      if (!await svc.permission.isSuperAdmin(session)) return '仅超级管理员可操作'
      if (!flag) return '请提供好友申请的 flag（见通知）'
      try {
        await svc.onebot.handleFriendRequest(session, flag, false, remark?.trim() || '拒绝')
      } catch (e) {
        return (e as Error).message
      }
      await svc.log.audit('拒绝加好友申请', { operatorId: idOf(session.userId), detail: flag })
      return '已拒绝该加好友申请'
    })
}