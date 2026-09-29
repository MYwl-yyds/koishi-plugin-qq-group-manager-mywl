<template>
  <k-layout>
    <div class="qg-shell">
      <!-- 侧边栏：按功能域重新归类 -->
      <aside class="qg-nav" :class="{ collapsed: collapsed }">
        <div class="qg-brand">
          <span class="qg-brand-logo">群</span>
          <div v-if="!collapsed" class="qg-brand-text">
            <strong>群管控制台</strong>
            <small>OneBot v11</small>
          </div>
        </div>

        <nav class="qg-nav-groups">
          <div v-for="grp in navGroups" :key="grp.title" class="qg-nav-group">
            <div v-if="!collapsed" class="qg-nav-title">{{ grp.title }}</div>
            <button
              v-for="item in grp.items"
              :key="item.key"
              class="qg-nav-item"
              :class="{ active: currentPage === item.key }"
              :title="collapsed ? item.label : item.desc"
              @click="go(item.key)"
            >
              <span class="qg-nav-icon">{{ item.icon }}</span>
              <span v-if="!collapsed" class="qg-nav-label">{{ item.label }}</span>
            </button>
          </div>
        </nav>

        <div class="qg-nav-foot">
          <button class="qg-nav-item" :title="collapsed ? '展开侧栏' : '收起侧栏'" @click="toggleCollapse">
            <span class="qg-nav-icon">{{ collapsed ? '»' : '«' }}</span>
            <span v-if="!collapsed" class="qg-nav-label">收起侧栏</span>
          </button>
        </div>
      </aside>

      <!-- 主区域 -->
      <main class="qg-main">
        <header class="qg-topbar">
          <div class="qg-topbar-left">
            <h2 class="qg-page-title">{{ activeItem?.label }}</h2>
            <span class="qg-page-desc">{{ activeItem?.desc }}</span>
          </div>
          <div class="qg-topbar-right">
            <span v-if="updatedText" class="qg-updated">{{ updatedText }}</span>
            <select v-model="theme" class="qg-theme-select" title="主题配色" @change="applyTheme">
              <option v-for="t in themes" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </div>
        </header>

        <div class="qg-body">
          <KeepAlive>
            <component :is="activeComponent" :key="currentPage" />
          </KeepAlive>
        </div>
      </main>
    </div>

    <transition-group name="qg-toast" tag="div" class="qg-toast-wrap">
      <div v-for="t in toasts" :key="t.id" class="qg-toast" :class="t.type">{{ t.text }}</div>
    </transition-group>
  </k-layout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Overview from './pages/Overview.vue'
import Groups from './pages/Groups.vue'
import GroupDetail from './pages/GroupDetail.vue'
import BannedWords from './pages/BannedWords.vue'
import MemberCheck from './pages/MemberCheck.vue'
import Blacklist from './pages/Blacklist.vue'
import Whitelist from './pages/Whitelist.vue'
import Logs from './pages/Logs.vue'
import Permissions from './pages/Permissions.vue'
import Settings from './pages/Settings.vue'
import Backup from './pages/Backup.vue'
import { toasts } from './toast'
import { invalidateScope, lastLoadedAt } from './useData'
import { currentPage, gotoPage } from './nav'

// 页面按功能域重新归类：
//  1. 总览        —— 运行概况、待办、趋势
//  2. 群聊管控    —— 群列表 / 群配置 / 违禁词与链接 / 群员检查
//  3. 名单中心    —— 黑名单 / 白名单
//  4. 记录中心    —— 操作与审核日志
//  5. 系统        —— 权限组 / 全局设置
const navGroups = [
  {
    title: '总览',
    items: [
      { key: 'overview', label: '运行总览', icon: '📊', desc: '关键指标、待审申请与近 7 天趋势', component: Overview },
    ],
  },
  {
    title: '群聊管控',
    items: [
      { key: 'groups', label: '群聊列表', icon: '💬', desc: '选择要配置的群聊，查看各功能开关状态', component: Groups },
      { key: 'group-detail', label: '群配置详情', icon: '⚙️', desc: '按群覆盖欢迎语、审核、违禁词、链接、图片、群员检查等设置', component: GroupDetail },
      { key: 'banned-words', label: '违禁词与链接', icon: '🚫', desc: '全局违禁词库、禁发链接与禁发图片（全局样本库）', component: BannedWords },
      { key: 'member-check', label: '群员检查', icon: '🔎', desc: '按群配置：按 QQ 等级 / 群名片 / 群等级定时检查成员并自动处理', component: MemberCheck },
    ],
  },
  {
    title: '名单中心',
    items: [
      { key: 'blacklist', label: '黑名单', icon: '⛔', desc: '全局与分群黑名单管理', component: Blacklist },
      { key: 'whitelist', label: '白名单', icon: '✅', desc: '全局与分群白名单及豁免项管理', component: Whitelist },
    ],
  },
  {
    title: '记录中心',
    items: [
      { key: 'logs', label: '运行日志', icon: '📜', desc: '操作 / 审核 / 违规 / 黑名单日志检索与分页', component: Logs },
    ],
  },
  {
    title: '系统',
    items: [
      { key: 'permissions', label: '权限组', icon: '🛡️', desc: '权限组、优先级、成员与细粒度权限开关', component: Permissions },
      { key: 'settings', label: '全局设置', icon: '🔧', desc: '超级管理员、通知转发、AI 接口', component: Settings },
      { key: 'backup', label: '导出与导入', icon: '📦', desc: '配置与黑白名单的备份 / 迁移 / 还原', component: Backup },
    ],
  },
]

const flat = navGroups.flatMap((g) => g.items)
const themes = [
  { value: 'indigo', label: '靛蓝' },
  { value: 'emerald', label: '翡翠' },
  { value: 'rose', label: '玫瑰' },
  { value: 'sunset', label: '日落' },
  { value: 'ocean', label: '海洋' },
  { value: 'dark', label: '暗色' },
]

// 记住上次所在页面与侧栏状态（页面 key 由 nav.ts 统一管理）
const collapsed = ref(localStorage.getItem('qg-collapsed') === '1')
const theme = ref(localStorage.getItem('qg-theme') || 'indigo')
const now = ref(Date.now())
let tickTimer: any = null

const activeItem = computed(() => flat.find((i) => i.key === currentPage.value) || flat[0])
const activeComponent = computed(() => activeItem.value.component)
const updatedText = computed(() => {
  void now.value
  const diff = Math.floor((now.value - lastLoadedAt.value) / 1000)
  if (diff < 5) return '数据已就绪'
  if (diff < 60) return `${diff} 秒前更新`
  return `${Math.floor(diff / 60)} 分钟前更新`
})

function go(key: string) {
  gotoPage(key)
}

function toggleCollapse() {
  collapsed.value = !collapsed.value
  localStorage.setItem('qg-collapsed', collapsed.value ? '1' : '0')
}

function applyTheme() {
  document.documentElement.dataset.theme = theme.value
  localStorage.setItem('qg-theme', theme.value)
}

onMounted(() => {
  applyTheme()
  tickTimer = setInterval(() => { now.value = Date.now() }, 1000)
  // 首次进入清掉可能已过期的本地缓存，保证拿到最新数据
  invalidateScope()
  lastLoadedAt.value = Date.now()
})
onBeforeUnmount(() => { if (tickTimer) clearInterval(tickTimer) })
</script>

<style scoped>
.qg-updated { font-size: 12px; color: var(--qg-muted); }
</style>
