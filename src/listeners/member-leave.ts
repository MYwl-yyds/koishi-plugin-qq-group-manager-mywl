import { Context, Session } from 'koishi'
import { Services } from '../types'
import { idOf, TimerRegistry } from '../utils'

// 退群自动拉黑：监听群成员减少（主动退群或被踢出）
export function apply(ctx: Context, svc: Services) {
  // 延迟拉黑用的定时器需在插件卸载时清理，避免热重载后访问已销毁的 ctx
  const timers = new TimerRegistry()
  ctx.on('dispose', () => timers.dispose())

  ctx.on('guild-member-removed', async (session: Session) => {
    try {
      const groupId = idOf(session.guildId)
      const userId = idOf(session.userId)
      if (!groupId || !userId) return

      const cfg = await svc.settings.getGroup(groupId)
      if (!cfg.autoBlacklist.enabled) return

      const operatorId = idOf((session as any).operatorId)
      const selfLeave = !operatorId || operatorId === userId
      const nickname = await svc.onebot.resolveNickname(session, groupId, userId)

      if (selfLeave && !cfg.autoBlacklist.onSelfLeave) return
      if (!selfLeave && !cfg.autoBlacklist.onKicked) return

      const reason = selfLeave ? '主动退群' : '被踢出'
      const blGroupId = cfg.applyGlobalBlacklist === true ? '' : groupId
      const doBlacklist = async () => {
        await svc.store.blacklistAdd(userId, 'auto', blGroupId)
        await svc.log.blacklist('退群自动拉黑', { targetId: userId, groupId, detail: reason })
        if (cfg.autoBlacklist.notice?.enabled) {
          await svc.notice.send(session, cfg.autoBlacklist.notice, {
            userId,
            groupId,
            nickname: nickname || userId,
            reason,
          }, groupId)
        }
        ctx.logger('autoblacklist').info(`已自动拉黑 ${userId}（${reason}）群 ${groupId}`)
      }

      if (cfg.autoBlacklist.delayMinutes > 0) {
        timers.setTimeout(() => { doBlacklist().catch(() => {}) }, cfg.autoBlacklist.delayMinutes * 60000)
      } else {
        await doBlacklist()
      }
    } catch (e) {
      ctx.logger('autoblacklist').warn('退群自动拉黑处理异常', e)
    }
  })
}