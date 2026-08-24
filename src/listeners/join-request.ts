import { Context, Session } from 'koishi'
import { Services, JoinRequestRecord, Config } from '../types'
import { idOf } from '../utils'
import { renderNotice } from '../services/notice'
import { trackRequest, lookupRequest, quotedMessageId } from '../services/request-tracker'

function requestFlag(session: Session): string {
  const s = session as any
  return String(s.messageId ?? s.flag ?? s.id ?? '')
}

function requestSubType(session: Session): string {
  return String((session as any).subtype ?? session.subtype ?? 'add')
}

// 解析引用文本中的审核意图
function parseReplyIntent(text: string): 'approve' | 'reject' | null {
  const t = String(text || '').trim()
  if (/^(同意|通过|y|yes)(\s|$)/i.test(t)) return 'approve'
  if (/^(拒绝|不通过|n|no)(\s|$)/i.test(t)) return 'reject'
  return null
}

// 去掉意图词，返回理由（未填写则为空）
function stripIntent(text: string): string {
  return String(text || '').replace(/^(拒绝|不通过|no|n|同意|通过|yes|y)(\s+|$)/i, '').trim()
}

// 通知审核员（通知中不再展示 flag，改为通过消息 ID 反查）
async function notifyReviewers(svc: Services, session: Session, cfg: Config, record: JoinRequestRecord): Promise<void> {
  const dispName = record.nickname && record.nickname !== record.userId ? record.nickname : record.userId
  const text = `【入群审核通知】\n群号：${record.groupId}\n申请人：${dispName}${dispName !== record.userId ? `（${record.userId}）` : ''}\n申请内容：${record.comment || '无'}\n\n请引用回复本条消息，发送「同意」或「拒绝」（也可发送 y/n）即可完成审核。`
  const mode = cfg.joinReview.manual.notifyMode
  const reviewers = cfg.joinReview.manual.reviewers || []
  if (mode === 'group' || mode === 'both') {
    const gid = cfg.joinReview.manual.notifyGroupId || record.groupId
    if (gid) {
      const mid = await svc.onebot.sendGroup(session, gid, text)
      if (mid) trackRequest(mid, { flag: record.flag, type: 'join', source: 'manual' })
    }
  }
  if (mode === 'private' || mode === 'both') {
    for (const r of reviewers) {
      if (r) {
        const mid = await svc.onebot.sendPrivate(session, r, text)
        if (mid) trackRequest(mid, { flag: record.flag, type: 'join', source: 'manual' })
      }
    }
  }
}

