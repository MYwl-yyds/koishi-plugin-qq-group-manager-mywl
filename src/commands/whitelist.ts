import { Context, Session } from 'koishi'
import { Services } from '../types'
import { resolveTargetUser, idOf } from '../utils'

function guild(session: Session): string {
  return idOf(session.guildId)
}

// 统一的名单渲染：避免两处格式不一致
function formatEntries(list: any[]): string {
  return list.map((e, i) => `${i + 1}. ${e.userId}${e.groupId ? `（群 ${e.groupId}）` : '（全局）'}`).join('\n')
}

// 白名单管理
export function apply(ctx: Context, svc: Services) {
  ctx.command('添加白名单 <user:string>', '将指定用户加入白名单（加 -q 加入全局白名单）')
    .option('global', '-q 加入全局白名单')
    .action(async ({ session, options }: any, user) => {
      if (!await svc.permission.check(session, '白名单管理')) return '你没有权限使用此命令'
      const target = resolveTargetUser(session, user)
      if (!target) return '请 @ 要加入白名单的用户，或提供对方 QQ 号'
      const cfg = await svc.settings.getGroup(guild(session))
      const applyGlobal = cfg.applyGlobalWhitelist === true
      const groupId = options?.global ? '' : (applyGlobal ? '' : guild(session))
      await svc.store.whitelistAdd(target, groupId)
      await svc.log.operation('添加白名单', { operatorId: idOf(session.userId), operatorName: session.username || '', targetId: target, groupId })
      return `已将 ${target} 加入${groupId ? '本群' : '全局'}白名单`
    })

  ctx.command('移除白名单 <user:string>', '将指定用户移出白名单（加 -q 移出全局白名单）')
    .option('global', '-q 移出全局白名单')
    .action(async ({ session, options }: any, user) => {
      if (!await svc.permission.check(session, '白名单管理')) return '你没有权限使用此命令'
      const target = resolveTargetUser(session, user)
      if (!target) return '请提供要移出白名单的用户 QQ'
      // 与「添加白名单」保持同一范围判定
      const cfg = await svc.settings.getGroup(guild(session))
      const groupId = options?.global ? '' : (cfg.applyGlobalWhitelist === true ? '' : guild(session))
      const removed = await svc.store.whitelistRemove(target, groupId)
      if (!removed) {
        // 回退：本群启用全局名单时，也允许移除本群历史条目
        const fallbackGroup = guild(session)
        if (!options?.global && groupId === '' && fallbackGroup) {
          const ok = await svc.store.whitelistRemove(target, fallbackGroup)
          if (ok) {
            await svc.log.operation('移除白名单', { operatorId: idOf(session.userId), operatorName: session.username || '', targetId: target, groupId: fallbackGroup })
            return `已将 ${target} 移出本群白名单`
          }
        }
        return `${target} 不在${groupId ? '本群' : '全局'}白名单中`
      }
      await svc.log.operation('移除白名单', { operatorId: idOf(session.userId), operatorName: session.username || '', targetId: target, groupId })
      return `已将 ${target} 移出${groupId ? '本群' : '全局'}白名单`
    })

  ctx.command('白名单列表', '查看白名单（加 -q 仅查看全局白名单）')
    .option('global', '-q 仅查看全局白名单')
    .action(async ({ session, options }: any) => {
      if (!await svc.permission.check(session, '白名单查看')) return '你没有权限使用此命令'
      // 修复同「黑名单列表」：按范围分别查询，并兼容 channelId 与私聊场景
      const gid = idOf(session.guildId ?? (session as any).channelId)
      const globalList = await svc.store.whitelistList('')
      if (options?.global) {
        if (globalList.length === 0) return '全局白名单为空'
        return `全局白名单（共 ${globalList.length} 人）：\n${formatEntries(globalList)}`
      }
      const groupList = gid ? await svc.store.whitelistList(gid) : []
      const scoped = [...groupList, ...globalList]
      if (scoped.length > 0) {
        const head = gid ? `群 ${gid} 白名单（含全局）` : '白名单'
        return `${head}（共 ${scoped.length} 人）：\n${formatEntries(scoped)}`
      }
      // 本群与全局都为空：若数据存在其它群名下，明确指出，避免被误判成「功能坏了」
      const all = await svc.store.whitelistList()
      const others = all.filter((e: any) => e.groupId && e.groupId !== gid)
      if (others.length > 0) {
        const gids = Array.from(new Set(others.map((e: any) => String(e.groupId))))
        return `群 ${gid || '(未知)'} 与全局白名单均为空。\n其它群存在 ${others.length} 条记录：${gids.join('、')}\n`
          + '如需查看请到对应群内执行，或到 WebUI「名单中心 → 白名单」查看。'
      }
      return gid ? `群 ${gid} 的白名单为空（全局白名单也为空）` : '当前不在群聊中，且全局白名单为空'
    })
}