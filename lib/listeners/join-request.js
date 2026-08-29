"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apply = apply;
const utils_1 = require("../utils");
const request_tracker_1 = require("../services/request-tracker");
function requestFlag(session) {
    const s = session;
    return String(s.messageId ?? s.flag ?? s.id ?? '');
}
function requestSubType(session) {
    return String(session.subtype ?? session.subtype ?? 'add');
}
// 解析引用文本中的审核意图
function parseReplyIntent(text) {
    const t = String(text || '').trim();
    if (/^(同意|通过|y|yes)(\s|$)/i.test(t))
        return 'approve';
    if (/^(拒绝|不通过|n|no)(\s|$)/i.test(t))
        return 'reject';
    return null;
}
// 去掉意图词，返回理由（未填写则为空）
function stripIntent(text) {
    return String(text || '').replace(/^(拒绝|不通过|no|n|同意|通过|yes|y)(\s+|$)/i, '').trim();
}
// 通知审核员（拥有「审核员」权限的用户可引用回复完成审批）。
// 通知目标统一使用「入群自动判定结果通知」的通知目标，目标为空时发送至事件所在群。
async function notifyReviewers(svc, session, cfg, record) {
    const dispName = record.nickname && record.nickname !== record.userId ? record.nickname : record.userId;
    const text = `【入群审核通知】\n群号：${record.groupId}\n申请人：${dispName}${dispName !== record.userId ? `（${record.userId}）` : ''}\n申请内容：${record.comment || '无'}\n\n请引用回复本条消息，发送「同意」或「拒绝」（也可发送 y/n）即可完成审核。`;
    const notice = cfg.joinReview.autoNotice;
    const targetId = notice?.targetId || '';
    const mode = notice?.mode ?? 'group';
    if (mode === 'private') {
        if (targetId) {
            const mid = await svc.onebot.sendPrivate(session, targetId, text);
            if (mid)
                (0, request_tracker_1.trackRequest)(mid, { flag: record.flag, type: 'join', source: 'manual' });
        }
        else {
            // 目标为空：默认发送至事件所在群
            const mid = await svc.onebot.sendGroup(session, record.groupId, text);
            if (mid)
                (0, request_tracker_1.trackRequest)(mid, { flag: record.flag, type: 'join', source: 'manual' });
        }
    }
    else {
        const gid = targetId || record.groupId;
        if (gid) {
            const mid = await svc.onebot.sendGroup(session, gid, text);
            if (mid)
                (0, request_tracker_1.trackRequest)(mid, { flag: record.flag, type: 'join', source: 'manual' });
        }
    }
}
async function handleJoinRequest(svc, session) {
    const flag = requestFlag(session);
    if (!flag) {
        return;
    }
    const subType = requestSubType(session);
    // 仅处理主动加群申请（add）与邀请入群（invite），其余忽略
    if (subType !== 'add' && subType !== 'invite')
        return;
    const groupId = (0, utils_1.idOf)(session.guildId);
    const userId = (0, utils_1.idOf)(session.userId);
    const comment = String(session.content ?? '');
    const nickname = await svc.onebot.resolveNickname(session, groupId, userId);
    const cfg = await svc.settings.getGroup(groupId);
    const now = new Date();
    // 记录待处理请求（invite 也记录，供超管通过命令审批）
    await svc.store.joinRequestCreate({
        flag,
        subType,
        groupId,
        userId,
        nickname,
        comment,
        status: 'pending',
        reviewers: [],
        notified: [],
        createdAt: now,
        expireAt: new Date(now.getTime() + Math.max(cfg.joinReview.manual.timeoutMinutes, 1) * 60000),
    });
    // 邀请入群不做自动审核（通知转发由 request-forward 负责）
    if (subType !== 'add')
        return;
    // 流程固定顺序：总开关 > 频率检查 > 黑名单检查 > 等级检查 > 关键词检查 > 人工审核 > LLM自动审核 > 默认操作
    // 未开启的步骤自动跳过；拒绝步骤使用各自配置的「拒绝理由」
    if (!cfg.joinReview.enabled)
        return;
    const jr = cfg.joinReview;
    const finalize = async (approve, reason, status) => {
        await svc.store.joinRequestUpdate(flag, { status });
        try {
            await svc.onebot.handleJoinRequest(session, flag, subType, approve, reason);
        }
        catch (e) {
            svc.ctx.logger('join').warn('处理入群请求失败', e.message);
        }
        await svc.log.audit(approve ? '入群审核通过' : '入群审核拒绝', { targetId: userId, groupId, detail: reason, result: status });
        // 入群自动判定结果通知（目标为空时默认发送至事件所在群）
        if (jr.autoNotice?.enabled) {
            await svc.notice.send(session, jr.autoNotice, {
                userId,
                groupId,
                nickname: nickname || userId,
                answer: comment,
                result: `${approve ? '已同意' : '已拒绝'}（${reason}）`,
                reason,
            }, groupId);
        }
    };
    // 白名单豁免入群审核（优先于全部流程步骤）
    const wlJoin = await svc.store.whitelistEntry(userId, groupId, cfg.applyGlobalWhitelist !== false);
    if (wlJoin?.exemptJoin) {
        await finalize(true, '白名单豁免', 'approved');
        return;
    }
    // LLM 自动审核 + 默认操作（人工审核超时后也进入此步）
    const runLlmOrDefault = async () => {
        const cur = await svc.store.joinRequestByFlag(flag);
        if (!cur || cur.status !== 'pending')
            return;
        if (jr.llm.enabled && cfg.ai.enabled) {
            const verdict = await svc.ai.reviewJoin(cfg.ai, comment || '（无申请内容）');
            if (verdict) {
                const reason = verdict.approve
                    ? `AI 审批：${verdict.reason}`
                    : (jr.llm.rejectReason?.trim() || `AI 审批：${verdict.reason}`);
                await finalize(verdict.approve, reason, 'llm');
                return;
            }
            // AI 判定失效 → 落入默认操作
        }
        // 默认操作：仅在所有审核判定失效或超时后执行
        const action = jr.default?.action ?? 'reject';
        const approve = action === 'approve';
        const reason = approve
            ? '默认操作：自动同意'
            : (jr.default?.rejectReason?.trim() || '审核超时，按默认操作拒绝');
        await finalize(approve, reason, 'default');
    };
    // 1. 频率检查
    if (jr.frequency.enabled) {
        const since = new Date(now.getTime() - jr.frequency.windowMinutes * 60000);
        const count = await svc.store.joinRequestCountRecent(userId, groupId, since);
        if (count > jr.frequency.maxCount) {
            await finalize(false, jr.frequency.rejectReason || '申请过于频繁', 'rejected');
            return;
        }
    }
    // 2. 黑名单检查（全局 + 本群，依据「应用全局黑名单」开关）
    if (jr.blacklist.enabled) {
        if (await svc.store.blacklistHas(userId, groupId, cfg.applyGlobalBlacklist !== false)) {
            await finalize(false, jr.blacklist.rejectReason || '命中黑名单', 'rejected');
            return;
        }
    }
    // 3. QQ 等级检查
    if (jr.qqLevel.enabled) {
        const info = await svc.onebot.getStrangerInfo(session, userId);
        if (info && typeof info.level === 'number' && info.level < jr.qqLevel.minLevel) {
            await finalize(false, jr.qqLevel.rejectReason || `QQ 等级不足（需 ≥ ${jr.qqLevel.minLevel} 级）`, 'rejected');
            return;
        }
    }
    // 4. 关键词检查
    if (jr.keyword.enabled) {
        const rej = jr.keyword.rejectKeywords.find((k) => k && comment.includes(k));
        if (rej) {
            await finalize(false, jr.keyword.rejectReason || `命中拒绝关键词「${rej}」`, 'rejected');
            return;
        }
        const pass = jr.keyword.passKeywords.find((k) => k && comment.includes(k));
        if (pass) {
            await finalize(true, `命中通过关键词「${pass}」`, 'approved');
            return;
        }
    }
    // 5. 人工审核（超时后进入 LLM 自动审核 / 默认操作）
    if (jr.manual.enabled) {
        await notifyReviewers(svc, session, cfg, { flag, subType, groupId, userId, nickname, comment, status: 'pending', reviewers: [], notified: [], createdAt: now, expireAt: new Date() });
        const timeoutMs = Math.max(jr.manual.timeoutMinutes, 1) * 60000;
        setTimeout(() => {
            runLlmOrDefault().catch((e) => svc.ctx.logger('join').warn('入群审核超时处理异常', e));
        }, timeoutMs);
        return;
    }
    // 未启用人工审核：进入 LLM 自动审核，未启用或判定失效则执行默认操作
    await runLlmOrDefault();
}
function apply(ctx, svc) {
    ctx.on('guild-member-request', (session) => {
        handleJoinRequest(svc, session).catch((e) => {
            ctx.logger('join').warn('入群审核流程异常', e);
        });
    });
    // 人工审核：拥有「审核员」权限的用户引用回复「入群审核通知」，发送 同意/拒绝（或 y/n）即可完成审批
    ctx.middleware(async (session, next) => {
        try {
            const qid = (0, request_tracker_1.quotedMessageId)(session);
            if (!qid)
                return next();
            const meta = (0, request_tracker_1.lookupRequest)(qid);
            if (!meta || meta.source !== 'manual')
                return next();
            const intent = parseReplyIntent(String(session.content ?? '').trim());
            if (!intent)
                return next();
            const record = await svc.store.joinRequestByFlag(meta.flag);
            if (!record || record.status !== 'pending')
                return next();
            const cfg = await svc.settings.getGroup(record.groupId);
            // 「审核员」作为权限项统一管理，超级管理员始终拥有审核权限
            if (!await svc.permission.check(session, '审核员'))
                return next();
            const approve = intent === 'approve';
            // 理由可选：未填写时拒绝使用「人工审核」配置的默认拒绝理由
            let reason = stripIntent(String(session.content ?? '').trim());
            if (!approve && !reason)
                reason = cfg.joinReview.manual.rejectReason || '';
            const uid = (0, utils_1.idOf)(session.userId);
            try {
                await svc.onebot.handleJoinRequest(session, meta.flag, record.subType || 'add', approve, reason);
            }
            catch (e) {
                return `操作失败：${e.message}`;
            }
            await svc.store.joinRequestUpdate(meta.flag, { status: approve ? 'approved' : 'rejected' });
            await svc.log.audit(approve ? '入群审核通过' : '入群审核拒绝', { operatorId: uid, operatorName: session.username || '', targetId: record.userId, groupId: record.groupId, detail: reason });
            return approve ? '已同意该入群申请' : `已拒绝该入群申请${reason ? `（${reason}）` : ''}`;
        }
        catch (e) {
            ctx.logger('join').warn('引用审核处理异常', e);
            return next();
        }
    });
}
//# sourceMappingURL=join-request.js.map