<template>
  <div>
      <div class="qg-heading">
        <h2>群聊管理</h2>
        <button class="qg-btn primary" :disabled="!selectedId" @click="save">保存本群配置</button>
      </div>

      <div v-if="data" class="qg-layout">
        <div class="qg-side">
          <h3>已配置的群</h3>
          <div v-for="g in data.groups" :key="g.id" class="qg-item" :class="{ active: g.groupId === selectedId }" @click="select(g.groupId)">
            {{ g.groupId }}
          </div>
          <div v-if="data.groups.length === 0" class="qg-muted">尚未配置任何群</div>
          <div class="qg-add">
            <textarea class="qg-textarea" v-model="newGroupId" rows="2" placeholder="输入群 QQ 号，多个用逗号/空格/换行分隔"></textarea>
            <button class="qg-btn primary" @click="addGroup">批量添加</button>
          </div>
        </div>

        <div style="min-width:0">
          <div v-if="!selectedId" class="qg-card" style="margin:0"><span class="qg-hint">请在左侧选择或添加一个群聊进行配置。此处为「群级覆盖」，优先于全局设置；留空的项目沿用全局配置。</span></div>

          <div v-else>
            <div class="qg-card">
              <div class="qg-heading"><h3>群 {{ selectedId }} 配置</h3>
                <button class="qg-btn sm danger" @click="reset">重置为全局</button>
              </div>
              <label class="qg-row" title="关闭后本群不启用任何群管功能"><span>群管功能总开关</span><input type="checkbox" v-model="form.enableGroupManagement" /></label>
            </div>

            <div class="qg-grid two">
              <div class="qg-card">
                <h3>禁言</h3>
                <label class="qg-row" title="是否允许使用禁言命令"><span>禁言功能</span><input type="checkbox" v-model="form.muteEnabled" /></label>
                <label class="qg-row" title="单次禁言允许的最大时长（分钟）"><span>最大禁言时长(分)</span><input class="qg-input grow" type="number" v-model="form.muteMaxDuration" /></label>
              </div>
              <div class="qg-card">
                <h3>精华 / 头衔</h3>
                <label class="qg-row" title="是否允许设置/取消精华消息"><span>精华消息</span><input type="checkbox" v-model="form.essenceEnabled" /></label>
                <label class="qg-row" title="是否允许设置/取消群专属头衔"><span>群头衔</span><input type="checkbox" v-model="form.titleEnabled" /></label>
              </div>
            </div>

            <div class="qg-card">
              <h3>欢迎 / 欢送语</h3>
              <label class="qg-row" title="新成员入群时发送欢迎语"><span>欢迎语</span><input type="checkbox" v-model="form.welcomeEnabled" /></label>
              <label class="qg-row" style="align-items:flex-start" title="可用变量：{userId} 成员QQ、{nickname} 昵称、{groupId} 群号、{level} QQ等级、{avatar} 头像"><span>欢迎语文案</span><textarea class="qg-textarea grow" v-model="form.welcomeText" rows="2" placeholder="默认：欢迎 {nickname} 加入本群！"></textarea></label>
              <label class="qg-row" title="成员退群时发送欢送语"><span>欢送语</span><input type="checkbox" v-model="form.farewellEnabled" /></label>
              <label class="qg-row" style="align-items:flex-start" title="可用变量：{userId} 成员QQ、{nickname} 昵称、{groupId} 群号、{level} QQ等级、{avatar} 头像"><span>欢送语文案</span><textarea class="qg-textarea grow" v-model="form.farewellText" rows="2" placeholder="默认：{nickname} 离开了本群。"></textarea></label>
              <p class="qg-hint">欢迎/欢送语支持变量：{userId}=成员QQ号、{groupId}=群号、{nickname}=成员昵称、{level}=QQ等级、{avatar}=头像图片。例如「欢迎 {nickname} 加入本群！」。</p>
            </div>

            <div class="qg-card">
              <h3>举报</h3>
              <label class="qg-row" title="是否允许在本群使用举报命令"><span>举报功能</span><input type="checkbox" v-model="form.reportEnabled" /></label>
              <label class="qg-row"><span>频率限制</span><input type="checkbox" v-model="form.reportFreqEnabled" /></label>
              <div class="qg-grid two" style="margin-top:6px">
                <label class="qg-row"><span>窗口(分钟)</span><input class="qg-input grow" type="number" v-model="form.reportFreqWindow" /></label>
                <label class="qg-row"><span>窗口内最大次数</span><input class="qg-input grow" type="number" v-model="form.reportFreqMax" /></label>
              </div>
              <label class="qg-row" style="align-items:flex-start" title="举报判定后的惩罚映射，数组元素含 level/muteDuration/kick/recall（禁言时长由 AI 自定义）"><span>惩罚映射(JSON)</span><textarea class="qg-textarea grow" v-model="form.levelsJson" rows="4"></textarea></label>
            </div>

            <div class="qg-card">
              <h3>入群审核</h3>
              <label class="qg-row" title="是否启用入群审核流程"><span>总开关</span><input type="checkbox" v-model="form.joinEnabled" /></label>
              <div class="qg-grid two" style="margin-top:8px">
                <div>
                  <label class="qg-row" title="按时间窗口内申请次数判断是否过于频繁"><span>频率检查</span><input type="checkbox" v-model="form.freqEnabled" /></label>
                  <label class="qg-row" title="频率统计窗口（分钟）"><span>频率窗口(分)</span><input class="qg-input grow" type="number" v-model="form.freqWindow" /></label>
                  <label class="qg-row" title="窗口内允许的最大申请次数"><span>窗口内最大次数</span><input class="qg-input grow" type="number" v-model="form.freqMax" /></label>
                  <label class="qg-row" title="命中黑名单自动拒绝"><span>黑名单检查</span><input type="checkbox" v-model="form.blEnabled" /></label>
                  <label class="qg-row" title="按申请人 QQ 等级判断（低于最低等级自动拒绝）"><span>QQ 等级检查</span><input type="checkbox" v-model="form.levelEnabled" /></label>
                  <label class="qg-row" title="通过审核所需的最低 QQ 等级"><span>最低等级</span><input class="qg-input grow" type="number" v-model="form.minLevel" /></label>
                </div>
                <div>
                  <label class="qg-row" title="按通过/拒绝关键词判断申请"><span>关键词检查</span><input type="checkbox" v-model="form.kwEnabled" /></label>
                  <label class="qg-row" style="align-items:flex-start" title="命中即自动通过，逗号/换行分隔"><span>通过关键词</span><textarea class="qg-textarea grow" v-model="form.passKeywords" rows="2" placeholder="逗号分隔"></textarea></label>
                  <label class="qg-row" style="align-items:flex-start" title="命中即自动拒绝，逗号/换行分隔"><span>拒绝关键词</span><textarea class="qg-textarea grow" v-model="form.rejectKeywords" rows="2" placeholder="逗号分隔"></textarea></label>
                  <label class="qg-row" title="需要人工审核（可通过引用回复通知审批）"><span>人工审核</span><input type="checkbox" v-model="form.manualEnabled" /></label>
                  <label class="qg-row" title="人工审核超时时间（分钟）"><span>人工超时(分)</span><input class="qg-input grow" type="number" v-model="form.manualTimeout" /></label>
                  <label class="qg-row" title="人工审核后交由 LLM 自动判断"><span>LLM 自动处理</span><input type="checkbox" v-model="form.llmEnabled" /></label>
                </div>
              </div>
              <label class="qg-row" style="align-items:flex-start" title="可参与人工审核的审核员 QQ，逗号/换行分隔（超管始终可审核）"><span>审核员 QQ</span><textarea class="qg-textarea grow" v-model="form.reviewers" rows="2" placeholder="逗号分隔"></textarea></label>
              <label class="qg-row" title="人工审核通知的发送方式"><span>通知方式</span>
                <select class="qg-select grow" v-model="form.notifyMode">
                  <option value="group">群聊</option><option value="private">私聊</option><option value="both">两者</option>
                </select>
              </label>
              <label class="qg-row" title="人工审核通知发送到的群号（通知方式为群聊时）"><span>通知群号</span><input class="qg-input grow" v-model="form.notifyGroupId" /></label>
            </div>

            <div class="qg-card">
              <h3>违禁词</h3>
              <label class="qg-row" title="是否启用违禁词检测"><span>总开关</span><input type="checkbox" v-model="form.bwEnabled" /></label>
              <label class="qg-row" title="触发违禁词后禁言（与「踢出」互斥，只能选其一）"><span>触发后禁言</span><input type="checkbox" v-model="form.bwBan" @change="onBanToggle" /></label>
              <label class="qg-row" title="触发违禁词后踢出（与「禁言」互斥，只能选其一）"><span>触发后踢出</span><input type="checkbox" v-model="form.bwKick" @change="onKickToggle" /></label>
              <label class="qg-row" title="触发违禁词后撤回该消息"><span>触发后撤回</span><input type="checkbox" v-model="form.bwRecall" /></label>
              <label class="qg-row" title="触发违禁词后禁言的时长（分钟）"><span>禁言时长(分)</span><input class="qg-input grow" type="number" v-model="form.bwDuration" /></label>
              <div class="qg-add" style="margin-top:8px">
                <input class="qg-input" v-model="bannedInput" placeholder="违禁词，多个用逗号/空格分隔" />
                <button class="qg-btn primary" @click="addBannedWords">批量添加</button>
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
                <span v-for="w in form.bwWords" :key="w" class="qg-pill">{{ w }} <button @click="removeBannedWord(w)">×</button></span>
              </div>
            </div>

            <div class="qg-card">
              <h3>退群自动拉黑</h3>
              <label class="qg-row" title="是否启用退群自动拉黑"><span>总开关</span><input type="checkbox" v-model="form.abEnabled" /></label>
              <label class="qg-row" title="成员主动退群时自动拉黑"><span>拉黑主动退群</span><input type="checkbox" v-model="form.abSelf" /></label>
              <label class="qg-row" title="成员被踢出时自动拉黑"><span>拉黑被踢出</span><input type="checkbox" v-model="form.abKicked" /></label>
              <label class="qg-row" title="退群后延迟拉黑（分钟），0 表示立即拉黑"><span>延迟(分)</span><input class="qg-input grow" type="number" v-model="form.abDelay" /></label>
            </div>

            <div class="qg-card" style="border-color:#c7d2fe;background:#f8faff">
              <h3>AI / LLM 接口（本群独立配置，留空则用全局）</h3>
              <label class="qg-row" title="留空则使用全局接口"><span>baseURL</span><input class="qg-input grow" v-model="aiForm.baseURL" placeholder="留空用全局" /></label>
              <label class="qg-row" title="留空则使用全局接口"><span>API Key</span><input class="qg-input grow" type="password" v-model="aiForm.apiKey" placeholder="留空用全局" /></label>
              <label class="qg-row" title="留空则使用全局接口"><span>模型</span><input class="qg-input grow" v-model="aiForm.model" placeholder="留空用全局" /></label>
              <div class="qg-grid two" style="margin-top:8px">
                <label class="qg-row" title="留空则使用全局接口"><span>temperature</span><input class="qg-input grow" type="number" step="0.1" v-model="aiForm.temperature" placeholder="留空用全局" /></label>
                <label class="qg-row" title="留空则使用全局接口"><span>max_tokens</span><input class="qg-input grow" type="number" v-model="aiForm.maxTokens" placeholder="留空用全局" /></label>
              </div>
              <label class="qg-row" title="留空则使用全局接口"><span>超时(毫秒)</span><input class="qg-input grow" type="number" v-model="aiForm.timeout" placeholder="留空用全局" /></label>
              <label class="qg-row" style="align-items:flex-start" title="入群审核提示词，留空则使用全局默认提示词"><span>入群审核提示词</span><textarea class="qg-textarea grow" v-model="aiForm.joinPrompt" rows="3" placeholder="留空则使用全局默认提示词"></textarea></label>
              <label class="qg-row" style="align-items:flex-start" title="举报审核提示词，留空则使用全局默认提示词"><span>举报审核提示词</span><textarea class="qg-textarea grow" v-model="aiForm.reportPrompt" rows="3" placeholder="留空则使用全局默认提示词"></textarea></label>
            </div>

            <div class="qg-card" style="border-color:#fde68a;background:#fffdf5">
              <h3>执行后结果通知（自定义消息 + 变量）</h3>

              <div class="qg-notice">
                <h4>入群自动判定结果通知</h4>
                <p class="qg-hint">发送目标复用入群审核的「通知方式/通知群号/审核员」。可用变量：{userId}=申请人QQ、{nickname}=申请人昵称、{level}=QQ等级、{question}=入群问题、{answer}=申请回答、{result}=判定结果、{reason}=审核理由、{avatar}=头像图片。其中 {question}/{answer}/{level} 为空时整行自动省略。</p>
                <label class="qg-row"><span>启用</span><input type="checkbox" v-model="form.autoNotice.enabled" /></label>
                <textarea class="qg-textarea" v-model="form.autoNotice.text" rows="6"></textarea>
              </div>

              <div class="qg-notice">
                <h4>违禁词·撤回通知</h4>
                <p class="qg-hint">可用变量：{userId}=触发用户QQ、{groupId}=群号、{nickname}=触发用户昵称、{word}=触发的违禁词、{punish}=处罚结果。</p>
                <label class="qg-row"><span>启用</span><input type="checkbox" v-model="form.bwRecallNotice.enabled" /></label>
                <div class="qg-grid two" style="margin-top:4px">
                  <label class="qg-row"><span>发送方式</span><select class="qg-select grow" v-model="form.bwRecallNotice.mode"><option value="group">群聊</option><option value="private">私聊</option></select></label>
                  <label class="qg-row"><span>目标</span><input class="qg-input grow" v-model="form.bwRecallNotice.targetId" placeholder="留空发送到事件所在群" /></label>
                </div>
                <textarea class="qg-textarea" v-model="form.bwRecallNotice.text" rows="4"></textarea>
              </div>

              <div class="qg-notice">
                <h4>违禁词·禁言通知</h4>
                <p class="qg-hint">可用变量：{userId}=触发用户QQ、{groupId}=群号、{nickname}=触发用户昵称、{word}=触发的违禁词、{punish}=处罚结果。</p>
                <label class="qg-row"><span>启用</span><input type="checkbox" v-model="form.bwBanNotice.enabled" /></label>
                <div class="qg-grid two" style="margin-top:4px">
                  <label class="qg-row"><span>发送方式</span><select class="qg-select grow" v-model="form.bwBanNotice.mode"><option value="group">群聊</option><option value="private">私聊</option></select></label>
                  <label class="qg-row"><span>目标</span><input class="qg-input grow" v-model="form.bwBanNotice.targetId" placeholder="留空发送到事件所在群" /></label>
                </div>
                <textarea class="qg-textarea" v-model="form.bwBanNotice.text" rows="4"></textarea>
              </div>

              <div class="qg-notice">
                <h4>违禁词·踢出通知</h4>
                <p class="qg-hint">可用变量：{userId}=触发用户QQ、{groupId}=群号、{nickname}=触发用户昵称、{word}=触发的违禁词、{punish}=处罚结果。</p>
                <label class="qg-row"><span>启用</span><input type="checkbox" v-model="form.bwKickNotice.enabled" /></label>
                <div class="qg-grid two" style="margin-top:4px">
                  <label class="qg-row"><span>发送方式</span><select class="qg-select grow" v-model="form.bwKickNotice.mode"><option value="group">群聊</option><option value="private">私聊</option></select></label>
                  <label class="qg-row"><span>目标</span><input class="qg-input grow" v-model="form.bwKickNotice.targetId" placeholder="留空发送到事件所在群" /></label>
                </div>
                <textarea class="qg-textarea" v-model="form.bwKickNotice.text" rows="4"></textarea>
              </div>

              <div class="qg-notice">
                <h4>退群自动拉黑通知</h4>
                <p class="qg-hint">可用变量：{userId}=退群用户QQ、{groupId}=群号、{nickname}=退群用户昵称、{reason}=拉黑原因。</p>
                <label class="qg-row"><span>启用</span><input type="checkbox" v-model="form.abNotice.enabled" /></label>
                <div class="qg-grid two" style="margin-top:4px">
                  <label class="qg-row"><span>发送方式</span><select class="qg-select grow" v-model="form.abNotice.mode"><option value="group">群聊</option><option value="private">私聊</option></select></label>
                  <label class="qg-row"><span>目标</span><input class="qg-input grow" v-model="form.abNotice.targetId" placeholder="留空发送到事件所在群" /></label>
                </div>
                <textarea class="qg-textarea" v-model="form.abNotice.text" rows="4"></textarea>
              </div>
            </div>

            <div class="qg-actions">
              <button class="qg-btn primary" @click="save">保存</button>
            </div>
          </div>
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
onMounted(refresh)

