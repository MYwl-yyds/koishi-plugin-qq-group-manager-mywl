import { Context, Session } from 'koishi';
import { OneBotFramework } from '../types';
export interface GroupProfile {
    name: string;
    intro: string;
    avatar: string;
    memberCount: string;
}
export declare class OneBotService {
    private ctx;
    private log;
    readonly framework: OneBotFramework;
    private groupProfileCache;
    constructor(ctx: Context, framework?: OneBotFramework);
    private internal;
    private invoke;
    mute(session: Session, userId: string, minutes: number): Promise<void>;
    unmute(session: Session, userId: string): Promise<void>;
    setWholeBan(session: Session, enable: boolean): Promise<void>;
    kick(session: Session, userId: string): Promise<void>;
    leaveGroup(session: Session): Promise<void>;
    handleJoinRequest(session: Session, flag: string, subType: string, approve: boolean, reason?: string): Promise<void>;
    handleFriendRequest(session: Session, flag: string, approve: boolean, remark?: string): Promise<void>;
    setEssence(session: Session, messageId: string): Promise<void>;
    deleteEssence(session: Session, messageId: string): Promise<void>;
    setTitle(session: Session, userId: string, title: string): Promise<void>;
    recall(session: Session, messageId: string): Promise<void>;
    getMsg(session: Session, messageId: string): Promise<{
        userId?: string;
        nickname?: string;
        content?: string;
    } | null>;
    getStrangerInfo(session: Session, userId: string): Promise<{
        nickname?: string;
        level?: number;
    } | null>;
    getGroupMemberList(session: Session, groupId: string): Promise<Array<{
        user_id?: number | string;
        userId?: string;
        role?: string;
        card?: string;
    }>>;
    getGroupInfo(session: Session, groupId: string): Promise<Record<string, any>>;
    getGroupMemberInfo(session: Session, groupId: string, userId: string): Promise<{
        card?: string;
        nickname?: string;
    } | null>;
    resolveNickname(session: Session, groupId: string, userId: string): Promise<string>;
    getGroupProfile(session: Session, groupId: string): Promise<GroupProfile>;
    sendGroup(session: Session, groupId: string, content: string | any[]): Promise<string>;
    sendPrivate(session: Session, userId: string, content: string | any[]): Promise<string>;
}
