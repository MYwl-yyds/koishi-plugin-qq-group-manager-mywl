<template>
  <div>
    <Skeleton v-if="!data && loading" :rows="5" />

    <template v-else-if="data">
      <div class="qg-layout">
        <div class="qg-side">
          <h3>权限组</h3>
          <div class="qg-side-list">
            <div
              v-for="g in data.permissions"
              :key="g.id"
              class="qg-item"
              :class="{ active: g.name === selectedName }"
              @click="select(g.name)"
            >
              <span class="qg-item-main">{{ g.name }}</span>
              <span v-if="g.isDefault" class="qg-tag operation">默认</span>
              <span class="qg-tag neutral">{{ g.members.length }}</span>
            </div>
          </div>
          <EmptyState
            v-if="data.permissions.length === 0"
            text="尚未创建权限组"
            sub="未创建时仅超级管理员可触发群管命令"
            icon="🛡️"
            sm
          />
          <div class="qg-add">
            <input class="qg-input" v-model="newName" placeholder="权限组名称" @keyup.enter="create" />
            <button class="qg-btn primary" @click="create">创建</button>
          </div>
        </div>

        <div style="min-width:0">
          <EmptyState v-if="!selected" text="请选择或创建一个权限组" icon="🛡️" />
          <template v-else>
            <Section :title="selected.name" :sub="`优先级 ${selected.priority}`" icon="🛡️" :open="true">
              <template #actions>
                <button v-if="!selected.isDefault" class="qg-btn sm" @click="setDefault">设为默认组</button>
                <button class="qg-btn sm" @click="rename">重命名</button>
                <button class="qg-btn sm danger" @click="remove">删除该组</button>
              </template>

              <div class="qg-grid two">
                <ToggleRow label="优先级（越大越优先）" type="number" v-model="priorityInput" />
                <div class="qg-actions" style="margin-top:0">
                  <button class="qg-btn sm" @click="savePriority">保存优先级</button>
                </div>
              </div>
              <p class="qg-hint tight">成员同时属于多个权限组时，取优先级最高的组的开关设置；无匹配组时使用「默认组」。</p>
            </Section>

            <Section title="命令 / 权限开关" :sub="`${enabledCount} / ${data.commands.length} 项开启`" icon="🎚️" :open="true">
              <template #actions>
                <button class="qg-btn sm" @click="setAll(true)">全部开启</button>
                <button class="qg-btn sm" @click="setAll(false)">全部关闭</button>
              </template>
              <!-- 按功能域分组展示，高危项单独标记 -->
              <div v-for="grp in permGroups" :key="grp.name" class="qg-perm-block">
                <h4 class="qg-perm-title">
                  {{ grp.name }}
                  <span class="qg-muted">（{{ grp.items.filter((i) => selected.perms?.[i.key] === true).length }} / {{ grp.items.length }}）</span>
                  <button class="qg-btn sm" style="margin-left:8px" @click="setGroup(grp.items, true)">全开</button>
                  <button class="qg-btn sm" @click="setGroup(grp.items, false)">全关</button>
                </h4>
                <div class="qg-perm-grid">
                  <label v-for="item in grp.items" :key="item.key" :class="{ danger: item.danger }" :title="item.danger ? '高危权限，默认关闭' : item.label">
                    <input type="checkbox" :checked="selected.perms?.[item.key] === true" @change="togglePerm(item.key, $event)" />
                    <span>{{ item.label }}<b v-if="item.danger" class="qg-danger-dot">!</b></span>
                  </label>
                </div>
              </div>
              <p class="qg-hint">
                「审核员」为权限项（用于入群审核通知的引用回复审批），不是命令；超级管理员始终可审核。
                标有 <b class="qg-danger-dot">!</b> 的是高危权限（退群、审核员、权限组管理），新建权限组时默认关闭，需显式勾选。
                「举报」命令对所有群成员开放，不受权限组控制（滥用由频率限制防护）。
              </p>
            </Section>

            <Section title="成员管理" :sub="`${selected.members.length} 人`" icon="👥" :open="true">
              <div class="qg-add" style="margin-top:0">
                <input class="qg-input" v-model="memberInput" placeholder="成员 QQ 号，多个用逗号 / 空格 / 换行分隔" @keyup.enter="addMember" />
                <button class="qg-btn primary" @click="addMember">批量添加</button>
              </div>
              <div class="qg-add" style="margin-top:10px">
                <select class="qg-select" v-model="importGroupId" style="max-width:220px">
                  <option value="">— 选择群聊快捷导入 —</option>
                  <option v-for="g in groupOptions" :key="g.groupId" :value="g.groupId">{{ g.groupId }}</option>
                </select>
                <select class="qg-select" v-model="importRole" style="max-width:150px">
                  <option value="member">群成员</option>
                  <option value="admin">群管理员</option>
                  <option value="owner">群所有者</option>
                </select>
                <button class="qg-btn" :disabled="importing" @click="importMembers">{{ importing ? '导入中…' : '快捷导入' }}</button>
              </div>
              <div class="qg-add" style="margin-top:10px">
                <input class="qg-input" v-model="memberFilter" placeholder="在成员中搜索 QQ 号" />
              </div>
              <div style="margin-top:10px">
                <TagList :items="filteredMembers" removable empty-text="暂无成员" @remove="removeMember" />
              </div>
            </Section>

            <Section title="生效群聊" :sub="selected.groupIds.length === 0 ? '全部群' : `${selected.groupIds.length} 个群`" icon="💬" :open="true">
              <div class="qg-add" style="margin-top:0">
                <input class="qg-input" v-model="scopeInput" placeholder="输入要添加的群号，多个用逗号分隔" @keyup.enter="saveScope" />
                <button class="qg-btn primary" @click="saveScope">添加</button>
                <button class="qg-btn" @click="clearScope">清空为全部群</button>
              </div>
              <div style="margin-top:10px">
                <TagList :items="selected.groupIds" :removable="false" :muted="true" empty-text="全部群（未限制）" />
              </div>
              <p class="qg-hint">留空表示该权限组在全部群生效；超级管理员不受生效群限制。</p>
            </Section>
          </template>
        </div>
      </div>
    </template>

    <EmptyState v-else :text="error || '暂无数据'" icon="⚠️" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useScope, mutate, invalidateScope, splitList } from '../useData'
