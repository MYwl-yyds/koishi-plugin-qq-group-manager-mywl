<template>
  <div>
    <Skeleton v-if="!data && loading" :rows="5" />

    <template v-else-if="data">
      <div class="qg-layout">
        <div class="qg-side">
          <h3>名单范围</h3>
          <input class="qg-input qg-side-search" v-model="scopeKeyword" placeholder="搜索群号" />
          <div class="qg-side-list">
            <div class="qg-item" :class="{ active: currentScope === '' }" @click="select('')">
              <span class="qg-item-main">全局黑名单</span>
              <span class="qg-tag neutral">{{ entriesOf('').length }}</span>
            </div>
            <div class="qg-muted" style="padding:6px 4px">分群黑名单（各群默认使用本群独立名单）</div>
            <div v-for="gid in filteredGroups" :key="gid" class="qg-group-row">
              <div class="qg-item" :class="{ active: currentScope === gid }" @click="select(gid)">
                <span class="qg-item-main">群 {{ gid }}</span>
                <span class="qg-tag neutral">{{ entriesOf(gid).length }}</span>
              </div>
              <label class="qg-apply" title="开启后本群直接使用全局黑名单">
                <input type="checkbox" :checked="applyGlobal(gid)" @change="toggleApply(gid, $event)" /> 应用全局黑名单
              </label>
            </div>
          </div>
        </div>

        <Section :title="currentScope === '' ? '全局黑名单' : `群 ${currentScope} 黑名单`" :sub="`${entries.length} 条`" icon="⛔" :open="true">
          <template #actions>
            <button v-if="currentScope && !isApplyingGlobal" class="qg-btn sm" @click="moveAllToGlobal">全部转移全局</button>
          </template>

          <div v-if="currentScope && isApplyingGlobal" class="qg-hint">
            该群已开启「应用全局黑名单」，将直接使用全局黑名单，本群独立名单未启用。
            如需启用本群独立名单，请关闭左侧该群的「应用全局黑名单」开关。
          </div>

          <template v-else>
            <div class="qg-add" style="margin-top:0">
              <input class="qg-input" v-model="input" placeholder="QQ 号，多个用逗号 / 空格 / 换行分隔" @keyup.enter="add" />
              <button class="qg-btn primary" @click="add">批量添加</button>
            </div>

            <div class="qg-add" style="margin-top:10px">
              <input class="qg-input" v-model="keyword" placeholder="在名单中搜索 QQ 号" />
            </div>

            <EmptyState v-if="entries.length === 0" text="暂无黑名单记录" icon="⛔" sm />
            <div v-else class="qg-table-wrap" style="margin-top:10px">
              <table class="qg-table">
                <thead><tr><th>QQ</th><th>来源</th><th>加入时间</th><th>操作</th></tr></thead>
                <tbody>
                  <tr v-for="b in entries" :key="b.id">
                    <td class="num">{{ b.userId }}</td>
                    <td><span class="qg-tag neutral">{{ sourceName(b.source) }}</span></td>
                    <td class="nowrap qg-muted">{{ formatTime(b.createdAt) }}</td>
                    <td>
                      <div class="actions">
                        <button v-if="currentScope" class="qg-btn sm" @click="moveToGlobal(b.userId)">转移全局</button>
                        <button class="qg-btn sm danger" @click="remove(b.userId)">移除</button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-if="keyword && entries.length === 0" class="qg-muted">没有匹配「{{ keyword }}」的记录。</p>
          </template>
        </Section>
      </div>
    </template>

    <EmptyState v-else :text="error || '暂无数据'" icon="⚠️" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useScope, mutate, invalidateScope, applyMutated, formatTime } from '../useData'
import { takePageParams } from '../nav'
import { toast } from '../toast'
import Section from '../components/Section.vue'
import EmptyState from '../components/EmptyState.vue'
import Skeleton from '../components/Skeleton.vue'

const currentScope = ref('')
const input = ref('')
const keyword = ref('')
const scopeKeyword = ref('')

const { data, loading, error, refresh } = useScope<any>('lists')

const filteredGroups = computed(() => {
  const list = data.value?.groupIds || []
  const kw = scopeKeyword.value.trim()
  return kw ? list.filter((g: string) => g.includes(kw)) : list
})

function entriesOf(scope: string) {
  return (data.value?.blacklist || []).filter((b: any) => String(b.groupId) === scope)
}

const entries = computed(() => {
  const list = entriesOf(currentScope.value)
  const kw = keyword.value.trim()
  return kw ? list.filter((b: any) => String(b.userId).includes(kw)) : list
})

const isApplyingGlobal = computed(() => currentScope.value !== '' && applyGlobal(currentScope.value))

function applyGlobal(gid: string): boolean {
  return data.value?.scopeApply?.[gid]?.blacklist === true
}

function select(scope: string) {
  currentScope.value = scope
  keyword.value = ''
}

function split(s: any): string[] {
  if (Array.isArray(s)) return s.map(String)
  return String(s || '').split(/[,，\s\n]+/).filter(Boolean)
}

function sourceName(s: string) {
  return { manual: '手动', auto: '自动拉黑', review: '审核' }[s] || s || '-'
}

async function after(res: any, okText: string) {
  if (res?.ok) {
    toast.success(okText)
    // 后端已把重建后的 lists 数据一起返回（mutate 内部会写入缓存），
    // 这里直接采用即可，不需要再 invalidate + 重新请求一整轮。
    if (!applyMutated(res, 'lists', data)) {
      invalidateScope('lists')
      refresh(undefined, true)
    }
  } else {
    toast.error(res?.error || '操作失败')
  }
}

async function toggleApply(gid: string, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  await after(await mutate('setGroup', { groupId: gid, patch: { applyGlobalBlacklist: checked } }), '已更新该群黑名单范围')
}

async function add() {
  const users = split(input.value)
  if (!users.length) return
  await after(await mutate('blacklist.add', { users, groupId: currentScope.value }), `已添加 ${users.length} 个黑名单`)
  input.value = ''
}

async function remove(userId: string) {
  await after(await mutate('blacklist.remove', { userId, groupId: currentScope.value }), `已移除 ${userId}`)
}

async function moveToGlobal(userId: string) {
  await after(await mutate('blacklist.moveGlobal', { userId, groupId: currentScope.value }), '已转移至全局')
}

async function moveAllToGlobal() {
  const users = entriesOf(currentScope.value).map((b: any) => b.userId)
  if (!users.length) return
  await after(await mutate('blacklist.moveGlobal', { users, groupId: currentScope.value }), `已转移 ${users.length} 条至全局`)
}

onMounted(() => {
  const params = takePageParams()
  if (params?.groupId) currentScope.value = String(params.groupId)
})
</script>
