<template>
  <div>
    <Skeleton v-if="!data && loading" :rows="6" />

    <template v-else-if="data">
      <!-- 群选择：群员检查为纯群级配置 -->
      <Section title="选择群聊" sub="群员检查为纯群级配置，每个群一份独立设置" icon="💬" :open="true">
        <div class="qg-add" style="margin-top:0">
          <select class="qg-select" v-model="currentGroupId" style="max-width:300px">
            <option value="">— 请选择群聊 —</option>
            <option v-for="g in groupOptions" :key="g.groupId" :value="g.groupId">
              {{ g.name ? `${g.name}（${g.groupId}）` : g.groupId }}
            </option>
          </select>
          <input class="qg-input" v-model="manualGroupId" placeholder="或输入未在列表中的群号" style="max-width:220px" />
          <button class="qg-btn" @click="useManualGroup">切换</button>
        </div>
        <p class="qg-hint tight">
          群员检查不再有全局配置，也不跟随任何全局值；每个群必须单独启用与配置。
          未在「群聊管理」中添加的群，这里切换后保存会自动创建配置。
        </p>
      </Section>

      <EmptyState v-if="!currentGroupId" text="请先选择一个群聊" sub="选择后即可配置该群的群员检查规则" icon="👈" />

      <template v-else>
      <!-- 运行状态 -->
      <Section title="运行状态" :sub="cfg.enabled ? '已启用' : '未启用'" icon="📡" :open="true">
        <template #actions>
          <button class="qg-btn sm" :disabled="scanning" @click="scanAll">
            {{ scanning ? '全量检查中…' : '立即全量检查' }}
          </button>
        </template>
        <div class="qg-grid three">
          <div class="qg-card flat">
            <h4>本群总开关</h4>
            <ToggleRow label="启用群员检查" v-model="cfg.enabled" @update:model-value="markDirty" />
            <p class="qg-hint tight">关闭后本群不再执行定时扫描。</p>
          </div>
          <div class="qg-card flat">
            <h4>扫描参数（本群）</h4>
            <ToggleRow label="扫描间隔(分)" type="number" v-model="cfg.intervalMinutes" @update:model-value="markDirty" title="本群两次扫描的最小间隔" />
            <ToggleRow label="单群超时(秒)" type="number" v-model="cfg.timeoutSeconds" @update:model-value="markDirty" title="超过该时长跳过本群，避免卡死" />
            <ToggleRow label="并发请求数" type="number" v-model="cfg.batchSize" @update:model-value="markDirty" title="调用 OneBot 接口的并发数。大群建议 1~2，过高会触发协议端限流，导致等级读取失败" />
            <ToggleRow label="等级缓存(小时)" type="number" v-model="cfg.levelCacheHours" @update:model-value="markDirty" title="同一成员在该时间内重复扫描不再请求接口。大群建议 6~24 小时，是避免限流最有效的手段" />
            <ToggleRow label="失败率上限(%)" type="number" v-model="cfg.maxFailRatio" @update:model-value="markDirty" title="一次检查中超过该比例的成员取不到有效等级时，判定为协议端限流并立即中止检查（不执行任何处罚），避免整群误判" />
            <ToggleRow label="冷却时间(小时)" type="number" v-model="cfg.cooldownHours" @update:model-value="markDirty" title="同一成员在该时间内不重复处理" />
            <ToggleRow label="仅活跃成员(天)" type="number" v-model="cfg.activeWithinDays" @update:model-value="markDirty" title="0 表示检查全部成员" />
            <p class="qg-hint tight">
              大群提示：QQ 等级需要逐人调用 <code>get_stranger_info</code>，人数多时容易被协议端限流。
              建议「并发请求数」设为 1~2、「等级缓存」设为 6~24 小时、「仅活跃成员」设为 7~30 天，
              可大幅降低请求量。若接口返回的等级为 <code>0</code>，系统会视为「读取失败」而非真实等级，
              并按各规则里的「等级获取失败时」设置处理，不会因此误伤群员。
            </p>
          </div>
          <div class="qg-card flat">
            <h4>最近一次执行</h4>
            <p class="qg-muted" style="margin:0 0 8px">
              {{ data.lastRunAt ? relativeTime(data.lastRunAt) : '尚未执行' }}
            </p>
            <div v-if="data.lastResults?.length" class="qg-run-list">
              <div v-for="r in data.lastResults" :key="r.groupId" class="qg-run-row">
                <span>群 {{ r.groupId }}</span>
                <span class="qg-muted">命中 {{ r.hits }} · 禁言 {{ r.actions.mute }} · 踢出 {{ r.actions.kick }}</span>
              </div>
            </div>
            <span v-else class="qg-muted">暂无执行记录</span>
          </div>
        </div>
      </Section>

      <!-- 三类检测规则 -->
      <div class="qg-grid three">
        <!-- QQ 等级 -->
        <Section title="检测等级" sub="QQ 账号等级" icon="⭐" :open="true">
          <ToggleRow label="启用此项检测" v-model="qq.enabled" @update:model-value="markDirty" />
          <ToggleRow label="最低等级" type="number" v-model="qq.minLevel" @update:model-value="markDirty" title="低于该值时触发操作" />
          <ToggleRow
            label="触发操作"
            type="select"
            v-model="qq.action"
            :options="actionOptions"
            @update:model-value="markDirty"
          />
          <ToggleRow
            label="禁言时长(分)"
            type="number"
            v-model="qq.muteDuration"
            :disabled="qq.action !== 'mute'"
            @update:model-value="markDirty"
          />
          <ToggleRow
            label="取不到等级时"
            type="select"
            v-model="qq.whenUnknown"
            :options="unknownOptions"
            @update:model-value="markDirty"
          />
          <p class="qg-hint tight">
            等级来自 <code>get_stranger_info</code> 的 <code>level</code> 字段（QQ 账号等级 1~256）。
            LLBot / NapCat 均支持；接口不可用时按上方「取不到等级时」处理。
          </p>
          <NoticeEditor title="命中通知" v-model="qq.notice" hint="变量：{userId} {nickname} {groupId} {level} {threshold} {punish}" />
          <div class="qg-actions">
            <button class="qg-btn primary sm" :disabled="!dirty" @click="save('QQ等级设置')">保存本项</button>
          </div>
        </Section>

        <!-- 群名片 -->
        <Section title="检测群名片" sub="包含 / 完全等于" icon="🏷️" :open="true">
          <ToggleRow label="启用此项检测" v-model="card.enabled" @update:model-value="markDirty" />
          <ToggleRow
            label="匹配方式"
            type="select"
            v-model="card.matchMode"
            :options="[{ label: '包含', value: 'contains' }, { label: '完全等于', value: 'equals' }]"
            @update:model-value="markDirty"
          />
          <ToggleRow label="区分大小写" v-model="card.caseSensitive" @update:model-value="markDirty" />
          <ToggleRow label="排除群管理" v-model="card.excludeAdmins" @update:model-value="markDirty" title="群主与管理员不参与检查" />
          <ToggleRow label="排除白名单" v-model="card.excludeWhitelist" @update:model-value="markDirty" />
          <ToggleRow
            label="触发操作"
            type="select"
            v-model="card.action"
            :options="actionOptions"
            @update:model-value="markDirty"
          />
          <ToggleRow
            label="禁言时长(分)"
            type="number"
            v-model="card.muteDuration"
            :disabled="card.action !== 'mute'"
            @update:model-value="markDirty"
          />
          <label class="qg-field" style="margin-top:8px">
            <label>匹配内容（逗号分隔，支持 /正则/ 写法）</label>
            <textarea
              class="qg-textarea"
              rows="3"
              v-model="cardPatterns"
              placeholder="例如：广告, 加微信, /^【.*】/"
              @blur="markDirty"
            ></textarea>
          </label>
          <p class="qg-hint tight">
            检查对象为「群名片」，群名片为空时回退使用群昵称。以 <code>/</code> 首尾包裹的内容按正则匹配，例如
            <code>/^【.*】/</code>。
          </p>
          <NoticeEditor title="命中通知" v-model="card.notice" hint="变量：{userId} {nickname} {groupId} {card} {word} {punish}" />
          <div class="qg-actions">
            <button class="qg-btn primary sm" :disabled="!dirty" @click="save('群名片设置')">保存本项</button>
          </div>
        </Section>

        <!-- 群等级 -->
        <Section title="检测群等级" sub="群活跃等级" icon="📶" :open="true">
          <ToggleRow label="启用此项检测" v-model="groupLevel.enabled" @update:model-value="markDirty" />
          <ToggleRow label="最低群等级" type="number" v-model="groupLevel.minLevel" @update:model-value="markDirty" title="低于该值时触发操作" />
          <ToggleRow
            label="触发操作"
            type="select"
            v-model="groupLevel.action"
            :options="actionOptions"
            @update:model-value="markDirty"
          />
          <ToggleRow
            label="禁言时长(分)"
            type="number"
            v-model="groupLevel.muteDuration"
            :disabled="groupLevel.action !== 'mute'"
            @update:model-value="markDirty"
          />
          <ToggleRow
            label="取不到等级时"
            type="select"
            v-model="groupLevel.whenUnknown"
            :options="unknownOptions"
            @update:model-value="markDirty"
          />
          <p class="qg-hint tight">
            群等级来自 <code>get_group_member_info</code> / <code>get_group_member_list</code> 的
            <code>level</code> 字段（群内活跃等级）。LLBot 会直接返回该字段。
          </p>
          <NoticeEditor title="命中通知" v-model="groupLevel.notice" hint="变量：{userId} {nickname} {groupId} {level} {threshold} {punish}" />
          <div class="qg-actions">
            <button class="qg-btn primary sm" :disabled="!dirty" @click="save('群等级设置')">保存本项</button>
          </div>
        </Section>
      </div>

      <!-- 试运行 -->
      <Section title="试运行（预览命中成员）" :sub="`当前群：${currentGroupId}`" icon="🧪" :open="true">
        <div class="qg-add" style="margin-top:0">
          <button class="qg-btn primary" :disabled="previewing" @click="runPreview">
            {{ previewing ? '分析中…' : '预览命中成员' }}
          </button>
          <button class="qg-btn" :disabled="scanning" @click="scanOne">对该群立即执行检查</button>
        </div>

        <template v-if="mc">
          <div v-if="scanErrors.length" class="qg-scan-errors">
            <p v-for="(e, i) in scanErrors" :key="i" class="qg-error">{{ e }}</p>
          </div>
          <p v-if="mc.previewError" class="qg-error">{{ mc.previewError }}</p>
          <EmptyState v-else-if="!mc.hits?.length" text="没有成员命中当前规则" icon="🎉" sm />
          <div v-else class="qg-table-wrap" style="margin-top:10px">
            <table class="qg-table">
              <thead><tr><th>QQ</th><th>昵称 / 群名片</th><th>检测项</th><th>说明</th><th>触发操作</th></tr></thead>
              <tbody>
                <tr v-for="(h, i) in mc.hits" :key="i">
                  <td class="num">{{ h.userId }}</td>
                  <td>{{ h.card || h.nickname || '-' }}</td>
                  <td><span class="qg-tag operation">{{ h.kindName }}</span></td>
                  <td>{{ h.detail }}</td>
                  <td>
                    <span class="qg-tag" :class="actionTagClass(h.kind)">
                      {{ actionName(h.kind) }}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="mc.hits?.length" class="qg-hint">共 {{ mc.hits.length }} 名成员会命中。实际执行还会受「冷却时间」影响。</p>
        </template>
      </Section>

      <!-- 统一保存栏：本页不再实时保存，改动后在这里提交 -->
      <div class="qg-actions sticky">
        <button class="qg-btn primary" :disabled="saving || !dirty" @click="save('群员检查配置')">
          {{ saving ? '保存中…' : '保存本群配置' }}
        </button>
        <button class="qg-btn" :disabled="!dirty" @click="discardChanges">放弃修改</button>
        <span class="qg-muted">
          {{ dirty ? '有未保存的改动' : '当前配置已保存' }} · 群 {{ currentGroupId }}
        </span>
      </div>
      </template>
    </template>

    <EmptyState v-else :text="error || '暂无数据'" icon="⚠️" />
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useScope, mutate, invalidateScope, applyMutated, relativeTime, splitList } from '../useData'
import { toast } from '../toast'
import Section from '../components/Section.vue'
import EmptyState from '../components/EmptyState.vue'
import Skeleton from '../components/Skeleton.vue'
import ToggleRow from '../components/ToggleRow.vue'
import NoticeEditor from '../components/NoticeEditor.vue'

