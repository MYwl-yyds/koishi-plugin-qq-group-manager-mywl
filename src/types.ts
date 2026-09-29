import { Context } from 'koishi'

// ---------- 违规类型与程度 ----------
export type ViolationType = '涉黄' | '涉政' | '人身攻击' | '广告' | '其他'
export type ViolationLevel = '轻度' | '中度' | '重度'

export const VIOLATION_TYPES: ViolationType[] = ['涉黄', '涉政', '人身攻击', '广告', '其他']
export const VIOLATION_LEVELS: ViolationLevel[] = ['轻度', '中度', '重度']

// ---------- 日志类型 ----------
export type LogType = 'operation' | 'audit' | 'violation' | 'blacklist'
export const LOG_TYPES: LogType[] = ['operation', 'audit', 'violation', 'blacklist']

// ---------- 配置结构 ----------
export interface AiConfig {
  enabled: boolean
  baseURL: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  timeout: number
  prompts: {
    joinReview: string
    reportReview: string
  }
}

export interface MuteConfig {
  enabled: boolean
  maxDuration: number
}

export interface WelcomeConfig {
  enabled: boolean
  text: string
}

export interface JoinFrequencyConfig {
  enabled: boolean
  windowMinutes: number
  maxCount: number
  // 命中频率限制时的拒绝理由
  rejectReason: string
}

export interface JoinBlacklistConfig {
  enabled: boolean
  // 命中黑名单时的拒绝理由
  rejectReason: string
}

export interface JoinQqLevelConfig {
  enabled: boolean
  minLevel: number
  // 等级不足时的拒绝理由
  rejectReason: string
}

export interface JoinKeywordConfig {
  enabled: boolean
  passKeywords: string[]
  rejectKeywords: string[]
  // 命中拒绝关键词时的拒绝理由
  rejectReason: string
}

export interface JoinManualConfig {
  enabled: boolean
  timeoutMinutes: number
  // 审核员拒绝且未填理由时的默认拒绝理由
  rejectReason: string
}

export interface JoinLlmConfig {
  enabled: boolean
  // LLM 拒绝时的理由优先使用此值，为空则用 AI 生成的理由
  rejectReason: string
}

// 默认操作：所有审核判定失效或超时后执行（同意或拒绝）
export interface JoinDefaultConfig {
  action: 'approve' | 'reject'
  rejectReason: string
}

export interface JoinReviewConfig {
  enabled: boolean
  frequency: JoinFrequencyConfig
  blacklist: JoinBlacklistConfig
  qqLevel: JoinQqLevelConfig
  keyword: JoinKeywordConfig
  manual: JoinManualConfig
  llm: JoinLlmConfig
  default: JoinDefaultConfig
  autoNotice: NoticeConfig
}

// 违禁词内的「禁发链接」子项
export interface LinkGuardConfig {
  enabled: boolean
  // 命中链接后的处理（与违禁词一致：禁言 / 踢出 / 撤回）
  banOnTrigger: boolean
  kickOnTrigger: boolean
  recallOnTrigger: boolean
  banDuration: number
  // 白名单：支持完整链接、域名、泛域名（*.example.com）
  whitelist: string[]
  banNotice: NoticeConfig
  kickNotice: NoticeConfig
  recallNotice: NoticeConfig
}

export interface BannedWordConfig {
  enabled: boolean
  words: string[]
  banOnTrigger: boolean
  kickOnTrigger: boolean
  recallOnTrigger: boolean
  banDuration: number
  link: LinkGuardConfig
  image: ImageGuardConfig
  banNotice: NoticeConfig
  kickNotice: NoticeConfig
  recallNotice: NoticeConfig
}

// ---------- 禁发指定图片 ----------
// 样本图（违规图库）条目：保存感知哈希与原始来源，供 pHash 比对
export interface BannedImageEntry {
  id: number
  // 感知哈希（16 位十六进制）
  hash: string
  // 归属群号：空串 = 全局样本（对所有群生效），非空 = 该群专属样本
  groupId: string
  // 来源：url / upload / command
  source: string
  // 原始地址或文件名（便于管理员辨认）
  origin: string
  // 备注
  label: string
  // 图片尺寸，便于辨认
  width: number
  height: number
  format: string
  createdAt: Date
}

