<template>
  <div>
      <div class="qg-heading">
        <h2>数据看板</h2>
        <button class="qg-btn sm" @click="refresh">刷新</button>
      </div>

      <template v-if="data">
        <div class="qg-stats">
          <div class="qg-stat c1"><div class="num">{{ data.stats.configuredGroups }}</div><div class="label">已配置群数</div></div>
          <div class="qg-stat c2"><div class="num">{{ data.stats.permissionGroups }}</div><div class="label">权限组数</div></div>
          <div class="qg-stat c3"><div class="num">{{ data.stats.bannedWords }}</div><div class="label">违禁词数</div></div>
          <div class="qg-stat c4"><div class="num">{{ data.stats.pendingReviews }}</div><div class="label">待审核申请</div></div>
          <div class="qg-stat c5"><div class="num">{{ data.stats.blacklistTotal }}</div><div class="label">黑名单数量</div></div>
        </div>

        <div class="qg-grid two">
          <div class="qg-card">
            <h3>操作日志趋势（近 7 天）</h3>
            <svg class="qg-trend" :viewBox="`0 0 ${chartW} ${chartH}`" preserveAspectRatio="xMidYMid meet">
              <line v-for="(g, i) in gridLines" :key="'g' + i" class="qg-trend-grid" :x1="chartPL" :x2="chartW - chartPR" :y1="g.y" :y2="g.y" />
              <text v-for="(g, i) in gridLines" :key="'gt' + i" class="qg-trend-label" :x="chartPL - 6" :y="g.y + 3" text-anchor="end">{{ g.label }}</text>
              <path
                v-for="s in trendSeries"
                :key="s.key"
                :d="seriesPath(s.key)"
                fill="none"
                :style="{ stroke: s.color }"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <g v-for="(d, i) in trend" :key="'p' + i">
                <circle
                  v-for="s in trendSeries"
                  :key="s.key"
                  :cx="xAt(i)"
                  :cy="yAt(d[s.key])"
                  r="2.6"
                  :style="{ fill: s.color }"
                  stroke="#fff"
                  stroke-width="1"
                />
              </g>
              <text v-for="(d, i) in trend" :key="'x' + i" class="qg-trend-label" :x="xAt(i)" :y="chartH - 8" text-anchor="middle">{{ d.date.slice(5) }}</text>
            </svg>
            <div class="qg-legend">
              <span v-for="s in trendSeries" :key="s.key"><i class="qg-dot" :style="{ background: s.color }"></i>{{ s.label }}</span>
            </div>
          </div>

          <div class="qg-card">
            <h3>违规类型分布</h3>
            <div v-if="violationEntries.length === 0" class="qg-muted">暂无违规记录</div>
            <div v-for="(e, i) in violationEntries" :key="i" class="qg-dist-row">
              <span class="name">{{ e[0] }}</span>
              <span class="qg-bar vi" :style="{ width: barWidth(e[1], violationMax), flex: 1 }"></span>
              <span class="cnt">{{ e[1] }}</span>
            </div>
          </div>
        </div>

        <div class="qg-card">
          <h3>待审核入群申请</h3>
          <div v-if="data.pendingReviews.length === 0" class="qg-muted">暂无待审核申请</div>
          <table v-else class="qg-table">
            <thead><tr><th>申请人</th><th>群号</th><th>内容</th><th>时间</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="r in data.pendingReviews" :key="r.flag">
                <td>{{ r.userId }}</td>
                <td>{{ r.groupId }}</td>
                <td>{{ r.comment || '无' }}</td>
                <td>{{ formatTime(r.createdAt) }}</td>
                <td>
                  <button class="qg-btn sm primary" @click="approve(r)">通过</button>
                  <button class="qg-btn sm danger" @click="reject(r)">拒绝</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="qg-card">
          <div class="qg-heading">
            <h3>最近日志</h3>
            <button class="qg-btn sm danger" @click="clearLogs">清除全部日志</button>
          </div>
          <div style="max-height:360px;overflow-y:auto">
            <table class="qg-table">
              <thead><tr><th>类型</th><th>动作</th><th>操作者</th><th>目标</th><th>详情</th><th>时间</th></tr></thead>
              <tbody>
                <tr v-for="(l, i) in pagedLogs" :key="i">
                  <td><span class="qg-tag" :class="l.type">{{ typeName(l.type) }}</span></td>
                  <td>{{ l.action }}</td>
                  <td>{{ l.operatorName || l.operatorId || '-' }}</td>
                  <td>{{ formatTarget(l) }}</td>
                  <td>{{ formatDetail(l) }}</td>
                  <td>{{ formatTime(l.createdAt) }}</td>
                </tr>
                <tr v-if="pagedLogs.length === 0"><td colspan="6" class="qg-muted">暂无日志</td></tr>
              </tbody>
            </table>
          </div>
          <div v-if="pageCount > 1" style="display:flex;align-items:center;gap:10px;margin-top:10px;justify-content:space-between">
            <button class="qg-btn sm" :disabled="page <= 1" @click="page--">上一页</button>
            <span>第 {{ page }} / {{ pageCount }} 页 · 共 {{ (data.logs || []).length }} 条 · 每页 {{ pageSize }} 条</span>
            <button class="qg-btn sm" :disabled="page >= pageCount" @click="page++">下一页</button>
          </div>
        </div>
      </template>
      <div v-else class="qg-muted">加载中…</div>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useGmData, formatTime } from '../useData'