const selectedId = ref<string>('')
const newGroupId = ref('')
const bannedInput = ref('')

const form = reactive<any>({})
const aiForm = reactive<any>({ baseURL: '', apiKey: '', model: '', temperature: '', maxTokens: '', timeout: '', joinPrompt: '', reportPrompt: '' })

function split(s: any): string[] {
  if (Array.isArray(s)) return s.map(String)
  return String(s || '').split(/[,，\s]+/).filter(Boolean)
}

function loadNotice(c: any, g: any) {
  c = c || {}; g = g || {}
  return {
    enabled: c.enabled ?? g.enabled ?? false,
    mode: c.mode ?? g.mode ?? 'group',
    targetId: c.targetId ?? g.targetId ?? '',
    text: c.text || g.text || '',
  }
}

function fillFrom(cfg: any, g: any) {
  const c = cfg || {}
  form.enableGroupManagement = c.enableGroupManagement !== undefined ? c.enableGroupManagement : g.enableGroupManagement
  form.muteEnabled = c.mute?.enabled ?? g.mute?.enabled
  form.muteMaxDuration = c.mute?.maxDuration ?? g.mute?.maxDuration ?? 43200
  form.welcomeEnabled = c.welcome?.enabled ?? g.welcome?.enabled
  form.welcomeText = c.welcome?.text ?? g.welcome?.text ?? ''
  form.farewellEnabled = c.farewell?.enabled ?? g.farewell?.enabled
  form.farewellText = c.farewell?.text ?? g.farewell?.text ?? ''
  form.joinEnabled = c.joinReview?.enabled ?? g.joinReview?.enabled
  form.freqEnabled = c.joinReview?.frequency?.enabled ?? g.joinReview?.frequency?.enabled
  form.freqWindow = c.joinReview?.frequency?.windowMinutes ?? g.joinReview?.frequency?.windowMinutes ?? 10
  form.freqMax = c.joinReview?.frequency?.maxCount ?? g.joinReview?.frequency?.maxCount ?? 3
  form.blEnabled = c.joinReview?.blacklist?.enabled ?? g.joinReview?.blacklist?.enabled
  form.levelEnabled = c.joinReview?.qqLevel?.enabled ?? g.joinReview?.qqLevel?.enabled
  form.minLevel = c.joinReview?.qqLevel?.minLevel ?? g.joinReview?.qqLevel?.minLevel ?? 8
  form.kwEnabled = c.joinReview?.keyword?.enabled ?? g.joinReview?.keyword?.enabled
  form.passKeywords = (c.joinReview?.keyword?.passKeywords ?? g.joinReview?.keyword?.passKeywords ?? []).join(',')
  form.rejectKeywords = (c.joinReview?.keyword?.rejectKeywords ?? g.joinReview?.keyword?.rejectKeywords ?? []).join(',')
  form.manualEnabled = c.joinReview?.manual?.enabled ?? g.joinReview?.manual?.enabled
  form.manualTimeout = c.joinReview?.manual?.timeoutMinutes ?? g.joinReview?.manual?.timeoutMinutes ?? 30
  form.reviewers = (c.joinReview?.manual?.reviewers ?? g.joinReview?.manual?.reviewers ?? []).join(',')
  form.notifyMode = c.joinReview?.manual?.notifyMode ?? g.joinReview?.manual?.notifyMode ?? 'group'
  form.notifyGroupId = c.joinReview?.manual?.notifyGroupId ?? g.joinReview?.manual?.notifyGroupId ?? ''
  form.llmEnabled = c.joinReview?.llm?.enabled ?? g.joinReview?.llm?.enabled
  form.bwEnabled = c.bannedWords?.enabled ?? g.bannedWords?.enabled
  form.bwBan = c.bannedWords?.banOnTrigger ?? g.bannedWords?.banOnTrigger
  form.bwKick = c.bannedWords?.kickOnTrigger ?? g.bannedWords?.kickOnTrigger
  form.bwRecall = c.bannedWords?.recallOnTrigger ?? g.bannedWords?.recallOnTrigger
  form.bwDuration = c.bannedWords?.banDuration ?? g.bannedWords?.banDuration ?? 10
  form.bwWords = [...(c.bannedWords?.words ?? g.bannedWords?.words ?? [])]
  form.reportEnabled = c.report?.enabled ?? g.report?.enabled
  form.reportFreqEnabled = c.report?.frequency?.enabled ?? g.report?.frequency?.enabled ?? true
  form.reportFreqWindow = c.report?.frequency?.windowMinutes ?? g.report?.frequency?.windowMinutes ?? 5
  form.reportFreqMax = c.report?.frequency?.maxCount ?? g.report?.frequency?.maxCount ?? 3
  form.levelsJson = JSON.stringify(c.report?.levels ?? g.report?.levels ?? [], null, 2)
  form.abEnabled = c.autoBlacklist?.enabled ?? g.autoBlacklist?.enabled
  form.abSelf = c.autoBlacklist?.onSelfLeave ?? g.autoBlacklist?.onSelfLeave
  form.abKicked = c.autoBlacklist?.onKicked ?? g.autoBlacklist?.onKicked
  form.abDelay = c.autoBlacklist?.delayMinutes ?? g.autoBlacklist?.delayMinutes ?? 0
  form.essenceEnabled = c.essence?.enabled ?? g.essence?.enabled
  form.titleEnabled = c.title?.enabled ?? g.title?.enabled

  form.autoNotice = loadNotice(c.joinReview?.autoNotice, g.joinReview?.autoNotice)
  form.bwRecallNotice = loadNotice(c.bannedWords?.recallNotice, g.bannedWords?.recallNotice)
  form.bwBanNotice = loadNotice(c.bannedWords?.banNotice, g.bannedWords?.banNotice)
  form.bwKickNotice = loadNotice(c.bannedWords?.kickNotice, g.bannedWords?.kickNotice)
  form.abNotice = loadNotice(c.autoBlacklist?.notice, g.autoBlacklist?.notice)

  const a = c.ai
  aiForm.baseURL = a?.baseURL ?? ''
  aiForm.apiKey = a?.apiKey ?? ''
  aiForm.model = a?.model ?? ''
  aiForm.temperature = a?.temperature ?? ''
  aiForm.maxTokens = a?.maxTokens ?? ''
  aiForm.timeout = a?.timeout ?? ''
  aiForm.joinPrompt = a?.prompts?.joinReview || ''
  aiForm.reportPrompt = a?.prompts?.reportReview || ''
}

