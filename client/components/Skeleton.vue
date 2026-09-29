<template>
  <div class="qg-skeleton" :class="`rows-${rows}`">
    <div v-for="i in rows" :key="i" class="qg-skeleton-row" :style="{ width: widths[i % widths.length] }"></div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ rows?: number }>(), { rows: 4 })
const widths = ['100%', '82%', '92%', '70%']
</script>
