import { Context, Session } from 'koishi'
import { Services, MemberCheckRule, MemberCheckState, Config } from '../types'
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

      // 超时改为由 runGroup 内部软处理（到点停止发起新请求并返回已完成的结果）。
      // 这里仍套一层 withTimeout 作为「硬兜底」，但给它额外余量：
      // 软超时会先触发并正常返回，硬超时只在底层接口彻底卡死时才会用到。
      const timeoutMs = Math.max(5, Number(cfg.memberCheck.timeoutSeconds) || 60) * 1000
      return await withTimeout(
        this.runGroup(session, cfg, gid, onlyKind, started),
        timeoutMs + 30000,
        `群 ${gid} 群员检查超时（${Math.round(timeoutMs / 1000)} 秒，底层接口无响应）`,
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
    // 软超时截止时间：到达后停止发起新的接口请求，但保留已完成的结果。
    // deadline 为 0 表示不限制。
    const timeoutMs = Math.max(5, Number(mc.timeoutSeconds) || 60) * 1000
    const deadline = started + timeoutMs
    const result: MemberCheckResult = {
      groupId: gid, scanned: 0, checked: 0, hits: 0,
      actions: { mute: 0, kick: 0, notice: 0, skipped: 0 },
      errors: [], durationMs: 0,
    }

    // 显式标注类型：Services.onebot 为 any，否则 members/targets 会被推断为 any，
    // 进而让下面的 Map 索引操作触发 TS2538（null / {} 不能作为索引类型）。
    const members: MemberInfo[] = await this.svc.onebot.getMemberList(session, gid, 0)
    result.scanned = members.length
    if (members.length === 0) {
      result.errors.push('未能获取群成员列表（协议端接口不可用或群号无效）')
      result.durationMs = Date.now() - started
      return result
    }

    // 机器人自身与超级管理员不参与检查
    const selfId = idOf((session.bot as any)?.selfId ?? (session.bot as any)?.userId)
    const superUsers = new Set<string>((await this.svc.settings.getGlobal()).superUsers || [])

    let targets: MemberInfo[] = members.filter((m) => m.userId && m.userId !== selfId && !superUsers.has(m.userId))

    // 一次性加载本群成员状态：既用于「仅检查最近活跃成员」的活跃时间，
    // 也用于后面的检查冷却判断，避免大群下反复查库。
    // 显式标注类型：Services.store 为 any，否则这里会被推断成 {}[] / null[]。
    const memberStates: MemberCheckState[] = await this.svc.store.memberStateList(gid).catch(() => [])
    // 元组断言 + Map 泛型：数组字面量默认推断为联合类型数组，会让 get() 的返回值类型失真
    const stateMap = new Map<string, MemberCheckState>(
      memberStates.map((s) => [String(s.userId), s] as [string, MemberCheckState]),
    )

    // 仅检查最近活跃成员
    if (Number(mc.activeWithinDays) > 0) {
      const since = Date.now() - Number(mc.activeWithinDays) * 86400000
      const activeMap = new Map<string, number>(
        memberStates.map((s) => [String(s.userId), new Date(s.activeAt).getTime()] as [string, number]),
      )
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

    // 大群优化：
    // - 并发默认降到 2（原为 4），显著降低触发协议端限流的概率；
    // - 等级缓存默认 6 小时（可配），同一成员短期重复扫描不再发请求；
    // - 失败重试 1 次并带退避，避免瞬时抖动被当成「等级 0」。
    const concurrency = Math.max(1, Number(mc.batchSize) || 2)
    const cacheHours = Math.max(0, Number(mc.levelCacheHours ?? 6))
    const levelTtl = cacheHours * 3600000

    const qqLevelMap = new Map<string, number | null>()
    // 统计接口失败率：大面积失败通常是限流征兆，必须中止以免误伤整群
    let qqFailed = 0
    let qqAttempted = 0
    // 软超时：不再用 withTimeout 一刀切断整个 runGroup（那会把已经查到的结果全部丢掉，
    // 大群必然触发）。这里改为「到点就停止发起新的请求」，已完成的部分照常返回。
    // 已缓存的等级（getStrangerInfo 内部有 5 分钟~levelCacheHours 的缓存）下一轮直接命中，
    // 因此大群会分几轮逐步补全，而不是每轮都从头重来。
    let timedOut = false
    // 因超时而「未发起请求」的成员数：不计入失败率，否则大群每轮都会触发失败率保护而无法推进
    let qqSkippedByTimeout = 0
    // 本轮真正发起过查询的成员（含查询失败）。用于区分「查了但没拿到」和「根本还没查」：
    // 前者才允许走 whenUnknown 的降级策略，后者必须直接跳过。
    const qqLevelQueried = new Set<string>()
    if (needQqLevel && targets.length > 0) {
      const infos = await mapConcurrent(targets.map((m) => m.userId), concurrency, async (uid) => {
        // 已到截止时间：不再发起新请求，标记为「本轮跳过」（不是失败）
        if (deadline > 0 && Date.now() >= deadline) {
          timedOut = true
          return { uid, level: null, skipped: true }
        }
        const info = await this.svc.onebot.getStrangerInfo(session, uid, levelTtl, 1)
        const level = info && typeof info.level === 'number' && info.level >= 1 ? info.level : null
        return { uid, level, skipped: false }
      })
      for (const r of infos) {
        qqLevelMap.set(r.uid, r.level)
        // 超时跳过与真正的接口失败分开统计
        if (r.skipped) { qqSkippedByTimeout++; continue }
        qqLevelQueried.add(r.uid)
        qqAttempted++
        if (r.level === null) qqFailed++
      }
    }

    // 记录软超时：本轮结果不完整，提示用户（但不影响已完成的处理）
    if (timedOut) {
      result.errors.push(
        `扫描达到单群超时上限（${Math.round(timeoutMs / 1000)} 秒），本轮提前结束，`
        + `本轮跳过 ${qqSkippedByTimeout} 人（已完成的部分正常生效）。`
        + `已获取的等级会被缓存，下一轮扫描会继续处理剩余成员且更快。`
        + `成员较多时建议：提高「单群超时」、增大「扫描间隔」，或调大「等级缓存」。`,
      )
      this.log().warn(
        `群 ${gid} 群员检查达到超时上限（${Math.round(timeoutMs / 1000)}s），本轮跳过 ${qqSkippedByTimeout} 人`,
      )
    }

    // 失败率保护：超过阈值直接中止本群检查，不执行任何处罚。
    // 宁可这一轮不检查，也不能因为接口限流把整群成员误判为低等级。
    const failRatio = qqAttempted > 0 ? qqFailed / qqAttempted : 0
    const maxFailRatio = Math.min(Math.max(Number(mc.maxFailRatio ?? 30), 0), 100) / 100
    if (needQqLevel && qqAttempted > 0 && failRatio > maxFailRatio) {
      result.errors.push(
        `QQ 等级接口大面积失败（${qqFailed}/${qqAttempted}，${Math.round(failRatio * 100)}%），`
        + `超过阈值 ${Math.round(maxFailRatio * 100)}%，已中止本次检查以避免误判。`
        + `常见原因为协议端限流，建议降低并发数或延长扫描间隔。`,
      )
      result.durationMs = Date.now() - started
      this.log().warn(`群 ${gid} 群员检查中止：QQ 等级接口失败率 ${Math.round(failRatio * 100)}%（${qqFailed}/${qqAttempted}）`)
      return result
    }

    // 群等级补拉同样做失败保护，并改用 Map 回填（原实现对每个成员 findIndex，大群下是 O(n²)）
    let groupLevelFailed = 0
    // 群等级接口是批量调用（一次拉一批），剩余时间不足时整批跳过，不计入失败率
    if (groupLevelMissing.length > 0 && (deadline === 0 || Date.now() < deadline)) {
      const infos = await this.svc.onebot.getMembersInfo(session, gid, groupLevelMissing, concurrency)
      // 显式写成 [string, number] 元组并标注 Map 泛型：
      // 否则 TS 会把数组字面量推断成 (string | number)[]，导致 idx 变成 string | number，
      // 作为数组下标时触发 TS2538。
      const idxById = new Map<string, number>(targets.map((m, i) => [m.userId, i] as [string, number]))
      for (const uid of groupLevelMissing) {
        const info = infos.get(uid)
        const idx = idxById.get(uid)
        if (idx === undefined) continue
        if (info && typeof info.level === 'number' && info.level >= 1) {
          const cur = targets[idx]
          targets[idx] = { ...cur, level: info.level }
        } else {
          groupLevelFailed++
        }
      }
      const glRatio = groupLevelMissing.length > 0 ? groupLevelFailed / groupLevelMissing.length : 0
      if (glRatio > maxFailRatio) {
        result.errors.push(
          `群等级接口大面积失败（${groupLevelFailed}/${groupLevelMissing.length}，${Math.round(glRatio * 100)}%），`
          + `已中止本次检查以避免误判。`,
        )
        result.durationMs = Date.now() - started
        this.log().warn(`群 ${gid} 群员检查中止：群等级接口失败率 ${Math.round(glRatio * 100)}%`)
        return result
      }
    }

    const cooldownMs = Math.max(0, Number(mc.cooldownHours) || 0) * 3600000
    const now = Date.now()

    // 预热白名单，避免在成员循环里逐条查库（大群下这是主要耗时来源之一）。
    // 语义与 store.whitelistEntry 保持一致：applyGlobalWhitelist 为真时查全局条目，
    // 否则查本群条目。
    let whitelistIds = new Set<string>()
    if (mc.card?.enabled && mc.card.excludeWhitelist !== false) {
      const scopeId = cfg.applyGlobalWhitelist === true ? '' : gid
      const wl = await this.svc.store.whitelistList(scopeId).catch(() => [])
      whitelistIds = new Set((wl || []).map((w: any) => String(w.userId)))
    }

    // 因本轮超时而被跳过的成员：绝不能进入处罚判定。
    // 否则当 whenUnknown='trigger' 时，一次超时会把大量成员当成「等级获取失败」而批量处罚，
    // 这正是大群最危险的误伤场景。
    // 判据：需要查 QQ 等级、且本轮没有对它发起过查询。
    const isTimeoutSkipped = (uid: string) => needQqLevel && !qqLevelQueried.has(uid)

    for (const m of targets) {
      result.checked++
      const hits: MemberCheckHit[] = []

      // 1. QQ 账号等级
      if (needQqLevel && mc.qqLevel.enabled) {
        // 本轮超时未查询该成员：直接跳过，不做任何判定
        if (isTimeoutSkipped(m.userId)) {
          result.actions.skipped++
          continue
        }
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
        // 白名单已预加载到 Set，这里不再逐个查库
        const excludeWl = mc.card.excludeWhitelist !== false && whitelistIds.has(String(m.userId))
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
        // 冷却：同一成员在冷却期内不重复处理（用预加载的 stateMap，避免逐条查库）
        if (cooldownMs > 0) {
          const state = stateMap.get(String(m.userId))
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
    const members: MemberInfo[] = await this.svc.onebot.getMemberList(session, gid, 0)
    const selfId = idOf((session.bot as any)?.selfId ?? (session.bot as any)?.userId)
    const superUsers = new Set<string>((await this.svc.settings.getGlobal()).superUsers || [])
    const targets: MemberInfo[] = members.filter((m) => m.userId && m.userId !== selfId && !superUsers.has(m.userId))
    const hits: MemberCheckHit[] = []

    const needQqLevel = !!mc.qqLevel?.enabled && (!kind || kind === 'qqLevel')
    const qqLevelMap = new Map<string, number | null>()
    if (needQqLevel) {
      // 与 runGroup 保持一致：低并发、长缓存、带退避重试，避免大群预览触发限流
      const concurrency = Math.max(1, Number(mc.batchSize) || 2)
      const levelTtl = Math.max(0, Number(mc.levelCacheHours ?? 6)) * 3600000
      const infos = await mapConcurrent(targets.map((m) => m.userId), concurrency, async (uid) => {
        const info = await this.svc.onebot.getStrangerInfo(session, uid, levelTtl, 1)
        return [uid, info && typeof info.level === 'number' && info.level >= 1 ? info.level : null] as [string, number | null]
      })
      for (const [uid, level] of infos) qqLevelMap.set(uid, level)
    }

    // 白名单预加载，避免逐成员查库
    let whitelistIds = new Set<string>()
    if (mc.card?.enabled && mc.card.excludeWhitelist !== false) {
      const scopeId = cfg.applyGlobalWhitelist === true ? '' : gid
      const wl = await this.svc.store.whitelistList(scopeId).catch(() => [])
      whitelistIds = new Set((wl || []).map((w: any) => String(w.userId)))
    }

    for (const m of targets) {
      if (needQqLevel) {
        const level = qqLevelMap.get(m.userId)
        // 与 runGroup 一致：未知（接口失败）时按 whenUnknown 决定是否算命中
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
      if (mc.card?.enabled && (!kind || kind === 'card') && mc.card.patterns?.length) {
        const excludeAdmin = mc.card.excludeAdmins !== false && (m.role === 'admin' || m.role === 'owner')
        const excludeWl = mc.card.excludeWhitelist !== false && whitelistIds.has(String(m.userId))
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
      // 群等级：与 runGroup 保持一致的三态处理 —— 未知按 whenUnknown 决定，
      // 已知且低于阈值才算命中（normalizeMember 已把 0 归一为 -1=未知）
      if (mc.groupLevel?.enabled && (!kind || kind === 'groupLevel')) {
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
    }
    return hits
  }
}
