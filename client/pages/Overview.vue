<template>
  <div>
    <Skeleton v-if="!data && loading" :rows="6" />

    <template v-else-if="data">
      <div class="qg-stats">
        <div class="qg-stat c1">
          <div class="num">{{ data.stats.configuredGroups }}</div>
          <div class="label">已配置群聊</div>
          <span class="icon">💬</span>
        </div>
        <div class="qg-stat c4">
          <div class="num">{{ data.stats.pendingReviews }}</div>
          <div class="label">待审核申请</div>
          <span class="icon">⏳</span>
        </div>
        <div class="qg-stat c3">
          <div class="num">{{ data.stats.todayViolation }}</div>
          <div class="label">今日违规处理</div>
          <span class="icon">🚫</span>
        </div>
        <div class="qg-stat c5">
          <div class="num">{{ data.stats.blacklistTotal }}</div>
          <div class="label">黑名单</div>
          <span class="icon">⛔</span>
        </div>
        <div class="qg-stat c2">
          <div class="num">{{ data.stats.whitelistTotal }}</div>
          <div class="label">白名单</div>
          <span class="icon">✅</span>
        </div>
        <div class="qg-stat c6">
          <div class="num">{{ data.stats.bannedWords }}</div>
          <div class="label">违禁词</div>
          <span class="icon">📝</span>
        </div>
      </div>

      <!-- 群员检查状态 -->
      <Section title="群员检查" :sub="memberCheckSummary" icon="🔎" :open="true">
        <template #actions>
          <button class="qg-btn sm" :disabled="scanning" @click="scanAll">
            {{ scanning ? '检查中…' : '立即全量检查' }}
          </button>
        </template>
        <div class="qg-grid three">
          <div class="qg-card flat" :class="{ 'qg-off': !data.memberCheck.kinds.qqLevel }">
            <h4>QQ 账号等级</h4>
            <span class="qg-tag" :class="data.memberCheck.kinds.qqLevel ? 'ok' : 'neutral'">
              {{ data.memberCheck.kinds.qqLevel ? '已启用' : '未启用' }}
            </span>
          </div>
          <div class="qg-card flat" :class="{ 'qg-off': !data.memberCheck.kinds.card }">
            <h4>群名片</h4>
            <span class="qg-tag" :class="data.memberCheck.kinds.card ? 'ok' : 'neutral'">
              {{ data.memberCheck.kinds.card ? '已启用' : '未启用' }}
            </span>
          </div>
          <div class="qg-card flat" :class="{ 'qg-off': !data.memberCheck.kinds.groupLevel }">
            <h4>群等级</h4>
            <span class="qg-tag" :class="data.memberCheck.kinds.groupLevel ? 'ok' : 'neutral'">
              {{ data.memberCheck.kinds.groupLevel ? '已启用' : '未启用' }}
            </span>
          </div>
        </div>
        <p class="qg-hint tight">
          已启用群员检查的群：{{ data.memberCheck.groupCount ?? 0 }} 个 ·
          上次执行：{{ data.memberCheck.lastRunAt ? relativeTime(data.memberCheck.lastRunAt) : '尚未执行' }}。
          群员检查为群级配置，各群独立设置间隔与规则，详细配置请到「群员检查」页面。
        </p>
        <div v-if="data.memberCheck.lastResults?.length" class="qg-table-wrap" style="margin-top:10px">
          <table class="qg-table">
            <thead><tr><th>群号</th><th>扫描</th><th>命中</th><th>禁言</th><th>踢出</th><th>耗时</th></tr></thead>
            <tbody>
              <tr v-for="r in data.memberCheck.lastResults" :key="r.groupId">
                <td class="num">{{ r.groupId }}</td>
                <td class="num">{{ r.scanned }}</td>
                <td class="num">{{ r.hits }}</td>
                <td class="num">{{ r.actions.mute }}</td>
                <td class="num">{{ r.actions.kick }}</td>
                <td class="num">{{ (r.durationMs / 1000).toFixed(1) }}s</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <div class="qg-grid two">
        <Section title="日志趋势" :sub="`近 ${trendDays} 天各类事件数量`" icon="📈" :open="true">
          <template #actions>
            <select class="qg-select" style="width:auto" v-model.number="trendDays" @change="refresh()">
              <option :value="7">近 7 天</option>
              <option :value="14">近 14 天</option>
              <option :value="30">近 30 天</option>
            </select>
          </template>
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
            <text
              v-for="(d, i) in trend"
              :key="'x' + i"
              class="qg-trend-label"
              :x="xAt(i)"
              :y="chartH - 6"
              text-anchor="middle"
            >{{ shortLabel(d.date, i) }}</text>
          </svg>
          <div class="qg-legend">
            <span v-for="s in trendSeries" :key="s.key"><i class="qg-dot" :style="{ background: s.color }"></i>{{ s.label }}（{{ data.typeTotals[s.key] ?? 0 }}）</span>
          </div>
        </Section>

        <Section title="违规类型分布" icon="🥧" :open="true">
          <EmptyState v-if="violationEntries.length === 0" text="近期暂无违规记录" icon="🕊️" sm />
          <div v-for="(e, i) in violationEntries" :key="i" class="qg-dist-row">
            <span class="name">{{ e[0] }}</span>
            <span class="qg-bar vi" :style="{ width: barWidth(e[1], violationMax), flex: '0 0 auto' }"></span>
            <span class="cnt">{{ e[1] }}</span>
          </div>
          <div class="qg-sep"></div>
          <h4>今日概览</h4>
          <div class="qg-grid two">
            <div><span class="qg-muted">操作</span><div style="font-size:20px;font-weight:800">{{ data.stats.todayOperation }}</div></div>
            <div><span class="qg-muted">违规</span><div style="font-size:20px;font-weight:800">{{ data.stats.todayViolation }}</div></div>
          </div>
        </Section>
      </div>

      <Section title="待审核入群申请" :sub="`${data.pendingReviews.length} 条待处理`" icon="📥" :open="data.pendingReviews.length > 0">
        <EmptyState v-if="data.pendingReviews.length === 0" text="暂无待审核申请" icon="🕊️" sm />
        <div v-else class="qg-table-wrap">
          <table class="qg-table">
            <thead><tr><th>申请人</th><th>群号</th><th>申请内容</th><th>时间</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="r in data.pendingReviews" :key="r.flag">
                <td class="nowrap">{{ r.nickname || r.userId }}<br><span class="qg-muted">{{ r.userId }}</span></td>
                <td class="num">{{ r.groupId }}</td>
                <td>{{ r.comment || '无' }}</td>
                <td class="nowrap qg-muted">{{ relativeTime(r.createdAt) }}</td>
                <td>
                  <div class="actions">
                    <button class="qg-btn sm primary" :disabled="busyFlag === r.flag" @click="review(r, true)">通过</button>
                    <button class="qg-btn sm danger" :disabled="busyFlag === r.flag" @click="review(r, false)">拒绝</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="最近日志" icon="📜" :open="true">
        <template #actions>
          <button class="qg-btn sm" @click="goLogs">查看全部</button>
        </template>
        <EmptyState v-if="!data.recentLogs?.length" text="暂无日志" icon="📜" sm />
        <div v-else class="qg-table-wrap">
          <table class="qg-table">
            <thead><tr><th>类型</th><th>动作</th><th>操作者</th><th>目标</th><th>时间</th></tr></thead>
            <tbody>
              <tr v-for="(l, i) in data.recentLogs" :key="i">
                <td><span class="qg-tag" :class="l.type">{{ typeName(l.type) }}</span></td>
                <td>{{ l.action }}</td>
                <td class="nowrap">{{ l.operatorName || l.operatorId || '-' }}</td>
                <td class="nowrap">{{ targetOf(l) }}</td>
                <td class="nowrap qg-muted">{{ relativeTime(l.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>
    </template>

    <EmptyState v-else :text="error || '暂无数据'" :sub="error ? '请确认已启用 console 插件并刷新页面' : ''" icon="⚠️" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useScope, mutate, relativeTime } from '../useData'
import { gotoPage } from '../nav'
import { toast } from '../toast'
import Section from '../components/Section.vue'
import EmptyState from '../components/EmptyState.vue'
import Skeleton from '../components/Skeleton.vue'

const trendDays = ref(7)
const busyFlag = ref('')
const scanning = ref(false)

const { data, loading, error, refresh } = useScope<any>('overview', {
  params: () => ({ days: trendDays.value }),
  autoRefreshMs: 30000,
})

const memberCheckSummary = computed(() => {
  const mc = data.value?.memberCheck
  if (!mc) return ''
  if (!mc.enabled) return '没有任何群启用群员检查'
  const on = [mc.kinds.qqLevel && 'QQ等级', mc.kinds.card && '群名片', mc.kinds.groupLevel && '群等级'].filter(Boolean)
  const base = `${mc.groupCount ?? 0} 个群已启用`
  return on.length ? `${base}（${on.join(' / ')}）` : `${base}（未选择任何检测项）`
})

// ---------- 趋势图（Catmull-Rom 平滑曲线） ----------
const chartW = 620
const chartH = 200
const chartPL = 36
const chartPR = 14
const chartPT = 14
const chartPB = 24
const trendSeries = [
  { key: 'operation', label: '操作', color: 'var(--qg-primary)' },
  { key: 'audit', label: '审核', color: '#f59e0b' },
  { key: 'violation', label: '违规', color: '#ef4444' },
  { key: 'blacklist', label: '黑名单', color: '#8b5cf6' },
]
const trend = computed(() => (data.value?.logTrend || []) as any[])
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
// 点太多时只标注首尾与中间，避免重叠
function shortLabel(date: string, i: number): string {
  const n = trend.value.length
  if (n > 10 && i !== 0 && i !== n - 1 && i % Math.ceil(n / 6) !== 0) return ''
  return String(date).slice(5)
}

const violationEntries = computed(() => {
  const d = data.value?.violationDist || {}
  return Object.entries(d).sort((a: any, b: any) => b[1] - a[1])
})
const violationMax = computed(() => Math.max(1, ...violationEntries.value.map((e) => e[1] as number)))
function barWidth(v: number, m: number) {
  return Math.max(2, Math.round((v / m) * 100)) + '%'
}

function typeName(t: string) {
  return { operation: '操作', audit: '审核', violation: '违规', blacklist: '黑名单' }[t] || t
}
function targetOf(l: any) {
  if (l.groupId && l.targetId) return `${l.groupId} · ${l.targetId}`
  return l.targetId || l.groupId || '-'
}

async function review(r: any, approve: boolean) {
  busyFlag.value = r.flag
  const res = await mutate(approve ? 'join.approve' : 'join.reject', { flag: r.flag, reason: approve ? '由 WebUI 审核通过' : '由 WebUI 审核拒绝' })
  busyFlag.value = ''
  if (res?.ok) {
    toast.success(approve ? '已通过该入群申请' : '已拒绝该入群申请')
    refresh(undefined, true)
  } else {
    toast.error(res?.error || '操作失败')
  }
}

async function scanAll() {
  scanning.value = true
  const res = await mutate('memberCheck.scanAll', {})
  scanning.value = false
  if (res?.ok) {
    toast.success('群员检查已完成')
    refresh(undefined, true)
  } else {
    toast.error(res?.error || '检查失败')
  }
}

function goLogs() {
  gotoPage('logs')
}
</script>

<style scoped>
.qg-card.qg-off { opacity: .6; }
</style>
