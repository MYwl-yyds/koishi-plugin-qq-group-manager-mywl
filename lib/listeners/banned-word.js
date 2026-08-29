"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apply = apply;
const utils_1 = require("../utils");
function plainText(session) {
    const texts = (session.elements || [])
        .filter((el) => el.type === 'text')
        .map((el) => el.attrs?.content ?? '');
    return texts.join('') || String(session.content ?? '');
}
// 违禁词检测
function apply(ctx, svc) {
    ctx.middleware(async (session, next) => {
        try {
            const groupId = (0, utils_1.idOf)(session.guildId);
            const userId = (0, utils_1.idOf)(session.userId);
            const selfId = (0, utils_1.idOf)(session.bot.selfId ?? session.bot.userId);
            if (!groupId || userId === selfId)
                return next();
            const cfg = await svc.settings.getGroup(groupId);
            if (cfg.enableGroupManagement === false)
                return next();
            if (!cfg.bannedWords.enabled || cfg.bannedWords.words.length === 0)
                return next();
            // 白名单豁免违禁词
            const wl = await svc.store.whitelistEntry(userId, groupId, cfg.applyGlobalWhitelist !== false);
            if (wl?.exemptBannedWord)
                return next();
            const text = plainText(session);
            if (!text)
                return next();
            const hit = cfg.bannedWords.words.find((w) => w && text.includes(w));
            if (!hit)
                return next();
            const actions = [];
            let didRecall = false;
            let didBan = false;
            let didKick = false;
            // 禁言与踢出互斥：同时开启时仅执行禁言
            const shouldBan = !!cfg.bannedWords.banOnTrigger;
            const shouldKick = !!cfg.bannedWords.kickOnTrigger && !shouldBan;
            try {
                if (cfg.bannedWords.recallOnTrigger && session.messageId) {
                    await svc.onebot.recall(session, (0, utils_1.idOf)(session.messageId));
                    actions.push('撤回');
                    didRecall = true;
                }
                if (shouldBan) {
                    await svc.onebot.mute(session, userId, cfg.bannedWords.banDuration);
                    actions.push(`禁言 ${cfg.bannedWords.banDuration} 分钟`);
                    didBan = true;
                }
                if (shouldKick) {
                    await svc.onebot.kick(session, userId);
                    actions.push('踢出');
                    didKick = true;
                }
            }
            catch (e) {
                actions.push(`处罚失败：${e.message}`);
            }
            await svc.log.violation('违禁词处罚', {
                targetId: userId,
                groupId,
                detail: JSON.stringify({ type: '违禁词', word: hit, source: 'bannedword' }),
                result: actions.join('，') || '无',
            });
            const nickname = await svc.onebot.resolveNickname(session, groupId, userId);
            const vars = {
                userId,
                groupId,
                nickname: nickname || userId,
                word: hit,
                punish: actions.join('，') || '无',
            };
            if (didRecall && cfg.bannedWords.recallNotice?.enabled) {
                await svc.notice.send(session, cfg.bannedWords.recallNotice, { ...vars, punish: '已撤回消息' }, groupId);
            }
            if (didBan && cfg.bannedWords.banNotice?.enabled) {
                await svc.notice.send(session, cfg.bannedWords.banNotice, { ...vars, punish: `禁言 ${cfg.bannedWords.banDuration} 分钟` }, groupId);
            }
            if (didKick && cfg.bannedWords.kickNotice?.enabled) {
                await svc.notice.send(session, cfg.bannedWords.kickNotice, { ...vars, punish: '已踢出' }, groupId);
            }
            ctx.logger('bannedword').info(`用户 ${userId} 在群 ${groupId} 触发违禁词「${hit}」`);
        }
        catch (e) {
            ctx.logger('bannedword').warn('违禁词检测异常', e);
        }
        return next();
    });
}
//# sourceMappingURL=banned-word.js.map