const actionOptions = [
  { label: '仅记录（不处罚）', value: 'none' },
  { label: '禁言', value: 'mute' },
  { label: '踢出', value: 'kick' },
]
const unknownOptions = [
  { label: '跳过（安全，推荐）', value: 'skip' },
  { label: '视为命中（注意：大群限流时会误伤）', value: 'trigger' },
]

const scanning = ref(false)
const previewing = ref(false)
// 本次手动扫描返回的错误 / 中止原因（如接口限流导致中止）
const scanErrors = ref<string[]>([])
const currentGroupId = ref('')
const manualGroupId = ref('')
const cardPatterns = ref('')

// 是否有未保存的改动。本页不再实时保存（避免每点一下开关都写库、
// 也避免与「群配置详情」页互相覆盖），统一由保存按钮提交。
const dirty = ref(false)
const saving = ref(false)
function markDirty() { dirty.value = true }

// 放弃修改：重新拉取该群配置并回填表单（回填逻辑见下方 watch）
function discardChanges() {
  dirty.value = false
  if (!currentGroupId.value) return
  refreshPreview(undefined, true).then(() => { dirty.value = false })
}

const cfg = reactive<any>({
  enabled: false, intervalMinutes: 30, timeoutSeconds: 60, batchSize: 2,
  levelCacheHours: 6, maxFailRatio: 30, cooldownHours: 24, activeWithinDays: 0,
})
const qq = reactive<any>({ enabled: false, minLevel: 8, action: 'none', muteDuration: 10, whenUnknown: 'skip', notice: {} })
const card = reactive<any>({ enabled: false, matchMode: 'contains', caseSensitive: false, excludeAdmins: true, excludeWhitelist: true, action: 'none', muteDuration: 10, notice: {} })
const groupLevel = reactive<any>({ enabled: false, minLevel: 1, action: 'none', muteDuration: 10, whenUnknown: 'skip', notice: {} })