import { toast } from '../toast'
import Section from '../components/Section.vue'
import EmptyState from '../components/EmptyState.vue'
import Skeleton from '../components/Skeleton.vue'
import ToggleRow from '../components/ToggleRow.vue'
import TagList from '../components/TagList.vue'

const selectedName = ref('')
const newName = ref('')
const memberInput = ref('')
const memberFilter = ref('')
const scopeInput = ref('')
const priorityInput = ref(0)
const importGroupId = ref('')
const importRole = ref('member')
const importing = ref(false)

const { data, loading, error, refresh } = useScope<any>('permissions')
const { data: groupList } = useScope<any>('groups')

const groupOptions = computed(() => (groupList.value?.groups || []).map((g: any) => ({ groupId: g.groupId })))

const selected = computed(() => (data.value?.permissions || []).find((g: any) => g.name === selectedName.value))

const filteredMembers = computed(() => {
  const list = selected.value?.members || []
  const kw = memberFilter.value.trim()
  return kw ? list.filter((m: string) => String(m).includes(kw)) : list
})

const enabledCount = computed(() => {
  const s = selected.value
  if (!s || !data.value) return 0
  return data.value.commands.filter((c: string) => s.perms?.[c] === true).length
})

// 权限项按功能域分组（后端提供 permItems 元数据；缺失时回退为单组）
const permGroups = computed(() => {
  const items: any[] = data.value?.permItems?.length
    ? data.value.permItems
    : (data.value?.commands || []).map((c: string) => ({ key: c, label: c, group: '全部权限' }))
  const order: string[] = []
  const map = new Map<string, any[]>()
  for (const it of items) {
    const g = it.group || '其它'
    if (!map.has(g)) { map.set(g, []); order.push(g) }
    map.get(g)!.push(it)
  }
  return order.map((name) => ({ name, items: map.get(name)! }))
})

watch(selected, (g) => {
  if (!g) return
  scopeInput.value = ''
  priorityInput.value = g.priority
}, { immediate: true })

// 数据是异步到达的，首次拿到列表后自动选中第一个权限组
watch(() => data.value?.permissions, (list) => {
  if (!list?.length) return
  const exists = list.some((g: any) => g.name === selectedName.value)
  if (!exists) selectedName.value = list[0].name
}, { immediate: true })

function select(name: string) {
  selectedName.value = name
  memberFilter.value = ''
}

async function after(res: any, okText?: string) {
  if (res?.ok) {
    if (okText) toast.success(okText)
    invalidateScope('permissions')
    refresh(undefined, true)
  } else {
    toast.error(res?.error || '操作失败')
  }
}

async function create() {
  const name = newName.value.trim()
  if (!name) return
  const res = await mutate('permission.create', { name })
  if (res?.ok) {
    toast.success(`已创建权限组「${name}」`)
    selectedName.value = name
    newName.value = ''
    invalidateScope('permissions')
    refresh(undefined, true)
  } else {
    toast.error(res?.error || '创建失败')
  }
}