// 违禁词内的「禁发指定图片」子项
export interface ImageGuardConfig {
  enabled: boolean
  // 汉明距离阈值：越小越严格（0 只匹配几乎完全相同的图）
  threshold: number
  // 触发处理（与违禁词一致：禁言 / 踢出 / 撤回）
  banOnTrigger: boolean
  kickOnTrigger: boolean
  recallOnTrigger: boolean
  banDuration: number
  banNotice: NoticeConfig
  kickNotice: NoticeConfig
  recallNotice: NoticeConfig
}

// ---------- 群员检查 ----------
// 触发操作：禁言 / 踢出 / 仅记录
export type MemberCheckAction = 'none' | 'mute' | 'kick'

export interface MemberCheckRule {
  enabled: boolean
  action: MemberCheckAction
  // action 为 mute 时生效（分钟）
  muteDuration: number
  // 命中后是否撤回该成员最近一条消息（尽力而为，失败不影响主流程）
  recall: boolean
  // 是否同时私聊/群内提示（使用 notice）
  notice: NoticeConfig
}

// 检测 QQ 账号等级（get_stranger_info.level，1~256）
export interface MemberCheckQqLevelConfig extends MemberCheckRule {
  minLevel: number
  // 无法获取等级时的处理：跳过（安全）或视为命中
  whenUnknown: 'skip' | 'trigger'
}

// 检测群名片（包含 / 完全等于）
export interface MemberCheckCardConfig extends MemberCheckRule {
  matchMode: 'contains' | 'equals'
  // 支持正则：以 / 包裹时按正则解析
  patterns: string[]
  caseSensitive: boolean
  // 排除群管理（群主/管理员）与白名单成员
  excludeAdmins: boolean
  excludeWhitelist: boolean
}

// 检测群等级（get_group_member_info.level，即活跃等级）
export interface MemberCheckGroupLevelConfig extends MemberCheckRule {
  minLevel: number
  whenUnknown: 'skip' | 'trigger'
}

export interface MemberCheckConfig {
  enabled: boolean
  // 扫描间隔（分钟）
  intervalMinutes: number
  // 单个群的成员检查超时（秒），超时跳过本群
  timeoutSeconds: number
  // 每批并发请求数，避免触发协议端风控
  batchSize: number
  // 对同一成员的重复处理间隔（小时），避免反复禁言/踢出
  cooldownHours: number
  // 只检查最近 N 天内活跃（说过话）的成员，0 表示全部检查
  activeWithinDays: number
  qqLevel: MemberCheckQqLevelConfig
  card: MemberCheckCardConfig
  groupLevel: MemberCheckGroupLevelConfig
}

export interface LevelPunishment {
  level: ViolationLevel
  muteDuration: number
  kick: boolean
  recall: boolean
}

export interface ReportConfig {
  enabled: boolean
  levels: LevelPunishment[]
  frequency: {
    enabled: boolean
    windowMinutes: number
    maxCount: number
  }
}

export interface AutoBlacklistConfig {
  enabled: boolean
  onSelfLeave: boolean
  onKicked: boolean
  delayMinutes: number
  notice: NoticeConfig
}

export interface RequestForwardConfig {
  enabled: boolean
  mode: 'group' | 'private'
  targetId: string
  text: string
}

// 通知配置（支持变量模板）
export interface NoticeConfig {
  enabled: boolean
  mode: 'group' | 'private'
  targetId: string
  text: string
}

export type OneBotFramework = 'auto' | 'napcat' | 'llbot'

export interface Config {
  enableGroupManagement: boolean
  superUsers: string[]
  onebotFramework: OneBotFramework
  applyGlobalBlacklist: boolean
  applyGlobalWhitelist: boolean
  mute: MuteConfig
  welcome: WelcomeConfig
  farewell: WelcomeConfig
  joinReview: JoinReviewConfig
  bannedWords: BannedWordConfig
  memberCheck: MemberCheckConfig
  report: ReportConfig
  autoBlacklist: AutoBlacklistConfig
  requestForward: RequestForwardConfig
  essence: { enabled: boolean }
  title: { enabled: boolean }
  ai: AiConfig
}

// ---------- 数据库表结构 ----------
export interface PermissionGroup {
  id: number
  name: string
  priority: number
  isDefault: boolean
  members: string[]
  groupIds: string[]
  perms: Record<string, boolean>
}

