import { Schema } from 'koishi'
import { DEFAULT_CONFIG } from './constants'

export const name = 'quanmian-qq-guanqun'

// 插件 Schema 仅暴露最基础的三项，其余全部在控制台「全局设置」页面中配置
export interface PluginConfig {
  enableGroupManagement: boolean
  superUsers: string[]
  onebotFramework: 'auto' | 'napcat' | 'llbot'
}

export const Config: Schema<PluginConfig> = Schema.object({
  enableGroupManagement: Schema.boolean()
    .default(DEFAULT_CONFIG.enableGroupManagement)
    .description('群管功能总开关'),
  superUsers: Schema.array(String)
    .default(DEFAULT_CONFIG.superUsers)
    .description('超级管理员 QQ 列表（拥有全部权限）'),
  onebotFramework: Schema.union(['auto', 'napcat', 'llbot'] as const)
    .default(DEFAULT_CONFIG.onebotFramework)
    .description('OneBot 框架适配（自动检测 / NapCat / LLBot），用于适配不同框架的 OneBot 内置接口'),
}).description('全方面QQ群管（其余功能请进入控制台左侧「全局设置」页面配置）')