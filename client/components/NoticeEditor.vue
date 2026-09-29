<template>
  <div class="qg-notice">
    <div class="qg-notice-head">
      <h4>{{ title }}</h4>
      <label class="qg-switch">
        <input type="checkbox" :checked="!!modelValue?.enabled" @change="patch({ enabled: ($event.target as HTMLInputElement).checked })" />
        <span>启用</span>
      </label>
    </div>
    <p v-if="hint" class="qg-hint">{{ hint }}</p>
    <div class="qg-grid two" style="margin-top:4px">
      <label class="qg-row">
        <span>发送方式</span>
        <select class="qg-select grow" :value="modelValue?.mode || 'group'" @change="patch({ mode: ($event.target as HTMLSelectElement).value })">
          <option value="group">群聊</option>
          <option value="private">私聊</option>
        </select>
      </label>
      <label class="qg-row">
        <span>目标</span>
        <input class="qg-input grow" :value="modelValue?.targetId || ''" placeholder="留空发送到事件所在群" @input="patch({ targetId: ($event.target as HTMLInputElement).value })" />
      </label>
    </div>
    <textarea class="qg-textarea" rows="4" :value="modelValue?.text || ''" @input="patch({ text: ($event.target as HTMLTextAreaElement).value })"></textarea>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  title: string
  modelValue?: any
  hint?: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: any): void
}>()

// 兜底为完整通知结构，避免父级传入 null/{} 时控件取值报错
const current = computed(() => ({
  enabled: !!props.modelValue?.enabled,
  mode: props.modelValue?.mode || 'group',
  targetId: props.modelValue?.targetId || '',
  text: props.modelValue?.text || '',
}))

function patch(p: any) {
  emit('update:modelValue', { ...current.value, ...p })
}
</script>
