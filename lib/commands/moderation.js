"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apply = apply;
const utils_1 = require("../utils");
// 获取群号
function guild(session) {
    return (0, utils_1.idOf)(session.guildId);
}
// 禁言、解除禁言、踢出、退群
function apply(ctx, svc) {
    ctx.command('禁言 <user:string> [duration:text]', '禁言指定用户（默认 10 分钟）')
        .alias('封禁')
        .action(async ({ session }, user, duration) => {
        if (!await svc.permission.check(session, '禁言'))
            return '你没有权限使用此命令';
        const target = (0, utils_1.resolveTargetUser)(session, user);
        if (!target)
            return '请 @ 要禁言的用户，或提供对方 QQ 号';
        const cfg = await svc.settings.getGroup(guild(session));
        if (cfg.enableGroupManagement === false)
            return '本群未启用群管功能';
        if (!cfg.mute.enabled)
            return '禁言功能已被禁用';
        const minutes = (0, utils_1.parseDuration)(duration, 10);
        if (minutes > cfg.mute.maxDuration)
            return `禁言时长不能超过 ${(0, utils_1.formatDuration)(cfg.mute.maxDuration)}`;
        try {
            await svc.onebot.mute(session, target, minutes);
        }
        catch (e) {
            return e.message;
        }
        await svc.log.operation('禁言', { operatorId: (0, utils_1.idOf)(session.userId), operatorName: session.username || '', targetId: target, groupId: guild(session), detail: `${(0, utils_1.formatDuration)(minutes)}` });
        return `已禁言 ${target} ${(0, utils_1.formatDuration)(minutes)}`;
    });
    ctx.command('解除禁言 <user:string>', '解除指定用户的禁言')
        .alias('解禁')
        .action(async ({ session }, user) => {
        if (!await svc.permission.check(session, '解除禁言'))
            return '你没有权限使用此命令';
        const target = (0, utils_1.resolveTargetUser)(session, user);
        if (!target)
            return '请 @ 要解除禁言的用户，或提供对方 QQ 号';
        const cfg = await svc.settings.getGroup(guild(session));
        if (cfg.enableGroupManagement === false)
            return '本群未启用群管功能';
        if (!cfg.mute.enabled)
            return '禁言功能已被禁用';
        try {
            await svc.onebot.unmute(session, target);
        }
        catch (e) {
            return e.message;
        }
        await svc.log.operation('解除禁言', { operatorId: (0, utils_1.idOf)(session.userId), operatorName: session.username || '', targetId: target, groupId: guild(session) });
        return `已解除 ${target} 的禁言`;
    });
    ctx.command('全体禁言', '开启当前群全体禁言')
        .action(async ({ session }) => {
        if (!await svc.permission.check(session, '全体禁言'))
            return '你没有权限使用此命令';
        const gid = guild(session);
        if (!gid)
            return '仅可在群聊中使用全体禁言命令';
        const cfg = await svc.settings.getGroup(gid);
        if (cfg.enableGroupManagement === false)
            return '本群未启用群管功能';
        if (!cfg.mute.enabled)
            return '禁言功能已被禁用';
        try {
            await svc.onebot.setWholeBan(session, true);
        }
        catch (e) {
            return e.message;
        }
        await svc.log.operation('全体禁言', { operatorId: (0, utils_1.idOf)(session.userId), operatorName: session.username || '', groupId: gid });
        return '已开启全体禁言';
    });
    ctx.command('全体解禁', '关闭当前群全体禁言')
        .action(async ({ session }) => {
        if (!await svc.permission.check(session, '全体解禁'))
            return '你没有权限使用此命令';
        const gid = guild(session);
        if (!gid)
            return '仅可在群聊中使用全体解禁命令';
        const cfg = await svc.settings.getGroup(gid);
        if (cfg.enableGroupManagement === false)
            return '本群未启用群管功能';
        if (!cfg.mute.enabled)
            return '禁言功能已被禁用';
        try {
            await svc.onebot.setWholeBan(session, false);
        }
        catch (e) {
            return e.message;
        }
        await svc.log.operation('全体解禁', { operatorId: (0, utils_1.idOf)(session.userId), operatorName: session.username || '', groupId: gid });
        return '已解除全体禁言';
    });
    ctx.command('踢出 <user:string>', '将指定用户移出群聊')
        .alias('移除')
        .action(async ({ session }, user) => {
        if (!await svc.permission.check(session, '踢出'))
            return '你没有权限使用此命令';
        const target = (0, utils_1.resolveTargetUser)(session, user);
        if (!target)
            return '请 @ 要踢出的用户，或提供对方 QQ 号';
        const cfg = await svc.settings.getGroup(guild(session));
        if (cfg.enableGroupManagement === false)
            return '本群未启用群管功能';
        try {
            await svc.onebot.kick(session, target);
        }
        catch (e) {
            return e.message;
        }
        await svc.log.operation('踢出', { operatorId: (0, utils_1.idOf)(session.userId), operatorName: session.username || '', targetId: target, groupId: guild(session) });
        return `已将 ${target} 移出群聊`;
    });
    ctx.command('退群', '机器人退出当前群聊')
        .action(async ({ session }) => {
        if (!await svc.permission.check(session, '退群'))
            return '你没有权限使用此命令';
        const gid = guild(session);
        if (!gid)
            return '仅可在群聊中使用退群命令';
        try {
            await svc.onebot.leaveGroup(session);
        }
        catch (e) {
            return e.message;
        }
        await svc.log.operation('退群', { operatorId: (0, utils_1.idOf)(session.userId), operatorName: session.username || '', groupId: gid });
        return '已退出当前群聊';
    });
}
//# sourceMappingURL=moderation.js.map