"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermissionService = exports.ALL_COMMANDS = void 0;
exports.defaultPerms = defaultPerms;
const utils_1 = require("../utils");
// 所有可被权限组控制的命令名与权限项（与 commands 中的 key 对应；「审核员」为权限项而非命令）
exports.ALL_COMMANDS = [
    '禁言', '解除禁言', '全体禁言', '全体解禁', '踢出', '退群', '审核员',
    '设置精华', '取消精华', '设置头衔', '取消头衔',
    '添加黑名单', '移除黑名单', '添加白名单', '移除白名单', '添加违禁词', '移除违禁词', '权限组',
];
function defaultPerms() {
    const map = {};
    for (const cmd of exports.ALL_COMMANDS)
        map[cmd] = true;
    return map;
}
// 权限服务：自定义权限组 + 优先级 + 默认组 + 命令权限开关
class PermissionService {
    constructor(ctx, store, superUsers) {
        this.store = store;
        this.superUsers = superUsers;
        this.log = ctx.logger('permission');
        this.authorityLevel = 3;
    }
    async listGroups() {
        return this.store.permissionGroups();
    }
    async getGroup(name) {
        return this.store.permissionGroupByName(name);
    }
    async createGroup(name, isDefault = false) {
        const existing = await this.getGroup(name);
        if (existing)
            throw new Error(`权限组「${name}」已存在`);
        const max = await this.store.permissionGroups();
        const priority = (max.reduce((m, g) => Math.max(m, g.priority), 0) ?? 0) + 1;
        const group = await this.store.permissionGroupCreate({
            name,
            priority,
            isDefault,
            members: [],
            groupIds: [],
            perms: defaultPerms(),
        });
        if (isDefault)
            await this.clearDefaultExcept(group.id);
        return group;
    }
    async removeGroup(name) {
        const group = await this.getGroup(name);
        if (!group)
            throw new Error(`权限组「${name}」不存在`);
        await this.store.permissionGroupRemove(group.id);
    }
    async clearDefaultExcept(id) {
        const groups = await this.store.permissionGroups();
        for (const g of groups) {
            if (g.isDefault && g.id !== id)
                await this.store.permissionGroupUpdate(g.id, { isDefault: false });
        }
    }
    async setDefault(name) {
        const group = await this.getGroup(name);
        if (!group)
            throw new Error(`权限组「${name}」不存在`);
        await this.clearDefaultExcept(group.id);
        await this.store.permissionGroupUpdate(group.id, { isDefault: true });
    }
    async setPriority(name, priority) {
        const group = await this.getGroup(name);
        if (!group)
            throw new Error(`权限组「${name}」不存在`);
        await this.store.permissionGroupUpdate(group.id, { priority });
    }
    async addMember(groupName, userId) {
        const group = await this.getGroup(groupName);
        if (!group)
            throw new Error(`权限组「${groupName}」不存在`);
        if (!group.members.includes(userId)) {
            group.members.push(userId);
            await this.store.permissionGroupUpdate(group.id, { members: group.members });
        }
    }
    async removeMember(groupName, userId) {
        const group = await this.getGroup(groupName);
        if (!group)
            throw new Error(`权限组「${groupName}」不存在`);
        group.members = group.members.filter((m) => m !== userId);
        await this.store.permissionGroupUpdate(group.id, { members: group.members });
    }
    // 添加生效群（追加并去重；传入空数组表示清空为「全部群」）
    async setGroups(groupName, groupIds) {
        const group = await this.getGroup(groupName);
        if (!group)
            throw new Error(`权限组「${groupName}」不存在`);
        const merged = Array.from(new Set([...group.groupIds, ...groupIds]));
        await this.store.permissionGroupUpdate(group.id, { groupIds: merged });
    }
    // 清空生效群（恢复为「全部群」）
    async clearGroups(groupName) {
        const group = await this.getGroup(groupName);
        if (!group)
            throw new Error(`权限组「${groupName}」不存在`);
        await this.store.permissionGroupUpdate(group.id, { groupIds: [] });
    }
    async setPerm(groupName, command, enabled) {
        if (!exports.ALL_COMMANDS.includes(command))
            throw new Error(`未知命令「${command}」`);
        const group = await this.getGroup(groupName);
        if (!group)
            throw new Error(`权限组「${groupName}」不存在`);
        group.perms[command] = enabled;
        await this.store.permissionGroupUpdate(group.id, { perms: group.perms });
    }
    // 从群聊快捷导入成员到权限组（role: admin 管理员 / member 全部成员 / owner 群主）
    async importFromGroup(groupName, members, role = 'member') {
        const group = await this.getGroup(groupName);
        if (!group)
            throw new Error(`权限组「${groupName}」不存在`);
        let count = 0;
        for (const m of members) {
            const uid = (0, utils_1.idOf)(m.user_id ?? m.userId);
            if (!uid)
                continue;
            if (role === 'admin' && m.role !== 'admin' && m.role !== 'owner')
                continue;
            if (role === 'owner' && m.role !== 'owner')
                continue;
            if (!group.members.includes(uid)) {
                group.members.push(uid);
                count++;
            }
        }
        await this.store.permissionGroupUpdate(group.id, { members: group.members });
        return count;
    }
    // 判断是否为超级管理员（供仅限超管的操作使用）
    async isSuperAdmin(session) {
        const userId = (0, utils_1.idOf)(session.userId);
        if ((await this.superUsers()).includes(userId))
            return true;
        return (session.user?.authority ?? 0) >= this.authorityLevel;
    }
    // 判断某用户对某命令是否有权限
    async check(session, command) {
        const userId = (0, utils_1.idOf)(session.userId);
        // 超级管理员：拥有全部命令权限，且不受权限组生效群（groupIds）限制
        if ((await this.superUsers()).includes(userId))
            return true;
        // Koishi 高权限（authority >= 3）
        if (session.user?.authority >= this.authorityLevel)
            return true;
        const groups = await this.store.permissionGroups();
        // 未配置任何权限组：仅超级管理员可触发（安全优先，超管已在上面 return true）
        if (groups.length === 0)
            return false;
        const guildId = (0, utils_1.idOf)(session.guildId);
        const matched = [];
        for (const g of groups) {
            const inScope = g.groupIds.length === 0 || g.groupIds.includes(guildId);
            if (inScope && g.members.includes(userId))
                matched.push(g);
        }
        let target;
        if (matched.length > 0) {
            target = matched.sort((a, b) => b.priority - a.priority)[0];
        }
        else {
            target = groups.find((g) => g.isDefault);
        }
        if (!target) {
            // 有权限组但无所属组且默认组未配置：默认拒绝（安全优先）
            this.log.debug(`用户 ${userId} 未匹配任何权限组，命令「${command}」被拒绝`);
            return false;
        }
        return target.perms[command] !== false;
    }
}
exports.PermissionService = PermissionService;
//# sourceMappingURL=permission.js.map