const { data, loading, error } = useScope<any>('settings')
const { data: groupList } = useScope<any>('groups')
const { data: mc, refresh: refreshPreview } = useScope<any>('memberCheck', {
  params: () => ({ groupId: currentGroupId.value }),
  immediate: false,
})

// 群名从 buildGroups 的 name 字段读取（此前被写死为空串，导致只显示群号）
const groupOptions = computed(() =>
  (groupList.value?.groups || []).map((g: any) => ({ groupId: String(g.groupId), name: g.name || '' })))

function loadNotice(c: any) {
  c = c || {}
  return { enabled: !!c.enabled, mode: c.mode || 'group', targetId: c.targetId || '', text: c.text || '' }
}

// 群员检查为纯群级配置：每次切换群都重新从该群的生效配置回填。
// 后端返回的 groupId 用于校验数据确实属于当前选中的群，
// 避免切换群时用上一个群的旧数据回填表单。
watch([currentGroupId, mc], () => {
  const m = mc.value?.config
  // 数据未就绪、或数据不属于当前群时先不回填（等新数据到达）
  if (!currentGroupId.value || !m) return
  if (mc.value?.groupId && String(mc.value.groupId) !== String(currentGroupId.value)) return
  // 有未保存的改动时不要用服务端数据覆盖表单（例如预览刷新触发的重取），
  // 否则用户正在编辑的内容会被静默丢弃。切换群时会先重置 dirty，所以不受影响。
  if (dirty.value) return
  Object.assign(cfg, {
    enabled: !!m.enabled,
    intervalMinutes: m.intervalMinutes ?? 30,
    timeoutSeconds: m.timeoutSeconds ?? 60,
    batchSize: m.batchSize ?? 2,
    levelCacheHours: m.levelCacheHours ?? 6,
    maxFailRatio: m.maxFailRatio ?? 30,
    cooldownHours: m.cooldownHours ?? 24,
    activeWithinDays: m.activeWithinDays ?? 0,
  })
  Object.assign(qq, {
    enabled: !!m.qqLevel?.enabled,
    minLevel: m.qqLevel?.minLevel ?? 8,
    action: m.qqLevel?.action ?? 'none',
    muteDuration: m.qqLevel?.muteDuration ?? 10,
    whenUnknown: m.qqLevel?.whenUnknown ?? 'skip',
    notice: loadNotice(m.qqLevel?.notice),
  })
  Object.assign(card, {
    enabled: !!m.card?.enabled,
    matchMode: m.card?.matchMode ?? 'contains',
    caseSensitive: !!m.card?.caseSensitive,
    excludeAdmins: m.card?.excludeAdmins !== false,
    excludeWhitelist: m.card?.excludeWhitelist !== false,
    action: m.card?.action ?? 'none',
    muteDuration: m.card?.muteDuration ?? 10,
    notice: loadNotice(m.card?.notice),
  })
  Object.assign(groupLevel, {
    enabled: !!m.groupLevel?.enabled,
    minLevel: m.groupLevel?.minLevel ?? 1,
    action: m.groupLevel?.action ?? 'none',
    muteDuration: m.groupLevel?.muteDuration ?? 10,
    whenUnknown: m.groupLevel?.whenUnknown ?? 'skip',
    notice: loadNotice(m.groupLevel?.notice),
  })
  cardPatterns.value = (m.card?.patterns || []).join(', ')
}, { immediate: true })

