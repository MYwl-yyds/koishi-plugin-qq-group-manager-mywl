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

export interface BannedWordConfig {
  enabled: boolean
  words: string[]
  banOnTrigger: boolean
  kickOnTrigger: boolean
  recallOnTrigger: boolean
  banDuration: number
  banNotice: NoticeConfig
  kickNotice: NoticeConfig
  recallNotice: NoticeConfig
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
}

export function isGroupMessage(target: string | undefined): boolean {
  return !!target && /^\d{5,}$/.test(target)
}