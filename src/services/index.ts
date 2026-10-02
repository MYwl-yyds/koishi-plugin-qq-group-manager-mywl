import { Context } from 'koishi'
import { Config, Services } from '../types'
import { Store } from './store'
import { LogService } from './log'
import { OneBotService } from './onebot'
import { AiService } from './ai'
import { SettingsService } from './settings'
import { PermissionService } from './permission'
import { NoticeService } from './notice'
import { MemberCheckService } from './member-check'
import { ImageGuardService } from './image-guard'
import { ExportService } from './export'

export function createServices(ctx: Context, config: Config): Services {
  const store = new Store(ctx)
  const onebot = new OneBotService(ctx, config.onebotFramework ?? 'auto')
  const settings = new SettingsService(ctx, store, config)
  const services: Services = {
    ctx,
    config,
    log: new LogService(ctx, store),
    store,
    ai: new AiService(ctx),
    onebot,
    notice: new NoticeService(ctx, onebot),
    settings,
    permission: null as any,
    memberCheck: null as any,
    imageGuard: null as any,
    exporter: null as any,
  }
  services.permission = new PermissionService(ctx, store, async () => (await services.settings.getGlobal()).superUsers)
  services.memberCheck = new MemberCheckService(ctx, services)
  services.imageGuard = new ImageGuardService(ctx, store)
  // 让图片检测在「消息段只带 file 文件名」时也能通过 get_image 取到真实地址
  services.imageGuard.attachOnebot(onebot)
  services.exporter = new ExportService(ctx, store, settings, () => services.imageGuard?.invalidate?.())
  return services
}