function select(groupId: string) {
  selectedId.value = groupId
  const g = data.value?.global || {}
  const rec = (data.value?.groups || []).find((x: any) => x.groupId === groupId)
  fillFrom(rec?.config, g)
}

async function addGroup() {
  const ids = split(newGroupId.value)
  let last = ''
  for (const gid of ids) {
    const exists = (data.value?.groups || []).some((g: any) => g.groupId === gid)
    if (exists) {
      toast.warning(`群 ${gid} 已存在配置，已自动展示其配置`)
    } else {
      await mutate('setGroup', { groupId: gid, patch: {} })
      toast.success(`已添加群 ${gid}`)
    }
    last = gid
  }
  newGroupId.value = ''
  if (last) select(last)
}

function noticePatch(n: any) {
  return { enabled: !!n.enabled, mode: n.mode, targetId: n.targetId || '', text: n.text || '' }
}

async function save() {
  if (!selectedId.value) {
    toast.warning('请先选择要保存的群聊')
    return
  }
  let levels = []
  try { levels = JSON.parse(form.levelsJson || '[]') } catch { toast.error('惩罚映射 JSON 格式错误'); return }
  const patch: any = {
    enableGroupManagement: form.enableGroupManagement,
    mute: { enabled: form.muteEnabled, maxDuration: Number(form.muteMaxDuration) },
    welcome: { enabled: form.welcomeEnabled, text: form.welcomeText },
    farewell: { enabled: form.farewellEnabled, text: form.farewellText },
    joinReview: {
      enabled: form.joinEnabled,
      frequency: { enabled: form.freqEnabled, windowMinutes: Number(form.freqWindow), maxCount: Number(form.freqMax) },
      blacklist: { enabled: form.blEnabled },
      qqLevel: { enabled: form.levelEnabled, minLevel: Number(form.minLevel) },
      keyword: { enabled: form.kwEnabled, passKeywords: split(form.passKeywords), rejectKeywords: split(form.rejectKeywords) },
      manual: { enabled: form.manualEnabled, timeoutMinutes: Number(form.manualTimeout), reviewers: split(form.reviewers), notifyMode: form.notifyMode, notifyGroupId: form.notifyGroupId },
      llm: { enabled: form.llmEnabled },
      autoNotice: { enabled: !!form.autoNotice.enabled, mode: 'group', targetId: '', text: form.autoNotice.text },
    },
    bannedWords: {
      enabled: form.bwEnabled, banOnTrigger: form.bwBan, kickOnTrigger: form.bwKick, recallOnTrigger: form.bwRecall,
      banDuration: Number(form.bwDuration), words: form.bwWords,
      banNotice: noticePatch(form.bwBanNotice),
      kickNotice: noticePatch(form.bwKickNotice),
      recallNotice: noticePatch(form.bwRecallNotice),
    },
    report: { enabled: form.reportEnabled, levels, frequency: { enabled: form.reportFreqEnabled, windowMinutes: Number(form.reportFreqWindow), maxCount: Number(form.reportFreqMax) } },
    autoBlacklist: {
      enabled: form.abEnabled, onSelfLeave: form.abSelf, onKicked: form.abKicked,
      delayMinutes: Number(form.abDelay),
      notice: noticePatch(form.abNotice),
    },
    essence: { enabled: form.essenceEnabled },
    title: { enabled: form.titleEnabled },
    ai: {
      baseURL: aiForm.baseURL || '',
      apiKey: aiForm.apiKey || '',
      model: aiForm.model || '',
      temperature: aiForm.temperature === '' ? '' : Number(aiForm.temperature),
      maxTokens: aiForm.maxTokens === '' ? '' : Number(aiForm.maxTokens),
      timeout: aiForm.timeout === '' ? '' : Number(aiForm.timeout),
      prompts: { joinReview: aiForm.joinPrompt || '', reportReview: aiForm.reportPrompt || '' },
    },
  }
  const res = await mutate('setGroup', { groupId: selectedId.value, patch })
  if (res?.ok) {
    toast.success('已保存该群配置')
  } else {
    toast.error(res?.error || '保存失败')
  }
}

async function reset() {
  if (!selectedId.value) return
  if (!confirm('确定将该群配置重置为全局配置？')) return
  await mutate('clearGroup', { groupId: selectedId.value })
  select(selectedId.value)
}

function onBanToggle() {
  if (form.bwBan && form.bwKick) form.bwKick = false
}
function onKickToggle() {
  if (form.bwKick && form.bwBan) form.bwBan = false
}

async function addBannedWords() {
  const words = split(bannedInput.value)
  if (!words.length) return
  for (const w of words) {
    if (!form.bwWords.includes(w)) form.bwWords.push(w)
  }
  bannedInput.value = ''
}
function removeBannedWord(w: string) {
  form.bwWords = form.bwWords.filter((x: string) => x !== w)
}
</script>