<template>
  <div class="qg-tag-list">
    <span v-for="(t, i) in items" :key="t + i" class="qg-pill" :class="{ muted: muted }">
      {{ t }}
      <button v-if="removable" type="button" @click="$emit('remove', t)">×</button>
    </span>
    <span v-if="items.length === 0" class="qg-muted">{{ emptyText }}</span>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  items: string[]
  removable?: boolean
  muted?: boolean
  emptyText?: string
}>(), { emptyText: '暂无内容' })

defineEmits<{ (e: 'remove', v: string): void }>()
</script>
