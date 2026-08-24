import { Context, Session, segment } from 'koishi'
import { NoticeConfig } from '../types'

// 当下列变量取值为空时，包含这些变量的整行将被省略
const OPTIONAL_VARS = ['question', 'answer', 'level']

// 渲染通知模板（支持变量与条件行），返回可直接发送的消息片段数组
export function renderNotice(template: string, vars: Record<string, string>): any[] {
  const avatarUrl = vars['userId'] ? `https://q1.qlogo.cn/g?b=qq&nk=${vars['userId']}&s=640` : ''
  const lines = String(template ?? '').split('\n')
  const out: any[] = []
  lines.forEach((line, i) => {
    // 可选变量为空则跳过整行（例如未设置入群问题、无回答、无等级）
    if (OPTIONAL_VARS.some((k) => line.includes(`{${k}}`) && !vars[k])) return
    const parts = renderLine(line, vars, avatarUrl)
    for (const p of parts) out.push(p)
    if (i < lines.length - 1) out.push('\n')
  })
  return out
}

function renderLine(line: string, vars: Record<string, string>, avatarUrl: string): any[] {
  const parts: any[] = []
  const re = /\{(\w+)\}/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) {
    const text = line.slice(last, m.index)
    if (text) parts.push(text)
    const key = m[1]
    if (key === 'avatar') {
      if (avatarUrl) parts.push(segment.image(avatarUrl))
    } else {
      const val = vars[key] ?? ''
      if (val) parts.push(val)
    }
    last = m.index + m[0].length
  }
  const tail = line.slice(last)
  if (tail) parts.push(tail)
  return parts
}

// 通知服务：统一的「执行后结果通知」发送（支持自定义文本与变量）
export class NoticeService {
  private ctx: Context
  private onebot: any

  constructor(ctx: Context, onebot: any) {
    this.ctx = ctx
    this.onebot = onebot
  }

  // 发送通知；fallbackGroup 用于 targetId 为空时回退到事件所在群
  async send(session: Session, notice: NoticeConfig, vars: Record<string, string>, fallbackGroup = ''): Promise<void> {
    try {
      if (!notice || !notice.enabled) return
      const content = renderNotice(notice.text, vars)
      if (!content || content.length === 0) return
      if (notice.mode === 'private') {
        if (notice.targetId) await this.onebot.sendPrivate(session, notice.targetId, content)
      } else {
        const gid = notice.targetId || fallbackGroup
        if (gid) await this.onebot.sendGroup(session, gid, content)
      }
    } catch (e) {
      this.ctx.logger('notice').warn('发送通知失败', e)
    }
  }
}