"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apply = apply;
const utils_1 = require("../utils");
const notice_1 = require("../services/notice");
// 欢迎语 / 欢送语（支持 {userId} {groupId} {nickname} {level} {avatar}）
function apply(ctx, svc) {
    ctx.on('guild-member-added', async (session) => {
        try {
            const groupId = (0, utils_1.idOf)(session.guildId);
            const userId = (0, utils_1.idOf)(session.userId);
            if (!groupId || !userId)
                return;
            const cfg = await svc.settings.getGroup(groupId);
            if (cfg.enableGroupManagement === false)
                return;
            if (!cfg.welcome.enabled)
                return;
            const nickname = await svc.onebot.resolveNickname(session, groupId, userId);
            const info = await svc.onebot.getStrangerInfo(session, userId);
            const level = info && typeof info.level === 'number' ? String(info.level) : '';
            const content = (0, notice_1.renderNotice)(cfg.welcome.text, { userId, groupId, nickname, level });
            if (content.length)
                await svc.onebot.sendGroup(session, groupId, content);
        }
        catch (e) {
            ctx.logger('welcome').warn('发送欢迎语失败', e);
        }
    });
    ctx.on('guild-member-removed', async (session) => {
        try {
            const groupId = (0, utils_1.idOf)(session.guildId);
            const userId = (0, utils_1.idOf)(session.userId);
            if (!groupId || !userId)
                return;
            const cfg = await svc.settings.getGroup(groupId);
            if (cfg.enableGroupManagement === false)
                return;
            if (!cfg.farewell.enabled)
                return;
            const nickname = await svc.onebot.resolveNickname(session, groupId, userId);
            const info = await svc.onebot.getStrangerInfo(session, userId);
            const level = info && typeof info.level === 'number' ? String(info.level) : '';
            const content = (0, notice_1.renderNotice)(cfg.farewell.text, { userId, groupId, nickname, level });
            if (content.length)
                await svc.onebot.sendGroup(session, groupId, content);
        }
        catch (e) {
            ctx.logger('farewell').warn('发送欢送语失败', e);
        }
    });
}
//# sourceMappingURL=welcome-farewell.js.map