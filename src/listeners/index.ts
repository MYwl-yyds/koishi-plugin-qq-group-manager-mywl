import { Context } from 'koishi'
import { Services } from '../types'
import * as joinRequest from './join-request'
import * as memberLeave from './member-leave'
import * as bannedWord from './banned-word'
import * as welcomeFarewell from './welcome-farewell'
import * as requestForward from './request-forward'

export function registerListeners(ctx: Context, svc: Services) {
  joinRequest.apply(ctx, svc)
  memberLeave.apply(ctx, svc)
  bannedWord.apply(ctx, svc)
  welcomeFarewell.apply(ctx, svc)
  requestForward.apply(ctx, svc)
}