// 切换群时拉取该群的配置与预览
watch(currentGroupId, (gid) => {
  // 上一个群的扫描错误提示不应带到新群
  scanErrors.value = []
  // 切换群即放弃未保存的改动（表单会被新群数据覆盖）
  dirty.value = false
  if (!gid) return
  refreshPreview(undefined, true)
})

function useManualGroup() {
  const gid = manualGroupId.value.trim()
  if (!/^\d{5,12}$/.test(gid)) {
    toast.warning('请输入正确的群号')
    return
  }
  currentGroupId.value = gid
  manualGroupId.value = ''
}

const noticePatch = (n: any) => ({ enabled: !!n?.enabled, mode: n?.mode || 'group', targetId: n?.targetId || '', text: n?.text || '' })

async function save(label: string) {
  if (!currentGroupId.value) {
    toast.warning('请先选择群聊')
    return
  }
  if (saving.value) return
  saving.value = true
  const res = await mutate('setGroup', {
    groupId: currentGroupId.value,
    // 让后端重建 memberCheck 域（含预览数据）并随响应返回，免去保存后再发一次请求
    scope: 'memberCheck',
    patch: {
      memberCheck: {
        enabled: cfg.enabled,
        intervalMinutes: Number(cfg.intervalMinutes) || 30,
        timeoutSeconds: Number(cfg.timeoutSeconds) || 60,
        batchSize: Number(cfg.batchSize) || 2,
        levelCacheHours: Number(cfg.levelCacheHours ?? 6),
        maxFailRatio: Number(cfg.maxFailRatio ?? 30),
        // 这两个允许为 0（0 = 不限制 / 检查全部成员），不能用 || 兜底
        cooldownHours: Math.max(0, Number(cfg.cooldownHours) || 0),
        activeWithinDays: Math.max(0, Number(cfg.activeWithinDays) || 0),
        qqLevel: {
          enabled: qq.enabled, minLevel: Number(qq.minLevel), action: qq.action,
          muteDuration: Number(qq.muteDuration), whenUnknown: qq.whenUnknown, notice: noticePatch(qq.notice),
        },
        card: {
          enabled: card.enabled, matchMode: card.matchMode, caseSensitive: !!card.caseSensitive,
          excludeAdmins: !!card.excludeAdmins, excludeWhitelist: !!card.excludeWhitelist,
          patterns: splitList(cardPatterns.value), action: card.action,
          muteDuration: Number(card.muteDuration), notice: noticePatch(card.notice),
        },
        groupLevel: {
          enabled: groupLevel.enabled, minLevel: Number(groupLevel.minLevel), action: groupLevel.action,
          muteDuration: Number(groupLevel.muteDuration), whenUnknown: groupLevel.whenUnknown,
          notice: noticePatch(groupLevel.notice),
        },
      },
    },
  })
  saving.value = false
  if (res?.ok) {
    toast.success(`${label}已保存`)
    dirty.value = false
    invalidateScope('groups')
    invalidateScope('overview')
    // 直接用响应里带回来的最新数据，不再多发一次请求
    applyMutated(res, 'memberCheck', mc)
  } else {
    toast.error(res?.error || '保存失败')
  }
}

