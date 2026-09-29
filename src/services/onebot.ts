import { Context, Session } from 'koishi'
import { OneBotFramework, OneBotMemberInfo } from '../types'
import { idOf, mapConcurrent } from '../utils'

function normalizeError(e: any): Error {
  if (e instanceof Error) return e
  return new Error(String(e?.message ?? e))
}

// snake_case -> camelCase
function toCamel(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

// 群资料（用于通知变量：群聊名称/简介/头像/人数）
export interface GroupProfile {
  name: string
  intro: string
  avatar: string
  memberCount: string
}

// 归一化的群成员信息（屏蔽各框架字段差异）
export interface MemberInfo {
  userId: string
  nickname: string
  card: string
  role: string
  // 群等级（活跃等级），获取不到时为 -1
  level: number
  // 最后发言时间戳（毫秒），0 表示未知
  lastSentTime: number
  joinTime: number
}

// 统一封装 OneBot v11 内置接口，所有调用具备异常捕获与降级返回。
// NapCat / LLBot / go-cqhttp 均为标准 OneBot v11 协议，统一按 snake_case action + 对象参数调用。
export class OneBotService {
  private ctx: Context
  private log: any
  readonly framework: OneBotFramework
  // 群资料短时缓存，避免违禁词等高频通知重复调用 get_group_info
  private groupProfileCache = new Map<string, { at: number, data: GroupProfile }>()
  // 群成员列表短时缓存，避免群员检查与权限导入等重复拉取
  private memberListCache = new Map<string, { at: number, data: MemberInfo[] }>()
  // 陌生人信息（QQ 等级）短时缓存
  private strangerCache = new Map<string, { at: number, data: { nickname?: string, level?: number } | null }>()

  constructor(ctx: Context, framework: OneBotFramework = 'auto') {
    this.ctx = ctx
    this.log = ctx.logger('onebot')
    this.framework = framework
  }

  // 取出底层原始请求对象：
  // - Koishi 标准 OneBot 适配器（NapCat / LLBot / go-cqhttp 均使用）在 bot.internal 上提供 _request / _get
  // - 部分场景下会话上直接挂载 onebot 函数桥（session.onebot / bot.onebot）
  private rawBridge(session: Session): ((action: string, params: any) => Promise<any>) | null {
    const s = session as any
    if (typeof s.onebot === 'function') return s.onebot.bind(s)
    if (typeof s.bot?.onebot === 'function') return s.bot.onebot.bind(s.bot)
    return null
  }

  private internal(session: Session): any {
    const s = session as any
    return s.bot?.internal ?? s.bot
  }

  // 统一调用 OneBot v11 内置接口。
  // NapCat / LLBot / go-cqhttp 均为标准 OneBot v11 协议，统一使用 snake_case action + 对象参数。
  // 调用顺序兼容多种适配器形态，任一可用即可，全部不可用才报错。
  private async invoke(
    session: Session,
    action: string,
    params: Record<string, any>,
    camelArgs: any[],
  ): Promise<any> {
    const errors: string[] = []

    // 1) 会话/机器人上直接挂载的原生 onebot 函数桥
    const bridge = this.rawBridge(session)
    if (bridge) {
      try {
        return await bridge(action, params)
      } catch (e) {
        errors.push(`onebot桥: ${normalizeError(e).message}`)
      }
    }

    const internal = this.internal(session)
    if (!internal) {
      throw new Error('当前协议端不是 OneBot v11，无法调用群管理接口')
    }

    // 2) Koishi OneBot 适配器标准入口：_request / _get（LLBot 通过该入口透传标准 action）
    for (const name of ['_request', '_get', 'request'] as const) {
      const fn = (internal as any)[name]
      if (typeof fn !== 'function') continue
      try {
        return await fn.call(internal, action, params)
      } catch (e) {
        errors.push(`${name}: ${normalizeError(e).message}`)
        // _get 不存在或动作不被支持时继续尝试其它形态
      }
    }

    // 3) 适配器在 internal 上生成的 camelCase 动作方法（旧版适配器 / 部分分支）
    const fn = internal[toCamel(action)]
    if (typeof fn === 'function') {
      try {
        return await fn.call(internal, ...camelArgs)
      } catch (e) {
        errors.push(`${toCamel(action)}: ${normalizeError(e).message}`)
      }
    } else {
      errors.push(`未找到方法 ${toCamel(action)}`)
    }

    throw new Error(`当前协议端不支持 OneBot 接口 ${action}（${errors.join('；')}）`)
  }

  // 从 OneBot 返回值中提取 data（兼容 {status,retcode,data} 与直接返回）
  private unwrap(res: any): any {
    if (res && typeof res === 'object' && 'data' in res && (res.data !== undefined || 'status' in res || 'retcode' in res)) {
      return res.data
    }
    return res
  }

  // 归一化单个群成员信息（屏蔽 LLBot / NapCat / go-cqhttp 字段差异）
  private normalizeMember(raw: any): MemberInfo {
    const userId = idOf(raw?.user_id ?? raw?.userId ?? raw?.uin)
    const levelRaw = raw?.level ?? raw?.member_level ?? raw?.memberLevel
    const level = levelRaw === undefined || levelRaw === null || levelRaw === '' ? -1 : Number(levelRaw)
    return {
      userId,
      nickname: String(raw?.nickname ?? raw?.nick_name ?? '').trim(),
      card: String(raw?.card ?? '').trim(),
      role: String(raw?.role ?? 'member'),
      level: Number.isFinite(level) ? level : -1,
      lastSentTime: Number(raw?.last_sent_time ?? raw?.lastSentTime ?? 0) || 0,
      joinTime: Number(raw?.join_time ?? raw?.joinTime ?? 0) || 0,
    }
  }

  // 目标合法性校验：禁止对自己、群主、以及权限不低于自己的成员执行禁言/踢出。
  // 校验失败会抛错，由调用方捕获后转为可读提示，避免「误踢机器人自己」这类不可逆操作。
  private async assertPunishable(session: Session, userId: string, action: string): Promise<void> {
    const selfId = idOf((session.bot as any)?.selfId ?? (session.bot as any)?.userId)
    if (!userId) throw new Error(`${action}失败：未指定目标用户`)
    if (selfId && userId === selfId) throw new Error(`${action}失败：不能对自己执行该操作`)

    const groupId = idOf(session.guildId)
    if (!groupId) return
    try {
      const target = await this.getGroupMemberInfo(session, groupId, userId, 30 * 1000)
      if (target?.role === 'owner') throw new Error(`${action}失败：不能对群主执行该操作`)
      // 机器人自身在群内的角色：owner > admin > member。目标角色更高或相等时协议端通常也会拒绝，
      // 这里提前拦截以给出明确提示（仅当机器人不是群主时才有意义）。
      const self = selfId ? await this.getGroupMemberInfo(session, groupId, selfId, 30 * 1000) : null
      const rank = (role?: string) => (role === 'owner' ? 3 : role === 'admin' ? 2 : 1)
      if (self && rank(target?.role) >= rank(self.role) && self.role !== 'owner') {
        throw new Error(`${action}失败：目标成员（${target?.role === 'admin' ? '管理员' : '成员'}）权限不低于机器人`)
      }
    } catch (e) {
      // 查询失败（接口不可用）时不阻断操作，交由协议端判定；但上面的显式校验错误必须抛出
      const msg = normalizeError(e).message
      if (msg.startsWith(`${action}失败：`)) throw e
    }
  }

  // 禁言（minutes 为分钟）
  async mute(session: Session, userId: string, minutes: number): Promise<void> {
    await this.assertPunishable(session, userId, '禁言')
    try {
      const groupId = idOf(session.guildId)
      const duration = Math.round(minutes * 60)
      await this.invoke(session, 'set_group_ban',
        { group_id: groupId, user_id: userId, duration },
        [groupId, userId, duration])
    } catch (e) {
      this.log.warn('禁言失败', normalizeError(e).message)
      throw new Error(`禁言失败：${normalizeError(e).message}`)
    }
  }

  async unmute(session: Session, userId: string): Promise<void> {
    try {
      const groupId = idOf(session.guildId)
      await this.invoke(session, 'set_group_ban',
        { group_id: groupId, user_id: userId, duration: 0 },
        [groupId, userId, 0])
    } catch (e) {
      this.log.warn('解除禁言失败', normalizeError(e).message)
      throw new Error(`解除禁言失败：${normalizeError(e).message}`)
    }
  }

  // 全体禁言 / 全体解禁
  async setWholeBan(session: Session, enable: boolean): Promise<void> {
    try {
      const groupId = idOf(session.guildId)
      await this.invoke(session, 'set_group_whole_ban',
        { group_id: groupId, enable },
        [groupId, enable])
    } catch (e) {
      this.log.warn(enable ? '全体禁言失败' : '全体解禁失败', normalizeError(e).message)
      throw new Error(`${enable ? '全体禁言' : '全体解禁'}失败：${normalizeError(e).message}`)
    }
  }

  async kick(session: Session, userId: string): Promise<void> {
    await this.assertPunishable(session, userId, '踢出')
    try {
      const groupId = idOf(session.guildId)
      await this.invoke(session, 'set_group_kick',
        { group_id: groupId, user_id: userId },
        [groupId, userId])
    } catch (e) {
      this.log.warn('踢出失败', normalizeError(e).message)
      throw new Error(`踢出失败：${normalizeError(e).message}`)
    }
  }

  async leaveGroup(session: Session): Promise<void> {
    try {
      const groupId = idOf(session.guildId)
      await this.invoke(session, 'set_group_leave',
        { group_id: groupId },
        [groupId])
    } catch (e) {
      this.log.warn('退群失败', normalizeError(e).message)
      throw new Error(`退群失败：${normalizeError(e).message}`)
    }
  }

  async handleJoinRequest(session: Session, flag: string, subType: string, approve: boolean, reason?: string): Promise<void> {
    try {
      await this.invoke(session, 'set_group_add_request',
        { flag, sub_type: subType, approve, reason: reason ?? '' },
        [flag, subType, approve, reason ?? ''])
    } catch (e) {
      this.log.warn('处理入群请求失败', normalizeError(e).message)
      throw new Error(`处理入群请求失败：${normalizeError(e).message}`)
    }
  }

  async handleFriendRequest(session: Session, flag: string, approve: boolean, remark?: string): Promise<void> {
    try {
      await this.invoke(session, 'set_friend_add_request',
        { flag, approve, remark: remark ?? '' },
        [flag, approve, remark ?? ''])
    } catch (e) {
      this.log.warn('处理好友请求失败', normalizeError(e).message)
      throw new Error(`处理好友请求失败：${normalizeError(e).message}`)
    }
  }

  async setEssence(session: Session, messageId: string): Promise<void> {
    try {
      await this.invoke(session, 'set_essence_msg',
        { message_id: messageId },
        [messageId])
    } catch (e) {
      this.log.warn('设置精华失败', normalizeError(e).message)
      throw new Error(`设置精华失败：${normalizeError(e).message}`)
    }
  }

  async deleteEssence(session: Session, messageId: string): Promise<void> {
    try {
      await this.invoke(session, 'delete_essence_msg',
        { message_id: messageId },
        [messageId])
    } catch (e) {
      this.log.warn('取消精华失败', normalizeError(e).message)
      throw new Error(`取消精华失败：${normalizeError(e).message}`)
    }
  }

  async setTitle(session: Session, userId: string, title: string): Promise<void> {
    try {
      const groupId = idOf(session.guildId)
      // 空标题表示清除头衔，duration 使用 -1 以兼容 napcat/llbot
      await this.invoke(session, 'set_group_special_title',
        { group_id: groupId, user_id: userId, special_title: title, duration: -1 },
        [groupId, userId, title, -1])
    } catch (e) {
      this.log.warn('设置头衔失败', normalizeError(e).message)
      throw new Error(`设置头衔失败：${normalizeError(e).message}`)
    }
  }

  async recall(session: Session, messageId: string): Promise<void> {
    try {
      await this.invoke(session, 'delete_msg',
        { message_id: messageId },
        [messageId])
    } catch (e) {
      this.log.warn('撤回失败', normalizeError(e).message)
      throw new Error(`撤回失败：${normalizeError(e).message}`)
    }
  }

  // 获取消息详情（OneBot get_msg），用于解析被引用消息的发送者与正文。
  // 标准 OneBot v11 的 reply 段通常只含 message_id，不含发送者，
  // 因此需要调用 get_msg 获取发送者 QQ 与原始内容。
  async getMsg(session: Session, messageId: string): Promise<{ userId?: string, nickname?: string, content?: string } | null> {
    try {
      const res = await this.invoke(session, 'get_msg',
        { message_id: messageId },
        [messageId])
      const data = res?.data ?? res ?? {}
      const sender = data.sender ?? {}
      // 不同框架字段略有差异：user_id 可能在顶层，也可能在 sender 内
      const uid = data.user_id ?? sender.user_id
      let content = ''
      if (data.raw_message != null && String(data.raw_message).trim()) {
        content = String(data.raw_message)
      } else if (Array.isArray(data.message)) {
        content = data.message
          .filter((m: any) => m?.type === 'text')
          .map((m: any) => String(m?.data?.text ?? ''))
          .join('')
      } else if (data.text != null) {
        content = String(data.text)
      }
      return {
        userId: uid !== undefined && uid !== null ? String(uid) : '',
        nickname: sender.nickname != null ? String(sender.nickname) : (sender.card != null ? String(sender.card) : ''),
        content,
      }
    } catch (e) {
      this.log.warn('获取消息详情失败', normalizeError(e).message)
      return null
    }
  }

  // 获取陌生人信息（用于 QQ 等级检查与昵称），失败降级返回 null
  // level 字段在 LLBot / NapCat 上为 QQ 账号等级（1~256）
  async getStrangerInfo(session: Session, userId: string, ttlMs = 5 * 60 * 1000): Promise<{ nickname?: string, level?: number } | null> {
    const uid = idOf(userId)
    if (!uid) return null
    const hit = this.strangerCache.get(uid)
    if (hit && Date.now() - hit.at < ttlMs) return hit.data
    let data: { nickname?: string, level?: number } | null = null
    try {
      const res = await this.invoke(session, 'get_stranger_info',
        { user_id: uid, no_cache: false },
        [uid, false])
      const info = this.unwrap(res) ?? {}
      const levelRaw = info.level ?? info.qq_level ?? info.qqLevel
      data = {
        nickname: info.nickname ? String(info.nickname) : '',
        level: levelRaw === undefined || levelRaw === null || levelRaw === '' ? -1 : Number(levelRaw),
      }
      if (!Number.isFinite(data.level as number)) data.level = -1
    } catch (e) {
      this.log.warn('获取陌生人信息失败（降级跳过）', normalizeError(e).message)
      data = null
    }
    this.cacheSet(this.strangerCache, uid, data)
    return data
  }

  private cacheSet<T>(cache: Map<string, { at: number, data: T }>, key: string, data: T, max = 500): void {
    cache.set(key, { at: Date.now(), data })
    if (cache.size > max) {
      const first = cache.keys().next().value
      if (first !== undefined) cache.delete(first)
    }
  }

  // 获取群成员列表（归一化字段），带短时缓存。
  // LLBot / NapCat 的 get_group_member_list 均返回含 level（群等级）、card、role 的成员数组。
  async getMemberList(session: Session, groupId: string, ttlMs = 60 * 1000): Promise<MemberInfo[]> {
    const gid = idOf(groupId)
    if (!gid) return []
    const hit = this.memberListCache.get(gid)
    if (hit && Date.now() - hit.at < ttlMs) return hit.data
    try {
      const res = await this.invoke(session, 'get_group_member_list',
        { group_id: gid, no_cache: ttlMs <= 0 },
        [gid])
      const list = this.unwrap(res) ?? []
      const data = Array.isArray(list) ? list.map((m) => this.normalizeMember(m)).filter((m) => m.userId) : []
      if (data.length > 0) this.cacheSet(this.memberListCache, gid, data, 50)
      return data
    } catch (e) {
      this.log.warn('获取群成员列表失败', normalizeError(e).message)
      return []
    }
  }

  // 兼容旧调用：返回原始成员数组
  async getGroupMemberList(session: Session, groupId: string): Promise<OneBotMemberInfo[]> {
    const members = await this.getMemberList(session, groupId, 0)
    return members.map((m) => ({
      user_id: m.userId,
      userId: m.userId,
      nickname: m.nickname,
      card: m.card,
      role: m.role,
      level: m.level < 0 ? undefined : m.level,
    }))
  }

  // 获取机器人加入的群列表（OneBot get_group_list）
  async getGroupList(session: Session): Promise<Array<{ groupId: string, name: string, memberCount: number }>> {
    try {
      const res = await this.invoke(session, 'get_group_list', {}, [])
      const list = this.unwrap(res) ?? []
      if (!Array.isArray(list)) return []
      return list.map((g: any) => ({
        groupId: idOf(g?.group_id ?? g?.groupId ?? g?.id),
        name: String(g?.group_name ?? g?.groupName ?? g?.name ?? '').trim(),
        memberCount: Number(g?.member_count ?? g?.memberCount ?? 0) || 0,
      })).filter((g) => g.groupId)
    } catch (e) {
      this.log.warn('获取群列表失败', normalizeError(e).message)
      return []
    }
  }

  // 获取群信息（OneBot get_group_info）
  async getGroupInfo(session: Session, groupId: string): Promise<Record<string, any>> {
    try {
      const res = await this.invoke(session, 'get_group_info',
        { group_id: groupId, no_cache: false },
        [groupId, false])
      return (this.unwrap(res) ?? {}) as Record<string, any>
    } catch (e) {
      this.log.warn('获取群信息失败', normalizeError(e).message)
      return {}
    }
  }

  // 获取群成员信息（群名片 card / 昵称 nickname / 群等级 level）
  async getGroupMemberInfo(session: Session, groupId: string, userId: string, ttlMs = 0): Promise<MemberInfo | null> {
    if (ttlMs > 0) {
      const cached = this.memberListCache.get(idOf(groupId))
      if (cached && Date.now() - cached.at < ttlMs) {
        const found = cached.data.find((m) => m.userId === idOf(userId))
        if (found) return found
      }
    }
    try {
      const res = await this.invoke(session, 'get_group_member_info',
        { group_id: groupId, user_id: userId, no_cache: false },
        [groupId, userId, false])
      const data = this.unwrap(res)
      if (!data || typeof data !== 'object') return null
      return this.normalizeMember(data)
    } catch (e) {
      this.log.warn('获取群成员信息失败', normalizeError(e).message)
      return null
    }
  }

  // 从 session 出发尽力解析用户昵称（返回非空的 QQ 号兜底）
  async resolveNickname(session: Session, groupId: string, userId: string): Promise<string> {
    const s = session as any
    const uid = String(userId || '')
    const authorName = s.author?.name || s.author?.nickname
    if (authorName && String(authorName) !== uid) return String(authorName)
    const uname = s.username
    if (uname && String(uname) !== uid) return String(uname)
    // 优先陌生人信息昵称（get_stranger_info）
    const stranger = await this.getStrangerInfo(session, uid)
    if (stranger?.nickname && stranger.nickname !== uid) return stranger.nickname
    // 群成员信息（群名片优先于昵称）
    if (groupId) {
      const info = await this.getGroupMemberInfo(session, String(groupId), uid)
      const card = info?.card || info?.nickname
      if (card && card !== uid) return String(card)
    }
    return uid
  }

  // 批量获取群成员信息（用于群员检查；使用短时缓存命中，未命中则并发拉取）
  async getMembersInfo(session: Session, groupId: string, userIds: string[], concurrency = 4): Promise<Map<string, MemberInfo>> {
    const gid = idOf(groupId)
    const result = new Map<string, MemberInfo>()
    const cached = this.memberListCache.get(gid)
    const fresh = cached && Date.now() - cached.at < 60 * 1000 ? cached.data : []
    const byId = new Map(fresh.map((m) => [m.userId, m]))
    const missing: string[] = []
    for (const uid of userIds) {
      const found = byId.get(uid)
      if (found) result.set(uid, found)
      else missing.push(uid)
    }
    if (missing.length === 0) return result
    const fetched = await mapConcurrent(missing, concurrency, async (uid) => {
      const info = await this.getGroupMemberInfo(session, gid, uid)
      return [uid, info] as [string, MemberInfo | null]
    })
    for (const [uid, info] of fetched) {
      if (info) result.set(uid, info)
    }
    return result
  }

  // 获取群资料（群聊名称/简介/头像/人数），带短时缓存，失败降级返回空值兜底
  async getGroupProfile(session: Session, groupId: string): Promise<GroupProfile> {
    const gid = String(groupId || '')
    if (!gid) return { name: '', intro: '', avatar: '', memberCount: '' }
    const hit = this.groupProfileCache.get(gid)
    if (hit && Date.now() - hit.at < 60000) return hit.data
    const info = await this.getGroupInfo(session, gid)
    const introKeys = ['group_memo', 'memo', 'introduction', 'description', 'group_slogan', 'slogan', '群简介', '简介', '群说明']
    let intro = ''
    for (const k of introKeys) {
      const v = (info as any)[k]
      if (v !== undefined && v !== null && String(v).trim()) { intro = String(v).trim(); break }
    }
    const count = (info as any).member_count ?? (info as any).memberCount
    const name = String((info as any).group_name ?? (info as any).name ?? '').trim() || gid
    const data: GroupProfile = {
      name,
      intro,
      // QQ 群默认头像链接（p.qlogo.cn gh 系列）
      avatar: `https://p.qlogo.cn/gh/${gid}/${gid}/640/`,
      memberCount: count !== undefined && count !== null ? String(count) : '',
    }
    this.groupProfileCache.set(gid, { at: Date.now(), data })
    if (this.groupProfileCache.size > 200) {
      const first = this.groupProfileCache.keys().next().value
      if (first) this.groupProfileCache.delete(first)
    }
    return data
  }

  async sendGroup(session: Session, groupId: string, content: string | any[]): Promise<string> {
    try {
      const res = await session.bot.sendMessage(groupId, content as any, groupId)
      const ids = Array.isArray(res) ? res : [res]
      return String(ids[0] ?? '')
    } catch (e) {
      this.log.warn('发送群消息失败', normalizeError(e).message)
      return ''
    }
  }

  async sendPrivate(session: Session, userId: string, content: string | any[]): Promise<string> {
    try {
      const res = await session.bot.sendPrivateMessage(userId, content as any)
      const ids = Array.isArray(res) ? res : [res]
      return String(ids[0] ?? '')
    } catch (e) {
      this.log.warn('发送私聊消息失败', normalizeError(e).message)
      return ''
    }
  }
}