async function rename() {
  if (!selected.value) return
  const next = prompt('请输入新的权限组名称', selected.value.name)
  if (!next || next.trim() === selected.value.name) return
  const res = await mutate('permission.rename', { name: selected.value.name, nextName: next.trim() })
  if (res?.ok) {
    toast.success('已重命名')
    selectedName.value = next.trim()
    invalidateScope('permissions')
    refresh(undefined, true)
  } else {
    toast.error(res?.error || '重命名失败')
  }
}

async function remove() {
  if (!selected.value) return
  if (!confirm(`确认删除权限组「${selected.value.name}」？`)) return
  const name = selected.value.name
  const res = await mutate('permission.remove', { name })
  if (res?.ok) {
    toast.success(`已删除权限组「${name}」`)
    selectedName.value = ''
    invalidateScope('permissions')
    refresh(undefined, true)
  } else {
    toast.error(res?.error || '删除失败')
  }
}

async function setDefault() {
  if (!selected.value) return
  await after(await mutate('permission.setDefault', { name: selected.value.name }), '已设为默认权限组')
}

async function savePriority() {
  if (!selected.value) return
  await after(await mutate('permission.setPriority', { name: selected.value.name, priority: Number(priorityInput.value) }), '优先级已保存')
}

async function togglePerm(cmd: string, e: Event) {
  if (!selected.value) return
  const enabled = (e.target as HTMLInputElement).checked
  const res = await mutate('permission.setPerm', { name: selected.value.name, command: cmd, enabled })
  if (res?.ok) {
    if (!selected.value.perms) selected.value.perms = {}
    selected.value.perms[cmd] = enabled
  } else {
    toast.error(res?.error || '设置失败')
  }
}

async function setAll(enabled: boolean) {
  if (!selected.value) return
  for (const cmd of data.value.commands) {
    await mutate('permission.setPerm', { name: selected.value.name, command: cmd, enabled })
  }
  toast.success(enabled ? '已开启全部权限' : '已关闭全部权限')
  invalidateScope('permissions')
  refresh(undefined, true)
}

// 按功能域批量开关
async function setGroup(items: any[], enabled: boolean) {
  if (!selected.value) return
  for (const it of items) {
    await mutate('permission.setPerm', { name: selected.value.name, command: it.key, enabled })
  }
  toast.success(`已${enabled ? '开启' : '关闭'}「${items[0]?.group || ''}」全部权限`)
  invalidateScope('permissions')
  refresh(undefined, true)
}

async function addMember() {
  if (!selected.value) return
  const users = splitList(memberInput.value)
  if (!users.length) return
  for (const userId of users) {
    await mutate('permission.addMember', { name: selected.value.name, userId })
  }
  toast.success(`已添加 ${users.length} 名成员`)
  memberInput.value = ''
  invalidateScope('permissions')
  refresh(undefined, true)
}

async function removeMember(userId: string) {
  if (!selected.value) return
  const res = await mutate('permission.removeMember', { name: selected.value.name, userId })
  if (res?.ok) {
    selected.value.members = selected.value.members.filter((m: string) => m !== userId)
  } else {
    toast.error(res?.error || '移除失败')
  }
}

async function importMembers() {
  if (!selected.value) return
  if (!importGroupId.value) {
    toast.warning('请先选择要导入的群聊')
    return
  }
  importing.value = true
  const res = await mutate('permission.import', { name: selected.value.name, groupId: importGroupId.value, role: importRole.value })
  importing.value = false
  if (res?.ok) {
    toast.success('导入完成')
    invalidateScope('permissions')
    refresh(undefined, true)
  } else {
    toast.error(res?.error || '导入失败')
  }
}

async function saveScope() {
  if (!selected.value) return
  const ids = splitList(scopeInput.value).filter((x) => /^\d{5,}$/.test(x))
  if (ids.length === 0) {
    toast.warning('请填写要添加的群号')
    return
  }
  await after(await mutate('permission.setGroups', { name: selected.value.name, groupIds: ids }), '已添加生效群')
  scopeInput.value = ''
}

async function clearScope() {
  if (!selected.value) return
  await after(await mutate('permission.clearGroups', { name: selected.value.name }), '已恢复为全部群生效')
}
</script>

<style scoped>
.qg-perm-block { margin-bottom: 14px; }
.qg-perm-block:last-of-type { margin-bottom: 6px; }
.qg-perm-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--qg-text-2);
  margin: 0 0 6px;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.qg-muted { font-weight: 400; color: var(--qg-muted); }
.qg-perm-grid label.danger span { color: var(--qg-danger); }
.qg-danger-dot {
  display: inline-block;
  margin-left: 4px;
  width: 13px;
  height: 13px;
  line-height: 13px;
  text-align: center;
  border-radius: 50%;
  background: var(--qg-danger);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
}
</style>
