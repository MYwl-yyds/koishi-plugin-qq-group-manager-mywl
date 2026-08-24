import { Context, Session } from 'koishi'
import { Services } from '../types'
import { idOf, template } from '../utils'
import { trackRequest, lookupRequest, quotedMessageId } from '../services/request-tracker'

function requestFlag(session: Session): string {
  const s = session as any
  return String(s.messageId ?? s.flag ?? s.id ?? '')
}

function requestSubType(session: Session): string {
  return String((session as any).subtype ?? session.subtype ?? 'add')
}

// 解析引用回复文本中的审批意图
function parseIntent(text: string): 'approve' | 'reject' | null {
  const t = String(text || '').trim()
  if (/^(同意|通过|y|yes)(\s|$)/i.test(t)) return 'approve'
  if (/^(拒绝|不通过|n|no)(\s|$)/i.test(t)) return 'reject'
  return null
}

// 去掉引用回复文本中的意图词，返回备注/理由（未填写则为空）
function stripIntent(text: string): string {
  return String(text || '').replace(/^(拒绝|不通过|no|n|同意|通过|yes|y)(\s+|$)/i, '').trim()
}

// 通知转发：将机器人收到的入群申请/邀请入群/加好友申请统一转发到指定私聊或群聊
export function apply(ctx: Context, svc: Services) {
  const forward = async (session: Session, type: 'friend' | 'join', title: string, vars: Record<string, string>, flag: string) => {
    try {
      const cfg = await svc.settings.getGlobal()
      const fw = cfg.requestForward
      if (!fw?.enabled || !fw?.targetId) return
      const text = template(fw.text || '【{title}通知】\n申请人：{nickname}({userId})\n申请内容：{comment}', { title, ...vars })
      let mid = ''
      if (fw.mode === 'private') {
        mid = await svc.onebot.sendPrivate(session, fw.targetId, text)
      } else {
        mid = await svc.onebot.sendGroup(session, fw.targetId, text)
      }
      if (mid) trackRequest(mid, { flag, type, source: 'forward' })
      ctx.logger('forward').info(`已转发${title}通知 -> ${fw.mode === 'private' ? '私聊' : '群聊'} ${fw.targetId}`)
    } catch (e) {
      ctx.logger('forward').warn('通知转发失败', e)
    }
  }

  ctx.on('friend-request', async (session) => {
    const flag = requestFlag(session)
    if (!flag) return
    const userId = idOf(session.userId)
    const comment = String(session.content ?? '')
    const nickname = await svc.onebot.resolveNickname(session, '', userId)
    forward(session, 'friend', '加好友申请', { userId, nickname: nickname || userId, groupId: '', comment: comment || '无' }, flag)
  })

  ctx.on('guild-member-request', async (session) => {
    const flag = requestFlag(session)
    if (!flag) return
    const subType = requestSubType(session)
    const title = subType === 'invite' ? '邀请入群' : '入群申请'
    const groupId = idOf(session.guildId)
    const userId = idOf(session.userId)
    const comment = String(session.content ?? '')
    const nickname = await svc.onebot.resolveNickname(session, groupId, userId)
    forward(session, 'join', title, { userId, nickname: nickname || userId, groupId, comment: comment || '无' }, flag)
  })

  // 超级管理员「引用回复」转发通知即可审批（同意 y / 拒绝 n）。
  // 使用 prepend 确保优先于入群审核的「人工审核」引用回复中间件处理。
  ctx.middleware(async (session: Session, next) => {
    try {
      const qid = quotedMessageId(session)
      if (!qid) return next()
      const meta = lookupRequest(qid)
      if (!meta || meta.source !== 'forward') return next()
      const intent = parseIntent(String(session.content ?? '').trim())
      if (!intent) return next()

      // 仅超级管理员可处理通知转发
      if (!await svc.permission.isSuperAdmin(session)) return next()

      const approve = intent === 'approve'
      const raw = String(session.content ?? '').trim()
      const operatorId = idOf(session.userId)

      if (meta.type === 'friend') {
        // 备注：未填写则不附带备注
        const remark = stripIntent(raw)
        try {
          await svc.onebot.handleFriendRequest(session, meta.flag, approve, remark)
        } catch (e) {
          return `操作失败：${(e as Error).message}`
        }
        await svc.log.audit(approve ? '通过加好友申请(转发)' : '拒绝加好友申请(转发)', { operatorId, operatorName: (session as any).username || '', detail: meta.flag })
        return approve ? '已同意该加好友申请' : '已拒绝该加好友申请'
      }

      // 入群申请 / 邀请入群
      const record = await svc.store.joinRequestByFlag(meta.flag)
      const subType = record?.subType || 'add'
      // 理由：未填写则不附带理由
      const reason = stripIntent(raw)
      try {
        await svc.onebot.handleJoinRequest(session, meta.flag, subType, approve, reason)
      } catch (e) {
        return `操作失败：${(e as Error).message}`
      }
      if (record) await svc.store.joinRequestUpdate(meta.flag, { status: approve ? 'approved' : 'rejected' })
      await svc.log.audit(approve ? '通过入群申请(转发)' : '拒绝入群申请(转发)', {
        operatorId,
        operatorName: (session as any).username || '',
        targetId: record?.userId ?? '',
        groupId: record?.groupId ?? idOf(session.guildId),
        detail: reason,
      })
      return approve ? '已同意该入群申请' : `已拒绝该入群申请${reason ? `（${reason}）` : ''}`
    } catch (e) {
      ctx.logger('forward').warn('转发审批处理异常', e)
      return next()
    }
  }, true)
}