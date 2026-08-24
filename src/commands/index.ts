import { Context } from 'koishi'
import { Services } from '../types'
import * as moderation from './moderation'
import * as report from './report'
import * as essenceTitle from './essence-title'
import * as blacklist from './blacklist'
import * as whitelist from './whitelist'
import * as bannedword from './bannedword'
import * as permission from './permission'

export function registerCommands(ctx: Context, svc: Services) {
  moderation.apply(ctx, svc)
  report.apply(ctx, svc)
  essenceTitle.apply(ctx, svc)
  blacklist.apply(ctx, svc)
  whitelist.apply(ctx, svc)
  bannedword.apply(ctx, svc)
  permission.apply(ctx, svc)
}