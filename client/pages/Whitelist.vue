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
              <button
                class="qg-clear-btn"
                :disabled="!entriesOf('').length"
                title="清空全局白名单"
                @click.stop="clearScope('')"
              >清空</button>
            </div>
            <div class="qg-muted" style="padding:6px 4px">分群白名单（各群默认使用本群独立名单）</div>
            <div v-for="gid in filteredGroups" :key="gid" class="qg-group-row">
              <div class="qg-item" :class="{ active: currentScope === gid }" @click="select(gid)">
                <span class="qg-item-main">群 {{ gid }}</span>
                <span class="qg-tag neutral">{{ entriesOf(gid).length }}</span>
                <button
                  class="qg-clear-btn"
                  :disabled="!entriesOf(gid).length"
                  :title="`清空群 ${gid} 的白名单`"
                  @click.stop="clearScope(gid)"
                >清空</button>
              </div>
              <label class="qg-apply" title="开启后本群直接使用全局白名单">
                <input type="checkbox" :checked="applyGlobal(gid)" @change="toggleApply(gid, $event)" /> 应用全局白名单
              </label>
            </div>
          </div>
        </div>

        <Section :title="currentScope === '' ? '全局白名单' : `群 ${currentScope} 白名单`" :sub="`${entries.length} 条`" icon="✅" :open="true">
          <div v-if="currentScope && isApplyingGlobal" class="qg-hint">
            该群已开启「应用全局白名单」，将直接使用全局白名单，本群独立名单未启用。
            如需启用本群独立名单，请关闭左侧该群的「应用全局白名单」开关。
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

            <EmptyState
              v-if="entries.length === 0"
              :text="keyword ? `没有匹配「${keyword}」的记录` : '暂无白名单记录'"
              icon="✅"
              sm
            />

            <template v-else>
              <!-- 批量操作栏 -->
              <div class="qg-bulk-bar">
                <label class="qg-bulk-all">
                  <input type="checkbox" :checked="allSelected" :indeterminate.prop="someSelected" @change="toggleAll" />
                  全选
                </label>
                <span class="qg-bulk-count">已选 {{ selectedCount }} / {{ entries.length }} 项</span>

                <button class="qg-btn sm danger" :disabled="!selectedCount" @click="removeSelected">批量移除</button>

                <!-- 群级名单：可把选中项转移到全局 -->
                <template v-if="currentScope">
                  <button class="qg-btn sm" :disabled="!selectedCount" @click="moveSelectedToGlobal">转移全局</button>
                  <button class="qg-btn sm" :disabled="!entries.length" @click="moveAllToGlobal">全部转移全局</button>
                </template>

                <!-- 全局名单：可把选中项转移/复制到指定群 -->
                <template v-else>
                  <select class="qg-select" v-model="targetGroupId">
                    <option value="">选择目标群…</option>
                    <option v-for="gid in filteredGroups" :key="gid" :value="gid">群 {{ gid }}</option>
                  </select>
                  <button class="qg-btn sm" :disabled="!selectedCount || !targetGroupId" @click="moveSelectedToGroup('move')">移动</button>
                  <button class="qg-btn sm" :disabled="!selectedCount || !targetGroupId" @click="moveSelectedToGroup('copy')">复制</button>
                </template>

                <button class="qg-btn sm danger qg-bulk-end" :disabled="!entries.length" @click="clearScope(currentScope)">清空本名单</button>
              </div>
              <p v-if="currentScope === '' && filteredGroups.length === 0" class="qg-hint tight">
                「转移到指定群」需要至少已有一个群（可在「群聊管控 → 群聊列表」添加）。
              </p>

              <div class="qg-table-wrap" style="margin-top:10px">
                <table class="qg-table">
                  <thead>
                    <tr>
                      <th class="qg-check-col"><input type="checkbox" :checked="allSelected" :indeterminate.prop="someSelected" @change="toggleAll" /></th>
                      <th>QQ</th><th>豁免被举报</th><th>豁免入群审核</th><th>豁免违禁词</th><th>加入时间</th><th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="b in entries" :key="b.id" :class="{ 'qg-row-selected': isSelected(b.userId) }">
                      <td class="qg-check-col">
                        <input type="checkbox" :checked="isSelected(b.userId)" @change="toggleOne(b.userId, $event)" />
                      </td>
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
            </template>
          </template>
        </Section>
      </div>
    </template>

    <EmptyState v-else :text="error || '暂无数据'" icon="⚠️" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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
// 全局名单 → 指定群的目标群
const targetGroupId = ref('')
// 勾选的成员 QQ（按当前名单范围有意义）
const selected = ref<string[]>([])

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

// ---------- 批量选择 ----------
function isSelected(userId: string) {
  return selected.value.includes(String(userId))
}