export interface GroupConfigRecord {
  id: number
  groupId: string
  config: Partial<Config>
}

export interface GlobalConfigRecord {
  id: number
  config: Partial<Config>
}

export interface BlacklistEntry {
  id: number
  userId: string
  groupId: string
  source: 'manual' | 'auto' | 'review'
  createdAt: Date
}

export interface WhitelistEntry {
  id: number
  userId: string
  groupId: string
  exemptReport: boolean
  exemptJoin: boolean
  exemptBannedWord: boolean
  createdAt: Date
}

export interface LogEntry {
  id: number
  type: LogType
  action: string
  operatorId: string
  operatorName?: string
  targetId: string
  groupId: string
  detail: string
  result: string
  createdAt: Date
}

// 群员检查状态：记录成员的最近活跃时间与最近一次处理时间（用于冷却去重）
export interface MemberCheckState {
  id: number
  groupId: string
  userId: string
  // 最近一次发言时间
  activeAt: Date
  // 最近一次被群员检查处理的时间
  checkedAt: Date
  // 最近一次处理结果（踢出/禁言/无）
  lastAction: string
}

export interface JoinRequestRecord {
  id: number
  flag: string
  subType: string
  groupId: string
  userId: string
  nickname: string
  comment: string
  status: 'pending' | 'approved' | 'rejected' | 'timeout' | 'llm' | 'manual' | 'default'
  reviewers: string[]
  notified: string[]
  createdAt: Date
  expireAt: Date
}

declare module 'koishi' {
  interface Tables {
    gm_permission_group: PermissionGroup
    gm_group_config: GroupConfigRecord
    gm_global_config: GlobalConfigRecord
    gm_blacklist: BlacklistEntry
    gm_whitelist: WhitelistEntry
    gm_log: LogEntry
    gm_join_request: JoinRequestRecord
    gm_member_state: MemberCheckState
    gm_banned_image: BannedImageEntry
  }
}

// ---------- 审核结果 ----------
export interface ReviewVerdict {
  approve: boolean
  reason: string
}

export interface ReportVerdict {
  violation: boolean
  type: ViolationType
  level: ViolationLevel
  reason: string
  // LLM 自定义禁言时长（分钟），未提供时为 undefined
  muteDuration?: number
}

// ---------- OneBot 内部 API（最小化类型） ----------
export interface OneBotMemberInfo {
  user_id?: number | string
  userId?: string
  nickname?: string
  card?: string
  role?: string
  // 群等级（活跃等级），LLBot / NapCat 的 get_group_member_info 会返回
  level?: number | string
  title?: string
  join_time?: number
  last_sent_time?: number
}

export interface OneBotApi {
  setGroupBan(groupId: string, userId: string, duration?: number): Promise<unknown>
  setGroupWholeBan(groupId: string, enable?: boolean): Promise<unknown>
  setGroupKick(groupId: string, userId: string, rejectAddRequest?: boolean): Promise<unknown>
  setGroupLeave(groupId: string, isDismiss?: boolean): Promise<unknown>
  setGroupAddRequest(flag: string, subType: string, approve: boolean, reason?: string): Promise<unknown>
  setGroupCard(groupId: string, userId: string, card?: string): Promise<unknown>
  setGroupSpecialTitle(groupId: string, userId: string, specialTitle?: string, duration?: number): Promise<unknown>
  setEssenceMsg(messageId: string): Promise<unknown>
  deleteEssenceMsg(messageId: string): Promise<unknown>
  getEssenceMsgList(groupId: string): Promise<unknown[]>
  deleteMsg(messageId: string): Promise<unknown>
  setFriendAddRequest(flag: string, approve: boolean, remark?: string): Promise<unknown>
  getStrangerInfo(userId: string, noCache?: boolean): Promise<{ level?: number }>
  getGroupMemberList(groupId: string): Promise<Array<{ user_id?: number, userId?: string, role?: string, card?: string }>>
}

// ---------- 服务聚合 ----------
export interface Services {
  ctx: Context
  config: Config
  log: any
  store: any
  ai: any
  permission: any
  settings: any
  onebot: any
  notice: any
  memberCheck: any
  imageGuard: any
  exporter: any
}

export function isGroupMessage(target: string | undefined): boolean {
  return !!target && /^\d{5,}$/.test(target)
}