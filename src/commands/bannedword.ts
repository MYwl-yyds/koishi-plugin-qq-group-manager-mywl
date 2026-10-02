import { Context, Session } from 'koishi'
import { Services } from '../types'
import { idOf, quotedMessageId } from '../utils'
import { ImageGuardService } from '../services/image-guard'

function guild(session: Session): string {
  return idOf(session.guildId)
}

// 违禁词管理
export function apply(ctx: Context, svc: Services) {
  ctx.command('添加违禁词 <word:text>', '添加一个违禁词')
    .action(async ({ session }: any, word) => {
      if (!await svc.permission.check(session, '违禁词管理')) return '你没有权限使用此命令'
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
      if (!await svc.permission.check(session, '违禁词管理')) return '你没有权限使用此命令'
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
      if (!await svc.permission.check(session, '违禁词查看')) return '你没有权限使用此命令'
      const g = await svc.settings.getGlobal()
      if (g.bannedWords.words.length === 0) return '违禁词列表为空'
      return `违禁词（共 ${g.bannedWords.words.length} 个）：\n${g.bannedWords.words.join('、')}`
    })

  // ---------- 违规图片样本采集 ----------

  // 引用一张图片消息并发送本命令，即可把该图加入违规图样本库
  ctx.command('设为违规图 [label:text]', '引用一张图片消息，把它加入违规图片样本库')
    .action(async ({ session }: any, label) => {
      if (!await svc.permission.check(session, '违规图管理')) return '你没有权限使用此命令'
      const { urls, reason } = await collectQuotedImageUrls(svc, session)
      if (urls.length === 0) {
        return `${reason || '未找到图片'}。用法：引用回复一条含图片的消息后发送本命令（支持 PNG / 基线 JPEG）`
      }
      const note = String(label || '').trim()
      const done: string[] = []
      const failed: string[] = []
      for (const url of urls) {
        const res = await svc.imageGuard.addSample(url, note, 'command', guild(session))
        if (res.ok) done.push(url)
        else failed.push(res.message)
      }
      if (done.length > 0) {
        await svc.log.operation('群内采集违规图样本', {
          operatorId: idOf(session.userId),
          operatorName: session.username || '',
          groupId: guild(session),
          detail: `${done.length} 张${note ? `（${note}）` : ''}`,
        })
      }
      if (done.length === 0) return `采集失败：${failed[0] || '无法解析该图片'}`
      return `已加入 ${done.length} 张违规图样本${note ? `（备注：${note}）` : ''}${failed.length ? `，${failed.length} 张失败：${failed[0]}` : ''}`
    })

  ctx.command('违规图列表', '查看违规图片样本库')
    .action(async ({ session }: any) => {
      if (!await svc.permission.check(session, '违禁词查看')) return '你没有权限使用此命令'
      const list = await svc.store.bannedImageList()
      if (list.length === 0) return '违规图样本库为空'
      const lines = list.slice(0, 20).map((e: any, i: number) =>
        `${i + 1}. ${e.label || '（无备注）'} [${e.format || '?'} ${e.width}×${e.height}] ${e.hash}`)
      const more = list.length > 20 ? `\n…其余 ${list.length - 20} 条请在 WebUI 查看` : ''
      return `违规图样本（共 ${list.length} 张）：\n${lines.join('\n')}${more}`
    })

  ctx.command('移除违规图 <hash:string>', '按感知哈希前缀移除违规图样本')
    .action(async ({ session }: any, hash) => {
      if (!await svc.permission.check(session, '违规图管理')) return '你没有权限使用此命令'
      const key = String(hash || '').trim().toLowerCase()
      if (!key) return '请提供要移除的样本哈希（可用「违规图列表」查询）'
      const list = await svc.store.bannedImageList()
      const hit = list.find((e: any) => String(e.hash).toLowerCase().startsWith(key))
      if (!hit) return `未找到哈希以「${key}」开头的样本`
      await svc.store.bannedImageRemove(hit.id)
      svc.imageGuard.invalidate()
      await svc.log.operation('移除违规图样本', {
        operatorId: idOf(session.userId), operatorName: session.username || '',
        groupId: guild(session), detail: hit.hash,
      })
      return `已移除样本「${hit.label || hit.hash}」`
    })
}

// 收集被引用消息中的图片地址。
// OneBot v11 的 reply/quote 段通常**只带 message_id**，不含原始消息内容，
// 因此必须调用 get_msg 取回原消息再解析其中的图片段；
// 少数适配器会在 quote 段内附带快照，这里作为快速路径优先尝试。
async function collectQuotedImageUrls(svc: Services, session: Session): Promise<{ urls: string[], reason: string }> {
  const urls: string[] = []
  const push = (v: any) => {
    if (typeof v === 'string' && /^https?:\/\//i.test(v) && !urls.includes(v)) urls.push(v)
  }

  // 1) 引用段内直接带快照的情况（部分适配器提供）
  for (const el of (session as any).elements || []) {
    if (el.type !== 'quote' && el.type !== 'reply') continue
    const snap = el.attrs?.quote ?? el.attrs?.data
    if (!snap) continue
    const inner = snap.elements ?? snap.message ?? (Array.isArray(snap) ? snap : [])
    for (const u of ImageGuardService.imageUrlsFromSegments(inner)) push(u)
  }
  if (urls.length > 0) return { urls, reason: '' }

  // 2) 标准路径：用被引用消息的 message_id 调 get_msg 取回原消息
  const quotedId = quotedMessageId(session)
  if (quotedId) {
    const msg = await svc.onebot.getMsg(session, quotedId)
    for (const u of msg?.images || []) push(u)
    if (urls.length > 0) return { urls, reason: '' }
    // 取回了消息但没有图片 —— 与被引用消息查不到要区分开，便于给出准确提示
    if (msg) return { urls, reason: '被引用的消息里没有图片' }
    return { urls, reason: '无法读取被引用的消息（协议端 get_msg 接口不可用）' }
  }

  // 3) 兜底：当前消息自身带的图片（例如直接把图片和命令一起发）
  for (const u of ImageGuardService.imageUrls(session)) push(u)
  if (urls.length > 0) return { urls, reason: '' }
  // 会话里的图片段可能只带 file 文件名/本地路径，用 get_image 换取真实下载地址
  for (const el of ((session as any).elements || []) as any[]) {
    if (el?.type !== 'image' && el?.type !== 'face' && el?.type !== 'mface') continue
    const f = el?.attrs?.file ?? el?.attrs?.url
    if (typeof f !== 'string' || !f) continue
    push(await svc.onebot.resolveImageUrl(session, f))
  }
  if (urls.length > 0) return { urls, reason: '' }

  return { urls, reason: '请「引用回复」一条包含图片的消息，再发送本命令' }
}