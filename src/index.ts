import { Context } from 'koishi'
import type { Config } from './types'
import type { PluginConfig } from './config'
import { DEFAULT_CONFIG } from './constants'
import { mergeDeep, logger } from './utils'
import { initModels } from './services/store'
import { createServices } from './services'
import { registerCommands } from './commands'
import { registerListeners } from './listeners'
import { applyWebUI } from './webui'

export { Config, name } from './config'
export type { PluginConfig } from './config'
export { DEFAULT_CONFIG } from './constants'

export const using = ['database'] as const

export function apply(ctx: Context, config: PluginConfig) {
  const log = logger(ctx)

  // 用内置默认值 + 极简 Schema 配置，得到完整生效配置（其余均在 WebUI 中修改）
  const fullConfig: Config = mergeDeep(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), config as any)

  // 初始化数据库表结构与服务
  initModels(ctx)
  const svc = createServices(ctx, fullConfig)

  // 群管功能总开关
  if (fullConfig.enableGroupManagement !== false) {
    registerCommands(ctx, svc)
    registerListeners(ctx, svc)
  }

  // WebUI（用于配置与看板），仅在安装了 console 插件时启用
  ctx.using(['console'], (cctx) => {
    applyWebUI(cctx, svc)
  })

  // 定时清理过期的入群审核申请（每 5 分钟）
  ctx.setInterval(async () => {
    try {
      await svc.store.joinRequestCleanup()
    } catch (e) {
      log.warn('清理过期入群申请失败', e)
    }
  }, 5 * 60 * 1000)

  log.info('全方面QQ群管已启动')
}