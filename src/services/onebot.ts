import { Context, Session } from 'koishi'
import { OneBotFramework } from '../types'
import { idOf } from '../utils'

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

// 统一封装 OneBot v11 内置接口，所有调用具备异常捕获与降级返回。
// NapCat / LLBot / go-cqhttp 均为标准 OneBot v11 协议，统一按 snake_case action + 对象参数调用。
export class OneBotService {
  private ctx: Context
  private log: any
  readonly framework: OneBotFramework
  // 群资料短时缓存，避免违禁词等高频通知重复调用 get_group_info
  private groupProfileCache = new Map<string, { at: number, data: GroupProfile }>()

  constructor(ctx: Context, framework: OneBotFramework = 'auto') {
    this.ctx = ctx
    this.log = ctx.logger('onebot')
    this.framework = framework
  }

  // 获取 Koishi OneBot 适配器的 internal 对象（提供底层 _get / request 原始接口）
  private internal(session: Session): any {
    const s = session as any
    return s.bot?.internal ?? s.bot
  }

  // 统一调用 OneBot v11 内置接口。
  // NapCat / LLBot / go-cqhttp 均为标准 OneBot v11 协议，统一使用 snake_case action + 对象参数。
  private async invoke(
    session: Session,
    action: string,
    params: Record<string, any>,
    camelArgs: any[],
  ): Promise<any> {
    const s = session as any

    // 1) 会话上直接挂载的原生 onebot 函数桥
    if (typeof s.onebot === 'function') {
      return await s.onebot(action, params)
    }
    if (typeof s.bot?.onebot === 'function') {
      return await s.bot.onebot(action, params)
    }

    const internal = this.internal(session)
    if (!internal) {
      throw new Error('当前协议端不是 OneBot v11，无法调用群管理接口')
    }

    // 2) 底层原始调用：_get(action, params) / request(action, params)
    if (typeof internal._get === 'function') {
      return await internal._get(action, params)
    }
    if (typeof internal.request === 'function') {
      return await internal.request(action, params)
    }

    // 3) 兼容旧版适配器：camelCase 方法（显式绑定 this，避免方法被取出后丢失 this 导致 _get 读取失败）
    const fn = internal[toCamel(action)]
    if (typeof fn === 'function') {
      return await fn.call(internal, ...camelArgs)
    }

    throw new Error(`当前协议端不支持 OneBot 接口 ${action}`)
  }

  // 禁言（minutes 为分钟）
  async mute(session: Session, userId: string, minutes: number): Promise<void> {
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
  async getStrangerInfo(session: Session, userId: string): Promise<{ nickname?: string, level?: number } | null> {
    try {
      const res = await this.invoke(session, 'get_stranger_info',
        { user_id: userId, no_cache: false },
        [userId, false])
      const data = res?.data ?? res ?? {}
      return {
        nickname: data.nickname ? String(data.nickname) : '',
        level: Number(data.level) || 0,
      }
    } catch (e) {
      this.log.warn('获取陌生人信息失败（降级跳过）', normalizeError(e).message)
      return null
    }
  }

  async getGroupMemberList(session: Session, groupId: string): Promise<Array<{ user_id?: number | string, userId?: string, role?: string, card?: string }>> {
    try {
      const res = await this.invoke(session, 'get_group_member_list',
        { group_id: groupId },
        [groupId])
      const list = res?.data ?? res ?? []
      return Array.isArray(list) ? list : []
    } catch (e) {
      this.log.warn('获取群成员列表失败', normalizeError(e).message)
      return []
    }
  }

  // 获取群信息（OneBot get_group_info）
  async getGroupInfo(session: Session, groupId: string): Promise<Record<string, any>> {
    try {
      const res = await this.invoke(session, 'get_group_info',
        { group_id: groupId },
        [groupId])
      return (res?.data ?? res ?? {}) as Record<string, any>
    } catch (e) {
      this.log.warn('获取群信息失败', normalizeError(e).message)
      return {}
    }
  }

  // 获取群成员信息（群名片 card / 昵称 nickname）
  async getGroupMemberInfo(session: Session, groupId: string, userId: string): Promise<{ card?: string, nickname?: string } | null> {
    try {
      const res = await this.invoke(session, 'get_group_member_info',
        { group_id: groupId, user_id: userId, no_cache: false },
        [groupId, userId, false])
      const data = res?.data ?? res ?? {}
      return {
        card: data.card ? String(data.card) : '',
        nickname: data.nickname ? String(data.nickname) : '',
      }
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