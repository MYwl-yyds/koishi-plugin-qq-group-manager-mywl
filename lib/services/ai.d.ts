import { Context } from 'koishi';
import { AiConfig, ReviewVerdict, ReportVerdict } from '../types';
export declare function extractJson<T = any>(text: string): T | null;
export declare class AiService {
    private ctx;
    private log;
    constructor(ctx: Context);
    private endpoint;
    chat(config: AiConfig, system: string, user: string): Promise<string>;
    reviewJoin(config: AiConfig, content: string): Promise<ReviewVerdict | null>;
    reviewReport(config: AiConfig, content: string): Promise<ReportVerdict>;
}
