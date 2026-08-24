import { Context, Session } from 'koishi'
import { Services, ViolationLevel, ViolationType } from '../types'
import { idOf } from '../utils'

function guild(session: Session): string {
  return idOf(session.guildId)
}

// 举报：引用/回复目标消息后触发，调用 AI 判断并执行惩罚
export function apply(ctx: Context, svc: Services) {
  ctx.command('举报', '举报一条被引用的消息（需先引用/回复目标消息）')
    .alias('投诉')
    .action(async ({ session }: any) => {
      const cfg = await svc.settings.getGroup(guild(session))
      if (cfg.enableGroupManagement === false) return '本群未启用群管功能'
      if (!cfg.report.enabled) return '举报功能已被禁用'

      // 举报频率限制（防止刷举报）
      if (cfg.report.frequency?.enabled) {
        const windowMs = Math.max(cfg.report.frequency.windowMinutes ?? 5, 1) * 60000
        const since = new Date(Date.now() - windowMs)
        const count = await svc.store.logCountRecent('violation', idOf(session.userId), guild(session), since)
        const maxCount = cfg.report.frequency.maxCount ?? 3
        if (count >= maxCount) {
          return `举报频率过快，请在 ${cfg.report.frequency.windowMinutes ?? 5} 分钟内最多举报 ${maxCount} 次`
        }
      }

      const quote = session.quote as any
      if (!quote) return '请先「引用或回复」要举报的消息，再发送举报命令'

      const messageId = idOf(quote.id ?? quote.messageId)
      let target = idOf(quote.userId)
      let content = String(quote.content ?? '')

      // 标准 OneBot v11 的 reply 段通常只含 message_id，不含发送者与正文，
      // 通过 get_msg 拉取被引用消息详情，以拿到发送者 QQ 与原始内容
      if (messageId && (!target || !content)) {
        const msg = await svc.onebot.getMsg(session, messageId)
        if (msg) {
          if (!target) target = msg.userId || ''
          if (!content) content = msg.content || ''
        }
      }

      if (!target) return '无法获取被举报消息的发送者 QQ，请重新「引用」该消息后重试'

      // 白名单豁免被举报
      const wlReport = await svc.store.whitelistEntry(target, guild(session), cfg.applyGlobalWhitelist !== false)
      if (wlReport?.exemptReport) return '该用户已被豁免举报，无法对其发起举报'

      // 组装上下文（被引用消息 + 举报人附言）
      const context = `被举报消息（发送人 ${target}）：\n${content}\n\n举报人附言：\n${session.content || ''}`

      // 调用 AI 审核（使用举报场景提示词）
      if (!cfg.ai.enabled || !cfg.ai.apiKey) {
        await svc.log.violation('举报（AI未启用）', { operatorId: idOf(session.userId), operatorName: session.username || '', targetId: target, groupId: guild(session), detail: content.slice(0, 200) })
        return 'AI 接口未启用，无法自动判定举报内容。请联系管理员配置 AI 接口。'
      }
      const verdict = await svc.ai.reviewReport(cfg.ai, context)

      if (!verdict.violation) {
        await svc.log.violation('举报（未违规）', { operatorId: idOf(session.userId), operatorName: session.username || '', targetId: target, groupId: guild(session), detail: content.slice(0, 200) })
        return '经 AI 审核，该消息暂未发现违规行为。'
      }

      // 根据违规程度映射惩罚
      const level = (verdict.level as ViolationLevel) || '轻度'
      const type = (verdict.type as ViolationType) || '其他'
      const punishment = cfg.report.levels.find((l) => l.level === level) || cfg.report.levels.find((l) => l.level === '中度')

      const gid = guild(session)
      const results: string[] = [`判断为「${type} / ${level}」违规`]
      if (punishment) {
        try {
          if (punishment.recall && messageId) {
            await svc.onebot.recall(session, messageId)
            results.push('已撤回')
          }
          if (punishment.kick && gid) {
            await svc.onebot.kick(session, target)
            results.push('已踢出')
          } else {
            // 禁言时长由 LLM 自定义，未提供时回退配置映射，且最长不超过 2 小时（120 分钟）
            const configured = Number(punishment.muteDuration || 0)
            const llmMinutes = typeof verdict.muteDuration === 'number' ? verdict.muteDuration : -1
            const muteMinutes = Math.min(Math.max(llmMinutes >= 0 ? llmMinutes : configured, 0), 120)
            if (muteMinutes > 0 && gid) {
              await svc.onebot.mute(session, target, muteMinutes)
              results.push(`已禁言 ${muteMinutes} 分钟`)
            }
          }
        } catch (e) {
          results.push(`惩罚执行失败：${(e as Error).message}`)
        }
      }

      await svc.log.violation('举报处理', {
        operatorId: idOf(session.userId), operatorName: session.username || '',
        targetId: target,
        groupId: gid,
        detail: JSON.stringify({ type, level, reason: verdict.reason, source: 'report' }),
        result: results.join('，'),
      })

      return `【举报结果】${results.join('，')}。\n审核理由：${verdict.reason}`
    })
}