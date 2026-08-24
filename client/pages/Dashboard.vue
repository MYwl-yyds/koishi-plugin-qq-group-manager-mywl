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
            <div v-for="(d, i) in data.stats.logTrend" :key="i" class="qg-bar-row">
              <span class="date">{{ d.date.slice(5) }}</span>
              <span class="qg-bar op" :style="{ width: barWidth(d.operation, maxCount) }" :title="'操作 ' + d.operation"></span>
              <span class="qg-bar au" :style="{ width: barWidth(d.audit, maxCount) }" :title="'审核 ' + d.audit"></span>
              <span class="qg-bar vi" :style="{ width: barWidth(d.violation, maxCount) }" :title="'违规 ' + d.violation"></span>
              <span class="qg-bar bl" :style="{ width: barWidth(d.blacklist, maxCount) }" :title="'黑名单 ' + d.blacklist"></span>
            </div>
            <div class="qg-legend">
              <span><i class="qg-dot op"></i>操作</span>
              <span><i class="qg-dot au"></i>审核</span>
              <span><i class="qg-dot vi"></i>违规</span>
              <span><i class="qg-dot bl"></i>黑名单</span>
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

const maxCount = computed(() => {
  const d = data.value?.stats?.logTrend || []
  return Math.max(1, ...d.map((x: any) => Math.max(x.operation, x.audit, x.violation, x.blacklist)))
})
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