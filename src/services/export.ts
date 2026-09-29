import { Context } from 'koishi'
import { Config } from '../types'
import { mergeDeep } from '../utils'

// 配置与名单的导出 / 导入。
// 导出内容不包含日志、成员检查状态等运行数据，便于人工审阅与跨环境迁移。

export const EXPORT_VERSION = 1

export interface ExportBundle {
  // 文件格式标识，导入时校验
  _format: 'qq-group-manager'
  _version: number
  exportedAt: string
  // 全局设置（不含 memberCheck —— 群员检查为纯群级配置）
  global?: any
  // 群级覆盖配置：{ [groupId]: Partial<Config> }
  groups?: Record<string, any>
  // 权限组
  permissionGroups?: any[]
  // 全局违规图样本（群专属样本随各自群配置单独维护）
  imageSamples?: any[]
}

export interface ListBundle {
  _format: 'qq-group-manager-list'
  _version: number
  exportedAt: string
  type: 'blacklist' | 'whitelist'
  entries: any[]
}

export interface ImportOptions {
  // merge：仅覆盖文件中出现的字段；replace：清空后整体替换
  mode: 'merge' | 'replace'
  // 是否导入群级配置
  includeGroups: boolean
  // 是否导入权限组
  includePermissionGroups: boolean
}

export interface ImportResult {
  ok: boolean
  message: string
  detail: {
    global: boolean
    groups: number
    permissionGroups: number
    imageSamples: number
    errors: string[]
  }
}

export class ExportService {
  private ctx: Context
  private store: any
  private settings: any
  private log: any
  // 导入违规图样本后清掉 image-guard 的样本缓存，避免最长 30 秒的旧数据窗口
  private onImageChange: () => void

  constructor(ctx: Context, store: any, settings: any, onImageChange?: () => void) {
    this.ctx = ctx
    this.store = store
    this.settings = settings
    this.onImageChange = onImageChange || (() => {})
    this.log = ctx.logger('export')
  }

  // ---------------- 导出 ----------------

  // 导出配置（全局设置 + 各群覆盖 + 权限组），不含黑白名单
  async exportConfig(includeGroups = true, includePermissionGroups = true): Promise<ExportBundle> {
    const bundle: ExportBundle = {
      _format: 'qq-group-manager',
      _version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
    }
    try {
      const global: any = await this.settings.getGlobal()
      // 群员检查已改为纯群级配置，全局不再有意义，导出时剔除以免造成误导
      if (global && global.memberCheck !== undefined) {
        const copy = { ...global }
        delete copy.memberCheck
        bundle.global = copy
      } else {
        bundle.global = global
      }
      // 违规图样本库分两级：全局样本随配置导出，群专属样本随各群导出
      bundle.imageSamples = (await this.store.bannedImageList('')).map((s: any) => ({
        hash: s.hash, groupId: '', source: s.source, origin: s.origin, label: s.label,
        width: s.width, height: s.height, format: s.format,
      }))
    } catch (e) {
      this.log.warn('导出全局设置失败', e)
    }
    if (includeGroups) {
      try {
        const rows = await this.store.groupConfigList()
        const groups: Record<string, any> = {}
        for (const row of rows) {
          // groupId 为空串是全局配置记录，跳过
          if (!row.groupId) continue
          groups[row.groupId] = row.config
        }
        bundle.groups = groups
      } catch (e) {
        this.log.warn('导出群配置失败', e)
      }
    }
    if (includePermissionGroups) {
      try {
        bundle.permissionGroups = await this.store.permissionGroups()
      } catch (e) {
        this.log.warn('导出权限组失败', e)
      }
    }
    return bundle
  }

  // 导出黑名单 / 白名单
  async exportList(type: 'blacklist' | 'whitelist'): Promise<ListBundle> {
    const entries = type === 'blacklist'
      ? await this.store.blacklistList()
      : await this.store.whitelistList()
    return {
      _format: 'qq-group-manager-list',
      _version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      type,
      entries: (entries || []).map((e: any) => {
        // 去掉自增主键，避免导入到已有数据的库时主键冲突
        const { id, ...rest } = e
        void id
        return rest
      }),
    }
  }

  // ---------------- 导入 ----------------

