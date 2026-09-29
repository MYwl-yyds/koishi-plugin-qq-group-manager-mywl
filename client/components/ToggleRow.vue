<template>
  <label class="qg-row" :class="{ disabled }" :title="title">
    <span class="qg-row-label">{{ label }}</span>
    <span v-if="hint" class="qg-row-hint">{{ hint }}</span>
    <slot />
    <input v-if="type === 'checkbox'" type="checkbox" :checked="!!modelValue" :disabled="disabled" @change="onCheck" />
    <input
      v-else-if="type === 'number'"
      class="qg-input grow"
      type="number"
      :value="modelValue"
      :disabled="disabled"
      :min="min"
      :max="max"
      :step="step"
      @input="onInput"
    />
    <input
      v-else-if="type === 'text'"
      class="qg-input grow"
      :value="modelValue"
      :disabled="disabled"
      :placeholder="placeholder"
      @input="onInput"
    />
    <select v-else-if="type === 'select'" class="qg-select grow" :value="modelValue" :disabled="disabled" @change="onInput">
      <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
  </label>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  label: string
  modelValue?: any
  type?: 'checkbox' | 'number' | 'text' | 'select'
  title?: string
  hint?: string
  disabled?: boolean
  placeholder?: string
  min?: number | string
  max?: number | string
  step?: number | string
  options?: Array<{ label: string, value: any }>
}>(), {
  type: 'checkbox',
  options: () => [],
})

const emit = defineEmits<{
  (e: 'update:modelValue', v: any): void
}>()

function onCheck(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).checked)
}
function onInput(e: Event) {
  const el = e.target as HTMLInputElement | HTMLSelectElement
  emit('update:modelValue', props.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value)
}
</script>
