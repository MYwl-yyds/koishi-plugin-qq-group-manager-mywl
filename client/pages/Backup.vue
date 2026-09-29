<template>
  <div>
    <Section title="配置导出 / 导入" sub="迁移全局设置、群级覆盖、权限组与全局违规图样本（不含黑白名单）" icon="📦" :open="true">
      <p class="qg-hint tight">
        导出的配置文件包含：<b>全局设置</b>、<b>各群覆盖配置</b>（含各群的群员检查、禁发链接 / 图片与群专属样本归属）、<b>权限组</b>、以及<b>全局违规图样本</b>（仅保留感知哈希与备注，不含图片本体）。
        不包含黑白名单（请到「黑名单」/「白名单」页单独导出）、也不包含日志与成员检查状态等运行数据。
      </p>

      <h4 class="qg-sub-title">导出</h4>
      <div class="qg-grid two">
        <label class="qg-check"><input type="checkbox" v-model="exportOpts.groups" /> 包含各群覆盖配置</label>
        <label class="qg-check"><input type="checkbox" v-model="exportOpts.permissions" /> 包含权限组</label>
      </div>
      <div class="qg-actions">
        <button class="qg-btn primary" :disabled="busy" @click="doExportConfig">
          {{ busy ? '处理中…' : '导出配置为 JSON 文件' }}
        </button>
      </div>

      <h4 class="qg-sub-title">导入</h4>
      <div class="qg-grid two">
        <label class="qg-row">
          <span>导入方式</span>
          <select class="qg-select grow" v-model="importOpts.mode">
            <option value="merge">合并（保留原有、覆盖文件中的字段）</option>
            <option value="replace">替换（清空后按文件整体覆盖）</option>
          </select>
        </label>
        <div>
          <label class="qg-check"><input type="checkbox" v-model="importOpts.groups" /> 导入各群覆盖配置</label>
          <label class="qg-check"><input type="checkbox" v-model="importOpts.permissions" /> 导入权限组</label>
        </div>
      </div>
      <p class="qg-hint tight">
        <b>合并</b>模式只覆盖文件中出现的字段，适合把 A 环境的配置补到 B 环境；
        <b>替换</b>模式会先清空权限组与全局违规图样本再写入，群级配置按文件整体覆盖，操作前请先导出备份。
      </p>

      <div class="qg-add" style="flex-wrap:wrap">
        <input ref="fileInput" type="file" accept="application/json,.json" style="display:none" @change="onConfigFile" />
        <button class="qg-btn" :disabled="busy" @click="fileInput?.click()">选择配置文件…</button>
        <span v-if="pendingConfig" class="qg-pill">{{ pendingConfig.name }}</span>
        <button class="qg-btn primary" :disabled="!pendingConfig || busy" @click="doImportConfig">
          {{ busy ? '导入中…' : '开始导入' }}
        </button>
      </div>
      <p v-if="configSummary" class="qg-hint tight">{{ configSummary }}</p>
    </Section>

    <Section title="名单导出 / 导入" sub="黑名单与白名单可分别备份与还原" icon="📋">
      <div class="qg-grid two">
        <div class="qg-card flat">
          <h4>黑名单</h4>
          <p class="qg-muted">共 {{ blackCount }} 条记录（含全局与各群）</p>
          <div class="qg-actions">
            <button class="qg-btn primary" :disabled="busy" @click="doExportList('blacklist')">导出黑名单</button>
            <input ref="blackFile" type="file" accept="application/json,.json" style="display:none" @change="(e) => onListFile(e, 'blacklist')" />
            <button class="qg-btn" :disabled="busy" @click="blackFile?.click()">导入黑名单…</button>
          </div>
          <p v-if="pendingBlack" class="qg-hint tight">
            已选择 {{ pendingBlack.name }}
            <select class="qg-select" style="width:auto;margin-left:6px" v-model="listMode">
              <option value="merge">合并</option>
              <option value="replace">替换（清空原有）</option>
            </select>
            <button class="qg-btn sm primary" style="margin-left:6px" :disabled="busy" @click="doImportList('blacklist')">确认导入</button>
          </p>
        </div>

        <div class="qg-card flat">
          <h4>白名单</h4>
          <p class="qg-muted">共 {{ whiteCount }} 条记录（含全局与各群）</p>
          <div class="qg-actions">
            <button class="qg-btn primary" :disabled="busy" @click="doExportList('whitelist')">导出白名单</button>
            <input ref="whiteFile" type="file" accept="application/json,.json" style="display:none" @change="(e) => onListFile(e, 'whitelist')" />
            <button class="qg-btn" :disabled="busy" @click="whiteFile?.click()">导入白名单…</button>
          </div>
          <p v-if="pendingWhite" class="qg-hint tight">
            已选择 {{ pendingWhite.name }}
            <select class="qg-select" style="width:auto;margin-left:6px" v-model="listMode">
              <option value="merge">合并</option>
              <option value="replace">替换（清空原有）</option>
            </select>
            <button class="qg-btn sm primary" style="margin-left:6px" :disabled="busy" @click="doImportList('whitelist')">确认导入</button>
          </p>
        </div>
      </div>
      <p class="qg-hint tight">
        白名单导出会保留三项豁免开关（举报 / 入群 / 违禁词）；导入时按文件中的开关原样还原。
        导入黑名单会绕过「白名单豁免」判断，忠实还原导出内容。
      </p>
    </Section>

    <Section title="操作说明" sub="关于文件格式与安全" icon="ℹ️">
      <ul class="qg-ul">
        <li>导出文件为 UTF-8 的 JSON，可用文本编辑器直接查看与修改。</li>
        <li>导入时会校验文件标识与版本号，非本插件导出的文件会被拒绝。</li>
        <li>导入「替换」模式不可撤销，建议先导出一份当前配置作为备份。</li>
        <li>名单导入会校验 QQ 号格式（5–12 位数字），非法条目会被跳过并计数。</li>
      </ul>
    </Section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { send } from '@koishijs/client'