  async importConfig(bundle: any, options: ImportOptions): Promise<ImportResult> {
    const detail = { global: false, groups: 0, permissionGroups: 0, imageSamples: 0, errors: [] as string[] }
    if (!bundle || bundle._format !== 'qq-group-manager') {
      return { ok: false, message: '文件格式不正确：不是本插件导出的配置文件', detail }
    }
    if (Number(bundle._version) > EXPORT_VERSION) {
      return { ok: false, message: `文件版本（${bundle._version}）高于当前插件支持的版本（${EXPORT_VERSION}）`, detail }
    }

    // 1. 全局设置
    if (bundle.global && typeof bundle.global === 'object') {
      try {
        if (options.mode === 'replace') {
          await this.settings.replaceGlobal(bundle.global)
        } else {
          await this.settings.setGlobal(bundle.global)
        }
        detail.global = true
      } catch (e) {
        detail.errors.push(`全局设置导入失败：${(e as Error).message}`)
      }
    }

    // 2. 群级配置
    if (options.includeGroups && bundle.groups && typeof bundle.groups === 'object') {
      // 先取出已有群配置，便于 merge 模式下叠加
      const existing: Record<string, any> = {}
      if (options.mode === 'merge') {
        try {
          const rows = await this.store.groupConfigList()
          for (const row of rows) if (row.groupId) existing[row.groupId] = row.config
        } catch { /* 忽略，按全新写入处理 */ }
      }
      for (const [groupId, cfg] of Object.entries(bundle.groups)) {
        if (!groupId || !cfg || typeof cfg !== 'object') continue
        try {
          const next = options.mode === 'merge'
            ? mergeDeep(existing[groupId] || {}, cfg as any)
            : cfg
          await this.settings.setGroup(groupId, next as any, true)
          detail.groups++
        } catch (e) {
          detail.errors.push(`群 ${groupId} 导入失败：${(e as Error).message}`)
        }
      }
    }

    // 3. 权限组
    if (options.includePermissionGroups && Array.isArray(bundle.permissionGroups)) {
      try {
        if (options.mode === 'replace') {
          await this.store.permissionGroupClear()
        }
        for (const g of bundle.permissionGroups) {
          if (!g || !g.name) continue
          try {
            await this.store.permissionGroupUpsert({
              name: String(g.name),
              priority: Number(g.priority) || 0,
              isDefault: !!g.isDefault,
              members: Array.isArray(g.members) ? g.members.map(String) : [],
              groupIds: Array.isArray(g.groupIds) ? g.groupIds.map(String) : [],
              perms: g.perms && typeof g.perms === 'object' ? g.perms : {},
            })
            detail.permissionGroups++
          } catch (e) {
            detail.errors.push(`权限组「${g.name}」导入失败：${(e as Error).message}`)
          }
        }
      } catch (e) {
        detail.errors.push(`权限组导入失败：${(e as Error).message}`)
      }
    }

    // 4. 全局违规图样本
    if (Array.isArray(bundle.imageSamples) && bundle.imageSamples.length > 0) {
      try {
        if (options.mode === 'replace') await this.store.bannedImageClear('')
        for (const s of bundle.imageSamples) {
          if (!s || typeof s.hash !== 'string' || !/^[0-9a-f]{8,64}$/i.test(s.hash)) continue
          try {
            const added = await this.store.bannedImageAdd({
              hash: String(s.hash).toLowerCase(),
              groupId: '',
              source: String(s.source || 'import'),
              origin: String(s.origin || ''),
              label: String(s.label || ''),
              width: Number(s.width) || 0,
              height: Number(s.height) || 0,
              format: String(s.format || ''),
            })
            if (added) detail.imageSamples++
          } catch { /* 单条失败不影响整体 */ }
        }
        if (detail.imageSamples > 0) this.onImageChange()
      } catch (e) {
        detail.errors.push(`违规图样本导入失败：${(e as Error).message}`)
      }
    }

    const ok = detail.errors.length === 0
    const parts = [
      detail.global ? '全局设置' : '',
      detail.groups > 0 ? `${detail.groups} 个群配置` : '',
      detail.permissionGroups > 0 ? `${detail.permissionGroups} 个权限组` : '',
      detail.imageSamples > 0 ? `${detail.imageSamples} 张违规图样本` : '',
    ].filter(Boolean)
    return {
      ok,
      message: ok
        ? `导入完成：${parts.join('、') || '无内容变更'}`
        : `导入完成但存在 ${detail.errors.length} 处错误：${parts.join('、') || '无内容变更'}`,
      detail,
    }
  }

  async importList(bundle: any, type: 'blacklist' | 'whitelist', mode: 'merge' | 'replace'): Promise<ImportResult> {
    const detail = { global: false, groups: 0, permissionGroups: 0, imageSamples: 0, errors: [] as string[] }
    if (!bundle || bundle._format !== 'qq-group-manager-list') {
      return { ok: false, message: '文件格式不正确：不是本插件导出的名单文件', detail }
    }
    if (bundle.type && bundle.type !== type) {
      return { ok: false, message: `名单类型不匹配：文件是「${bundle.type === 'blacklist' ? '黑名单' : '白名单'}」，当前页面在导入「${type === 'blacklist' ? '黑名单' : '白名单'}」`, detail }
    }
    const entries = Array.isArray(bundle.entries) ? bundle.entries : []
    if (entries.length === 0) {
      return { ok: true, message: '文件中没有名单条目', detail }
    }

    if (mode === 'replace') {
      try {
        if (type === 'blacklist') await this.store.blacklistClear()
        else await this.store.whitelistClear()
      } catch (e) {
        return { ok: false, message: `清空原名单失败：${(e as Error).message}`, detail }
      }
    }

    let n = 0
    for (const e of entries) {
      const userId = String(e?.userId ?? '').trim()
      if (!/^\d{5,12}$/.test(userId)) {
        detail.errors.push(`跳过非法 QQ：${JSON.stringify(e?.userId)}`)
        continue
      }
      const groupId = e?.groupId ? String(e.groupId) : ''
      try {
        if (type === 'blacklist') {
          // 直接写库，绕过「白名单豁免」守卫——导入是管理员显式意图，应忠实还原导出内容
          await this.store.blacklistUpsert(userId, groupId, String(e.source || 'import'), e.createdAt ? new Date(e.createdAt) : undefined)
        } else {
          await this.store.whitelistAdd(userId, groupId, {
            exemptReport: e.exemptReport === true,
            exemptJoin: e.exemptJoin === true,
            exemptBannedWord: e.exemptBannedWord === true,
          }, e.createdAt ? new Date(e.createdAt) : undefined)
        }
        n++
      } catch (err) {
        detail.errors.push(`${userId} 导入失败：${(err as Error).message}`)
      }
    }

    const ok = detail.errors.length === 0
    return {
      ok,
      message: ok
        ? `已导入 ${n} 条${type === 'blacklist' ? '黑名单' : '白名单'}记录`
        : `已导入 ${n} 条，${detail.errors.length} 条失败`,
      detail,
    }
  }
}
