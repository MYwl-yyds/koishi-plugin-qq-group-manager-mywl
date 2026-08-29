import { Schema } from 'koishi';
export declare const name = "quanmian-qq-guanqun";
export interface PluginConfig {
    enableGroupManagement: boolean;
    superUsers: string[];
    onebotFramework: 'auto' | 'napcat' | 'llbot';
}
export declare const Config: Schema<PluginConfig>;