async function handleJoinRequest(svc: Services, session: Session): Promise<void> {
  const flag = requestFlag(session)
  if (!flag) {
    return
  }
  const subType = requestSubType(session)
  // 仅处理主动加群申请（add）与邀请入群（invite），其余忽略
  if (subType !== 'add' && subType !== 'invite') return

  const groupId = idOf(session.guildId)
  const userId = idOf(session.userId)
  const comment = String(session.content ?? '')
  const nickname = await svc.onebot.resolveNickname(session, groupId, userId)

  const cfg = await svc.settings.getGroup(groupId)

  const now = new Date()
  // 记录待处理请求（invite 也记录，供超管通过命令审批）
  await svc.store.joinRequestCreate({
    flag,
    subType,
    groupId,
    userId,
    nickname,
    comment,
    status: 'pending',
    reviewers: [...(cfg.joinReview.manual.reviewers || [])],
    notified: [],
    createdAt: now,
    expireAt: new Date(now.getTime() + Math.max(cfg.joinReview.manual.timeoutMinutes, 1) * 60000),
  })

  // 邀请入群不做自动审核（通知转发由 request-forward 负责）
  if (subType !== 'add') return
  if (!cfg.joinReview.enabled) return

  const finalize = async (approve: boolean, reason: string, status: JoinRequestRecord['status']) => {
    await svc.store.joinRequestUpdate(flag, { status })
    try {
      await svc.onebot.handleJoinRequest(session, flag, subType, approve, reason)
    } catch (e) {
      svc.ctx.logger('join').warn('处理入群请求失败', (e as Error).message)
    }
    await svc.log.audit(approve ? '入群审核通过' : '入群审核拒绝', { targetId: userId, groupId, detail: reason, result: status })

    // 自动判定结果通知（复用入群审核已有的通知目标，频率/等级/关键词/LLM/超时等自动判断）
    if (cfg.joinReview.autoNotice?.enabled) {
      let level = ''
      if (cfg.joinReview.qqLevel?.enabled) {
        const info = await svc.onebot.getStrangerInfo(session, userId)
        level = info && typeof info.level === 'number' ? String(info.level) : ''
      }
      // 入群问题通过 OneBot 内置接口获取群聊自身设置的说明/问题
      let question = ''
      if (cfg.joinReview.autoNotice.text?.includes('{question}')) {
        question = await svc.onebot.getGroupQuestion(session, groupId)
      }
      const content = renderNotice(cfg.joinReview.autoNotice.text, {
        userId,
        groupId,
        nickname: nickname || userId,
        level,
        question,
        answer: comment,
        result: `${approve ? '已同意' : '已拒绝'}（${reason}）`,
        reason,
      })
      if (content.length) {
        const mode = cfg.joinReview.manual.notifyMode
        if (mode === 'group' || mode === 'both') {
          const gid = cfg.joinReview.manual.notifyGroupId || groupId
          if (gid) await svc.onebot.sendGroup(session, gid, content)
        }
        if (mode === 'private' || mode === 'both') {
          for (const r of cfg.joinReview.manual.reviewers || []) {
            if (r) await svc.onebot.sendPrivate(session, r, content)
          }
        }
      }
    }
  }

  // 0. 白名单豁免入群审核
  const wlJoin = await svc.store.whitelistEntry(userId, groupId, cfg.applyGlobalWhitelist !== false)
  if (wlJoin?.exemptJoin) {
    await finalize(true, '白名单豁免', 'approved')
    return
  }

  // 1. 频率检查
  if (cfg.joinReview.frequency.enabled) {
    const since = new Date(now.getTime() - cfg.joinReview.frequency.windowMinutes * 60000)
    const count = await svc.store.joinRequestCountRecent(userId, groupId, since)
    if (count > cfg.joinReview.frequency.maxCount) {
      await finalize(false, '申请过于频繁', 'rejected')
      return
    }
  }

  // 2. 黑名单检查（全局 + 本群，依据「应用全局黑名单」开关）
  if (cfg.joinReview.blacklist.enabled) {
    if (await svc.store.blacklistHas(userId, groupId, cfg.applyGlobalBlacklist !== false)) {
      await finalize(false, '命中黑名单', 'rejected')
      return
    }
  }

  // 3. QQ 等级检查
  if (cfg.joinReview.qqLevel.enabled) {
    const info = await svc.onebot.getStrangerInfo(session, userId)
    if (info && typeof info.level === 'number' && info.level < cfg.joinReview.qqLevel.minLevel) {
      await finalize(false, `QQ 等级不足（需 ≥ ${cfg.joinReview.qqLevel.minLevel} 级）`, 'rejected')
      return
    }
  }

  // 4. 关键词检查
  if (cfg.joinReview.keyword.enabled) {
    const rej = cfg.joinReview.keyword.rejectKeywords.find((k) => k && comment.includes(k))
    if (rej) {
      await finalize(false, `命中拒绝关键词「${rej}」`, 'rejected')
      return
    }
    const pass = cfg.joinReview.keyword.passKeywords.find((k) => k && comment.includes(k))
    if (pass) {
      await finalize(true, `命中通过关键词「${pass}」`, 'approved')
      return
    }
  }

  // 5. 人工审核（超时后 6. LLM 处理）
  if (cfg.joinReview.manual.enabled) {
    await notifyReviewers(svc, session, cfg, { flag, subType, groupId, userId, nickname, comment, status: 'pending', reviewers: [...(cfg.joinReview.manual.reviewers || [])], notified: [], createdAt: now, expireAt: new Date() } as any)
    const timeoutMs = Math.max(cfg.joinReview.manual.timeoutMinutes, 1) * 60000
    setTimeout(async () => {
      const cur = await svc.store.joinRequestByFlag(flag)
      if (!cur || cur.status !== 'pending') return
      if (cfg.joinReview.llm.enabled && cfg.ai.enabled) {
        const verdict = await svc.ai.reviewJoin(cfg.ai, comment || '（无申请内容）')
        await finalize(verdict.approve, `AI 审批：${verdict.reason}`, 'llm')
      } else {
        await finalize(false, '人工审核超时，自动拒绝', 'timeout')
      }
    }, timeoutMs)
    return
  }

  // 未启用人工审核：若启用 LLM 则立即自动审批
  if (cfg.joinReview.llm.enabled && cfg.ai.enabled) {
    const verdict = await svc.ai.reviewJoin(cfg.ai, comment || '（无申请内容）')
    await finalize(verdict.approve, `AI 审批：${verdict.reason}`, 'llm')
  }
}

export function apply(ctx: Context, svc: Services) {
  ctx.on('guild-member-request', (session) => {
    handleJoinRequest(svc, session).catch((e) => {
      ctx.logger('join').warn('入群审核流程异常', e)
    })
  })

  // 人工审核：引用回复「入群审核通知」，发送 同意/拒绝（或 y/n）即可完成审批
  ctx.middleware(async (session: Session, next) => {
    try {
      const qid = quotedMessageId(session)
      if (!qid) return next()
      const meta = lookupRequest(qid)
      if (!meta || meta.source !== 'manual') return next()
      const intent = parseReplyIntent(String(session.content ?? '').trim())
      if (!intent) return next()

      const record = await svc.store.joinRequestByFlag(meta.flag)
      if (!record || record.status !== 'pending') return next()

      const cfg = await svc.settings.getGroup(record.groupId)
      const reviewers = cfg.joinReview.manual.reviewers || []
      const uid = idOf(session.userId)
      const allowedByPerm = await svc.permission.check(session, '入群审核')
      const isReviewer = reviewers.length > 0 && reviewers.includes(uid)
      if (!allowedByPerm && !isReviewer) return next()

      const approve = intent === 'approve'
      // 理由可选：未填写则不附带理由
      const reason = stripIntent(String(session.content ?? '').trim())
      try {
        await svc.onebot.handleJoinRequest(session, meta.flag, record.subType || 'add', approve, reason)
      } catch (e) {
        return `操作失败：${(e as Error).message}`
      }
      await svc.store.joinRequestUpdate(meta.flag, { status: approve ? 'approved' : 'rejected' })
      await svc.log.audit(approve ? '入群审核通过' : '入群审核拒绝', { operatorId: uid, operatorName: (session as any).username || '', targetId: record.userId, groupId: record.groupId, detail: reason })
      return approve ? '已同意该入群申请' : `已拒绝该入群申请${reason ? `（${reason}）` : ''}`
    } catch (e) {
      ctx.logger('join').warn('引用审核处理异常', e)
      return next()
    }
  })
}