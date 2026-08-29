"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PREFIX = void 0;
exports.idOf = idOf;
exports.sleep = sleep;
exports.parseDuration = parseDuration;
exports.formatDuration = formatDuration;
exports.normalizeId = normalizeId;
exports.extractUser = extractUser;
exports.resolveTargetUser = resolveTargetUser;
exports.extractAllUsers = extractAllUsers;
exports.mergeDeep = mergeDeep;
exports.mergeEffective = mergeEffective;
exports.template = template;
exports.isPrivateChat = isPrivateChat;
exports.resolveTarget = resolveTarget;
exports.logger = logger;
function idOf(value) {
    if (value === undefined || value === null)
        return '';
    return String(value);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
// 解析时长字符串为「分钟」数值。支持单位：s/秒、m/分/分钟、h/时/小时、d/天/日；纯数字默认为分钟
function parseDuration(input, defaultMinutes = 10) {
    if (!input)
        return defaultMinutes;
    const raw = String(input).trim().toLowerCase();
    const match = raw.match(/^(\d+(?:\.\d+)?)\s*(秒|s|分|分钟|min|m|时|小时|hour|h|天|日|d)?$/);
    if (!match)
        return defaultMinutes;
    const value = parseFloat(match[1]);
    const unit = match[2] || 'm';
    let minutes = value;
    if (unit === '秒' || unit === 's')
        minutes = value / 60;
    else if (unit === '分' || unit === '分钟' || unit === 'min' || unit === 'm')
        minutes = value;
    else if (unit === '时' || unit === '小时' || unit === 'hour' || unit === 'h')
        minutes = value * 60;
    else if (unit === '天' || unit === '日' || unit === 'd')
        minutes = value * 24 * 60;
    return Math.max(0, minutes);
}
function formatDuration(minutes) {
    if (minutes >= 60) {
        const h = minutes / 60;
        return `${Number.isInteger(h) ? h : h.toFixed(1)} 小时`;
    }
    return `${minutes} 分钟`;
}
// 归一化用户 ID：剥离可能的「平台:ID」前缀（如 onebot:123456），返回纯 QQ 号
function normalizeId(id) {
    const s = String(id ?? '').trim();
    const i = s.lastIndexOf(':');
    return i >= 0 ? s.slice(i + 1) : s;
}
// 从 session 中提取被 @ 的用户（优先取首个 at），否则从文本中提取首个数字 QQ
function extractUser(session, raw) {
    for (const el of session.elements || []) {
        if (el.type === 'at' || el.type === 'mention') {
            const id = el.attrs?.id ?? el.attrs?.['user-id'] ?? el.attrs?.userId ?? el.attrs?.qq;
            if (id)
                return normalizeId(id);
        }
    }
    const text = raw ?? session.content ?? '';
    const match = text.match(/\d{5,12}/);
    return match ? match[0] : '';
}
// 解析命令中的目标用户：若 value 已是纯数字 QQ 则直接用，否则从 @ 中提取
function resolveTargetUser(session, value) {
    if (value && /^\d{5,12}$/.test(String(value).trim()))
        return String(value).trim();
    return extractUser(session, value);
}
function extractAllUsers(session) {
    const set = new Set();
    for (const el of session.elements || []) {
        if (el.type === 'at' || el.type === 'mention') {
            const id = el.attrs?.id ?? el.attrs?.['user-id'] ?? el.attrs?.userId ?? el.attrs?.qq;
            if (id)
                set.add(normalizeId(id));
        }
    }
    return [...set];
}
// 深度合并：对象递归合并，数组与其它类型直接覆盖
function mergeDeep(base, override) {
    if (override === undefined || override === null)
        return base;
    if (Array.isArray(base) || Array.isArray(override))
        return override;
    if (typeof base === 'object' && typeof override === 'object') {
        const out = { ...base };
        for (const key of Object.keys(override)) {
            out[key] = mergeDeep(base[key], override[key]);
        }
        return out;
    }
    return override;
}
function isEmptyValue(value) {
    if (value === undefined || value === null || value === '')
        return true;
    if (Array.isArray(value) && value.length === 0)
        return true;
    return false;
}
// 生效配置合并：覆盖值若为空（空串/空数组）则回退到基础值（用于「群级空则用全局」）
function mergeEffective(base, override) {
    if (isEmptyValue(override))
        return base;
    if (Array.isArray(base) || Array.isArray(override))
        return override;
    if (typeof base === 'object' && typeof override === 'object') {
        const out = { ...base };
        for (const key of Object.keys(override)) {
            out[key] = mergeEffective(base[key], override[key]);
        }
        return out;
    }
    return override;
}
function template(text, vars) {
    return text.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}
// 校验目标是否是「私聊」（target 为 QQ 号而非群号）
function isPrivateChat(session) {
    return session.isDirect === true || (session.subtype === 'private') || (session.channelId === session.userId);
}
function resolveTarget(session) {
    return idOf(session.guildId ?? session.channelId);
}
// 命令前缀统一使用
exports.PREFIX = '';
function logger(ctx) {
    return ctx.logger('全方面QQ群管');
}
//# sourceMappingURL=utils.js.map