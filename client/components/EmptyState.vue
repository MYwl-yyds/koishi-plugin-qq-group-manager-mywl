<template>
  <div class="qg-empty" :class="{ sm }">
    <div class="qg-empty-icon">{{ icon }}</div>
    <div class="qg-empty-text">{{ text }}</div>
    <div v-if="sub" class="qg-empty-sub">{{ sub }}</div>
    <!-- 可选操作区（如「重新加载」按钮） -->
    <div v-if="$slots.default" class="qg-empty-actions">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  text: string
  sub?: string
  icon?: string
  sm?: boolean
}>(), { icon: '📭' })
</script>

<style scoped>
.qg-empty-actions { margin-top: 10px; }
</style>
