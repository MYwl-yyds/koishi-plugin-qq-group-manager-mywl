import { Context, Session } from 'koishi'
import { Store } from './store'
import { PermissionGroup } from '../types'
import { idOf } from '../utils'

// 权限项定义：每个命令 / 管理动作一个独立权限项。
// group 用于 WebUI 分组展示，danger 标记高危项（默认拒绝）。
export interface PermItem {
  key: string
  label: string
  group: string
  danger?: boolean
}

export const PERM_ITEMS: PermItem[] = [
  // ---- 成员管理 ----
  { key: '禁言', label: '禁言', group: '成员管理' },
  { key: '解除禁言', label: '解除禁言', group: '成员管理' },
  { key: '全体禁言', label: '全体禁言', group: '成员管理' },
  { key: '全体解禁', label: '全体解禁', group: '成员管理' },
  { key: '踢出', label: '踢出', group: '成员管理' },
  { key: '退群', label: '退群（机器人退出本群）', group: '成员管理', danger: true },

  // ---- 入群审核 ----
  { key: '审核员', label: '审核员（同意/拒绝入群申请）', group: '入群审核', danger: true },

  // ---- 内容管理 ----
  { key: '设置精华', label: '设置精华', group: '内容管理' },
  { key: '取消精华', label: '取消精华', group: '内容管理' },
  { key: '设置头衔', label: '设置头衔', group: '内容管理' },
  { key: '取消头衔', label: '取消头衔', group: '内容管理' },
  { key: '违禁词查看', label: '查看违禁词 / 违规图列表', group: '内容管理' },
  { key: '违禁词管理', label: '增删违禁词', group: '内容管理' },
  { key: '违规图管理', label: '增删违规图片样本', group: '内容管理' },

  // ---- 名单管理 ----
  { key: '黑名单查看', label: '查看黑名单', group: '名单管理' },
  { key: '黑名单管理', label: '增删黑名单', group: '名单管理' },
  { key: '白名单查看', label: '查看白名单', group: '名单管理' },
  { key: '白名单管理', label: '增删白名单', group: '名单管理' },

  // ---- 系统 ----
  { key: '权限组查看', label: '查看权限组', group: '系统', danger: true },
  { key: '权限组管理', label: '创建/删除权限组、改成员与权限', group: '系统', danger: true },
]

// 所有可被权限组控制的权限项 key
export const ALL_COMMANDS: string[] = PERM_ITEMS.map((i) => i.key)

// 默认放行的权限项（新建权限组时预设为开）。
// 安全优先：不在此列表中的项一律默认拒绝，必须显式勾选。
export const DEFAULT_ALLOWED: string[] = [
  '禁言', '解除禁言', '全体禁言', '全体解禁', '踢出',
  '设置精华', '取消精华', '设置头衔', '取消头衔',
  '违禁词查看', '违禁词管理', '违规图管理',
  '黑名单查看', '黑名单管理', '白名单查看', '白名单管理',
]

// 默认拒绝的高危项：新建权限组时也不会自动获得，必须在 WebUI 中显式勾选
export const DEFAULT_DENIED: string[] = PERM_ITEMS.filter((i) => i.danger).map((i) => i.key)

export function defaultPerms(): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  for (const cmd of ALL_COMMANDS) map[cmd] = DEFAULT_ALLOWED.includes(cmd)
  return map
}

// 旧权限项 → 新权限项的兼容映射。
// 升级后老权限组里存的还是旧 key，读取时按此映射回退，
// 避免「升级后所有人突然失去权限」。
const LEGACY_PERM_MAP: Record<string, string[]> = {
  添加违禁词: ['违禁词管理'],
  移除违禁词: ['违禁词管理', '违禁词查看', '违规图管理'],
  添加黑名单: ['黑名单管理'],
  移除黑名单: ['黑名单管理', '黑名单查看'],
  添加白名单: ['白名单管理'],
  移除白名单: ['白名单管理', '白名单查看'],
  权限组: ['权限组管理', '权限组查看'],
}

// 读取某权限项在权限组中的取值，兼容旧 key
export function permValue(perms: Record<string, boolean> | undefined, key: string): boolean | undefined {
  if (!perms) return undefined
  if (typeof perms[key] === 'boolean') return perms[key]
  // 回退：任一旧 key 显式为 true 即视为开启
  for (const [legacy, targets] of Object.entries(LEGACY_PERM_MAP)) {
    if (targets.includes(key) && perms[legacy] === true) return true
  }
  return undefined
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

  // 重命名权限组，并同步迁移该组在各群配置中的引用（审核员等权限项按名称引用）
  async renameGroup(name: string, nextName: string): Promise<void> {
    const target = String(nextName || '').trim()
    if (!target) throw new Error('新名称不能为空')
    if (target === name) return
    const group = await this.getGroup(name)
    if (!group) throw new Error(`权限组「${name}」不存在`)
    if (await this.getGroup(target)) throw new Error(`权限组「${target}」已存在`)
    await this.store.permissionGroupUpdate(group.id, { name: target })
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

    // 未显式配置的权限项按「默认拒绝」处理，避免新增权限项或旧数据缺字段时被静默放行
    // （此前为 !== false，任何缺字段都视为放行，属于 fail-open 权限提升漏洞）
    // permValue 同时兼容旧权限项 key，避免升级后老权限组失效
    return permValue(target.perms, command) === true
  }

  // 审核员判定：需要超级管理员，或所属权限组显式开启了「审核员」权限项
  async isReviewer(session: Session): Promise<boolean> {
    if (await this.isSuperAdmin(session)) return true
    const userId = idOf(session.userId)
    const groups = await this.store.permissionGroups()
    if (groups.length === 0) return false
    const guildId = idOf(session.guildId)
    const matched = groups.filter((g) =>
      (g.groupIds.length === 0 || g.groupIds.includes(guildId)) && g.members.includes(userId))
    // 命中多个组时取优先级最高者，与 check() 一致
    const target = matched.length > 0
      ? matched.sort((a, b) => b.priority - a.priority)[0]
      : groups.find((g) => g.isDefault)
    return permValue(target?.perms, '审核员') === true
  }
}