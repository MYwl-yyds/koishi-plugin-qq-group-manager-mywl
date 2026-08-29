<template>
  <div>
      <div class="qg-heading"><h2>权限管理</h2></div>

      <div v-if="data" class="qg-layout">
        <div class="qg-side">
          <h3>权限组</h3>
          <div v-for="g in data.permissions" :key="g.id" class="qg-item" :class="{ active: g.name === selectedName }" @click="select(g.name)">
            {{ g.name }} <span v-if="g.isDefault" class="qg-tag default">默认</span>
          </div>
          <div v-if="data.permissions.length === 0" class="qg-muted">尚未创建权限组（此时仅超级管理员可触发群管命令）</div>
          <div class="qg-add">
            <input class="qg-input" v-model="newName" placeholder="权限组名称" @keyup.enter="create" />
            <button class="qg-btn primary" @click="create">创建</button>
          </div>
        </div>

        <div style="min-width:0">
          <div v-if="!selected" class="qg-card" style="margin:0"><span class="qg-muted">请选择或创建一个权限组</span></div>
          <div v-else>
            <div class="qg-card">
              <div class="qg-heading"><h3>{{ selected.name }}（优先级 {{ selected.priority }}）</h3>
                <div>
                  <button v-if="!selected.isDefault" class="qg-btn sm" @click="setDefault">设为默认组</button>
                  <button class="qg-btn sm danger" @click="remove">删除该组</button>
                </div>
              </div>

              <label class="qg-row"><span>优先级</span>
                <input class="qg-input" type="number" v-model="priorityInput" style="max-width:120px" />
                <button class="qg-btn sm" @click="savePriority">保存</button>
              </label>

              <h3 style="margin-top:4px">命令 / 权限开关</h3>
              <div class="qg-perm-grid">
                <label v-for="cmd in data.commands" :key="cmd">
                  <input type="checkbox" :checked="selected.perms?.[cmd] !== false" @change="togglePerm(cmd, $event)" />
                  <span>{{ cmd }}</span>
                </label>
              </div>
            </div>

            <div class="qg-card">
              <h3>成员管理</h3>
              <div class="qg-add" style="margin-top:0">
                <input class="qg-input" v-model="memberInput" placeholder="成员 QQ 号，多个用逗号/空格/换行分隔" @keyup.enter="addMember" />
                <button class="qg-btn primary" @click="addMember">批量添加</button>
              </div>
              <div class="qg-add" style="margin-top:10px">
                <input class="qg-input" v-model="importGroupId" placeholder="群号（填写后按角色快捷导入该群成员）" />
                <select class="qg-select" v-model="importRole">
                  <option value="member">群成员</option>
                  <option value="admin">群管理员</option>
                  <option value="owner">群所有者</option>
                </select>
                <button class="qg-btn" @click="importMembers">快捷导入</button>
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
                <span v-for="m in selected.members" :key="m" class="qg-pill">{{ m }} <button @click="removeMember(m)">×</button></span>
              </div>
            </div>

            <div class="qg-card">
              <h3>生效群聊（添加模式）</h3>
              <div class="qg-add" style="margin-top:0">
                <input class="qg-input" v-model="scopeInput" placeholder="输入要添加的群号，多个用逗号分隔" />
                <button class="qg-btn primary" @click="saveScope">添加</button>
                <button class="qg-btn sm" @click="clearScope">清空为全部群</button>
              </div>
              <div class="qg-muted" style="margin-top:8px">当前：{{ selected.groupIds.length === 0 ? '全部群' : selected.groupIds.join('、') }}</div>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="qg-muted">加载中…</div>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useGmData } from '../useData'
import { toast } from '../toast'

const { data, refresh, mutate } = useGmData()
onMounted(refresh)

const selectedName = ref('')
const newName = ref('')
const memberInput = ref('')
const scopeInput = ref('')
const priorityInput = ref(0)
const importGroupId = ref('')
const importRole = ref('member')

const selected = computed(() => (data.value?.permissions || []).find((g: any) => g.name === selectedName.value))

function select(name: string) {
  selectedName.value = name
  const g = selected.value
  scopeInput.value = g ? (g.groupIds.length === 0 ? '' : g.groupIds.join(',')) : ''
  priorityInput.value = g ? g.priority : 0
}

async function create() {
  if (!newName.value.trim()) return
  const res = await mutate('permission.create', { name: newName.value.trim() })
  if (res?.ok) toast.success(`已创建权限组「${newName.value.trim()}」`)
  else toast.error(res?.error || '创建失败')
  selectedName.value = newName.value.trim()
  newName.value = ''
}
async function remove() {
  if (!selected.value) return
  if (!confirm(`确认删除权限组「${selected.value.name}」？`)) return
  const res = await mutate('permission.remove', { name: selected.value.name })
  if (res?.ok) toast.success(`已删除权限组「${selected.value.name}」`)
  else toast.error(res?.error || '删除失败')
  selectedName.value = ''
}
async function setDefault() {
  if (!selected.value) return
  await mutate('permission.setDefault', { name: selected.value.name })
}
async function savePriority() {
  if (!selected.value) return
  await mutate('permission.setPriority', { name: selected.value.name, priority: Number(priorityInput.value) })
}
async function togglePerm(cmd: string, e: Event) {
  if (!selected.value) return
  const enabled = (e.target as HTMLInputElement).checked
  await mutate('permission.setPerm', { name: selected.value.name, command: cmd, enabled })
}
async function addMember() {
  if (!selected.value || !memberInput.value.trim()) return
  const users = memberInput.value.split(/[,，\s]+/).filter(Boolean)
  for (const userId of users) {
    await mutate('permission.addMember', { name: selected.value.name, userId })
  }
  memberInput.value = ''
}
async function importMembers() {
  if (!selected.value) return
  if (!importGroupId.value.trim()) {
    toast.warning('请先填写群号')
    return
  }
  const res = await mutate('permission.import', { name: selected.value.name, groupId: importGroupId.value.trim(), role: importRole.value })
  if (res?.ok) toast.success('导入完成')
  else toast.error(res?.error || '导入失败')
  importGroupId.value = ''
}
async function removeMember(userId: string) {
  if (!selected.value) return
  await mutate('permission.removeMember', { name: selected.value.name, userId })
}
async function saveScope() {
  if (!selected.value) return
  const ids = scopeInput.value.split(/[,，\s]+/).filter((x) => /^\d{5,}$/.test(x))
  if (ids.length === 0) {
    toast.warning('请填写要添加的群号')
    return
  }
  const res = await mutate('permission.setGroups', { name: selected.value.name, groupIds: ids })
  if (res?.ok) {
    toast.success('已添加生效群')
    scopeInput.value = ''
  } else {
    toast.error(res?.error || '添加失败')
  }
}
async function clearScope() {
  if (!selected.value) return
  await mutate('permission.clearGroups', { name: selected.value.name })
}
</script>