import { toast } from '../toast'

const { data, refresh, mutate } = useGmData()
onMounted(refresh)

// 定时自动刷新，保证看板数据实时
let timer: any = null
onMounted(() => { timer = setInterval(refresh, 30000) })
onUnmounted(() => { if (timer) clearInterval(timer) })

// 最近日志分页
const page = ref(1)
const pageSize = 20
const pagedLogs = computed(() => {
  const logs = data.value?.logs || []
  return logs.slice((page.value - 1) * pageSize, page.value * pageSize)
})
const pageCount = computed(() => Math.max(1, Math.ceil((data.value?.logs || []).length / pageSize)))

async function clearLogs() {
  if (!confirm('确认清除全部日志？该操作不可恢复。')) return
  const res = await mutate('log.clear', {})
  if (res?.ok) { toast.success('日志已清除'); page.value = 1 }
  else toast.error(res?.error || '清除失败')
}

// 操作日志趋势曲线图（近 7 天）
const chartW = 560
const chartH = 190
const chartPL = 38
const chartPR = 14
const chartPT = 14
const chartPB = 26
const trendSeries = [
  { key: 'operation', label: '操作', color: 'var(--qg-primary)' },
  { key: 'audit', label: '审核', color: '#f59e0b' },
  { key: 'violation', label: '违规', color: '#ef4444' },
  { key: 'blacklist', label: '黑名单', color: '#8b5cf6' },
]
const trend = computed(() => (data.value?.stats?.logTrend || []) as any[])
const trendMax = computed(() => {
  if (!trend.value.length) return 1
  return Math.max(1, ...trend.value.map((x: any) => Math.max(x.operation, x.audit, x.violation, x.blacklist)))
})
const innerW = computed(() => chartW - chartPL - chartPR)
const innerH = computed(() => chartH - chartPT - chartPB)
function xAt(i: number) {
  const n = trend.value.length
  if (n <= 1) return chartPL + innerW.value / 2
  return chartPL + (innerW.value * i) / (n - 1)
}
function yAt(v: number) {
  return chartPT + innerH.value - (v / trendMax.value) * innerH.value
}
const gridLines = computed(() => {
  const lines: { y: number, label: string }[] = []
  for (let i = 0; i <= 3; i++) {
    const t = i / 3
    lines.push({ y: chartPT + Math.round(innerH.value * t), label: String(Math.round(trendMax.value * (1 - t))) })
  }
  return lines
})
// Catmull-Rom 平滑曲线 -> 三次贝塞尔路径
function smoothPath(pts: { x: number, y: number }[]): string {
  if (!pts.length) return ''
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return d
}
function seriesPath(key: string): string {
  return smoothPath(trend.value.map((x: any, i: number) => ({ x: xAt(i), y: yAt(x[key]) })))
}

