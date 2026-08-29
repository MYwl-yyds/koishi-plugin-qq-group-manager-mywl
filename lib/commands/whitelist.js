"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apply = apply;
const utils_1 = require("../utils");
function guild(session) {
    return (0, utils_1.idOf)(session.guildId);
}
// 白名单管理
function apply(ctx, svc) {
    ctx.command('添加白名单 <user:string>', '将指定用户加入白名单（加 -q 加入全局白名单）')
        .option('global', '-q 加入全局白名单')
        .action(async ({ session, options }, user) => {
        if (!await svc.permission.check(session, '添加白名单'))
            return '你没有权限使用此命令';
        const target = (0, utils_1.resolveTargetUser)(session, user);
        if (!target)
            return '请 @ 要加入白名单的用户，或提供对方 QQ 号';
        const cfg = await svc.settings.getGroup(guild(session));
        const applyGlobal = cfg.applyGlobalWhitelist !== false;
        const groupId = options?.global ? '' : (applyGlobal ? '' : guild(session));
        await svc.store.whitelistAdd(target, groupId);
        await svc.log.operation('添加白名单', { operatorId: (0, utils_1.idOf)(session.userId), operatorName: session.username || '', targetId: target, groupId });
        return `已将 ${target} 加入${groupId ? '本群' : '全局'}白名单`;
    });
    ctx.command('移除白名单 <user:string>', '将指定用户移出白名单')
        .action(async ({ session }, user) => {
        if (!await svc.permission.check(session, '移除白名单'))
            return '你没有权限使用此命令';
        const target = (0, utils_1.resolveTargetUser)(session, user);
        if (!target)
            return '请提供要移出白名单的用户 QQ';
        const removed = await svc.store.whitelistRemove(target);
        if (!removed)
            return `${target} 不在白名单中`;
        await svc.log.operation('移除白名单', { operatorId: (0, utils_1.idOf)(session.userId), operatorName: session.username || '', targetId: target, groupId: guild(session) });
        return `已将 ${target} 移出白名单`;
    });
    ctx.command('白名单列表', '查看白名单')
        .action(async ({ session }) => {
        if (!await svc.permission.check(session, '移除白名单'))
            return '你没有权限使用此命令';
        const list = await svc.store.whitelistList();
        if (list.length === 0)
            return '白名单为空';
        const lines = list.map((e, i) => `${i + 1}. ${e.userId}${e.groupId ? `（群 ${e.groupId}）` : '（全局）'}`);
        return `白名单（共 ${list.length} 人）：\n${lines.join('\n')}`;
    });
}
//# sourceMappingURL=whitelist.js.map