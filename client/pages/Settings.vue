<template>
  <div>
    <Skeleton v-if="!data && loading" :rows="5" />

    <template v-else-if="data">
      <!-- 超级管理员 -->
      <Section title="超级管理员" sub="拥有全部权限，可审核入群 / 好友 / 邀请申请" icon="👑" :open="true">
        <div class="qg-add" style="margin-top:0">
          <input class="qg-input" v-model="superInput" placeholder="输入 QQ 号，多个用逗号 / 空格分隔" @keyup.enter="addSuper" />
          <button class="qg-btn primary" @click="addSuper">添加</button>
        </div>
        <div style="margin-top:10px">
          <TagList :items="superUsers" removable empty-text="尚未添加超级管理员" @remove="removeSuper" />
        </div>
        <div class="qg-actions">
          <button class="qg-btn primary" @click="saveSuper">保存超级管理员</button>
        </div>
        <p class="qg-hint">超级管理员不受权限组与生效群限制，始终拥有全部群管命令与审核能力。</p>
      </Section>

      <!-- 机器人状态 -->
      <Section title="协议端状态" icon="🔌" :open="true">
        <div class="qg-grid two">
          <div>
            <div class="qg-row static">
              <span class="qg-row-label">OneBot 框架</span>
              <span class="qg-tag neutral">{{ frameworkName }}</span>
            </div>
            <p class="qg-hint tight">
              当前由插件 Schema 配置项决定，实际调用时优先使用协议端提供的底层 <code>_request</code> 透传标准 action，
              因此 LLBot / NapCat / go-cqhttp 均可直接使用。如需修改请到 Koishi 的插件配置面板。
            </p>
          </div>
          <div>
            <h4>已连接机器人</h4>
            <EmptyState v-if="!data.bots?.length" text="暂无已连接的机器人" icon="🔌" sm />
            <div v-else class="qg-bot-list">
              <div v-for="b in data.bots" :key="b.selfId + b.platform" class="qg-bot-row">
                <span class="qg-tag operation">{{ b.platform }}</span>
                <span>{{ b.selfId || '未知账号' }}</span>
                <span class="qg-muted">{{ b.groups }} 个群</span>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <!-- 通知转发 -->
      <Section title="通知转发" :sub="form.rfEnabled ? '已启用' : '未启用'" icon="📤" :open="true">
        <p class="qg-muted">将机器人收到的入群申请、邀请入群、加好友申请统一转发到指定私聊或群聊，超级管理员引用回复即可审批。</p>
        <ToggleRow label="总开关" v-model="form.rfEnabled" />
        <div class="qg-grid two">
          <ToggleRow
            label="转发方式"
            type="select"
            v-model="form.rfMode"
            :options="[{ label: '群聊', value: 'group' }, { label: '私聊', value: 'private' }]"
          />
          <label class="qg-field">
            <label>目标（群号或私聊 QQ）</label>
            <input class="qg-input" v-model="form.rfTargetId" placeholder="群号或私聊 QQ 号" />
          </label>
        </div>
        <label class="qg-field" style="margin-top:10px">
          <label>转发内容格式</label>
          <textarea class="qg-textarea" rows="4" v-model="form.rfText"></textarea>
        </label>
        <p class="qg-hint">
          变量：{title}=申请类型标题、{userId}=申请人QQ、{nickname}=申请人昵称、{groupId}=群号（好友申请为空）、{comment}=申请内容/附言。
          目标不能是已在「群聊列表」中配置的群聊。
        </p>
        <div class="qg-actions"><button class="qg-btn primary" @click="saveGlobal">保存通知转发</button></div>
      </Section>

      <!-- AI 接口 -->
      <Section title="AI 接口（全局默认）" :sub="aiForm.enabled ? '已启用' : '未启用'" icon="🤖" :open="true">
        <p class="qg-muted">
          统一 OpenAI 兼容接口。入群自动审批、举报审核等 LLM 功能均使用此接口；
          各群可在「群配置详情」中独立覆盖，留空则使用此处全局设置。
        </p>
        <div class="qg-grid two">
          <ToggleRow label="启用 AI" v-model="aiForm.enabled" />
          <label class="qg-field"><label>baseURL</label><input class="qg-input" v-model="aiForm.baseURL" placeholder="https://api.openai.com/v1" /></label>
          <label class="qg-field"><label>API Key</label><input class="qg-input" type="password" v-model="aiForm.apiKey" placeholder="sk-..." /></label>
          <label class="qg-field"><label>模型</label><input class="qg-input" v-model="aiForm.model" placeholder="gpt-4o-mini" /></label>
          <label class="qg-field"><label>temperature</label><input class="qg-input" type="number" step="0.1" v-model="aiForm.temperature" /></label>
          <label class="qg-field"><label>max_tokens</label><input class="qg-input" type="number" v-model="aiForm.maxTokens" /></label>
          <label class="qg-field"><label>超时(毫秒)</label><input class="qg-input" type="number" v-model="aiForm.timeout" /></label>
        </div>
        <div class="qg-actions">
          <button class="qg-btn primary" @click="saveAi">保存 AI 设置</button>
          <button class="qg-btn" :disabled="testing" @click="testAi">{{ testing ? '测试中…' : '测试连接' }}</button>
        </div>
        <p class="qg-hint">「入群审核提示词」与「举报审核提示词」请在「群配置详情」中按群配置，或使用全局默认提示词。</p>
      </Section>

      <!-- 提示词参考 -->
      <Section title="默认提示词参考" icon="📄">
        <div class="qg-grid two">
          <div>
            <h4>入群审核系统提示词（固定，不可修改）</h4>
            <pre class="qg-fixed-prompt">{{ joinPromptFixed }}</pre>
          </div>
          <div>
            <h4>举报审核默认提示词</h4>
            <pre class="qg-fixed-prompt">{{ reportPromptDefault }}</pre>
          </div>
        </div>
      </Section>
    </template>

    <EmptyState v-else :text="error || '暂无数据'" icon="⚠️" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, reactive, watch } from 'vue'
