"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LogService = void 0;
// 日志服务：统一记录操作日志、审核日志、违规日志、黑名单变更日志
class LogService {
    constructor(ctx, store) {
        this.store = store;
        this.logger = ctx.logger('log');
    }
    async write(type, payload) {
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
            });
        }
        catch (e) {
            this.logger.warn('写入日志失败', e);
        }
    }
    operation(action, payload = {}) {
        return this.write('operation', { ...payload, action });
    }
    audit(action, payload = {}) {
        return this.write('audit', { ...payload, action });
    }
    violation(action, payload = {}) {
        return this.write('violation', { ...payload, action });
    }
    blacklist(action, payload = {}) {
        return this.write('blacklist', { ...payload, action });
    }
    async query(type, limit = 200) {
        return this.store.logQuery(type, limit);
    }
}
exports.LogService = LogService;
//# sourceMappingURL=log.js.map