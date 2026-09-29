<template>
  <div>
    <Section title="日志检索" icon="🔎" :open="true">
      <div class="qg-add" style="margin-top:0;flex-wrap:wrap">
        <select class="qg-select" style="max-width:150px" v-model="filters.type" @change="reload">
          <option value="">全部类型</option>
          <option v-for="t in LOG_TYPES" :key="t.value" :value="t.value">{{ t.label }}（{{ data?.counts?.[t.value] ?? 0 }}）</option>
        </select>
        <select class="qg-select" style="max-width:150px" v-model.number="filters.sinceDays" @change="reload">
          <option :value="0">全部时间</option>
          <option :value="1">今天</option>
          <option :value="7">近 7 天</option>
          <option :value="30">近 30 天</option>
        </select>
        <input class="qg-input" style="flex:1;min-width:170px" v-model="filters.keyword" placeholder="搜索动作 / 用户 / 群号 / 详情" @keyup.enter="reload" />
        <button class="qg-btn primary" @click="reload">查询</button>
        <button class="qg-btn" @click="reset">重置</button>
        <button class="qg-btn danger" @click="clearAll">清空全部日志</button>
      </div>
      <p class="qg-hint tight">
        共 {{ data?.totalAll ?? 0 }} 条日志，服务端分页返回，避免一次加载过多数据。
      </p>
    </Section>

    <Section :title="`日志明细（${data?.total ?? 0} 条）`" icon="📜" :open="true">
      <Skeleton v-if="!data && loading" :rows="6" />
      <EmptyState v-else-if="!data?.rows?.length" text="没有匹配的日志" sub="调整筛选条件再试一次" icon="📜" />
      <template v-else>
        <div class="qg-table-wrap">
          <table class="qg-table">
            <thead>
              <tr><th>类型</th><th>动作</th><th>操作者</th><th>群号</th><th>目标</th><th>详情</th><th>结果</th><th>时间</th></tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in data.rows" :key="i">
                <td><span class="qg-tag" :class="l.type">{{ typeName(l.type) }}</span></td>
                <td class="nowrap">{{ l.action }}</td>
                <td class="nowrap">{{ l.operatorName || l.operatorId || '-' }}</td>
                <td class="num">{{ l.groupId || '-' }}</td>
                <td class="num">{{ l.targetId || '-' }}</td>
                <td class="qg-detail">{{ formatDetail(l) }}</td>
                <td class="nowrap">{{ l.result || '-' }}</td>
                <td class="nowrap qg-muted">{{ formatTime(l.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="qg-pager">
          <div class="qg-pager-info">
            第 {{ data.page }} / {{ pageCount }} 页 · 共 {{ data.total }} 条 · 每页 {{ data.pageSize }} 条
          </div>
          <div class="qg-pager-btns">
            <select class="qg-select" style="width:auto" v-model.number="pageSize" @change="reload">
              <option :value="20">20 条/页</option>
              <option :value="50">50 条/页</option>
              <option :value="100">100 条/页</option>
            </select>
            <button class="qg-btn sm" :disabled="data.page <= 1" @click="go(1)">首页</button>
            <button class="qg-btn sm" :disabled="data.page <= 1" @click="go(data.page - 1)">上一页</button>
            <button class="qg-btn sm" :disabled="data.page >= pageCount" @click="go(data.page + 1)">下一页</button>
            <button class="qg-btn sm" :disabled="data.page >= pageCount" @click="go(pageCount)">末页</button>
          </div>
        </div>
      </template>
    </Section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useScope, mutate, invalidateScope, formatTime } from '../useData'
import { toast } from '../toast'
import Section from '../components/Section.vue'
import EmptyState from '../components/EmptyState.vue'
import Skeleton from '../components/Skeleton.vue'

const LOG_TYPES = [
  { value: 'operation', label: '操作' },
  { value: 'audit', label: '审核' },
  { value: 'violation', label: '违规' },
  { value: 'blacklist', label: '黑名单' },
]

const pageSize = ref(20)
const filters = reactive<any>({ type: '', keyword: '', sinceDays: 0, page: 1 })

const { data, loading, refresh } = useScope<any>('logs', {
  params: () => ({
    type: filters.type || undefined,
    keyword: filters.keyword || undefined,
    sinceDays: filters.sinceDays || undefined,
    page: filters.page,
    pageSize: pageSize.value,
  }),
})

const pageCount = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / (data.value?.pageSize || 20))))

function reload() {
  filters.page = 1
  invalidateScope('logs')
  refresh(undefined, true)
}

function go(p: number) {
  filters.page = Math.min(Math.max(1, p), pageCount.value)
  refresh(undefined, true)
}

function reset() {
  filters.type = ''
  filters.keyword = ''
  filters.sinceDays = 0
  pageSize.value = 20
  reload()
}

async function clearAll() {
  if (!confirm('确认清空全部日志？该操作不可恢复。')) return
  const res = await mutate('log.clear', {})
  if (res?.ok) {
    toast.success('日志已清空')
    invalidateScope('logs')
    reload()
  } else {
    toast.error(res?.error || '清空失败')
  }
}

function typeName(t: string) {
  return { operation: '操作', audit: '审核', violation: '违规', blacklist: '黑名单' }[t] || t
}

// 详情优先展示结构化字段（reason / word / type / detail）
function formatDetail(l: any) {
  const d = l.detail || ''
  if (!d) return '-'
  try {
    const o = JSON.parse(d)
    if (o && typeof o === 'object') {
      const parts: string[] = []
      if (o.kind) parts.push(`检测项 ${o.kind}`)
      if (o.word) parts.push(`命中「${o.word}」`)
      if (o.level) parts.push(`等级 ${o.level}`)
      if (o.type && o.type !== '违禁词') parts.push(`类型 ${o.type}`)
      if (o.reason) parts.push(o.reason)
      if (o.detail) parts.push(o.detail)
      if (o.host) parts.push(o.host)
      if (parts.length) return parts.join(' · ')
      return d.slice(0, 90)
    }
  } catch { /* 非 JSON，直接展示 */ }
  return d.length > 90 ? d.slice(0, 90) + '…' : d
}
</script>

<style scoped>
.qg-detail { max-width: 320px; word-break: break-word; font-size: 12.5px; }
</style>
