import { Context } from 'koishi'
import { Store } from './store'
import { LogType } from '../types'

export interface LogPayload {
  action: string
  operatorId?: string
  operatorName?: string
  targetId?: string
  groupId?: string
  detail?: string
  result?: string
}

// 日志服务：统一记录操作日志、审核日志、违规日志、黑名单变更日志
export class LogService {
  private store: Store
  private logger: any

  constructor(ctx: Context, store: Store) {
    this.store = store
    this.logger = ctx.logger('log')
  }

  private async write(type: LogType, payload: LogPayload): Promise<void> {
    try {
      await this.store.logAdd({
        type,
        action: payload.action,
        operatorId: payload.operatorId ?? '',
        operatorName: payload.operatorName ?? '',
        targetId: payload.targetId ?? '',
        groupId: payload.groupId ?? '',
        detail: payload.detail ?? '',
        result: payload.result ?? '',
      })
    } catch (e) {
      this.logger.warn('写入日志失败', e)
    }
  }

  operation(action: string, payload: Partial<LogPayload> = {}): Promise<void> {
    return this.write('operation', { ...payload, action })
  }

  audit(action: string, payload: Partial<LogPayload> = {}): Promise<void> {
    return this.write('audit', { ...payload, action })
  }

  violation(action: string, payload: Partial<LogPayload> = {}): Promise<void> {
    return this.write('violation', { ...payload, action })
  }

  blacklist(action: string, payload: Partial<LogPayload> = {}): Promise<void> {
    return this.write('blacklist', { ...payload, action })
  }

  async query(type?: LogType, limit = 200) {
    return this.store.logQuery(type, limit)
  }
}