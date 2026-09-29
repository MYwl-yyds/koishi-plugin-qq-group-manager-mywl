<template>
  <div>
    <Skeleton v-if="!data && loading" :rows="6" />

    <template v-else-if="data">
      <!-- ========== 违禁词 ========== -->
      <Section title="违禁词（全局默认）" :sub="`共 ${words.length} 个`" icon="📝" :open="true">
        <p class="qg-hint tight" style="margin-top:0">
          本页是<b>全局默认配置</b>。各群可在「群聊管控 → 群配置详情」中取消「继承全局」，
          为本群单独设置违禁词表与处罚规则；未取消的群沿用此处设置。
        </p>
        <ToggleRow label="违禁词总开关" v-model="bw.enabled" @update:model-value="saveBanned" title="关闭后不再检测违禁词（不影响禁发链接）" />

        <div class="qg-grid two" style="margin-top:10px">
          <div>
            <h4>触发处理</h4>
            <ToggleRow label="触发后禁言" v-model="bw.banOnTrigger" @update:model-value="onBanToggle" title="与「踢出」互斥，同时开启时仅禁言" />
            <ToggleRow label="触发后踢出" v-model="bw.kickOnTrigger" @update:model-value="onKickToggle" title="与「禁言」互斥" />
            <ToggleRow label="触发后撤回" v-model="bw.recallOnTrigger" />
            <ToggleRow label="禁言时长(分)" type="number" v-model="bw.banDuration" />
          </div>
          <div>
            <h4>词库管理</h4>
            <div class="qg-add" style="margin-top:0">
              <input class="qg-input" v-model="wordInput" placeholder="多个用逗号 / 空格 / 换行分隔" @keyup.enter="addWords" />
              <button class="qg-btn primary" @click="addWords">批量添加</button>
            </div>
            <div style="margin-top:10px">
              <TagList :items="words" removable empty-text="暂无违禁词" @remove="removeWord" />
            </div>
          </div>
        </div>
        <div class="qg-actions">
          <button class="qg-btn primary" @click="saveBanned">保存违禁词设置</button>
        </div>
      </Section>

      <!-- ========== 禁发链接 ========== -->
      <Section title="禁发链接（全局默认）" :sub="link.enabled ? '已启用' : '未启用'" icon="🔗" :open="true">
        <ToggleRow
          label="禁发链接开关"
          v-model="link.enabled"
          title="开启后，群成员发送的链接会被拦截并按下方处理"
        />
        <p class="qg-hint">
          识别范围：<code>http(s)://</code> 链接、<code>www.</code> 开头、IP 地址与带常见顶级域名的裸域名（如 <code>example.com/x</code>）。
          白名单命中的链接不会被拦截。
        </p>

        <div class="qg-grid two" style="margin-top:10px">
          <div>
            <h4>触发处理</h4>
            <ToggleRow label="触发后禁言" v-model="link.banOnTrigger" @update:model-value="onLinkBanToggle" title="与「踢出」互斥，同时开启时仅禁言" />
            <ToggleRow label="触发后踢出" v-model="link.kickOnTrigger" @update:model-value="onLinkKickToggle" title="与「禁言」互斥" />
            <ToggleRow label="触发后撤回" v-model="link.recallOnTrigger" />
            <ToggleRow label="禁言时长(分)" type="number" v-model="link.banDuration" />
            <div class="qg-actions">
              <button class="qg-btn primary" @click="saveLink">保存禁发链接设置</button>
            </div>
          </div>
          <div>
            <h4>仅禁发模式</h4>
            <p class="qg-hint tight">
              如需「只撤回链接、不禁言不踢出」，将「触发后禁言」和「触发后踢出」都关闭、仅保留「触发后撤回」即可。
            </p>
            <h4 style="margin-top:12px">提示</h4>
            <ul class="qg-ul">
              <li>禁发链接与违禁词共用同一条消息检测流程，先判断链接、再判断违禁词。</li>
              <li>白名单成员（豁免违禁词）同样不会被链接拦截。</li>
              <li>撤回需要协议端支持 <code>delete_msg</code>（LLBot / NapCat 均支持）。</li>
            </ul>
          </div>
        </div>
      </Section>

      <!-- ========== 链接白名单 ========== -->
      <Section title="链接白名单" :sub="`共 ${whitelist.length} 条`" icon="✅" :open="true">
        <div class="qg-add" style="margin-top:0">
          <input
            class="qg-input"
            v-model="whitelistInput"
            placeholder="完整链接 https://example.com/path · 域名 example.com · 泛域名 *.example.com"
            @keyup.enter="addWhitelist"
          />
          <button class="qg-btn primary" @click="addWhitelist">批量添加</button>
        </div>

        <p class="qg-hint">
          支持三种写法（不区分大小写）：
          <br>① <b>完整链接</b>：<code>https://example.com/docs</code> —— 放行该域名下路径为 <code>/docs</code> 或其子路径的链接；
          <br>② <b>域名</b>：<code>example.com</code> —— 放行 <code>example.com</code>、<code>www.example.com</code> 及任意子域名；
          <br>③ <b>泛域名</b>：<code>*.example.com</code> —— 放行任意子域名（如 <code>a.example.com</code>），不含 <code>example.com</code> 本身。
        </p>

        <EmptyState v-if="whitelist.length === 0" text="白名单为空，所有链接都会被拦截" sub="添加常用域名后再开启禁发链接，可避免误伤" icon="🔗" sm />
        <div v-else class="qg-wl-list">
          <div v-for="(entry, i) in whitelist" :key="i" class="qg-wl-item">
            <span class="qg-tag" :class="entry.startsWith('*.') ? 'blacklist' : (entry.includes('/') ? 'audit' : 'operation')">
              {{ entry.startsWith('*.') ? '泛域名' : (entry.replace(/^[a-z]+:\/\//i, '').includes('/') ? '完整链接' : '域名') }}
            </span>
            <code class="qg-wl-code">{{ entry }}</code>
            <div class="qg-wl-test">
              <input
                class="qg-input"
                v-model="testUrls[i]"
                placeholder="粘贴一条链接试试是否放行"
                @keyup.enter="runTest(i)"
              />
              <button class="qg-btn sm" :disabled="!testUrls[i] || testStates[i]?.loading" @click="runTest(i)">测试</button>
              <span v-if="testStates[i]?.result !== null && testStates[i]?.result !== undefined" class="qg-tag" :class="testStates[i].result ? 'ok' : 'violation'">
                {{ testStates[i].result ? '放行' : '拦截' }}
              </span>
              <span v-else-if="testStates[i]?.host" class="qg-tag neutral">{{ testStates[i].host }}</span>
            </div>
            <button class="qg-btn sm danger" @click="removeWhitelist(entry)">删除</button>
          </div>
        </div>
      </Section>

      <!-- ========== 禁发指定图片 ========== -->
      <Section title="禁发指定图片（全局默认）" sub="以图搜图：用感知哈希比对群内图片与样本图，命中即触发处理" icon="🖼">
        <ToggleRow label="启用禁发图片检测" v-model="image.enabled" title="与违禁词、禁发链接相互独立，可单独开关" />
        <p class="qg-hint tight">
          检测原理：把样本图和群内图片统一转为 32×32 灰度并计算 DCT 低频指纹（感知哈希），
          两张图指纹的「汉明距离」越小越相似。<b>阈值 0</b> 表示必须几乎完全一致；
          <b>8</b> 可容忍转发压缩、轻微缩放与二次保存；超过 <b>16</b> 基本会误判，不建议。
          目前支持 PNG 与基线 JPEG，其它格式请在入库时转成 PNG。
        </p>

        <div class="qg-grid two">
          <label class="qg-row">
            <span>汉明距离阈值</span>
            <input class="qg-input grow" type="number" min="0" max="64" step="1" v-model.number="image.threshold" />
          </label>
          <label class="qg-row">
            <span>禁言时长（分钟）</span>
            <input class="qg-input grow" type="number" min="1" v-model.number="image.banDuration" />
          </label>
        </div>
        <div class="qg-grid two">
          <ToggleRow label="触发后禁言" v-model="image.banOnTrigger" @update:model-value="onImageBanToggle" title="与「踢出」互斥，同时开启时仅禁言" />
          <ToggleRow label="触发后踢出" v-model="image.kickOnTrigger" @update:model-value="onImageKickToggle" title="与「禁言」互斥" />
        </div>
        <ToggleRow label="触发后撤回" v-model="image.recallOnTrigger" />
        <div class="qg-actions"><button class="qg-btn primary" @click="saveImage">保存图片检测设置</button></div>

        <!-- 样本库 -->
        <h4 class="qg-sub-title">全局违规图样本库（{{ samples.length }} 张）</h4>
        <p class="qg-hint tight" style="margin-top:0">
          此处维护的是<b>全局样本</b>，对所有群生效。单个群的额外样本请到
          「群聊管控 → 群配置详情 → 禁发指定图片」中维护（仅对该群生效）。
        </p>
        <div class="qg-add" style="flex-wrap:wrap">
          <input class="qg-input" style="flex:1;min-width:200px" v-model="sampleUrl" placeholder="粘贴图片地址（http/https）" @keyup.enter="addSampleByUrl" />
          <input class="qg-input" style="max-width:150px" v-model="sampleLabel" placeholder="备注（可选）" />
          <button class="qg-btn primary" :disabled="!sampleUrl || sampleBusy" @click="addSampleByUrl">
            {{ sampleBusy ? '解析中…' : '添加样本' }}
          </button>
          <label class="qg-btn" style="cursor:pointer">
            上传本地图片
            <input type="file" accept="image/png,image/jpeg" style="display:none" @change="onUpload" />
          </label>
        </div>

        <Skeleton v-if="sampleBusy && !samples.length" :rows="2" />
        <EmptyState v-else-if="!samples.length" text="样本库为空" sub="添加一张违规图后即可开始拦截" icon="🖼" />
        <div v-else class="qg-wl-list" style="margin-top:10px">
          <div class="qg-wl-item" v-for="s in samples" :key="s.id">
            <div>
              <code class="qg-wl-code">{{ s.hash }}</code>
              <span class="qg-muted"> · {{ s.width }}×{{ s.height }} {{ s.format || '未知' }}</span>
              <div class="qg-muted" style="word-break:break-all">{{ s.label || '（无备注）' }} — {{ s.origin }}</div>
            </div>
            <button class="qg-btn sm danger" @click="removeSample(s)">删除</button>
          </div>
        </div>

        <!-- 比对测试 -->
        <h4 class="qg-sub-title">比对测试</h4>
        <div class="qg-add" style="flex-wrap:wrap">
          <input class="qg-input" style="flex:1;min-width:200px" v-model="testImageUrl" placeholder="粘贴一张图片地址，看看会不会被拦截" @keyup.enter="runImageTest" />
          <button class="qg-btn" :disabled="!testImageUrl || imageTesting" @click="runImageTest">
            {{ imageTesting ? '比对中…' : '测试' }}
          </button>
        </div>
        <p v-if="imageTestResult" class="qg-hint tight">
          最小汉明距离 <b>{{ imageTestResult.distance }}</b>（阈值 {{ imageTestResult.threshold }}）→
          <span class="qg-tag" :class="imageTestResult.matched ? 'violation' : 'ok'">
            {{ imageTestResult.matched ? '会被拦截' : '不会拦截' }}
          </span>
          <span v-if="imageTestResult.sample"> 最相似样本：{{ imageTestResult.sample.label || imageTestResult.sample.hash }}</span>
        </p>
        <p v-else-if="imageTestError" class="qg-error">{{ imageTestError }}</p>
      </Section>

      <!-- ========== 通知模板 ========== -->
      <Section title="违禁词 / 链接 / 图片 通知模板" sub="全局默认，群级可在群配置中覆盖" icon="🔔">
        <div class="qg-grid two">
          <div>
            <NoticeEditor title="违禁词·撤回通知" v-model="notices.recallNotice" hint="变量：{userId} {nickname} {groupId} {word} {punish}" />
            <NoticeEditor title="违禁词·禁言通知" v-model="notices.banNotice" hint="变量：{userId} {nickname} {groupId} {word} {punish}" />
          </div>
          <div>
            <NoticeEditor title="违禁词·踢出通知" v-model="notices.kickNotice" hint="变量：{userId} {nickname} {groupId} {word} {punish}" />
            <NoticeEditor title="链接·撤回通知" v-model="linkNotices.recallNotice" hint="变量：{userId} {nickname} {groupId} {word} {host} {link} {punish}" />
          </div>
        </div>
        <div class="qg-grid two">
          <NoticeEditor title="链接·禁言通知" v-model="linkNotices.banNotice" hint="变量：{userId} {nickname} {groupId} {word} {host} {link} {punish}" />
          <NoticeEditor title="链接·踢出通知" v-model="linkNotices.kickNotice" hint="变量：{userId} {nickname} {groupId} {word} {host} {link} {punish}" />
        </div>
        <div class="qg-grid two">
          <NoticeEditor title="图片·撤回通知" v-model="imageNotices.recallNotice" hint="变量：{userId} {nickname} {groupId} {word} {distance} {image} {punish}" />
          <NoticeEditor title="图片·禁言通知" v-model="imageNotices.banNotice" hint="变量：{userId} {nickname} {groupId} {word} {distance} {image} {punish}" />
        </div>
        <div class="qg-grid two">
          <NoticeEditor title="图片·踢出通知" v-model="imageNotices.kickNotice" hint="变量：{userId} {nickname} {groupId} {word} {distance} {image} {punish}" />
          <div class="qg-actions"><button class="qg-btn primary" @click="saveNotices">保存通知模板</button></div>
        </div>
      </Section>
    </template>

    <EmptyState v-else :text="error || '暂无数据'" icon="⚠️" />
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useScope, mutate, invalidateScope } from '../useData'
import { send } from '@koishijs/client'
import { toast } from '../toast'
import Section from '../components/Section.vue'
import EmptyState from '../components/EmptyState.vue'
import Skeleton from '../components/Skeleton.vue'
import ToggleRow from '../components/ToggleRow.vue'
import TagList from '../components/TagList.vue'
import NoticeEditor from '../components/NoticeEditor.vue'

const wordInput = ref('')
const whitelistInput = ref('')
const testUrls = reactive<Record<number, string>>({})
const words = ref<string[]>([])
const bw = reactive<any>({ enabled: false, banOnTrigger: true, kickOnTrigger: false, recallOnTrigger: true, banDuration: 10 })
const link = reactive<any>({ enabled: false, banOnTrigger: true, kickOnTrigger: false, recallOnTrigger: true, banDuration: 10 })
const image = reactive<any>({ enabled: false, threshold: 8, banOnTrigger: true, kickOnTrigger: false, recallOnTrigger: true, banDuration: 10 })
const whitelist = ref<string[]>([])
const samples = ref<any[]>([])
const notices = reactive<any>({ recallNotice: {}, banNotice: {}, kickNotice: {} })
const linkNotices = reactive<any>({ recallNotice: {}, banNotice: {}, kickNotice: {} })
const imageNotices = reactive<any>({ recallNotice: {}, banNotice: {}, kickNotice: {} })

const sampleUrl = ref('')
const sampleLabel = ref('')
const sampleBusy = ref(false)
const testImageUrl = ref('')
const imageTesting = ref(false)
const imageTestResult = ref<any>(null)
const imageTestError = ref('')

const { data, loading, error, refresh } = useScope<any>('settings')

function split(s: any): string[] {
  if (Array.isArray(s)) return s.map(String)
  return String(s || '').split(/[,，\s\n]+/).filter(Boolean)
}

function loadNotice(c: any) {
  c = c || {}
  return { enabled: !!c.enabled, mode: c.mode || 'group', targetId: c.targetId || '', text: c.text || '' }
}

watch(data, (g) => {
  if (!g?.global) return
  const b = g.global.bannedWords || {}
  words.value = [...(b.words || [])]
  bw.enabled = !!b.enabled
  bw.banOnTrigger = !!b.banOnTrigger
  bw.kickOnTrigger = !!b.kickOnTrigger
  bw.recallOnTrigger = !!b.recallOnTrigger
  bw.banDuration = b.banDuration ?? 10
  const l = b.link || {}
  link.enabled = !!l.enabled
  link.banOnTrigger = l.banOnTrigger !== false
  link.kickOnTrigger = !!l.kickOnTrigger
  link.recallOnTrigger = l.recallOnTrigger !== false
  link.banDuration = l.banDuration ?? 10
  whitelist.value = [...(l.whitelist || [])]
  Object.assign(notices, {
    recallNotice: loadNotice(b.recallNotice),
    banNotice: loadNotice(b.banNotice),
    kickNotice: loadNotice(b.kickNotice),
  })
  Object.assign(linkNotices, {
    recallNotice: loadNotice(l.recallNotice),
    banNotice: loadNotice(l.banNotice),
    kickNotice: loadNotice(l.kickNotice),
  })
  const im = b.image || {}
  image.enabled = !!im.enabled
  image.threshold = im.threshold ?? 8
  image.banOnTrigger = im.banOnTrigger !== false
  image.kickOnTrigger = !!im.kickOnTrigger
  image.recallOnTrigger = im.recallOnTrigger !== false
  image.banDuration = im.banDuration ?? 10
  Object.assign(imageNotices, {
    recallNotice: loadNotice(im.recallNotice),
    banNotice: loadNotice(im.banNotice),
    kickNotice: loadNotice(im.kickNotice),
  })
  samples.value = Array.isArray(g.imageSamples) ? g.imageSamples : []
}, { immediate: true })

// 「试一试」：把待测链接连同当前白名单发给服务端判断，保证与运行时判定逻辑完全一致
const testStates = reactive<Record<number, { loading: boolean, result: boolean | null, host: string }>>({})

function testResult(i: number): boolean {
  return testStates[i]?.result === true
}

async function runTest(i: number) {
  const url = String(testUrls[i] || '').trim()
  if (!url) {
    testStates[i] = { loading: false, result: null, host: '' }
    return
  }
  testStates[i] = { loading: true, result: null, host: '' }
  const res = await send('qq-guanqun/mutate', { action: 'link.test', data: { url, whitelist: whitelist.value } })
  testStates[i] = {
    loading: false,
    result: !!res?.data?.whitelisted,
    host: res?.data?.parsed?.host || '无法解析为链接',
  }
}

async function saveBanned() {
  const res = await mutate('setGlobal', {
    bannedWords: {
      enabled: bw.enabled,
      banOnTrigger: bw.banOnTrigger,
      kickOnTrigger: bw.kickOnTrigger,
      recallOnTrigger: bw.recallOnTrigger,
      banDuration: Number(bw.banDuration),
      words: words.value,
    },
  })
  afterSave(res, '违禁词设置已保存')
}

async function saveLink() {
  const res = await mutate('setGlobal', {
    bannedWords: {
      link: {
        enabled: link.enabled,
        banOnTrigger: link.banOnTrigger,
        kickOnTrigger: link.kickOnTrigger,
        recallOnTrigger: link.recallOnTrigger,
        banDuration: Number(link.banDuration),
        whitelist: whitelist.value,
      },
    },
  })
  afterSave(res, '禁发链接设置已保存')
}

async function saveNotices() {
  const patch = (n: any) => ({ enabled: !!n.enabled, mode: n.mode, targetId: n.targetId || '', text: n.text || '' })
  const res = await mutate('setGlobal', {
    bannedWords: {
      recallNotice: patch(notices.recallNotice),
      banNotice: patch(notices.banNotice),
      kickNotice: patch(notices.kickNotice),
      link: {
        recallNotice: patch(linkNotices.recallNotice),
        banNotice: patch(linkNotices.banNotice),
        kickNotice: patch(linkNotices.kickNotice),
      },
      image: {
        recallNotice: patch(imageNotices.recallNotice),
        banNotice: patch(imageNotices.banNotice),
        kickNotice: patch(imageNotices.kickNotice),
      },
    },
  })
  afterSave(res, '通知模板已保存')
}

// ---------- 禁发指定图片 ----------
async function saveImage() {
  const res = await mutate('setGlobal', {
    bannedWords: {
      image: {
        enabled: image.enabled,
        threshold: Math.max(0, Math.min(64, Number(image.threshold) || 0)),
        banOnTrigger: image.banOnTrigger,
        kickOnTrigger: image.kickOnTrigger,
        recallOnTrigger: image.recallOnTrigger,
        banDuration: Number(image.banDuration),
      },
    },
  })
  afterSave(res, '禁发图片设置已保存')
}

async function addSampleByUrl() {
  const url = String(sampleUrl.value || '').trim()
  if (!url) return
  sampleBusy.value = true
  const res = await mutate('image.sample.add', { url, label: sampleLabel.value })
  sampleBusy.value = false
  if (res?.ok) {
    toast.success('已加入样本库')
    sampleUrl.value = ''
    sampleLabel.value = ''
    invalidateScope('settings')
    refresh(undefined, true)
  } else {
    toast.error(res?.error || '添加失败')
  }
}

function onUpload(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (file.size > 8 * 1024 * 1024) {
    toast.error('图片超过 8MB 上限')
    input.value = ''
    return
  }
  const reader = new FileReader()
  reader.onload = async () => {
    sampleBusy.value = true
    const res = await mutate('image.sample.addBase64', {
      dataUrl: String(reader.result || ''),
      label: sampleLabel.value,
      filename: file.name,
    })
    sampleBusy.value = false
    input.value = ''
    if (res?.ok) {
      toast.success('已加入样本库')
      sampleLabel.value = ''
      invalidateScope('settings')
      refresh(undefined, true)
    } else {
      toast.error(res?.error || '添加失败')
    }
  }
  reader.onerror = () => toast.error('读取本地图片失败')
  reader.readAsDataURL(file)
}

async function removeSample(s: any) {
  const res = await mutate('image.sample.remove', { id: s.id })
  if (res?.ok) {
    toast.success('已删除样本')
    invalidateScope('settings')
    refresh(undefined, true)
  } else {
    toast.error(res?.error || '删除失败')
  }
}

async function runImageTest() {
  const url = String(testImageUrl.value || '').trim()
  if (!url) return
  imageTesting.value = true
  imageTestError.value = ''
  imageTestResult.value = null
  const res = await send('qq-guanqun/mutate', {
    action: 'image.test',
    data: { url, threshold: Math.max(0, Math.min(64, Number(image.threshold) || 0)) },
  })
  imageTesting.value = false
  if (res?.ok && res.data) imageTestResult.value = res.data
  else imageTestError.value = res?.error || '比对失败'
}

function afterSave(res: any, okText: string) {
  if (res?.ok) {
    toast.success(okText)
    invalidateScope('settings')
    refresh(undefined, true)
  } else {
    toast.error(res?.error || '保存失败')
  }
}

function addWords() {
  const list = split(wordInput.value)
  if (!list.length) return
  for (const w of list) if (!words.value.includes(w)) words.value.push(w)
  wordInput.value = ''
  saveBanned()
}
function removeWord(w: string) {
  words.value = words.value.filter((x) => x !== w)
  saveBanned()
}

function addWhitelist() {
  const list = split(whitelistInput.value).map((x) => x.replace(/^[a-z]+:\/\//i, ''))
  if (!list.length) return
  for (const e of list) if (!whitelist.value.includes(e)) whitelist.value.push(e)
  whitelistInput.value = ''
  saveLink()
}
function removeWhitelist(entry: string) {
  whitelist.value = whitelist.value.filter((x) => x !== entry)
  saveLink()
}

function onBanToggle(v: any) { if (v) bw.kickOnTrigger = false }
function onKickToggle(v: any) { if (v) bw.banOnTrigger = false }
function onLinkBanToggle(v: any) { if (v) link.kickOnTrigger = false }
function onLinkKickToggle(v: any) { if (v) link.banOnTrigger = false }
function onImageBanToggle(v: any) { if (v) image.kickOnTrigger = false; saveImage() }
function onImageKickToggle(v: any) { if (v) image.banOnTrigger = false; saveImage() }
</script>

<style scoped>
.qg-ul { margin: 6px 0 0; padding-left: 18px; font-size: 12.5px; color: var(--qg-text-2); line-height: 1.8; }
.qg-ul code, .qg-hint code { background: var(--qg-hover); border-radius: 4px; padding: 1px 5px; font-size: 12px; }
.qg-wl-list { display: flex; flex-direction: column; gap: 9px; }
.qg-wl-item {
  display: grid;
  grid-template-columns: 82px minmax(120px, 1fr) minmax(180px, 1.6fr) auto;
  align-items: center;
  gap: 10px;
  padding: 9px 11px;
  border: 1px solid var(--qg-border-2);
  border-radius: 10px;
  background: var(--qg-card-2);
}
.qg-wl-code { font-size: 12.5px; word-break: break-all; }
.qg-wl-test { display: flex; align-items: center; gap: 8px; }
.qg-sub-title { font-size: 13px; margin: 16px 0 8px; padding-top: 12px; border-top: 1px dashed var(--qg-border); }
@media (max-width: 980px) {
  .qg-wl-item { grid-template-columns: 1fr 1fr; }
}
</style>