const violationEntries = computed(() => {
  const d = data.value?.stats?.violationDist || {}
  return Object.entries(d).sort((a: any, b: any) => b[1] - a[1])
})
const violationMax = computed(() => Math.max(1, ...violationEntries.value.map((e) => e[1] as number)))

function barWidth(v: number, m: number) {
  return Math.max(2, Math.round((v / m) * 100)) + '%'
}
function typeName(t: string) {
  return { operation: '操作', audit: '审核', violation: '违规', blacklist: '黑名单' }[t] || t
}
function preview(d: string) {
  if (!d) return '-'
  try {
    const o = JSON.parse(d)
    return typeof o === 'object' ? (o.reason || o.word || o.type || d) : d
  } catch { return d.slice(0, 40) }
}
function formatTarget(l: any) {
  const a = l.action || ''
  const g = l.groupId || ''
  const t = l.targetId || ''
  const d = l.detail || ''
  if (a.includes('全局设置')) return '全局设置'
  if (a.includes('群配置')) return g ? `${g} 群配置` : '群配置'
  if (a.includes('权限组')) return d ? `权限组 ${d}` : '权限组'
  if (g && t) return `${g} 群 · ${t}`
  if (t) return t
  if (g) return `${g} 群`
  return '-'
}
function formatDetail(l: any) {
  const a = l.action || ''
  const t = l.targetId || ''
  const d = l.detail || ''
  const r = l.result || ''

  // 配置类 WebUI 操作
  if (a.includes('保存') || a.includes('修改')) return '保存配置'
  if (a.includes('重置')) return '重置配置'
  if (a.includes('创建')) return '创建权限组'
  if (a.includes('删除')) return '删除权限组'
  if (a.includes('默认')) return '设为默认权限组'
  if (a.includes('添加成员')) return '添加成员' + (t ? ` ${t}` : '')
  if (a.includes('移除成员')) return '移除成员' + (t ? ` ${t}` : '')
  if (a.includes('导入')) return '导入成员' + (r ? `（${r}）` : '')
  if (a.includes('添加白名单')) return '添加白名单'
  if (a.includes('移除白名单')) return '移除白名单'
  if (a.includes('转移')) return '转移至全局'
  if (a.includes('添加黑名单')) return '添加黑名单'
  if (a.includes('移除黑名单')) return '移除黑名单'
  if (a.includes('添加违禁词')) return '添加违禁词' + (t ? `「${t}」` : '')
  if (a.includes('移除违禁词')) return '移除违禁词' + (t ? `「${t}」` : '')

  // 命令类操作
  if (a === '禁言') return '禁言 ' + (d || '')
  if (a === '解除禁言') return '解除禁言'
  if (a === '全体禁言') return '全体禁言'
  if (a === '全体解禁') return '全体解禁'
  if (a === '踢出') return '踢出'
  if (a === '退群') return '退群'
  if (a === '设置头衔') return '设置头衔' + (d ? `「${d}」` : '')
  if (a === '取消头衔') return '取消头衔'
  if (a === '设置精华') return '设置精华'
  if (a === '取消精华') return '取消精华'

  // 审核 / 违规 / 拉黑等：解析详情
  return preview(d)
}
async function approve(r: any) {
  const res = await mutate('join.approve', { flag: r.flag, reason: '由 WebUI 审核通过' })
  res?.ok ? toast.success('已通过该入群申请') : toast.error(res?.error || '操作失败')
}
async function reject(r: any) {
  const res = await mutate('join.reject', { flag: r.flag, reason: '由 WebUI 审核拒绝' })
  res?.ok ? toast.success('已拒绝该入群申请') : toast.error(res?.error || '操作失败')
}
</script>