import { Context } from 'koishi'
import { Config, Services } from '../types'
import { Store } from './store'
import { LogService } from './log'
import { OneBotService } from './onebot'
import { AiService } from './ai'
import { SettingsService } from './settings'
import { PermissionService } from './permission'
import { NoticeService } from './notice'

export function createServices(ctx: Context, config: Config): Services {
  const store = new Store(ctx)
  const onebot = new OneBotService(ctx, config.onebotFramework ?? 'auto')
  const services: Services = {
    ctx,
    config,
    log: new LogService(ctx, store),
    store,
    ai: new AiService(ctx),
    onebot,
    notice: new NoticeService(ctx, onebot),
    settings: new SettingsService(ctx, store, config),
    permission: null as any,
  }
  services.permission = new PermissionService(ctx, store, async () => (await services.settings.getGlobal()).superUsers)
  return services
}