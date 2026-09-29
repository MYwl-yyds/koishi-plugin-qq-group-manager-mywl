import { ref } from 'vue'

// 当前页面 key（App 与各页面共享，用于页面内跳转，避免整页刷新）
export const currentPage = ref(localStorage.getItem('qg-page') || 'overview')

// 跳转到指定页面，可携带定位参数（如要打开的群号）
export function gotoPage(key: string, payload?: any) {
  currentPage.value = key
  localStorage.setItem('qg-page', key)
  if (payload) pageParams.value = payload
  window.scrollTo({ top: 0 })
}

// 页面间传递的临时参数
export const pageParams = ref<any>(null)

export function takePageParams<T = any>(): T | null {
  const v = pageParams.value
  pageParams.value = null
  return v
}
