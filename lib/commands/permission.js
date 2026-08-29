"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apply = apply;
const utils_1 = require("../utils");
const permission_1 = require("../services/permission");
function guild(session) {
    return (0, utils_1.idOf)(session.guildId);
}
function parseGroupIds(text) {
    if (!text || text.trim() === '' || text.trim() === '全部')
        return [];
    return text.split(/[,，\s]+/).filter((x) => /^\d{5,}$/.test(x));
}
function parseGroupId(text) {
    const m = String(text || '').match(/\d{5,}/);
    return m ? m[0] : '';
}
function normalizeRole(input) {
    const r = String(input || '').trim().toLowerCase();
    if (['admin', '管理员', '管理'].includes(r))
        return 'admin';
    if (['owner', '群主', '所有人', '群所有人'].includes(r))
        return 'owner';
    return 'member';
}
// 权限组管理命令
function apply(ctx, svc) {
    const root = ctx.command('权限组', '自定义权限组管理');
    root.subcommand('.创建 <name:text>', '创建一个权限组')
        .action(async ({ session }, name) => {
        if (!await svc.permission.check(session, '权限组'))
            return '你没有权限使用此命令';
        if (!name)
            return '请提供权限组名称';
        try {
            const g = await svc.permission.createGroup(name.trim());
            return `已创建权限组「${g.name}」（优先级 ${g.priority}，默认开启全部命令权限）`;
        }
        catch (e) {
            return e.message;
        }
    });
    root.subcommand('.删除 <name:text>', '删除一个权限组')
        .action(async ({ session }, name) => {
        if (!await svc.permission.check(session, '权限组'))
            return '你没有权限使用此命令';
        if (!name)
            return '请提供权限组名称';
        try {
            await svc.permission.removeGroup(name.trim());
            return `已删除权限组「${name.trim()}」`;
        }
        catch (e) {
            return e.message;
        }
    });
    root.subcommand('.列表', '查看权限组列表')
        .action(async ({ session }) => {
        if (!await svc.permission.check(session, '权限组'))
            return '你没有权限使用此命令';
        const groups = await svc.permission.listGroups();
        if (groups.length === 0)
            return '尚未创建任何权限组';
        const lines = groups.map((g) => `「${g.name}」${g.isDefault ? '（默认组）' : ''} 优先级=${g.priority} 成员=${g.members.length} 生效群=${g.groupIds.length === 0 ? '全部' : g.groupIds.length + ' 个'}`);
        return `权限组列表：\n${lines.join('\n')}`;
    });
    root.subcommand('.设为默认 <name:text>', '将一个权限组设为默认组')
        .action(async ({ session }, name) => {
        if (!await svc.permission.check(session, '权限组'))
            return '你没有权限使用此命令';
        if (!name)
            return '请提供权限组名称';
        try {
            await svc.permission.setDefault(name.trim());
            return `已将「${name.trim()}」设为默认权限组`;
        }
        catch (e) {
            return e.message;
        }
    });
    root.subcommand('.添加成员 <name:text> <user:string>', '向权限组添加成员')
        .action(async ({ session }, name, user) => {
        if (!await svc.permission.check(session, '权限组'))
            return '你没有权限使用此命令';
        if (!name)
            return '请提供权限组名称';
        const target = (0, utils_1.resolveTargetUser)(session, user);
        if (!target)
            return '请 @ 要添加的成员，或提供 QQ 号';
        try {
            await svc.permission.addMember(name.trim(), target);
            return `已将 ${target} 添加到权限组「${name.trim()}」`;
        }
        catch (e) {
            return e.message;
        }
    });
    root.subcommand('.移除成员 <name:text> <user:string>', '从权限组移除成员')
        .action(async ({ session }, name, user) => {
        if (!await svc.permission.check(session, '权限组'))
            return '你没有权限使用此命令';
        if (!name)
            return '请提供权限组名称';
        const target = (0, utils_1.resolveTargetUser)(session, user);
        if (!target)
            return '请提供要移除的成员 QQ';
        try {
            await svc.permission.removeMember(name.trim(), target);
            return `已将 ${target} 从权限组「${name.trim()}」移除`;
        }
        catch (e) {
            return e.message;
        }
    });
    root.subcommand('.设置权限 <name:text> <command:text> <enabled:text>', '设置权限组内某命令的开关')
        .action(async ({ session }, name, command, enabled) => {
        if (!await svc.permission.check(session, '权限组'))
            return '你没有权限使用此命令';
        if (!name)
            return '请提供权限组名称';
        if (!command)
            return `请提供命令名，可选：${permission_1.ALL_COMMANDS.join('、')}`;
        const on = ['开', 'on', 'true', 'enable', '1'].includes(String(enabled).toLowerCase());
        try {
            await svc.permission.setPerm(name.trim(), command.trim(), on);
            return `已设置「${name.trim()}」的命令「${command.trim()}」为 ${on ? '开启' : '关闭'}`;
        }
        catch (e) {
            return e.message;
        }
    });
    root.subcommand('.添加生效群 <name:text> <groupIds:text>', '给权限组追加生效群聊（多个群号用逗号分隔）')
        .action(async ({ session }, name, groupIds) => {
        if (!await svc.permission.check(session, '权限组'))
            return '你没有权限使用此命令';
        if (!name)
            return '请提供权限组名称';
        const ids = parseGroupIds(groupIds);
        if (ids.length === 0)
            return '请提供要添加的群号';
        try {
            await svc.permission.setGroups(name.trim(), ids);
            return `已为「${name.trim()}」添加生效群：${ids.join('、')}`;
        }
        catch (e) {
            return e.message;
        }
    });
    root.subcommand('.清空生效群 <name:text>', '清空权限组的生效群（恢复为所有群）')
        .action(async ({ session }, name) => {
        if (!await svc.permission.check(session, '权限组'))
            return '你没有权限使用此命令';
        if (!name)
            return '请提供权限组名称';
        try {
            await svc.permission.clearGroups(name.trim());
            return `已清空「${name.trim()}」的生效群（恢复为所有群）`;
        }
        catch (e) {
            return e.message;
        }
    });
    root.subcommand('.导入 <name:text> [role:text] [groupIds:text]', '按角色从群聊快捷添加成员（角色：管理员/成员/群主；群号留空用当前群）')
        .action(async ({ session }, name, role, groupIds) => {
        if (!await svc.permission.check(session, '权限组'))
            return '你没有权限使用此命令';
        if (!name)
            return '请提供权限组名称';
        const ro = normalizeRole(role);
        const gid = parseGroupId(groupIds) || guild(session);
        if (!gid)
            return '请在群聊中使用，或提供目标群号';
        const members = await svc.onebot.getGroupMemberList(session, gid);
        const count = await svc.permission.importFromGroup(name.trim(), members, ro);
        const roleName = ro === 'admin' ? '管理员' : ro === 'owner' ? '群主' : '成员';
        return `已从群 ${gid} 添加 ${count} 名${roleName}到「${name.trim()}」`;
    });
}
//# sourceMappingURL=permission.js.map