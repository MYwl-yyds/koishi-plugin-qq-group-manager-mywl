import { Context, Session } from 'koishi';
import { NoticeConfig } from '../types';
export declare function renderNotice(template: string, vars: Record<string, string>): any[];
export declare class NoticeService {
    private ctx;
    private onebot;
    constructor(ctx: Context, onebot: any);
    send(session: Session, notice: NoticeConfig, vars: Record<string, string>, fallbackGroup?: string): Promise<void>;
}
