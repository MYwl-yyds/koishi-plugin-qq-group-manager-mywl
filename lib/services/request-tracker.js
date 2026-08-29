"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackRequest = trackRequest;
exports.lookupRequest = lookupRequest;
exports.quotedMessageId = quotedMessageId;
const map = new Map();
function trackRequest(messageId, meta) {
    if (!messageId)
        return;
    map.set(messageId, meta);
    // 1 小时后自动清理，避免内存泄漏
    setTimeout(() => { map.delete(messageId); }, 60 * 60 * 1000);
}
function lookupRequest(messageId) {
    if (!messageId)
        return undefined;
    return map.get(messageId);
}
// 从引用回复 session 中提取被引用消息的 ID
function quotedMessageId(session) {
    const q = session?.quote;
    if (!q)
        return '';
    return String(q.id ?? q.messageId ?? '');
}
//# sourceMappingURL=request-tracker.js.map