import { Context, Session } from 'koishi'
import { Services, MemberCheckRule, Config } from '../types'
// 仅用其类型，避免运行时依赖
import type { MemberInfo } from './onebot'
import { idOf, mapConcurrent, withTimeout } from '../utils'

export interface MemberCheckHit {
  groupId: string
  userId: string
  nickname: string
  card: string
  // 命中的检查类型
  kind: 'qqLevel' | 'card' | 'groupLevel'
  kindName: string
  // 触发说明（用于日志/通知）
  detail: string
  // 实际检测到的值（用于通知变量 {level} / {card}）
  level: string
  // 命中的关键词（群名片检查）
  word: string
  threshold: string
}

export interface MemberCheckResult {
  groupId: string
  scanned: number
  checked: number
  hits: number
  actions: { mute: number, kick: number, notice: number, skipped: number }
  errors: string[]
  durationMs: number
}

// 群名片匹配（包含 / 完全等于；支持 /正则/）
function matchCard(card: string, rule: Config['memberCheck']['card']): string {
  const value = rule.caseSensitive ? card : card.toLowerCase()
  for (const raw of rule.patterns) {
    const pattern = String(raw ?? '')
    if (!pattern) continue
    // 以 / 包裹视为正则
    if (pattern.length > 2 && pattern.startsWith('/') && pattern.endsWith('/')) {
      try {
        const re = new RegExp(pattern.slice(1, -1), rule.caseSensitive ? '' : 'i')
        const m = re.exec(card)
        if (m) return m[0] || pattern
      } catch { /* 非法正则忽略 */ }
      continue
    }
    const target = rule.caseSensitive ? pattern : pattern.toLowerCase()
    if (rule.matchMode === 'equals') {
      if (value === target) return pattern
    } else if (value.includes(target)) {
      return pattern
    }
  }
  return ''
}

// 群员检查服务：定时扫描群成员，按「QQ 等级 / 群名片 / 群等级」三类规则分别处理。
// 三类规则的触发操作互相独立，可为禁言 / 踢出 / 仅记录。
export class MemberCheckService {
  private ctx: Context
  private svc: Services
  private running = new Set<string>()
  private timer: any = null
  private lastRunAt = 0
  private lastResults: MemberCheckResult[] = []
  // 每群上次扫描时间：各群按自己的 intervalMinutes 独立计时
  private groupLastRun = new Map<string, number>()

  constructor(ctx: Context, svc: Services) {
    this.ctx = ctx
    this.svc = svc
  }

  private log() {
    return this.ctx.logger('member-check')
  }

  private ruleEnabled(cfg: Config): boolean {
    const mc = cfg.memberCheck
    if (!mc?.enabled) return false
    return !!(mc.qqLevel?.enabled || mc.card?.enabled || mc.groupLevel?.enabled)
  }

