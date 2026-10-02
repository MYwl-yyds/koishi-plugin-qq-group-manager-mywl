// 链接识别与白名单匹配服务
//
// 白名单条目支持三种写法（不区分大小写）：
//   1. 完整链接：https://example.com/path   → 匹配该域名 + 路径前缀
//   2. 域名：example.com                     → 匹配 example.com、www.example.com 及任意子域名
//   3. 泛域名：*.example.com                 → 仅匹配任意子域名（不含 example.com 本身）

// 常见顶级域名，用于「裸域名」识别，降低误报（如文件名、版本号 1.2.3）
const COMMON_TLDS = new Set([
  'com', 'net', 'org', 'edu', 'gov', 'mil', 'int', 'io', 'co', 'me', 'tv', 'cc', 'xyz', 'top',
  'info', 'biz', 'pro', 'site', 'online', 'shop', 'club', 'vip', 'app', 'dev', 'ai', 'tech',
  'store', 'fun', 'live', 'life', 'love', 'wang', 'ren', 'work', 'art', 'link', 'space', 'website',
  'icu', 'cloud', 'host', 'press', 'wiki', 'group', 'chat', 'email', 'design', 'studio', 'media',
  'cn', 'hk', 'tw', 'mo', 'jp', 'kr', 'sg', 'us', 'uk', 'de', 'fr', 'ru', 'au', 'ca', 'in', 'br',
  'it', 'nl', 'es', 'se', 'no', 'fi', 'pl', 'ch', 'at', 'be', 'dk', 'cz', 'gr', 'pt', 'tr', 'ua',
])

