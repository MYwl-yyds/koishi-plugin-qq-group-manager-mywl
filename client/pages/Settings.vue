<template>
  <div>
      <div class="qg-heading">
        <h2>全局设置</h2>
        <button class="qg-btn primary" @click="saveGlobal">保存全局设置</button>
      </div>

      <div v-if="data">
        <div class="qg-card">
          <h3>超级管理员</h3>
          <p class="qg-muted">超级管理员拥有全部权限，可审核入群申请、加好友申请与邀请入群等通知。</p>
          <div class="qg-add" style="margin-top:0">
            <input class="qg-input" v-model="superInput" placeholder="输入 QQ 号，多个用逗号/空格分隔" @keyup.enter="addSuper" />
            <button class="qg-btn primary" @click="addSuper">添加</button>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
            <span v-for="s in superUsers" :key="s" class="qg-pill">{{ s }} <button @click="removeSuper(s)">×</button></span>
            <span v-if="superUsers.length === 0" class="qg-muted">尚未添加超级管理员</span>
          </div>
        </div>

        <div class="qg-card">
          <h3>通知转发（请求通知统一转发）</h3>
          <p class="qg-muted">将机器人收到的入群申请、邀请入群、加好友申请统一转发到指定私聊或群聊，仅超级管理员可审核。</p>
          <label class="qg-row"><span>总开关</span><input type="checkbox" v-model="form.rfEnabled" /></label>
          <label class="qg-row"><span>转发方式</span>
            <select class="qg-select grow" v-model="form.rfMode">
              <option value="group">群聊</option><option value="private">私聊</option>
            </select>
          </label>
          <label class="qg-row"><span>目标 QQ</span><input class="qg-input grow" v-model="form.rfTargetId" placeholder="群号或私聊 QQ 号" /></label>
          <div class="qg-notice" style="margin-top:10px">
            <p class="qg-hint">转发内容格式（支持变量，未自定义则用默认格式）：{title}=申请类型标题（加好友申请/入群申请/邀请入群）、{userId}=申请人QQ、{nickname}=申请人昵称、{groupId}=群号（好友申请时为空）、{comment}=申请内容/附言。</p>
            <textarea class="qg-textarea" v-model="form.rfText" rows="4"></textarea>
          </div>
        </div>

        <div class="qg-actions">
          <button class="qg-btn primary" @click="saveGlobal">保存全局设置</button>
        </div>

        <hr class="qg-sep" />

        <div class="qg-card" style="border-color:#c7d2fe;background:#f8faff">
          <h3>AI 接口设置（全局默认接口）</h3>
          <p class="qg-muted">仅配置接口相关信息。入群自动审批、举报审核等 LLM 功能统一使用此接口；各群可在「群聊管理」中独立覆盖接口配置，留空则使用此处全局设置。</p>
          <label class="qg-row"><span>启用 AI</span><input type="checkbox" v-model="aiForm.enabled" /></label>
          <label class="qg-row"><span>baseURL</span><input class="qg-input grow" v-model="aiForm.baseURL" /></label>
          <label class="qg-row"><span>API Key</span><input class="qg-input grow" type="password" v-model="aiForm.apiKey" /></label>
          <label class="qg-row"><span>模型</span><input class="qg-input grow" v-model="aiForm.model" /></label>
          <div class="qg-grid two" style="margin-top:8px">
            <label class="qg-row"><span>temperature</span><input class="qg-input grow" type="number" step="0.1" v-model="aiForm.temperature" /></label>
            <label class="qg-row"><span>max_tokens</span><input class="qg-input grow" type="number" v-model="aiForm.maxTokens" /></label>
          </div>
          <label class="qg-row"><span>超时(毫秒)</span><input class="qg-input grow" type="number" v-model="aiForm.timeout" /></label>
          <div class="qg-actions"><button class="qg-btn primary" @click="saveAi">保存 AI 设置</button></div>
        </div>
      </div>
      <div v-else class="qg-muted">加载中…</div>
    </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useGmData } from '../useData'
import { toast } from '../toast'

const { data, refresh, mutate } = useGmData()

const superUsers = ref<string[]>([])
const superInput = ref('')

const form = reactive<any>({})
const aiForm = reactive<any>({
  enabled: false, baseURL: '', apiKey: '', model: '', temperature: 0.3, maxTokens: 1024, timeout: 30000,
})

function split(s: any): string[] {
  if (Array.isArray(s)) return s.map(String)
  return String(s || '').split(/[,，\s]+/).filter(Boolean)
}

function addSuper() {
  for (const u of split(superInput.value)) {
    if (u && !superUsers.value.includes(u)) superUsers.value.push(u)
  }
  superInput.value = ''
}
function removeSuper(u: string) {
  superUsers.value = superUsers.value.filter((x) => x !== u)
}

async function loadForm() {
  const g = data.value?.global
  if (!g) return
  superUsers.value = [...(g.superUsers || [])]
  form.rfEnabled = !!g.requestForward?.enabled
  form.rfMode = g.requestForward?.mode || 'group'
  form.rfTargetId = g.requestForward?.targetId || ''
  form.rfText = g.requestForward?.text || ''

  aiForm.enabled = !!g.ai?.enabled
  aiForm.baseURL = g.ai?.baseURL || ''
  aiForm.apiKey = g.ai?.apiKey || ''
  aiForm.model = g.ai?.model || ''
  aiForm.temperature = g.ai?.temperature ?? 0.3
  aiForm.maxTokens = g.ai?.maxTokens ?? 1024
  aiForm.timeout = g.ai?.timeout ?? 30000
}

async function saveGlobal() {
  const patch: any = {
    superUsers: superUsers.value,
    requestForward: { enabled: form.rfEnabled, mode: form.rfMode, targetId: form.rfTargetId.trim(), text: form.rfText },
  }
  const res = await mutate('setGlobal', patch)
  if (res?.ok) {
    toast.success('已保存全局设置')
  } else {
    toast.error(res?.error || '保存失败')
  }
}

async function saveAi() {
  const res = await mutate('setGlobal', {
    ai: {
      enabled: aiForm.enabled, baseURL: aiForm.baseURL.trim(), apiKey: aiForm.apiKey.trim(), model: aiForm.model.trim(),
      temperature: Number(aiForm.temperature), maxTokens: Number(aiForm.maxTokens), timeout: Number(aiForm.timeout),
    },
  })
  if (res?.ok) {
    toast.success('AI 设置已保存')
  } else {
    toast.error(res?.error || '保存失败')
  }
}

onMounted(async () => {
  await refresh()
  loadForm()
})
</script>