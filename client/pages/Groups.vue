<template>
  <div>
    <Skeleton v-if="!data && loading" :rows="5" />

    <template v-else-if="data">
      <Section title="添加群聊" sub="机器人已在的群可直接勾选导入" icon="➕" :open="true">
        <div class="qg-grid two" style="align-items:start">
          <div>
            <label class="qg-field">
              <label>手动输入群号（逗号 / 空格 / 换行分隔）</label>
              <textarea class="qg-textarea" rows="3" v-model="newGroupIds" placeholder="例如：123456789, 987654321"></textarea>
            </label>
            <div class="qg-actions">
              <button class="qg-btn primary" :disabled="adding" @click="addManual">
                {{ adding ? '添加中…' : '批量添加' }}
              </button>
            </div>
          </div>
          <div>
            <div class="qg-field">
              <label>机器人当前所在群（点击即添加）</label>
              <div class="qg-side-list" style="max-height:170px;border:1px solid var(--qg-border-2);border-radius:9px;padding:6px">
                <EmptyState v-if="data.available.length === 0" text="没有可快捷添加的群" sub="机器人未加入任何群，或所有群都已配置" icon="💤" sm />
                <div
                  v-for="g in data.available"
                  :key="g.groupId"
                  class="qg-item"
                  @click="addOne(g.groupId)"
                >
                  <span class="qg-item-main">{{ g.name || '未命名群聊' }}</span>
                  <span class="qg-item-sub">{{ g.groupId }}</span>
                  <span class="qg-tag neutral">添加</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section :title="`已配置群聊（${filtered.length}）`" icon="💬" :open="true">
        <template #actions>
          <input class="qg-input" style="width:170px" v-model="keyword" placeholder="搜索群号 / 名称" />
        </template>

        <EmptyState
          v-if="filtered.length === 0"
          :text="data.groups.length === 0 ? '尚未配置任何群聊' : '没有匹配的群聊'"
          sub="在上方添加群号后即可为该群单独配置各项群管功能"
          icon="💬"
        />

        <div v-else class="qg-group-cards">
          <div
            v-for="g in filtered"
            :key="g.groupId"
            class="qg-group-card"
            :class="{ off: g.effective.enableGroupManagement === false }"
            @click="openDetail(g.groupId)"
          >
            <div class="head">
              <div class="title">
                <strong>{{ g.name || '未命名群聊' }}</strong>
                <span class="qg-muted">{{ g.groupId }}</span>
              </div>
              <span class="qg-tag" :class="g.effective.enableGroupManagement === false ? 'neutral' : 'ok'">
                {{ g.effective.enableGroupManagement === false ? '已停用' : '运行中' }}
              </span>
            </div>

            <div class="qg-flags">
              <span class="qg-flag" :class="{ on: g.effective.joinReview }">入群审核</span>
              <span class="qg-flag" :class="{ on: g.effective.bannedWords }">违禁词</span>
              <span class="qg-flag" :class="{ on: g.effective.linkGuard }">禁发链接</span>
              <span class="qg-flag" :class="{ on: g.effective.memberCheck }">群员检查</span>
              <span class="qg-flag" :class="{ on: g.effective.report }">举报</span>
              <span class="qg-flag" :class="{ on: g.effective.welcome }">欢迎语</span>
              <span class="qg-flag" :class="{ on: g.effective.farewell }">欢送语</span>
              <span class="qg-flag" :class="{ on: g.effective.autoBlacklist }">退群拉黑</span>
            </div>

            <div class="foot">
              <span>黑名单 {{ g.blacklistCount }}</span>
              <span>白名单 {{ g.whitelistCount }}</span>
              <span class="qg-muted">{{ g.hasConfig ? `覆盖 ${g.overriddenKeys.length} 项` : '使用全局配置' }}</span>
            </div>
          </div>
        </div>
      </Section>
    </template>

    <EmptyState v-else :text="error || '暂无数据'" icon="⚠️" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useScope, mutate, invalidateScope, splitList } from '../useData'
import { gotoPage, takePageParams } from '../nav'
import { toast } from '../toast'
import Section from '../components/Section.vue'
import EmptyState from '../components/EmptyState.vue'
import Skeleton from '../components/Skeleton.vue'

const newGroupIds = ref('')
const keyword = ref('')
const adding = ref(false)

const { data, loading, error, refresh } = useScope<any>('groups')

const filtered = computed(() => {
  const list = data.value?.groups || []
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return list
  return list.filter((g: any) => g.groupId.includes(kw) || String(g.name || '').toLowerCase().includes(kw))
})

async function addManual() {
  const ids = splitList(newGroupIds.value).filter((x) => /^\d{5,}$/.test(x))
  if (ids.length === 0) {
    toast.warning('请填写有效的群号')
    return
  }
  adding.value = true
  const res = await mutate('group.add', { groupIds: ids })
  adding.value = false
  if (res?.ok) {
    toast.success(`已添加 ${ids.length} 个群聊`)
    newGroupIds.value = ''
    invalidateScope('groups')
    refresh(undefined, true)
  } else {
    toast.error(res?.error || '添加失败')
  }
}

async function addOne(groupId: string) {
  const res = await mutate('group.add', { groupIds: [groupId] })
  if (res?.ok) {
    toast.success(`已添加群 ${groupId}`)
    invalidateScope('groups')
    refresh(undefined, true)
  } else {
    toast.error(res?.error || '添加失败')
  }
}

function openDetail(groupId: string) {
  gotoPage('group-detail', { groupId })
}

// 从其它页面带参跳转过来时自动打开对应群
onMounted(() => {
  const params = takePageParams()
  if (params?.groupId) gotoPage('group-detail', params)
})
</script>

<style scoped>
.qg-group-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(272px, 1fr)); gap: 12px; }
.qg-group-card {
  border: 1px solid var(--qg-border);
  border-radius: 11px;
  padding: 13px 14px;
  cursor: pointer;
  background: var(--qg-card-2);
  transition: transform .16s, box-shadow .16s, border-color .16s;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.qg-group-card:hover { transform: translateY(-2px); box-shadow: var(--qg-shadow); border-color: color-mix(in srgb, var(--qg-primary) 35%, transparent); }
.qg-group-card.off { opacity: .68; }
.qg-group-card .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.qg-group-card .title { display: flex; flex-direction: column; min-width: 0; }
.qg-group-card .title strong { font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qg-group-card .foot { display: flex; gap: 12px; font-size: 11.5px; color: var(--qg-text-2); border-top: 1px dashed var(--qg-border); padding-top: 8px; }
</style>
