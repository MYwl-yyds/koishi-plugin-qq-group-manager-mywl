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
              <span class="qg-item-main">全局白名单</span>
              <span class="qg-tag neutral">{{ entriesOf('').length }}</span>
            </div>
            <div class="qg-muted" style="padding:6px 4px">分群白名单（各群默认使用本群独立名单）</div>
            <div v-for="gid in filteredGroups" :key="gid" class="qg-group-row">
              <div class="qg-item" :class="{ active: currentScope === gid }" @click="select(gid)">
                <span class="qg-item-main">群 {{ gid }}</span>
                <span class="qg-tag neutral">{{ entriesOf(gid).length }}</span>
              </div>
              <label class="qg-apply" title="开启后本群直接使用全局白名单">
                <input type="checkbox" :checked="applyGlobal(gid)" @change="toggleApply(gid, $event)" /> 应用全局白名单
              </label>
            </div>
          </div>
        </div>

        <Section :title="currentScope === '' ? '全局白名单' : `群 ${currentScope} 白名单`" :sub="`${entries.length} 条`" icon="✅" :open="true">
          <template #actions>
            <button v-if="currentScope && !isApplyingGlobal" class="qg-btn sm" @click="moveAllToGlobal">全部转移全局</button>
          </template>

          <div v-if="currentScope && isApplyingGlobal" class="qg-hint">
            该群已开启「应用全局白名单」，将直接使用全局白名单，本群独立名单未启用。
          </div>

          <template v-else>
            <p class="qg-muted">白名单成员默认豁免被加入黑名单；下方三个开关分别控制是否豁免被举报 / 入群审核 / 违禁词（含禁发链接）。</p>
            <div class="qg-add" style="margin-top:10px">
              <input class="qg-input" v-model="input" placeholder="QQ 号，多个用逗号 / 空格 / 换行分隔" @keyup.enter="add" />
              <button class="qg-btn primary" @click="add">批量添加</button>
            </div>

            <div class="qg-add" style="margin-top:10px">
              <input class="qg-input" v-model="keyword" placeholder="在名单中搜索 QQ 号" />
            </div>

            <EmptyState v-if="entries.length === 0" text="暂无白名单记录" icon="✅" sm />
            <div v-else class="qg-table-wrap" style="margin-top:10px">
              <table class="qg-table">
                <thead>
                  <tr><th>QQ</th><th>豁免被举报</th><th>豁免入群审核</th><th>豁免违禁词</th><th>加入时间</th><th>操作</th></tr>
                </thead>
                <tbody>
                  <tr v-for="b in entries" :key="b.id">
                    <td class="num">{{ b.userId }}</td>
                    <td><input type="checkbox" :checked="b.exemptReport" @change="toggleFlag(b, 'exemptReport', $event)" /></td>
                    <td><input type="checkbox" :checked="b.exemptJoin" @change="toggleFlag(b, 'exemptJoin', $event)" /></td>
                    <td><input type="checkbox" :checked="b.exemptBannedWord" @change="toggleFlag(b, 'exemptBannedWord', $event)" /></td>
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
import { useScope, mutate, invalidateScope, formatTime } from '../useData'
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
  return (data.value?.whitelist || []).filter((b: any) => String(b.groupId) === scope)
}
const entries = computed(() => {
  const list = entriesOf(currentScope.value)
  const kw = keyword.value.trim()
  return kw ? list.filter((b: any) => String(b.userId).includes(kw)) : list
})

const isApplyingGlobal = computed(() => currentScope.value !== '' && applyGlobal(currentScope.value))

function applyGlobal(gid: string): boolean {
  return data.value?.scopeApply?.[gid]?.whitelist === true
}

function select(scope: string) {
  currentScope.value = scope
}

function split(s: any): string[] {
  if (Array.isArray(s)) return s.map(String)
  return String(s || '').split(/[,，\s\n]+/).filter(Boolean)
}

async function after(res: any, okText: string) {
  if (res?.ok) {
    toast.success(okText)
    invalidateScope('lists')
    refresh(undefined, true)
  } else {
    toast.error(res?.error || '操作失败')
  }
}

async function toggleApply(gid: string, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  await after(await mutate('setGroup', { groupId: gid, patch: { applyGlobalWhitelist: checked } }), '已更新该群白名单范围')
}

async function add() {
  const users = split(input.value)
  if (!users.length) return
  await after(await mutate('whitelist.add', { users, groupId: currentScope.value }), `已添加 ${users.length} 个白名单`)
  input.value = ''
}

async function remove(userId: string) {
  await after(await mutate('whitelist.remove', { userId, groupId: currentScope.value }), `已移除 ${userId}`)
}

async function moveToGlobal(userId: string) {
  await after(await mutate('whitelist.moveGlobal', { userId, groupId: currentScope.value }), '已转移至全局')
}

async function moveAllToGlobal() {
  const users = entriesOf(currentScope.value).map((b: any) => b.userId)
  if (!users.length) return
  await after(await mutate('whitelist.moveGlobal', { users, groupId: currentScope.value }), `已转移 ${users.length} 条至全局`)
}

async function toggleFlag(b: any, key: string, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  const res = await mutate('whitelist.update', { userId: b.userId, groupId: b.groupId, patch: { [key]: checked } })
  if (res?.ok) {
    // 就地更新，避免整表刷新造成的闪烁
    b[key] = checked
  } else {
    toast.error(res?.error || '更新失败')
  }
}

onMounted(() => {
  const params = takePageParams()
  if (params?.groupId) currentScope.value = String(params.groupId)
})
</script>