import { useScope, mutate, invalidateScope, splitList } from '../useData'
import { toast } from '../toast'
import Section from '../components/Section.vue'
import EmptyState from '../components/EmptyState.vue'
import Skeleton from '../components/Skeleton.vue'
import ToggleRow from '../components/ToggleRow.vue'
import TagList from '../components/TagList.vue'

const superUsers = ref<string[]>([])
const superInput = ref('')
const framework = ref('auto')
const testing = ref(false)
const form = reactive<any>({ rfEnabled: false, rfMode: 'group', rfTargetId: '', rfText: '' })
const aiForm = reactive<any>({ enabled: false, baseURL: '', apiKey: '', model: '', temperature: 0.3, maxTokens: 1024, timeout: 30000 })

const joinPromptFixed = `你是一个 QQ 群的入群申请审核助手。请根据申请人的入群申请内容与验证答案，判断是否应该批准其入群。
请严格以 JSON 格式输出，不要包含任何多余文字、代码块或解释，格式如下：
{"approve": true或false, "reason": "简洁的中文审核理由"}`

const reportPromptDefault = `你是一个 QQ 群消息的违规审核助手。请判断给定消息是否违规，并给出违规类型、程度与建议禁言时长。
违规类型只能是：涉黄、涉政、人身攻击、广告、其他
违规程度只能是：轻度、中度、重度
请严格以 JSON 格式输出，格式如下：
{"violation": true或false, "type": "...", "level": "...", "reason": "...", "muteDuration": 建议禁言分钟数}`

const { data, loading, error, refresh } = useScope<any>('settings')

watch(data, (d) => {
  const g = d?.global
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
  framework.value = d.onebotFramework || 'auto'
}, { immediate: true })

function addSuper() {
  for (const u of splitList(superInput.value)) {
    if (!superUsers.value.includes(u)) superUsers.value.push(u)
  }
  superInput.value = ''
}
function removeSuper(u: string) {
  superUsers.value = superUsers.value.filter((x) => x !== u)
}

async function saveSuper() {
  const res = await mutate('setGlobal', { superUsers: superUsers.value })
  if (res?.ok) {
    toast.success('超级管理员已保存')
    invalidateScope('settings')
  } else {
    toast.error(res?.error || '保存失败')
  }
}

async function saveGlobal() {
  const res = await mutate('setGlobal', {
    requestForward: {
      enabled: form.rfEnabled,
      mode: form.rfMode,
      targetId: form.rfTargetId.trim(),
      text: form.rfText,
    },
  })
  if (res?.ok) {
    toast.success('通知转发设置已保存')
    invalidateScope('settings')
  } else {
    toast.error(res?.error || '保存失败')
  }
}

async function saveAi() {
  const res = await mutate('setGlobal', {
    ai: {
      enabled: aiForm.enabled,
      baseURL: String(aiForm.baseURL).trim(),
      apiKey: String(aiForm.apiKey).trim(),
      model: String(aiForm.model).trim(),
      temperature: Number(aiForm.temperature),
      maxTokens: Number(aiForm.maxTokens),
      timeout: Number(aiForm.timeout),
    },
  })
  if (res?.ok) {
    toast.success('AI 设置已保存')
    invalidateScope('settings')
  } else {
    toast.error(res?.error || '保存失败')
  }
}

async function testAi() {
  if (!aiForm.baseURL || !aiForm.apiKey || !aiForm.model) {
    toast.warning('请先填写 baseURL、API Key 与模型')
    return
  }
  testing.value = true
  const res = await mutate('ai.test', {
    baseURL: String(aiForm.baseURL).trim(),
    apiKey: String(aiForm.apiKey).trim(),
    model: String(aiForm.model).trim(),
    timeout: Number(aiForm.timeout) || 15000,
  })
  testing.value = false
  if (res?.ok) toast.success(res.data?.message || 'AI 接口连接成功')
  else toast.error(res?.error || '连接失败')
}

// 框架选择实际由插件 Schema 控制，此处只做只读展示
const frameworkName = computed(() => {
  const map: Record<string, string> = { auto: '自动检测', napcat: 'NapCat', llbot: 'LLBot' }
  return map[framework.value] || framework.value || '自动检测'
})
</script>

<style scoped>
code { background: var(--qg-hover); border-radius: 4px; padding: 1px 5px; font-size: 12px; }
.qg-bot-list { display: flex; flex-direction: column; gap: 6px; }
.qg-bot-row { display: flex; align-items: center; gap: 9px; font-size: 13px; }
</style>