import { useScope, invalidateScope } from '../useData'
import { toast } from '../toast'
import Section from '../components/Section.vue'

const fileInput = ref<HTMLInputElement>()
const blackFile = ref<HTMLInputElement>()
const whiteFile = ref<HTMLInputElement>()

const busy = ref(false)
const exportOpts = ref({ groups: true, permissions: true })
const importOpts = ref({ mode: 'merge', groups: true, permissions: true })
const listMode = ref<'merge' | 'replace'>('merge')

const pendingConfig = ref<{ name: string, bundle: any } | null>(null)
const pendingBlack = ref<{ name: string, bundle: any } | null>(null)
const pendingWhite = ref<{ name: string, bundle: any } | null>(null)
const configSummary = ref('')

const { data, refresh } = useScope<any>('lists')

const blackCount = computed(() => data.value?.blacklist?.length ?? 0)
const whiteCount = computed(() => data.value?.whitelist?.length ?? 0)

onMounted(() => refresh())

function download(filename: string, obj: any) {
  try {
    const text = JSON.stringify(obj, null, 2)
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast.success(`已生成 ${filename}`)
  } catch (e) {
    toast.error(`导出失败：${(e as Error).message}`)
  }
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

async function doExportConfig() {
  busy.value = true
  const res = await send('qq-guanqun/mutate', {
    action: 'export.config',
    data: { includeGroups: exportOpts.value.groups, includePermissionGroups: exportOpts.value.permissions },
  })
  busy.value = false
  if (!res?.ok || !res.data?.bundle) {
    toast.error(res?.error || '导出失败')
    return
  }
  download(`qq-guanqun-config-${stamp()}.json`, res.data.bundle)
}

async function doExportList(type: 'blacklist' | 'whitelist') {
  busy.value = true
  const res = await send('qq-guanqun/mutate', { action: 'export.list', data: { type } })
  busy.value = false
  if (!res?.ok || !res.data?.bundle) {
    toast.error(res?.error || '导出失败')
    return
  }
  download(`qq-guanqun-${type}-${stamp()}.json`, res.data.bundle)
}

function readJson(file: File): Promise<any> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result || '')))
      } catch (e) {
        reject(e)
      }
    }
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsText(file, 'utf-8')
  })
}

async function onConfigFile(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const bundle = await readJson(file)
    pendingConfig.value = { name: file.name, bundle }
    const parts: string[] = []
    if (bundle?.global) parts.push('全局设置')
    if (bundle?.groups) parts.push(`${Object.keys(bundle.groups).length} 个群配置`)
    if (bundle?.permissionGroups) parts.push(`${bundle.permissionGroups.length} 个权限组`)
    if (bundle?.imageSamples?.length) parts.push(`${bundle.imageSamples.length} 张全局违规图样本`)
    configSummary.value = `文件解析成功：包含 ${parts.join('、') || '无内容'}（导出于 ${bundle?.exportedAt || '未知时间'}）`
  } catch (e) {
    pendingConfig.value = null
    configSummary.value = ''
    toast.error(`文件解析失败：${(e as Error).message}`)
  } finally {
    input.value = ''
  }
}

async function onListFile(ev: Event, type: 'blacklist' | 'whitelist') {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const bundle = await readJson(file)
    const target = type === 'blacklist' ? pendingBlack : pendingWhite
    target.value = { name: `${file.name}（${bundle?.entries?.length ?? 0} 条）`, bundle }
  } catch (e) {
    toast.error(`文件解析失败：${(e as Error).message}`)
  } finally {
    input.value = ''
  }
}

async function doImportConfig() {
  if (!pendingConfig.value) return
  busy.value = true
  const res = await send('qq-guanqun/mutate', {
    action: 'import.config',
    data: {
      bundle: pendingConfig.value.bundle,
      mode: importOpts.value.mode,
      includeGroups: importOpts.value.groups,
      includePermissionGroups: importOpts.value.permissions,
    },
  })
  busy.value = false
  if (res?.ok) {
    toast.success('配置导入完成')
    pendingConfig.value = null
    configSummary.value = ''
    invalidateScope()
    refresh(undefined, true)
  } else {
    toast.error(res?.error || '导入失败')
  }
}

async function doImportList(type: 'blacklist' | 'whitelist') {
  const target = type === 'blacklist' ? pendingBlack : pendingWhite
  if (!target.value) return
  busy.value = true
  const res = await send('qq-guanqun/mutate', {
    action: 'import.list',
    data: { bundle: target.value.bundle, type, mode: listMode.value },
  })
  busy.value = false
  if (res?.ok) {
    toast.success('名单导入完成')
    target.value = null
    invalidateScope('lists')
    refresh(undefined, true)
  } else {
    toast.error(res?.error || '导入失败')
  }
}
</script>

<style scoped>
.qg-sub-title { font-size: 13px; margin: 16px 0 8px; padding-top: 12px; border-top: 1px dashed var(--qg-border); }
.qg-check { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--qg-text-2); cursor: pointer; margin: 4px 0; }
.qg-check input { accent-color: var(--qg-primary); cursor: pointer; }
.qg-card.flat h4 { margin: 0 0 4px; font-size: 13.5px; }
.qg-ul { margin: 6px 0 0; padding-left: 18px; font-size: 12.5px; color: var(--qg-text-2); line-height: 1.8; }
</style>