async function scanAll() {
  scanning.value = true
  // 「最近一次执行」由 settings 域提供，指定它以便直接采用响应数据
  const res = await mutate('memberCheck.scanAll', { scope: 'settings' })
  scanning.value = false
  if (res?.ok) {
    toast.success('全量群员检查已完成')
    // settings 域里的「最近一次执行」直接采用；mc 是另一个域，不能拿这份数据去覆盖
    applyMutated(res, 'settings', data)
    // 当前群的预览命中结果也可能变化，静默拉一次
    refreshPreview()
  } else {
    toast.error(res?.error || '检查失败')
  }
}

async function scanOne() {
  if (!currentGroupId.value) return
  scanning.value = true
  const res = await mutate('memberCheck.scan', { groupId: currentGroupId.value })
  scanning.value = false
  if (res?.ok) {
    // 本次扫描的错误/中止原因（例如接口限流导致中止）需要明确告知，不能静默成功
    // 本次扫描的错误/中止原因（例如接口限流导致中止）需要明确告知，不能静默成功。
    // lastResults 里同时包含其它群的结果，按当前群号匹配。
    const rows: any[] = res.data?.lastResults ?? []
    const mine = rows.find((r) => String(r.groupId) === String(currentGroupId.value)) ?? rows[0]
    const errs: string[] = mine?.errors ?? []
    scanErrors.value = errs
    if (errs.length > 0) {
      toast.warning(`群 ${currentGroupId.value} 检查已中止或存在异常，请查看下方提示`)
    } else {
      toast.success(`群 ${currentGroupId.value} 检查完成`)
    }
    // 响应带回了该群最新的 memberCheck 数据（含预览命中），直接采用
    if (!applyMutated(res, 'memberCheck', mc)) refreshPreview(undefined, true)
  } else {
    toast.error(res?.error || '检查失败')
  }
}

