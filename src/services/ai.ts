import { Context } from 'koishi'
import { AiConfig, ReviewVerdict, ReportVerdict } from '../types'

// 提取 JSON（兼容 Markdown 代码块包裹）
export function extractJson<T = any>(text: string): T | null {
  let raw = text.trim()
  // 去掉代码围栏
  raw = raw.replace(/^```(?:json|JSON)?\s*/i, '').replace(/\s*```$/, '')
  // 截取首个 { 到最后一个 }
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1)
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

// 统一 OpenAI 兼容 AI 接口服务
export class AiService {
  private ctx: Context
  private log: any

  constructor(ctx: Context) {
    this.ctx = ctx
    this.log = ctx.logger('ai')
  }

  private endpoint(config: AiConfig): string {
    const base = config.baseURL.replace(/\/+$/, '')
    return `${base}/chat/completions`
  }

  async chat(config: AiConfig, system: string, user: string): Promise<string> {
    if (!config.enabled || !config.apiKey) {
      throw new Error('AI 接口未启用或未配置 apiKey')
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeout || 30000)
    try {
      const resp = await fetch(this.endpoint(config), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          temperature: config.temperature,
          max_tokens: config.maxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: controller.signal,
      })
      if (!resp.ok) {
        const body = await resp.text().catch(() => '')
        throw new Error(`AI 接口返回 ${resp.status}: ${body.slice(0, 200)}`)
      }
      const data = await resp.json()
      const content = data?.choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content) {
        throw new Error('AI 接口返回内容为空或格式异常')
      }
      return content
    } finally {
      clearTimeout(timer)
    }
  }

  // 入群审核：返回结构化结果，失败降级返回默认批准
  async reviewJoin(config: AiConfig, content: string): Promise<ReviewVerdict> {
    try {
      const system = config.prompts?.joinReview || '你是入群申请审核助手。'
      const text = await this.chat(config, system, `入群申请内容：\n${content || '（无申请内容）'}`)
      const parsed = extractJson<{ approve?: boolean, reason?: string }>(text)
      if (parsed && typeof parsed.approve === 'boolean') {
        return { approve: parsed.approve, reason: parsed.reason || '由 AI 判定' }
      }
      this.log.warn('AI 入群审核返回无法解析，默认批准', text)
      return { approve: true, reason: 'AI 返回异常，默认批准' }
    } catch (e) {
      this.log.warn('AI 入群审核失败，降级默认批准', (e as Error).message)
      return { approve: true, reason: 'AI 服务不可用，默认批准' }
    }
  }

  // 举报审核：返回结构化结论，失败降级返回不违规
  async reviewReport(config: AiConfig, content: string): Promise<ReportVerdict> {
    try {
      const system = config.prompts?.reportReview || '你是群消息违规审核助手。'
      const text = await this.chat(config, system, `待审核消息：\n${content}`)
      const parsed = extractJson<{ violation?: boolean, type?: string, level?: string, reason?: string, muteDuration?: number }>(text)
      if (parsed && typeof parsed.violation === 'boolean') {
        const muteDuration = typeof parsed.muteDuration === 'number' && parsed.muteDuration >= 0 ? Math.floor(parsed.muteDuration) : undefined
        return {
          violation: parsed.violation,
          type: (parsed.type as any) || '其他',
          level: (parsed.level as any) || '轻度',
          reason: parsed.reason || '',
          muteDuration,
        }
      }
      this.log.warn('AI 举报审核返回无法解析，默认不违规', text)
      return { violation: false, type: '其他', level: '轻度', reason: 'AI 返回异常，默认不违规' }
    } catch (e) {
      this.log.warn('AI 举报审核失败，降级不违规', (e as Error).message)
      return { violation: false, type: '其他', level: '轻度', reason: 'AI 服务不可用，默认不违规' }
    }
  }
}