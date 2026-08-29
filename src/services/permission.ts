import { Context, Session } from 'koishi'
import { Store } from './store'
import { PermissionGroup } from '../types'
import { idOf } from '../utils'

// 所有可被权限组控制的命令名与权限项（与 commands 中的 key 对应；「审核员」为权限项而非命令）
export const ALL_COMMANDS = [
  '禁言', '解除禁言', '全体禁言', '全体解禁', '踢出', '退群', '审核员',
  '设置精华', '取消精华', '设置头衔', '取消头衔',
  '添加黑名单', '移除黑名单', '添加白名单', '移除白名单', '添加违禁词', '移除违禁词', '权限组',
]

export function defaultPerms(): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  for (const cmd of ALL_COMMANDS) map[cmd] = true
  return map
}

// 权限服务：自定义权限组 + 优先级 + 默认组 + 命令权限开关
export class PermissionService {
  private store: Store
  private superUsers: () => string[] | Promise<string[]>
  private log: any
  private authorityLevel: number

  constructor(ctx: Context, store: Store, superUsers: () => string[] | Promise<string[]>) {
    this.store = store
    this.superUsers = superUsers
    this.log = ctx.logger('permission')
    this.authorityLevel = 3
  }

  async listGroups(): Promise<PermissionGroup[]> {
    return this.store.permissionGroups()
  }

  async getGroup(name: string): Promise<PermissionGroup | undefined> {
    return this.store.permissionGroupByName(name)
  }

  async createGroup(name: string, isDefault = false): Promise<PermissionGroup> {
    const existing = await this.getGroup(name)
    if (existing) throw new Error(`权限组「${name}」已存在`)
    const max = await this.store.permissionGroups()
    const priority = (max.reduce((m, g) => Math.max(m, g.priority), 0) ?? 0) + 1
    const group = await this.store.permissionGroupCreate({
      name,
      priority,
      isDefault,
      members: [],
      groupIds: [],
      perms: defaultPerms(),
    })
    if (isDefault) await this.clearDefaultExcept(group.id)
    return group
  }

  async removeGroup(name: string): Promise<void> {
    const group = await this.getGroup(name)
    if (!group) throw new Error(`权限组「${name}」不存在`)
    await this.store.permissionGroupRemove(group.id)
  }

  private async clearDefaultExcept(id: number): Promise<void> {
    const groups = await this.store.permissionGroups()
    for (const g of groups) {
      if (g.isDefault && g.id !== id) await this.store.permissionGroupUpdate(g.id, { isDefault: false })
    }
  }

  async setDefault(name: string): Promise<void> {
    const group = await this.getGroup(name)
    if (!group) throw new Error(`权限组「${name}」不存在`)
    await this.clearDefaultExcept(group.id)
    await this.store.permissionGroupUpdate(group.id, { isDefault: true })
  }

  async setPriority(name: string, priority: number): Promise<void> {
    const group = await this.getGroup(name)
    if (!group) throw new Error(`权限组「${name}」不存在`)
    await this.store.permissionGroupUpdate(group.id, { priority })
  }

  async addMember(groupName: string, userId: string): Promise<void> {
    const group = await this.getGroup(groupName)
    if (!group) throw new Error(`权限组「${groupName}」不存在`)
    if (!group.members.includes(userId)) {
      group.members.push(userId)
      await this.store.permissionGroupUpdate(group.id, { members: group.members })
    }
  }

  async removeMember(groupName: string, userId: string): Promise<void> {
    const group = await this.getGroup(groupName)
    if (!group) throw new Error(`权限组「${groupName}」不存在`)
    group.members = group.members.filter((m) => m !== userId)
    await this.store.permissionGroupUpdate(group.id, { members: group.members })
  }

  // 添加生效群（追加并去重；传入空数组表示清空为「全部群」）
  async setGroups(groupName: string, groupIds: string[]): Promise<void> {
    const group = await this.getGroup(groupName)
    if (!group) throw new Error(`权限组「${groupName}」不存在`)
    const merged = Array.from(new Set([...group.groupIds, ...groupIds]))
    await this.store.permissionGroupUpdate(group.id, { groupIds: merged })
  }

  // 清空生效群（恢复为「全部群」）
  async clearGroups(groupName: string): Promise<void> {
    const group = await this.getGroup(groupName)
    if (!group) throw new Error(`权限组「${groupName}」不存在`)
    await this.store.permissionGroupUpdate(group.id, { groupIds: [] })
  }

  async setPerm(groupName: string, command: string, enabled: boolean): Promise<void> {
    if (!ALL_COMMANDS.includes(command)) throw new Error(`未知命令「${command}」`)
    const group = await this.getGroup(groupName)
    if (!group) throw new Error(`权限组「${groupName}」不存在`)
    group.perms[command] = enabled
    await this.store.permissionGroupUpdate(group.id, { perms: group.perms })
  }

  // 从群聊快捷导入成员到权限组（role: admin 管理员 / member 全部成员 / owner 群主）
  async importFromGroup(groupName: string, members: Array<{ userId?: string, user_id?: number | string, role?: string, card?: string }>, role: 'admin' | 'member' | 'owner' = 'member'): Promise<number> {
    const group = await this.getGroup(groupName)
    if (!group) throw new Error(`权限组「${groupName}」不存在`)
    let count = 0
    for (const m of members) {
      const uid = idOf((m as any).user_id ?? m.userId)
      if (!uid) continue
      if (role === 'admin' && m.role !== 'admin' && m.role !== 'owner') continue
      if (role === 'owner' && m.role !== 'owner') continue
      if (!group.members.includes(uid)) {
        group.members.push(uid)
        count++
      }
    }
    await this.store.permissionGroupUpdate(group.id, { members: group.members })
    return count
  }

  // 判断是否为超级管理员（供仅限超管的操作使用）
  async isSuperAdmin(session: Session): Promise<boolean> {
    const userId = idOf(session.userId)
    if ((await this.superUsers()).includes(userId)) return true
    return ((session as any).user?.authority ?? 0) >= this.authorityLevel
  }

  // 判断某用户对某命令是否有权限
  async check(session: Session, command: string): Promise<boolean> {
    const userId = idOf(session.userId)
    // 超级管理员：拥有全部命令权限，且不受权限组生效群（groupIds）限制
    if ((await this.superUsers()).includes(userId)) return true
    // Koishi 高权限（authority >= 3）
    if ((session as any).user?.authority >= this.authorityLevel) return true

    const groups = await this.store.permissionGroups()
    // 未配置任何权限组：仅超级管理员可触发（安全优先，超管已在上面 return true）
    if (groups.length === 0) return false

    const guildId = idOf(session.guildId)
    const matched: PermissionGroup[] = []
    for (const g of groups) {
      const inScope = g.groupIds.length === 0 || g.groupIds.includes(guildId)
      if (inScope && g.members.includes(userId)) matched.push(g)
    }

    let target: PermissionGroup | undefined
    if (matched.length > 0) {
      target = matched.sort((a, b) => b.priority - a.priority)[0]
    } else {
      target = groups.find((g) => g.isDefault)
    }

    if (!target) {
      // 有权限组但无所属组且默认组未配置：默认拒绝（安全优先）
      this.log.debug(`用户 ${userId} 未匹配任何权限组，命令「${command}」被拒绝`)
      return false
    }

    return target.perms[command] !== false
  }
}