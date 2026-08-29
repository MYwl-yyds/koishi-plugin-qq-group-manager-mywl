import { Context, Session } from 'koishi';
import { Store } from './store';
import { PermissionGroup } from '../types';
export declare const ALL_COMMANDS: string[];
export declare function defaultPerms(): Record<string, boolean>;
export declare class PermissionService {
    private store;
    private superUsers;
    private log;
    private authorityLevel;
    constructor(ctx: Context, store: Store, superUsers: () => string[] | Promise<string[]>);
    listGroups(): Promise<PermissionGroup[]>;
    getGroup(name: string): Promise<PermissionGroup | undefined>;
    createGroup(name: string, isDefault?: boolean): Promise<PermissionGroup>;
    removeGroup(name: string): Promise<void>;
    private clearDefaultExcept;
    setDefault(name: string): Promise<void>;
    setPriority(name: string, priority: number): Promise<void>;
    addMember(groupName: string, userId: string): Promise<void>;
    removeMember(groupName: string, userId: string): Promise<void>;
    setGroups(groupName: string, groupIds: string[]): Promise<void>;
    clearGroups(groupName: string): Promise<void>;
    setPerm(groupName: string, command: string, enabled: boolean): Promise<void>;
    importFromGroup(groupName: string, members: Array<{
        userId?: string;
        user_id?: number | string;
        role?: string;
        card?: string;
    }>, role?: 'admin' | 'member' | 'owner'): Promise<number>;
    isSuperAdmin(session: Session): Promise<boolean>;
    check(session: Session, command: string): Promise<boolean>;
}
