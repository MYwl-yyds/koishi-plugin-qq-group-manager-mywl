<template>
  <k-layout>
    <div class="qg-shell">
      <nav class="qg-tabs">
        <div class="qg-tabs-inner">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="qg-tab"
            :class="{ active: current === tab.key }"
            @click="current = tab.key"
          >{{ tab.label }}</button>
        </div>
        <div class="qg-theme">
          <span class="qg-theme-label">主题</span>
          <select v-model="theme" @change="applyTheme">
            <option value="indigo">靛蓝</option>
            <option value="emerald">翡翠</option>
            <option value="rose">玫瑰</option>
            <option value="sunset">日落</option>
            <option value="ocean">海洋</option>
          </select>
        </div>
      </nav>

      <div class="qg-body">
        <Dashboard v-if="current === 'dashboard'" />
        <Groups v-else-if="current === 'groups'" />
        <Permissions v-else-if="current === 'permissions'" />
        <Blacklist v-else-if="current === 'blacklist'" />
        <Whitelist v-else-if="current === 'whitelist'" />
        <Settings v-else />
      </div>
    </div>

    <transition-group name="qg-toast" tag="div" class="qg-toast-wrap">
      <div v-for="t in toasts" :key="t.id" class="qg-toast" :class="t.type">{{ t.text }}</div>
    </transition-group>
  </k-layout>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Dashboard from './pages/Dashboard.vue'
import Groups from './pages/Groups.vue'
import Permissions from './pages/Permissions.vue'
import Blacklist from './pages/Blacklist.vue'
import Whitelist from './pages/Whitelist.vue'
import Settings from './pages/Settings.vue'
import { toasts } from './toast'

const tabs = [
  { key: 'dashboard', label: '仪表盘' },
  { key: 'groups', label: '群聊管理' },
  { key: 'permissions', label: '权限管理' },
  { key: 'blacklist', label: '黑名单' },
  { key: 'whitelist', label: '白名单' },
  { key: 'settings', label: '全局设置' },
]

const current = ref('dashboard')
const theme = ref(localStorage.getItem('qg-theme') || 'indigo')

function applyTheme() {
  document.documentElement.dataset.theme = theme.value
  localStorage.setItem('qg-theme', theme.value)
}
applyTheme()
</script>