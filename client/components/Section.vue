<template>
  <div class="qg-section" :class="{ open: opened }">
    <div class="qg-section-head" @click="opened = !opened">
      <div class="qg-section-title">
        <span v-if="icon" class="qg-section-icon">{{ icon }}</span>
        <span v-else class="qg-dot-badge"></span>
        {{ title }}
        <span v-if="sub" class="qg-section-sub">{{ sub }}</span>
      </div>
      <div class="qg-section-tail" @click.stop>
        <slot name="actions"></slot>
        <span class="qg-caret" @click="opened = !opened">▶</span>
      </div>
    </div>
    <div v-show="opened" class="qg-section-body">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  title: string
  sub?: string
  icon?: string
  open?: boolean
}>(), { open: false })

const opened = ref(props.open)
watch(() => props.open, (v) => { opened.value = v })
</script>

<style scoped>
.qg-section-icon { font-size: 15px; }
.qg-section-tail { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
</style>
