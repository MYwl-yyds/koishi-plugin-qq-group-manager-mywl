<template>
  <div class="qg-empty" :class="{ sm }">
    <div class="qg-empty-icon">{{ icon }}</div>
    <div class="qg-empty-text">{{ text }}</div>
    <div v-if="sub" class="qg-empty-sub">{{ sub }}</div>
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
