import { Context, Session } from 'koishi'
import { Services } from '../types'
import { idOf } from '../utils'

function guild(session: Session): string {
  return idOf(session.guildId)
}

// 违禁词管理
export function apply(ctx: Context, svc: Services) {
  ctx.command('添加违禁词 <word:text>', '添加一个违禁词')
    .action(async ({ session }: any, word) => {
      if (!await svc.permission.check(session, '添加违禁词')) return '你没有权限使用此命令'
      const w = (word || '').trim()
      if (!w) return '请提供要添加的违禁词'
      const g = await svc.settings.getGlobal()
      const words = [...g.bannedWords.words]
      if (words.includes(w)) return `违禁词「${w}」已存在`
      words.push(w)
      await svc.settings.setGlobal({ bannedWords: { words } })
      await svc.log.operation('添加违禁词', { operatorId: idOf(session.userId), operatorName: session.username || '', targetId: w, groupId: guild(session) })
      return `已添加违禁词「${w}」`
    })

  ctx.command('移除违禁词 <word:text>', '移除一个违禁词')
    .action(async ({ session }: any, word) => {
      if (!await svc.permission.check(session, '移除违禁词')) return '你没有权限使用此命令'
      const w = (word || '').trim()
      if (!w) return '请提供要移除的违禁词'
      const g = await svc.settings.getGlobal()
      const words = g.bannedWords.words.filter((x) => x !== w)
      await svc.settings.setGlobal({ bannedWords: { words } })
      await svc.log.operation('移除违禁词', { operatorId: idOf(session.userId), operatorName: session.username || '', targetId: w, groupId: guild(session) })
      return `已移除违禁词「${w}」`
    })

  ctx.command('违禁词列表', '查看违禁词')
    .action(async ({ session }: any) => {
      if (!await svc.permission.check(session, '移除违禁词')) return '你没有权限使用此命令'
      const g = await svc.settings.getGlobal()
      if (g.bannedWords.words.length === 0) return '违禁词列表为空'
      return `违禁词（共 ${g.bannedWords.words.length} 个）：\n${g.bannedWords.words.join('、')}`
    })
}