// 批量操作只作用于「当前可见（含关键字筛选）」的选中项，避免误删被隐藏的勾选记录
const selectedEntries = computed(() => entries.value.filter((b: any) => isSelected(b.userId)))
const selectedCount = computed(() => selectedEntries.value.length)
const allSelected = computed(() => entries.value.length > 0 && selectedCount.value === entries.value.length)
const someSelected = computed(() => selectedCount.value > 0 && !allSelected.value)

function toggleOne(userId: string, e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  const id = String(userId)
  if (checked) {
    if (!selected.value.includes(id)) selected.value.push(id)
  } else {
    selected.value = selected.value.filter((x) => x !== id)
  }
}

function toggleAll(e: Event) {
  const checked = (e.target as HTMLInputElement).checked
  selected.value = checked ? entries.value.map((b: any) => String(b.userId)) : []
}

// 切换范围/筛选条件时清空勾选
watch([currentScope, keyword], () => { selected.value = [] })

function select(scope: string) {
  currentScope.value = scope
  keyword.value = ''
  selected.value = []
}

function split(s: any): string[] {
  if (Array.isArray(s)) return s.map(String)
  return String(s || '').split(/[,，\s\n]+/).filter(Boolean)
}

function scopeLabel(scope: string) {
  return scope === '' ? '全局白名单' : `群 ${scope} 的白名单`
}

async function after(res: any, okText: string) {
  if (res?.ok) {
    toast.success(okText)
    // 后端已把重建后的 lists 数据一起返回时直接采用，省掉一整轮额外请求
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
  // 专用动作会让后端把重建后的 lists 域一并返回，因此无需再额外请求一轮
  await after(await mutate('lists.setApplyGlobal', { groupId: gid, whitelist: checked }), '已更新该群白名单范围')
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

// ---------- 批量操作 ----------
async function removeSelected() {
  const users = selectedEntries.value.map((b: any) => String(b.userId))
  if (!users.length) return
  if (!confirm(`确定从「${scopeLabel(currentScope.value)}」移除选中的 ${users.length} 个成员？`)) return
  selected.value = []
  await after(await mutate('whitelist.remove', { users, groupId: currentScope.value }), `已移除 ${users.length} 条`)
}

async function moveSelectedToGlobal() {
  const users = selectedEntries.value.map((b: any) => String(b.userId))
  if (!users.length) return
  if (!confirm(`确定将选中的 ${users.length} 个成员从「${scopeLabel(currentScope.value)}」转移到全局白名单？\n\n转移后本群名单中不再保留这些成员，三项豁免开关会一并带过去。`)) return
  selected.value = []
  await after(await mutate('whitelist.moveGlobal', { users, groupId: currentScope.value }), `已转移 ${users.length} 条至全局`)
}

async function moveSelectedToGroup(mode: 'move' | 'copy') {
  const users = selectedEntries.value.map((b: any) => String(b.userId))
  const target = targetGroupId.value
  if (!users.length || !target) return
  const verb = mode === 'move' ? '移动' : '复制'
  const extra = mode === 'move' ? '\n\n「移动」会同时把这些成员从全局白名单中移除。' : ''
  if (!confirm(`确定将选中的 ${users.length} 个成员${verb}到「群 ${target} 的白名单」？${extra}`)) return
  selected.value = []
  await after(
    await mutate('whitelist.moveGroup', { users, targetGroupId: target, mode }),
    `已${verb} ${users.length} 条到群 ${target}`,
  )
}

// ---------- 一键清空 ----------
async function clearScope(scope: string) {
  const list = entriesOf(scope)
  if (!list.length) return
  if (!confirm(`确定清空「${scopeLabel(scope)}」的全部 ${list.length} 条记录？\n\n该操作不可恢复，且不会影响其它群或全局名单。`)) return
  selected.value = []
  await after(await mutate('whitelist.clear', { groupId: scope }), `已清空「${scopeLabel(scope)}」（${list.length} 条）`)
}

async function moveToGlobal(userId: string) {
  await after(await mutate('whitelist.moveGlobal', { userId, groupId: currentScope.value }), '已转移至全局')
}

async function moveAllToGlobal() {
  const users = entriesOf(currentScope.value).map((b: any) => b.userId)
  if (!users.length) return
  if (!confirm(`确定将「${scopeLabel(currentScope.value)}」的全部 ${users.length} 条转移至全局白名单？\n\n转移后本群名单将被清空。`)) return
  selected.value = []
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
  // 只取发给本页的参数，避免误消费其它页面的群号
  const params = takePageParams<{ groupId?: string }>('whitelist')
  if (params?.groupId) currentScope.value = String(params.groupId)
})
</script>
