import { Context } from 'koishi';
import { Store } from './store';
import { LogType } from '../types';
export interface LogPayload {
    action: string;
    operatorId?: string;
    operatorName?: string;
    targetId?: string;
    groupId?: string;
    detail?: string;
    result?: string;
}
export declare class LogService {
    private store;
    private logger;
    constructor(ctx: Context, store: Store);
    private write;
    operation(action: string, payload?: Partial<LogPayload>): Promise<void>;
    audit(action: string, payload?: Partial<LogPayload>): Promise<void>;
    violation(action: string, payload?: Partial<LogPayload>): Promise<void>;
    blacklist(action: string, payload?: Partial<LogPayload>): Promise<void>;
    query(type?: LogType, limit?: number): Promise<import("../types").LogEntry[]>;
}
