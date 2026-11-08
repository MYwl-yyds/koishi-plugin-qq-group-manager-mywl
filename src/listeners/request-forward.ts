import { Context, Session } from 'koishi'
import { Services } from '../types'
import { idOf, plainText } from '../utils'
import { trackRequest, lookupRequest, quotedMessageId, resolveRequestFallback, TrackedRequest } from '../services/request-tracker'
import { renderNotice, enrichVars } from '../services/notice'

// 取 OneBot 请求事件里的 flag（调用 set_group_add_request / set_friend_add_request 必须用它）。
// 注意顺序：session.id 是 Koishi 内部事件 ID，不是 flag，只能作为最后兜底；
// 真实 flag 优先从 session.flag 或原始事件负载里取，否则审批调用会因 flag 无效而失败。
function requestFlag(session: Session): string {
  const s = session as any
  const ev = s.event || {}
  const raw = ev._data || ev.data || {}
  return String(
    s.flag ?? ev.flag ?? raw.flag
    ?? s.messageId ?? ev.messageId ?? raw.message_id
    ?? s.id ?? '',
  )
}

function requestSubType(session: Session): string {
  return String((session as any).subtype ?? session.subtype ?? 'add')
}

// 解析引用回复文本中的审批意图
// 允许词后跟标点（「同意！」「y，备注」）。注意 \b 对中文无效，
// 因此额外用「词后紧跟标点/空白/结尾」来判断，避免「同意啊」被误判。
function parseIntent(text: string): 'approve' | 'reject' | null {
  const t = String(text || '').trim()
  if (!t) return null
  if (/^(同意|通过|批准|y|yes)(?=[\s，,。.!！~～、:：]|$)/i.test(t)) return 'approve'
  if (/^(拒绝|不通过|驳回|n|no)(?=[\s，,。.!！~～、:：]|$)/i.test(t)) return 'reject'
  return null
}

// 去掉引用回复文本中的意图词，返回备注/理由（未填写则为空）
function stripIntent(text: string): string {
  return String(text || '')
    .replace(/^(拒绝|不通过|驳回|no|n|同意|通过|批准|yes|y)(?=[\s，,。.!！~～、:：]|$)/i, '')
    .replace(/^[\s，,。.!！~～、:：]+/, '')
    .trim()
}

// 通知转发：将机器人收到的入群申请/邀请入群/加好友申请统一转发到指定私聊或群聊
export function apply(ctx: Context, svc: Services) {
  const forward = async (session: Session, type: 'friend' | 'join', title: string, vars: Record<string, string>, flag: string) => {
    try {
      const cfg = await svc.settings.getGlobal()
      const fw = cfg.requestForward
      if (!fw?.enabled || !fw?.targetId) return
      const rawText = fw.text || '【{title}通知】\n申请人：{nickname}({userId})\n申请内容：{comment}'
      // 改用 renderNotice + enrichVars：这样 {avatar} / {groupAvatar} / {level} / {groupName}
      // 等变量在通知转发里也能生效（原来走 template() 只能渲染纯文本，图片变量会被丢弃）。
      const enriched = await enrichVars(
        svc.onebot,
        session,
        rawText,
        { title, ...vars },
        vars['groupId'] || idOf(session.guildId),
      )
      const content = renderNotice(rawText, enriched)
      if (content.length === 0) return
      let mid = ''
      if (fw.mode === 'private') {
        mid = await svc.onebot.sendPrivate(session, fw.targetId, content)
      } else {
        mid = await svc.onebot.sendGroup(session, fw.targetId, content)
      }
      if (mid) trackRequest(mid, { flag, type, source: 'forward', groupId: fw.mode === 'private' ? '' : fw.targetId })
      ctx.logger('forward').info(`已转发${title}通知 -> ${fw.mode === 'private' ? '私聊' : '群聊'} ${fw.targetId}`)
    } catch (e) {
      ctx.logger('forward').warn('通知转发失败', e)
    }
  }

  ctx.on('friend-request', async (session) => {
    const flag = requestFlag(session)
    if (!flag) return
    const userId = idOf(session.userId)
    const comment = plainText(session)
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
    const comment = plainText(session)
    const nickname = await svc.onebot.resolveNickname(session, groupId, userId)
    forward(session, 'join', title, { userId, nickname: nickname || userId, groupId, comment: comment || '无' }, flag)
  })

  // 超级管理员「引用回复」转发通知即可审批（同意 y / 拒绝 n）。
  // 使用 prepend 确保优先于入群审核的「人工审核」引用回复中间件处理。
  ctx.middleware(async (session: Session, next) => {
    try {
      const qid = quotedMessageId(session)
      if (!qid) return next()
      // 关键：必须用文本段而不是 session.content —— 引用回复时 content 形如
      // 「[quote:id=123] 同意」，意图正则匹配不到开头，导致审批永远无法生效。
      const text = plainText(session).trim()
      const intent = parseIntent(text)
      if (!intent) return next()

      // 仅超级管理员可处理通知转发
      if (!await svc.permission.isSuperAdmin(session)) return next()

      // 群聊中要求通知确实发往本群；私聊不校验群号
      const here = idOf(session.guildId)
      let meta: TrackedRequest | undefined = lookupRequest(qid, here || undefined)
      if (!meta || meta.source !== 'forward') {
        // 内存未命中（插件重载 / 重启后通知仍在群里）时的兜底：
        // 该群当前只有一条待审申请就直接处理它，多条时放弃以免审错人。
        const fb = await resolveRequestFallback(svc.store, here)
        if (!fb) return next()
        meta = { flag: fb.flag, type: 'join', source: 'forward', groupId: here }
      }

      const approve = intent === 'approve'
      const raw = text
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