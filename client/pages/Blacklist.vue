<template>
  <div>
    <div class="qg-heading"><h2>黑名单</h2></div>

    <div v-if="data" class="qg-layout">
      <div class="qg-side">
        <h3>黑名单范围</h3>
        <div class="qg-item" :class="{ active: currentScope === '' }" @click="currentScope = ''">全局黑名单</div>
        <div class="qg-muted" style="margin:6px 0">分群黑名单（可关闭「应用全局黑名单」以启用本群独立黑名单）</div>
        <div v-for="g in data.groups" :key="g.id" class="qg-group-row">
          <div class="qg-item" :class="{ active: currentScope === g.groupId }" @click="currentScope = g.groupId">群 {{ g.groupId }}</div>
          <label class="qg-apply" :title="'开启后本群直接使用全局黑名单，隐藏本群独立黑名单'">
            <input type="checkbox" :checked="applyValue(g)" @change="toggleApply(g, $event)" /> 应用全局黑名单
          </label>
        </div>
      </div>

      <div class="qg-card" style="margin:0">
        <div class="qg-heading">
          <h3>{{ currentScope === '' ? '全局黑名单' : '群 ' + currentScope + ' 黑名单' }}</h3>
          <button v-if="currentScope && !isApplyingGlobal" class="qg-btn sm" @click="moveAllToGlobal">全部转移全局</button>
        </div>

        <div v-if="currentScope && isApplyingGlobal" class="qg-muted">
          该群已开启「应用全局黑名单」，将直接使用全局黑名单，本群独立黑名单未启用。如需启用，请关闭左侧该群的「应用全局黑名单」开关。
        </div>

        <template v-else>
          <div class="qg-add">
            <input class="qg-input" v-model="newBlackUserId" placeholder="QQ 号，多个用逗号/空格/换行分隔" />
            <button class="qg-btn primary" @click="addBlack">批量添加</button>
          </div>

          <table v-if="entries.length" class="qg-table" style="margin-top:10px">
            <thead><tr><th>QQ</th><th>来源</th><th>时间</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="b in entries" :key="b.id">
                <td>{{ b.userId }}</td>
                <td>{{ sourceName(b.source) }}</td>
                <td>{{ formatTime(b.createdAt) }}</td>
                <td>
                  <button v-if="currentScope" class="qg-btn sm" @click="moveToGlobal(b.userId)">转移全局</button>
                  <button class="qg-btn sm danger" @click="removeBlack(b.userId)">移除</button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-else class="qg-muted" style="margin-top:10px">暂无黑名单记录</div>
        </template>
      </div>
    </div>
    <div v-else class="qg-muted">加载中…</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useGmData, formatTime } from '../useData'
import { toast } from '../toast'

const { data, refresh, mutate } = useGmData()
onMounted(refresh)

const currentScope = ref('')
const newBlackUserId = ref('')

const isApplyingGlobal = computed(() => {
  if (!currentScope.value) return false
  const g = (data.value?.groups || []).find((x: any) => x.groupId === currentScope.value)
  if (!g) return false
  return applyValue(g)
})

const entries = computed(() => (data.value?.blacklist || []).filter((b: any) => b.groupId === currentScope.value))

function applyValue(g: any) {
  const global = data.value?.global || {}
  const c = g?.config || {}
  return c.applyGlobalBlacklist !== undefined ? !!c.applyGlobalBlacklist : (global.applyGlobalBlacklist !== false)
}

function sourceName(s: string) {
  return { manual: '手动', auto: '自动拉黑', review: '审核' }[s] || s || '-'
}

function split(s: any): string[] {
  if (Array.isArray(s)) return s.map(String)
  return String(s || '').split(/[,，\s]+/).filter(Boolean)
}

async function toggleApply(g: any, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  await mutate('setGroup', { groupId: g.groupId, patch: { applyGlobalBlacklist: checked } })
}

async function addBlack() {
  const users = split(newBlackUserId.value)
  if (!users.length) return
  await mutate('blacklist.add', { users, groupId: currentScope.value })
  toast.success(`已添加 ${users.length} 个黑名单`)
  newBlackUserId.value = ''
}

async function removeBlack(userId: string) {
  await mutate('blacklist.remove', { userId, groupId: currentScope.value })
  toast.info(`已移除 ${userId}`)
}

async function moveToGlobal(userId: string) {
  await mutate('blacklist.moveGlobal', { userId, groupId: currentScope.value })
}

async function moveAllToGlobal() {
  const users = entries.value.map((b: any) => b.userId)
  if (!users.length) return
  await mutate('blacklist.moveGlobal', { users, groupId: currentScope.value })
}
</script>