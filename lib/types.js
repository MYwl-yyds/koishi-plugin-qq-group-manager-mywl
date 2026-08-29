"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOG_TYPES = exports.VIOLATION_LEVELS = exports.VIOLATION_TYPES = void 0;
exports.isGroupMessage = isGroupMessage;
exports.VIOLATION_TYPES = ['涉黄', '涉政', '人身攻击', '广告', '其他'];
exports.VIOLATION_LEVELS = ['轻度', '中度', '重度'];
exports.LOG_TYPES = ['operation', 'audit', 'violation', 'blacklist'];
function isGroupMessage(target) {
    return !!target && /^\d{5,}$/.test(target);
}
//# sourceMappingURL=types.js.map