  // 启动定时扫描（插件启动时调用一次）
  start(): void {
    if (this.timer) return
    // 每 60 秒检查一次「是否到达扫描间隔」，避免使用动态定时器带来的漂移
    this.timer = setInterval(() => {
      this.tick().catch((e) => this.log().warn('群员检查定时任务异常', e))
    }, 60 * 1000)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  // 定时器心跳：挑出「本群自己的间隔已到」的群，各自独立执行。
  // 群员检查已改为纯群级配置，不再读取全局的 intervalMinutes / enabled。
  private async tick(): Promise<void> {
    const due = await this.dueGroups()
    if (due.length === 0) return
    for (const gid of due) this.groupLastRun.set(gid, Date.now())
    this.log().info(`群员检查开始，本次待扫描 ${due.length} 个群：${due.join(', ')}`)
    await this.scanGroups(due)
  }

  // 找出所有「已启用且已到扫描间隔」的群
  private async dueGroups(): Promise<string[]> {
    const records = await this.svc.store.groupConfigAll()
    const due: string[] = []
    const now = Date.now()
    for (const rec of records) {
      const gid = String(rec.groupId)
      if (!gid) continue
      const cfg = await this.svc.settings.getGroup(gid)
      if (!this.ruleEnabled(cfg)) continue
      const interval = Math.max(1, Number(cfg.memberCheck?.intervalMinutes) || 30) * 60 * 1000
      if (now - (this.groupLastRun.get(gid) ?? 0) < interval) continue
      due.push(gid)
    }
    return due
  }

  // 扫描指定群集合（内部复用，供定时任务与手动触发调用）
  private async scanGroups(groupIds: string[]): Promise<MemberCheckResult[]> {
    const results: MemberCheckResult[] = []
    for (const gid of groupIds) {
      const result = await this.checkGroup(gid).catch((e) => {
        this.log().warn(`群 ${gid} 群员检查异常`, e)
        return null
      })
      if (result) results.push(result)
    }
    this.lastResults = results
    this.lastRunAt = Date.now()
    return results
  }

  // 扫描全部已启用群员检查的群（各群使用自己的配置）
  async scanAll(): Promise<MemberCheckResult[]> {
    const records = await this.svc.store.groupConfigAll()
    const groupIds: string[] = []
    for (const rec of records) {
      const gid = String(rec.groupId)
      if (!gid) continue
      const cfg = await this.svc.settings.getGroup(gid)
      if (this.ruleEnabled(cfg)) groupIds.push(gid)
    }
    if (groupIds.length === 0) return []
    for (const gid of groupIds) this.groupLastRun.set(gid, Date.now())
    return this.scanGroups(groupIds)
  }

  // 检查单个群（可被 WebUI 手动触发）
  async checkGroup(groupId: string, onlyKind?: MemberCheckHit['kind']): Promise<MemberCheckResult> {
    const gid = idOf(groupId)
    const started = Date.now()
    const empty: MemberCheckResult = {
      groupId: gid, scanned: 0, checked: 0, hits: 0,
      actions: { mute: 0, kick: 0, notice: 0, skipped: 0 },
      errors: [], durationMs: 0,
    }
    if (!gid) return empty
    if (this.running.has(gid)) {
      return { ...empty, errors: ['该群正在检查中，已跳过本次'] }
    }
    this.running.add(gid)
    try {
      const cfg = await this.svc.settings.getGroup(gid)
      if (!this.ruleEnabled(cfg)) return { ...empty, durationMs: Date.now() - started }
      const session = this.sessionOf(gid)
      if (!session) return { ...empty, errors: ['未找到可用的 OneBot 机器人，无法执行群员检查'], durationMs: Date.now() - started }

      const timeoutMs = Math.max(5, Number(cfg.memberCheck.timeoutSeconds) || 60) * 1000
      return await withTimeout(
        this.runGroup(session, cfg, gid, onlyKind, started),
        timeoutMs,
        `群 ${gid} 群员检查超时（${Math.round(timeoutMs / 1000)} 秒）`,
      )
    } finally {
      this.running.delete(gid)
    }
  }

  // 构造一个「虚拟会话」用于调用 OneBot 接口（底层只依赖 bot.internal / bot.onebot）
  private sessionOf(groupId: string): Session | null {
    for (const bot of this.ctx.bots) {
      const s = bot.session?.({ guildId: groupId, channelId: groupId } as any)
      if (s) {
        // 部分实现不会带上 guildId，这里兜底
        ;(s as any).guildId = groupId
        ;(s as any).channelId = groupId
        return s
      }
    }
    const bot: any = this.ctx.bots[0]
    if (!bot) return null
    return { bot, guildId: groupId, channelId: groupId } as any
  }

  private async runGroup(
    session: Session,
    cfg: Config,
    gid: string,
    onlyKind: MemberCheckHit['kind'] | undefined,
    started: number,
  ): Promise<MemberCheckResult> {
    const mc = cfg.memberCheck
    const result: MemberCheckResult = {
      groupId: gid, scanned: 0, checked: 0, hits: 0,
      actions: { mute: 0, kick: 0, notice: 0, skipped: 0 },
      errors: [], durationMs: 0,
    }

    const members = await this.svc.onebot.getMemberList(session, gid, 0)
    result.scanned = members.length
    if (members.length === 0) {
      result.errors.push('未能获取群成员列表（协议端接口不可用或群号无效）')
      result.durationMs = Date.now() - started
      return result
    }

    // 机器人自身与超级管理员不参与检查
    const selfId = idOf((session.bot as any)?.selfId ?? (session.bot as any)?.userId)
    const superUsers = new Set((await this.svc.settings.getGlobal()).superUsers || [])

    let targets = members.filter((m) => m.userId && m.userId !== selfId && !superUsers.has(m.userId))

    // 仅检查最近活跃成员
    if (Number(mc.activeWithinDays) > 0) {
      const since = Date.now() - Number(mc.activeWithinDays) * 86400000
      const states = await this.svc.store.memberStateList(gid)
      const activeMap = new Map(states.map((s) => [String(s.userId), new Date(s.activeAt).getTime()]))
      const fallback = (m: MemberInfo) => (Number(m.lastSentTime) > 0 ? Number(m.lastSentTime) * 1000 : 0)
      targets = targets.filter((m) => {
        const at = Number(activeMap.get(m.userId) ?? 0)
        const last = Math.max(at, fallback(m))
        // 无活跃记录的成员：不检查（避免打扰长期潜水的成员）
        return last > 0 && last >= since
      })
    }

    // 需要额外拉取 QQ 等级（get_stranger_info）的成员
    const needQqLevel = !!mc.qqLevel?.enabled && (!onlyKind || onlyKind === 'qqLevel')
    // get_group_member_list 已包含群等级；缺失时再逐个补拉
    const needGroupLevel = !!mc.groupLevel?.enabled && (!onlyKind || onlyKind === 'groupLevel')
    const groupLevelMissing = needGroupLevel ? targets.filter((m) => m.level < 0).map((m) => m.userId) : []

    const qqLevelMap = new Map<string, number | null>()
    if (needQqLevel && targets.length > 0) {
      const infos = await mapConcurrent(targets.map((m) => m.userId), Math.max(1, Number(mc.batchSize) || 4), async (uid) => {
        const info = await this.svc.onebot.getStrangerInfo(session, uid)
        return [uid, info && typeof info.level === 'number' && info.level >= 0 ? info.level : null] as [string, number | null]
      })
      for (const [uid, level] of infos) qqLevelMap.set(uid, level)
    }

    if (groupLevelMissing.length > 0) {
      const infos = await this.svc.onebot.getMembersInfo(session, gid, groupLevelMissing, Math.max(1, Number(mc.batchSize) || 4))
      for (const [uid, info] of infos) {
        const idx = targets.findIndex((m) => m.userId === uid)
        if (idx >= 0) targets[idx] = { ...targets[idx], level: info.level }
      }
    }

    const cooldownMs = Math.max(0, Number(mc.cooldownHours) || 0) * 3600000
    const now = Date.now()

    for (const m of targets) {
      result.checked++
      const hits: MemberCheckHit[] = []

      // 1. QQ 账号等级
      if (needQqLevel && mc.qqLevel.enabled) {
        const level = qqLevelMap.get(m.userId)
        if (level === null || level === undefined) {
          if (mc.qqLevel.whenUnknown === 'trigger') {
            hits.push({
              groupId: gid, userId: m.userId, nickname: m.nickname, card: m.card,
              kind: 'qqLevel', kindName: 'QQ等级',
              detail: `QQ 等级获取失败（按配置视为命中，要求 ≥ ${mc.qqLevel.minLevel}）`,
              level: '', word: '', threshold: String(mc.qqLevel.minLevel),
            })
          }
        } else if (level < Number(mc.qqLevel.minLevel)) {
          hits.push({
            groupId: gid, userId: m.userId, nickname: m.nickname, card: m.card,
            kind: 'qqLevel', kindName: 'QQ等级',
            detail: `QQ 等级 ${level} 低于要求 ${mc.qqLevel.minLevel}`,
            level: String(level), word: '', threshold: String(mc.qqLevel.minLevel),
          })
        }
      }

      // 2. 群名片
      if (mc.card?.enabled && (!onlyKind || onlyKind === 'card') && mc.card.patterns?.length) {
        const excludeAdmin = mc.card.excludeAdmins !== false && (m.role === 'admin' || m.role === 'owner')
        const excludeWl = mc.card.excludeWhitelist !== false
          && !!(await this.svc.store.whitelistEntry(m.userId, gid, cfg.applyGlobalWhitelist === true))
        if (!excludeAdmin && !excludeWl) {
          const display = m.card || m.nickname || ''
          const word = matchCard(display, mc.card)
          if (word) {
            hits.push({
              groupId: gid, userId: m.userId, nickname: m.nickname, card: m.card,
              kind: 'card', kindName: '群名片',
              detail: `群名片「${display}」${mc.card.matchMode === 'equals' ? '完全等于' : '包含'}「${word}」`,
              level: '', word, threshold: mc.card.matchMode === 'equals' ? '完全等于' : '包含',
            })
          }
        }
      }

      // 3. 群等级
      if (mc.groupLevel?.enabled && (!onlyKind || onlyKind === 'groupLevel')) {
        if (m.level < 0) {
          if (mc.groupLevel.whenUnknown === 'trigger') {
            hits.push({
              groupId: gid, userId: m.userId, nickname: m.nickname, card: m.card,
              kind: 'groupLevel', kindName: '群等级',
              detail: `群等级获取失败（按配置视为命中，要求 ≥ ${mc.groupLevel.minLevel}）`,
              level: '', word: '', threshold: String(mc.groupLevel.minLevel),
            })
          }
        } else if (m.level < Number(mc.groupLevel.minLevel)) {
          hits.push({
            groupId: gid, userId: m.userId, nickname: m.nickname, card: m.card,
            kind: 'groupLevel', kindName: '群等级',
            detail: `群等级 ${m.level} 低于要求 ${mc.groupLevel.minLevel}`,
            level: String(m.level), word: '', threshold: String(mc.groupLevel.minLevel),
          })
        }
      }

      for (const hit of hits) {
        // 冷却：同一成员在冷却期内不重复处理
        if (cooldownMs > 0) {
          const state = await this.svc.store.memberStateGet(gid, m.userId)
          const checkedAt = state?.checkedAt ? new Date(state.checkedAt).getTime() : 0
          if (checkedAt && now - checkedAt < cooldownMs) {
            result.actions.skipped++
            continue
          }
        }
        result.hits++
        await this.applyHit(session, cfg, hit, result, m)
      }
    }

    result.durationMs = Date.now() - started
    return result
  }

  // 执行单条命中的触发操作（禁言 / 踢出 / 仅记录）
  private async applyHit(
    session: Session,
    cfg: Config,
    hit: MemberCheckHit,
    result: MemberCheckResult,
    member: { lastSentTime: number },
  ): Promise<void> {
    const rule: MemberCheckRule = (cfg.memberCheck as any)[hit.kind] as MemberCheckRule
    const action = rule?.action ?? 'none'
    const done: string[] = []

    if (action === 'mute') {
      try {
        await this.svc.onebot.mute(session, hit.userId, Math.max(1, Number(rule.muteDuration) || 10))
        done.push(`禁言 ${Math.max(1, Number(rule.muteDuration) || 10)} 分钟`)
        result.actions.mute++
      } catch (e) {
        result.errors.push(`禁言 ${hit.userId} 失败：${(e as Error).message}`)
      }
    } else if (action === 'kick') {
      try {
        await this.svc.onebot.kick(session, hit.userId)
        done.push('踢出')
        result.actions.kick++
      } catch (e) {
        result.errors.push(`踢出 ${hit.userId} 失败：${(e as Error).message}`)
      }
    } else {
      done.push('仅记录')
    }

    // 尽力撤回该成员最近一条消息（OneBot 无「撤回最近一条」接口，仅在被动消息场景可用）
    if (rule?.recall && action !== 'none') {
      // 无 message_id 时跳过，仅做提示
      done.push('（撤回需消息上下文，已跳过）')
    }

    await this.svc.store.memberStateSet(hit.groupId, hit.userId, {
      checkedAt: new Date(),
      lastAction: action,
    })

    await this.svc.log.operation(`群员检查·${hit.kindName}`, {
      targetId: hit.userId,
      groupId: hit.groupId,
      detail: JSON.stringify({ kind: hit.kind, detail: hit.detail, word: hit.word, level: hit.level, source: 'memberCheck' }),
      result: done.join('，') || '无',
    })

    if (rule?.notice?.enabled) {
      await this.svc.notice.send(session, rule.notice, {
        userId: hit.userId,
        groupId: hit.groupId,
        nickname: hit.nickname || hit.userId,
        card: hit.card || hit.nickname || '',
        level: hit.level,
        word: hit.word,
        threshold: hit.threshold,
        punish: done.join('，') || '无',
        reason: hit.detail,
      }, hit.groupId)
      result.actions.notice++
    }

    this.log().info(`群 ${hit.groupId} 成员 ${hit.userId} 命中${hit.kindName}：${hit.detail}`)
  }

  // WebUI：手动触发指定群检查
  async manualCheck(groupId: string, kind?: MemberCheckHit['kind']): Promise<MemberCheckResult> {
    return this.checkGroup(groupId, kind)
  }

  getLastResults(): MemberCheckResult[] {
    return this.lastResults
  }

  getLastRunAt(): number {
    return this.lastRunAt
  }

  // 预览：不执行任何操作，仅返回会命中的成员列表（供 WebUI 试运行）
  async preview(groupId: string, kind?: MemberCheckHit['kind']): Promise<MemberCheckHit[]> {
    const gid = idOf(groupId)
    if (!gid) return []
    const cfg = await this.svc.settings.getGroup(gid)
    if (!this.ruleEnabled(cfg)) return []
    const session = this.sessionOf(gid)
    if (!session) return []
    const mc = cfg.memberCheck
    const members = await this.svc.onebot.getMemberList(session, gid, 0)
    const selfId = idOf((session.bot as any)?.selfId ?? (session.bot as any)?.userId)
    const superUsers = new Set((await this.svc.settings.getGlobal()).superUsers || [])
    const targets = members.filter((m) => m.userId && m.userId !== selfId && !superUsers.has(m.userId))
    const hits: MemberCheckHit[] = []

    const needQqLevel = !!mc.qqLevel?.enabled && (!kind || kind === 'qqLevel')
    const qqLevelMap = new Map<string, number | null>()
    if (needQqLevel) {
      const infos = await mapConcurrent(targets.map((m) => m.userId), Math.max(1, Number(mc.batchSize) || 4), async (uid) => {
        const info = await this.svc.onebot.getStrangerInfo(session, uid)
        return [uid, info && typeof info.level === 'number' && info.level >= 0 ? info.level : null] as [string, number | null]
      })
      for (const [uid, level] of infos) qqLevelMap.set(uid, level)
    }

    for (const m of targets) {
      if (needQqLevel) {
        const level = qqLevelMap.get(m.userId)
        if (level !== null && level !== undefined && level < Number(mc.qqLevel.minLevel)) {
          hits.push({
            groupId: gid, userId: m.userId, nickname: m.nickname, card: m.card,
            kind: 'qqLevel', kindName: 'QQ等级',
            detail: `QQ 等级 ${level} 低于要求 ${mc.qqLevel.minLevel}`,
            level: String(level), word: '', threshold: String(mc.qqLevel.minLevel),
          })
        }
      }
      if (mc.card?.enabled && (!kind || kind === 'card') && mc.card.patterns?.length) {
        const excludeAdmin = mc.card.excludeAdmins !== false && (m.role === 'admin' || m.role === 'owner')
        const excludeWl = mc.card.excludeWhitelist !== false
          && !!(await this.svc.store.whitelistEntry(m.userId, gid, cfg.applyGlobalWhitelist === true))
        if (!excludeAdmin && !excludeWl) {
          const display = m.card || m.nickname || ''
          const word = matchCard(display, mc.card)
          if (word) {
            hits.push({
              groupId: gid, userId: m.userId, nickname: m.nickname, card: m.card,
              kind: 'card', kindName: '群名片',
              detail: `群名片「${display}」${mc.card.matchMode === 'equals' ? '完全等于' : '包含'}「${word}」`,
              level: '', word, threshold: mc.card.matchMode === 'equals' ? '完全等于' : '包含',
            })
          }
        }
      }
      if (mc.groupLevel?.enabled && (!kind || kind === 'groupLevel') && m.level >= 0 && m.level < Number(mc.groupLevel.minLevel)) {
        hits.push({
          groupId: gid, userId: m.userId, nickname: m.nickname, card: m.card,
          kind: 'groupLevel', kindName: '群等级',
          detail: `群等级 ${m.level} 低于要求 ${mc.groupLevel.minLevel}`,
          level: String(m.level), word: '', threshold: String(mc.groupLevel.minLevel),
        })
      }
    }
    return hits
  }
}
