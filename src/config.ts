import { Schema } from 'koishi'
import { DEFAULT_CONFIG } from './constants'

export const name = 'quanmian-qq-guanqun'

// 插件 Schema 仅暴露最基础的两项，其余全部在控制台「全局设置」页面中配置。
// 注意：原先还有一个 onebotFramework（自动/NapCat/LLBot）下拉选项，
// 但它从未参与任何分支判断（所有接口都按标准 OneBot v11 的 snake_case action 调用，
// 已同时兼容 NapCat / LLBot / go-cqhttp），属于纯误导项，故整体移除。
export interface PluginConfig {
  enableGroupManagement: boolean
  superUsers: string[]
}

export const Config: Schema<PluginConfig> = Schema.object({
  enableGroupManagement: Schema.boolean()
    .default(DEFAULT_CONFIG.enableGroupManagement)
    .description('群管功能总开关'),
  superUsers: Schema.array(String)
    .default(DEFAULT_CONFIG.superUsers)
    .description('超级管理员 QQ 列表（拥有全部权限）'),
}).description('全方面QQ群管（其余功能请进入控制台左侧「全局设置」页面配置）')
