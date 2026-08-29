import { Context } from 'koishi';
export type ViolationType = '涉黄' | '涉政' | '人身攻击' | '广告' | '其他';
export type ViolationLevel = '轻度' | '中度' | '重度';
export declare const VIOLATION_TYPES: ViolationType[];
export declare const VIOLATION_LEVELS: ViolationLevel[];
export type LogType = 'operation' | 'audit' | 'violation' | 'blacklist';
export declare const LOG_TYPES: LogType[];
export interface AiConfig {
    enabled: boolean;
    baseURL: string;
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
    timeout: number;
    prompts: {
        joinReview: string;
        reportReview: string;
    };
}
export interface MuteConfig {
    enabled: boolean;
    maxDuration: number;
}
export interface WelcomeConfig {
    enabled: boolean;
    text: string;
}
export interface JoinFrequencyConfig {
    enabled: boolean;
    windowMinutes: number;
    maxCount: number;
    rejectReason: string;
}
export interface JoinBlacklistConfig {
    enabled: boolean;
    rejectReason: string;
}
export interface JoinQqLevelConfig {
    enabled: boolean;
    minLevel: number;
    rejectReason: string;
}
export interface JoinKeywordConfig {
    enabled: boolean;
    passKeywords: string[];
    rejectKeywords: string[];
    rejectReason: string;
}
export interface JoinManualConfig {
    enabled: boolean;
    timeoutMinutes: number;
    rejectReason: string;
}
export interface JoinLlmConfig {
    enabled: boolean;
    rejectReason: string;
}
export interface JoinDefaultConfig {
    action: 'approve' | 'reject';
    rejectReason: string;
}
export interface JoinReviewConfig {
    enabled: boolean;
    frequency: JoinFrequencyConfig;
    blacklist: JoinBlacklistConfig;
    qqLevel: JoinQqLevelConfig;
    keyword: JoinKeywordConfig;
    manual: JoinManualConfig;
    llm: JoinLlmConfig;
    default: JoinDefaultConfig;
    autoNotice: NoticeConfig;
}
export interface BannedWordConfig {
    enabled: boolean;
    words: string[];
    banOnTrigger: boolean;
    kickOnTrigger: boolean;
    recallOnTrigger: boolean;
    banDuration: number;
    banNotice: NoticeConfig;
    kickNotice: NoticeConfig;
    recallNotice: NoticeConfig;
}
export interface LevelPunishment {
    level: ViolationLevel;
    muteDuration: number;
    kick: boolean;
    recall: boolean;
}
export interface ReportConfig {
    enabled: boolean;
    levels: LevelPunishment[];
    frequency: {
        enabled: boolean;
        windowMinutes: number;
        maxCount: number;
    };
}
export interface AutoBlacklistConfig {
    enabled: boolean;
    onSelfLeave: boolean;
    onKicked: boolean;
    delayMinutes: number;
    notice: NoticeConfig;
}
export interface RequestForwardConfig {
    enabled: boolean;
    mode: 'group' | 'private';
    targetId: string;
    text: string;
}
export interface NoticeConfig {
    enabled: boolean;
    mode: 'group' | 'private';
    targetId: string;
    text: string;
}
export type OneBotFramework = 'auto' | 'napcat' | 'llbot';
export interface Config {
    enableGroupManagement: boolean;
    superUsers: string[];
    onebotFramework: OneBotFramework;
    applyGlobalBlacklist: boolean;
    applyGlobalWhitelist: boolean;
    mute: MuteConfig;
    welcome: WelcomeConfig;
    farewell: WelcomeConfig;
    joinReview: JoinReviewConfig;
    bannedWords: BannedWordConfig;
    report: ReportConfig;
    autoBlacklist: AutoBlacklistConfig;
    requestForward: RequestForwardConfig;
    essence: {
        enabled: boolean;
    };
    title: {
        enabled: boolean;
    };
    ai: AiConfig;
}
export interface PermissionGroup {
    id: number;
    name: string;
    priority: number;
    isDefault: boolean;
    members: string[];
    groupIds: string[];
    perms: Record<string, boolean>;
}
export interface GroupConfigRecord {
    id: number;
    groupId: string;
    config: Partial<Config>;
}
export interface GlobalConfigRecord {
    id: number;
    config: Partial<Config>;
}
export interface BlacklistEntry {
    id: number;
    userId: string;
    groupId: string;
    source: 'manual' | 'auto' | 'review';
    createdAt: Date;
}
export interface WhitelistEntry {
    id: number;
    userId: string;
    groupId: string;
    exemptReport: boolean;
    exemptJoin: boolean;
    exemptBannedWord: boolean;
    createdAt: Date;
}
export interface LogEntry {
    id: number;
    type: LogType;
    action: string;
    operatorId: string;
    operatorName?: string;
    targetId: string;
    groupId: string;
    detail: string;
    result: string;
    createdAt: Date;
}
export interface JoinRequestRecord {
    id: number;
    flag: string;
    subType: string;
    groupId: string;
    userId: string;
    nickname: string;
    comment: string;
    status: 'pending' | 'approved' | 'rejected' | 'timeout' | 'llm' | 'manual' | 'default';
    reviewers: string[];
    notified: string[];
    createdAt: Date;
    expireAt: Date;
}
declare module 'koishi' {
    interface Tables {
        gm_permission_group: PermissionGroup;
        gm_group_config: GroupConfigRecord;
        gm_global_config: GlobalConfigRecord;
        gm_blacklist: BlacklistEntry;
        gm_whitelist: WhitelistEntry;
        gm_log: LogEntry;
        gm_join_request: JoinRequestRecord;
    }
}
export interface ReviewVerdict {
    approve: boolean;
    reason: string;
}
export interface ReportVerdict {
    violation: boolean;
    type: ViolationType;
    level: ViolationLevel;
    reason: string;
    muteDuration?: number;
}
export interface OneBotApi {
    setGroupBan(groupId: string, userId: string, duration?: number): Promise<unknown>;
    setGroupWholeBan(groupId: string, enable?: boolean): Promise<unknown>;
    setGroupKick(groupId: string, userId: string, rejectAddRequest?: boolean): Promise<unknown>;
    setGroupLeave(groupId: string, isDismiss?: boolean): Promise<unknown>;
    setGroupAddRequest(flag: string, subType: string, approve: boolean, reason?: string): Promise<unknown>;
    setGroupCard(groupId: string, userId: string, card?: string): Promise<unknown>;
    setGroupSpecialTitle(groupId: string, userId: string, specialTitle?: string, duration?: number): Promise<unknown>;
    setEssenceMsg(messageId: string): Promise<unknown>;
    deleteEssenceMsg(messageId: string): Promise<unknown>;
    getEssenceMsgList(groupId: string): Promise<unknown[]>;
    deleteMsg(messageId: string): Promise<unknown>;
    setFriendAddRequest(flag: string, approve: boolean, remark?: string): Promise<unknown>;
    getStrangerInfo(userId: string, noCache?: boolean): Promise<{
        level?: number;
    }>;
    getGroupMemberList(groupId: string): Promise<Array<{
        user_id?: number;
        userId?: string;
        role?: string;
        card?: string;
    }>>;
}
export interface Services {
    ctx: Context;
    config: Config;
    log: any;
    store: any;
    ai: any;
    permission: any;
    settings: any;
    onebot: any;
    notice: any;
}
export declare function isGroupMessage(target: string | undefined): boolean;