// 协议前缀链接 / www 开头链接 / 带路径的裸域名 / IPv4[:端口]
const PATTERN_PROTOCOL = /\b(?:https?|ftp):\/\/[^\s\u4e00-\u9fa5<>"'`\\|]+/gi
const PATTERN_WWW = /\bwww\.[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d{1,5})?(?:\/[^\s\u4e00-\u9fa5<>"'`\\|]*)?/gi
const PATTERN_IP = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:\/\S*)?/g
const PATTERN_BARE = /\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?::\d{1,5})?(?:\/[^\s\u4e00-\u9fa5<>"'`\\|]*)?/gi

// 结尾可能是中文标点或英文标点，需要剥离
const TRAILING = /[.,;:!?，。；：！？、）)】\]》>}"'`]+$/

export interface LinkHit {
  // 命中的原始文本
  raw: string
  // 归一化后的域名（小写、无端口）
  host: string
  // 去协议后的主机+路径（用于完整链接匹配）
  path: string
  // 完整链接（补全协议）
  url: string
}

function stripTrailing(s: string): string {
  return s.replace(TRAILING, '')
}

// 解析一个链接文本为结构化信息；无法解析域名时返回 null
export function parseLink(input: string): LinkHit | null {
  const raw = stripTrailing(String(input || '').trim())
  if (!raw) return null
  let rest = raw
  let scheme = ''
  const schemeMatch = rest.match(/^([a-z][a-z0-9+.-]*):\/\//i)
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase()
    rest = rest.slice(schemeMatch[0].length)
  }
  // 去掉 userinfo 与查询串后再解析 host
  rest = rest.replace(/^[^/@]*@/, '')
  const hostMatch = rest.match(/^([^/?#]+)/)
  if (!hostMatch) return null
  const authority = hostMatch[1]
  const tail = rest.slice(authority.length)
  const host = authority.replace(/:\d{1,5}$/, '').toLowerCase()
  if (!host) return null
  // host 合法性：必须含「.」或是 IPv4，或为 localhost
  const isIp = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)
  if (!isIp && host !== 'localhost' && !host.includes('.')) return null
  const path = (host + tail).toLowerCase()
  return {
    raw,
    host,
    path,
    url: `${scheme || 'http'}://${path}`,
  }
}

// 从一段文本中提取全部链接
//
// ignoreCdnHosts：跳过 QQ 自家的图片 / 表情 / 文件 CDN 域名。
// 这些地址只应出现在「图片消息」里，由禁发图片功能处理；
// 万一它们以文本形式残留在消息中，也不应被当成「用户发送的链接」而处罚。
// 注意：只列图片/媒体类 CDN，不含 qq.com 主域 —— 正常分享腾讯网页链接不应被放过。
const QQ_CDN_HOSTS = [
  'qpic.cn', 'gtimg.cn', 'qlogo.cn',
  'qqusercontent.com', 'multimedia.nt.qq.com.cn',
]

function isQqCdnHost(host: string): boolean {
  const h = String(host || '').toLowerCase()
  return QQ_CDN_HOSTS.some((d) => h === d || h.endsWith('.' + d))
}

export function extractLinks(text: string, detectBare = true, ignoreCdnHosts = true): LinkHit[] {
  const src = String(text || '')
  if (!src) return []
  const found = new Map<string, LinkHit>()

  const collect = (raw: string) => {
    const hit = parseLink(raw)
    if (!hit || found.has(hit.url)) return
    if (ignoreCdnHosts && isQqCdnHost(hit.host)) return
    found.set(hit.url, hit)
  }

  for (const m of src.match(PATTERN_PROTOCOL) || []) collect(m)
  for (const m of src.match(PATTERN_WWW) || []) collect(m)
  for (const m of src.match(PATTERN_IP) || []) collect(m)

  if (detectBare) {
    for (const m of src.match(PATTERN_BARE) || []) {
      // 仅当顶级域名在常见列表中才认为是链接，避免误伤「文件.txt」「1.2.3」等
      const hit = parseLink(m)
      if (!hit) continue
      const tld = hit.host.split('.').pop() || ''
      if (!COMMON_TLDS.has(tld)) continue
      collect(m)
    }
  }

  return [...found.values()]
}

// 归一化白名单条目
export function normalizeWhitelistEntry(entry: string): string {
  let s = String(entry || '').trim().toLowerCase()
  if (!s) return ''
  // 去掉协议
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  // 去掉末尾通配路径
  s = s.replace(/\/+$/, '')
  return s
}

// 判断某个链接是否命中白名单
// 匹配规则（任一命中即放行）：
//   泛域名 *.example.com → 任意子域名
//   域名   example.com   → example.com、www.example.com 及任意子域名
//   完整链接 https://example.com/ok → 同域名规则，且路径需等于该路径或位于其子路径下
export function isWhitelisted(hit: LinkHit, whitelist: string[]): boolean {
  if (!whitelist || whitelist.length === 0) return false
  const host = hit.host
  // hit.path 形如「example.com/ok?a=1」，这里只取路径部分（去掉查询串与锚点）
  const pathname = (hit.path.startsWith(host) ? hit.path.slice(host.length) : hit.path)
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
  for (const raw of whitelist) {
    const entry = normalizeWhitelistEntry(raw)
    if (!entry) continue

    // 泛域名：*.example.com（不含 apex 本身）
    if (entry.startsWith('*.')) {
      const base = entry.slice(2)
      if (!base) continue
      if (host.endsWith('.' + base)) return true
      continue
    }

    // 完整链接（含路径）：域名匹配 + 路径前缀匹配
    const slash = entry.indexOf('/')
    if (slash >= 0) {
      const entryHost = entry.slice(0, slash)
      const entryPath = entry.slice(slash).replace(/\/+$/, '')
      if (!hostMatches(host, entryHost)) continue
      if (pathname === entryPath || pathname.startsWith(entryPath + '/')) return true
      continue
    }

    // 纯域名：hostMatches 已覆盖精确、www. 与子域名
    if (hostMatches(host, entry)) return true
  }
  return false
}

// 域名匹配：entry 为白名单域名（已小写、无协议）
function hostMatches(host: string, entry: string): boolean {
  return host === entry || host === 'www.' + entry || host.endsWith('.' + entry)
}

// 过滤出「未命中白名单」的链接
export function filterBlockedLinks(links: LinkHit[], whitelist: string[]): LinkHit[] {
  return links.filter((l) => !isWhitelisted(l, whitelist))
}
