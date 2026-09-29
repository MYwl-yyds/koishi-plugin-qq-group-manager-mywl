import { Context, Session } from 'koishi'
import { Services, BannedWordConfig, LinkGuardConfig, ImageGuardConfig, NoticeConfig } from '../types'
import { idOf } from '../utils'
import { extractLinks, isWhitelisted } from '../services/link'

function plainText(session: Session): string {
  const texts = (session.elements || [])
    .filter((el: any) => el.type === 'text')
    .map((el: any) => el.attrs?.content ?? '')
  return texts.join('') || String(session.content ?? '')
}

// 统一的处罚执行：撤回 / 禁言 / 踢出（禁言与踢出互斥，同时开启时执行禁言）
async function punish(
  svc: Services,
  session: Session,
  userId: string,
  cfg: { recallOnTrigger?: boolean, banOnTrigger?: boolean, kickOnTrigger?: boolean, banDuration?: number },
  actions: string[],
): Promise<{ recall: boolean, ban: boolean, kick: boolean }> {
  const shouldBan = !!cfg.banOnTrigger
  const shouldKick = !!cfg.kickOnTrigger && !shouldBan
  const done = { recall: false, ban: false, kick: false }
  if (cfg.recallOnTrigger && session.messageId) {
    await svc.onebot.recall(session, idOf(session.messageId))
    actions.push('撤回')
    done.recall = true
  }
  if (shouldBan) {
    const minutes = Math.max(1, Number(cfg.banDuration) || 10)
    await svc.onebot.mute(session, userId, minutes)
    actions.push(`禁言 ${minutes} 分钟`)
    done.ban = true
  }
  if (shouldKick) {
    await svc.onebot.kick(session, userId)
    actions.push('踢出')
    done.kick = true
  }
  return done
}

// 按处罚结果发送对应通知（撤回 / 禁言 / 踢出三种通知各自独立）
async function sendPunishNotices(
  svc: Services,
  session: Session,
  groupId: string,
  vars: Record<string, string>,
  done: { recall: boolean, ban: boolean, kick: boolean },
  notices: { recallNotice?: NoticeConfig, banNotice?: NoticeConfig, kickNotice?: NoticeConfig },
  duration: number,
): Promise<void> {
  if (done.recall && notices.recallNotice?.enabled) {
    await svc.notice.send(session, notices.recallNotice, { ...vars, punish: '已撤回消息' }, groupId)
  }
  if (done.ban && notices.banNotice?.enabled) {
    await svc.notice.send(session, notices.banNotice, { ...vars, punish: `禁言 ${duration} 分钟` }, groupId)
  }
  if (done.kick && notices.kickNotice?.enabled) {
    await svc.notice.send(session, notices.kickNotice, { ...vars, punish: '已踢出' }, groupId)
  }
}