async function runPreview() {
  previewing.value = true
  await refreshPreview(undefined, true)
  previewing.value = false
}

function actionName(kind: string): string {
  const rule = kind === 'qqLevel' ? qq : kind === 'card' ? card : groupLevel
  return { none: '仅记录', mute: `禁言 ${rule.muteDuration} 分`, kick: '踢出' }[rule.action as string] || '仅记录'
}
function actionTagClass(kind: string): string {
  const rule = kind === 'qqLevel' ? qq : kind === 'card' ? card : groupLevel
  if (rule.action === 'kick') return 'violation'
  if (rule.action === 'mute') return 'audit'
  return 'neutral'
}
</script>

<style scoped>
.qg-run-list { display: flex; flex-direction: column; gap: 5px; max-height: 150px; overflow-y: auto; }
.qg-run-row { display: flex; justify-content: space-between; gap: 10px; font-size: 12.5px; }
/* 扫描中止 / 接口异常的提示块：需要足够醒目，避免管理员误以为检查正常完成 */
.qg-scan-errors {
  border: 1px solid var(--qg-danger);
  border-left-width: 3px;
  border-radius: 8px;
  padding: 8px 10px;
  margin: 0 0 10px;
}
.qg-scan-errors .qg-error { margin: 0; }
.qg-scan-errors .qg-error + .qg-error { margin-top: 6px; }
code { background: var(--qg-hover); border-radius: 4px; padding: 1px 5px; font-size: 12px; }
</style>
