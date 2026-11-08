import { Context, Session } from 'koishi'
import { Services } from '../types'
import { idOf } from '../utils'
import { renderNotice, enrichVars } from '../services/notice'

// 欢迎语 / 欢送语
// 支持变量：{userId} {groupId} {nickname} {level} {avatar} {groupName} {groupIntro} {groupAvatar} {memberCount}
export function apply(ctx: Context, svc: Services) {
  // 渲染并发送：统一走 enrichVars，保证 {avatar} / {groupAvatar} 等变量在
  // 欢迎语/欢送语里与通知模板中的行为完全一致。
  const render = async (session: Session, groupId: string, text: string, userId: string, nickname: string) => {
    const vars = await enrichVars(svc.onebot, session, text, { userId, groupId, nickname }, groupId)
    return renderNotice(text, vars)
  }

  ctx.on('guild-member-added', async (session: Session) => {
    try {
      const groupId = idOf(session.guildId)
      const userId = idOf(session.userId)
      if (!groupId || !userId) return
      const cfg = await svc.settings.getGroup(groupId)
      if (cfg.enableGroupManagement === false) return
      if (!cfg.welcome.enabled) return
      const nickname = await svc.onebot.resolveNickname(session, groupId, userId)
      const content = await render(session, groupId, cfg.welcome.text, userId, nickname)
      if (content.length) await svc.onebot.sendGroup(session, groupId, content)
    } catch (e) {
      ctx.logger('welcome').warn('发送欢迎语失败', e)
    }
  })

  ctx.on('guild-member-removed', async (session: Session) => {
    try {
      const groupId = idOf(session.guildId)
      const userId = idOf(session.userId)
      if (!groupId || !userId) return
      const cfg = await svc.settings.getGroup(groupId)
      if (cfg.enableGroupManagement === false) return
      if (!cfg.farewell.enabled) return
      const nickname = await svc.onebot.resolveNickname(session, groupId, userId)
      const content = await render(session, groupId, cfg.farewell.text, userId, nickname)
      if (content.length) await svc.onebot.sendGroup(session, groupId, content)
    } catch (e) {
      ctx.logger('farewell').warn('发送欢送语失败', e)
    }
  })
}