// 违禁词 / 禁发链接检测
export function apply(ctx: Context, svc: Services) {
  ctx.middleware(async (session: Session, next) => {
    try {
      const groupId = idOf(session.guildId)
      const userId = idOf(session.userId)
      const selfId = idOf((session.bot as any).selfId ?? (session.bot as any).userId)
      if (!groupId || userId === selfId) return next()

      const cfg = await svc.settings.getGroup(groupId)
      if (cfg.enableGroupManagement === false) return next()
      const bw: BannedWordConfig = cfg.bannedWords
      const linkCfg: LinkGuardConfig = bw?.link
      const imageCfg: ImageGuardConfig = bw?.image
      const wordsOn = !!bw?.enabled && (bw.words?.length ?? 0) > 0
      const linkOn = !!linkCfg?.enabled
      const imageOn = !!imageCfg?.enabled
      if (!wordsOn && !linkOn && !imageOn) return next()

      // 白名单豁免违禁词（禁发链接 / 禁发图片沿用同一豁免开关）
      const wl = await svc.store.whitelistEntry(userId, groupId, cfg.applyGlobalWhitelist === true)
      if (wl?.exemptBannedWord) return next()

      const nickname = await svc.onebot.resolveNickname(session, groupId, userId)

      // ---------- 1. 禁发指定图片（感知哈希比对，独立于文本检测） ----------
      if (imageOn) {
        const hit = await svc.imageGuard.check(session, imageCfg, groupId)
        if (hit) {
          const actions: string[] = []
          let done = { recall: false, ban: false, kick: false }
          try {
            done = await punish(svc, session, userId, imageCfg, actions)
          } catch (e) {
            actions.push(`处罚失败：${(e as Error).message}`)
          }
          await svc.log.violation('违禁词·图片处罚', {
            targetId: userId,
            groupId,
            detail: JSON.stringify({
              type: '违规图片', source: 'image',
              label: hit.entry.label || '', distance: hit.distance,
              sample: hit.entry.origin || '',
            }),
            result: actions.join('，') || '无',
          })
          const vars = {
            userId, groupId, nickname: nickname || userId,
            punish: actions.join('，') || '无',
            distance: String(hit.distance),
            // 复用同一套模板变量，便于管理员统一书写通知
            word: hit.entry.label || '违规图片',
            image: hit.url,
          }
          await sendPunishNotices(svc, session, groupId, vars, done, imageCfg, Math.max(1, Number(imageCfg.banDuration) || 10))
          ctx.logger('bannedword').info(`用户 ${userId} 在群 ${groupId} 发送违规图片（距离 ${hit.distance}）被处理`)
          return next()
        }
      }

      const text = plainText(session)
      if (!text) return next()

      // ---------- 2. 禁发链接 ----------
      if (linkOn) {
        const whitelist = linkCfg.whitelist || []
        // 仅拦截「未命中白名单」的链接
        const links = extractLinks(text).filter((l) => !isWhitelisted(l, whitelist))
        if (links.length > 0) {
          const hit = links[0]
          const actions: string[] = []
          let done = { recall: false, ban: false, kick: false }
          try {
            done = await punish(svc, session, userId, linkCfg, actions)
          } catch (e) {
            actions.push(`处罚失败：${(e as Error).message}`)
          }
          await svc.log.violation('违禁词·链接处罚', {
            targetId: userId,
            groupId,
            detail: JSON.stringify({ type: '违禁词', word: hit.raw, host: hit.host, source: 'link' }),
            result: actions.join('，') || '无',
          })
          const vars = {
            userId, groupId, nickname: nickname || userId,
            word: hit.raw, punish: actions.join('，') || '无',
            host: hit.host || '', link: hit.url || hit.raw,
          }
          await sendPunishNotices(svc, session, groupId, vars, done, linkCfg, Math.max(1, Number(linkCfg.banDuration) || 10))
          ctx.logger('bannedword').info(`用户 ${userId} 在群 ${groupId} 发送链接「${hit.raw}」被处理`)
          return next()
        }
      }

      // ---------- 3. 违禁词 ----------
      if (wordsOn) {
        const hit = bw.words.find((w) => w && text.includes(w))
        if (hit) {
          const actions: string[] = []
          let done = { recall: false, ban: false, kick: false }
          try {
            done = await punish(svc, session, userId, bw, actions)
          } catch (e) {
            actions.push(`处罚失败：${(e as Error).message}`)
          }
          await svc.log.violation('违禁词处罚', {
            targetId: userId,
            groupId,
            detail: JSON.stringify({ type: '违禁词', word: hit, source: 'bannedword' }),
            result: actions.join('，') || '无',
          })
          const vars = { userId, groupId, nickname: nickname || userId, word: hit, punish: actions.join('，') || '无' }
          await sendPunishNotices(svc, session, groupId, vars, done, bw, Math.max(1, Number(bw.banDuration) || 10))
          ctx.logger('bannedword').info(`用户 ${userId} 在群 ${groupId} 触发违禁词「${hit}」`)
          return next()
        }
      }
    } catch (e) {
      ctx.logger('bannedword').warn('违禁词检测异常', e)
    }
    return next()
  })

  // 记录成员活跃时间（供「只检查最近活跃成员」使用）。
  // 用内存节流避免每条消息都写库：同一成员 10 分钟内最多落库一次。
  const touchCache = new Map<string, number>()
  ctx.middleware(async (session: Session, next) => {
    const groupId = idOf(session.guildId)
    const userId = idOf(session.userId)
    const selfId = idOf((session.bot as any).selfId ?? (session.bot as any).userId)
    if (groupId && userId && userId !== selfId) {
      const key = `${groupId}:${userId}`
      const last = touchCache.get(key) ?? 0
      if (Date.now() - last > 10 * 60 * 1000) {
        touchCache.set(key, Date.now())
        if (touchCache.size > 5000) {
          const first = touchCache.keys().next().value
          if (first !== undefined) touchCache.delete(first)
        }
        svc.store.memberTouch(groupId, userId).catch(() => {})
      }
    }
    return next()
  })
}
