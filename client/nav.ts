import { ref } from 'vue'

// 当前页面 key（App 与各页面共享，用于页面内跳转，避免整页刷新）
export const currentPage = ref(localStorage.getItem('qg-page') || 'overview')

// 页面间传递的临时参数。
// 关键：参数必须「按目标页」投递，不能是谁先 mount 谁取走 ——
// 之前 Groups.vue 的 onMounted 会无条件 takePageParams()，把发给
// group-detail 的群号提前吃掉并清空，导致群配置详情页永远拿不到群号、
// 一直显示「暂无数据」。因此这里带上 target 页 key，只有目标页才能取走。
let pageParams: { target: string, value: any } | null = null

// 跳转到指定页面，可携带定位参数（如要打开的群号）
export function gotoPage(key: string, payload?: any) {
  // 先写参数再切页：保证目标页 mount 时参数已经就绪
  if (payload !== undefined && payload !== null) {
    pageParams = { target: key, value: payload }
  }
  currentPage.value = key
  localStorage.setItem('qg-page', key)
  window.scrollTo({ top: 0 })
}

// 取出「发给当前页面」的参数；非目标页调用会原样保留参数，不会误消费。
// 参数是一次性的：被正确的页面取走后即清空。
export function takePageParams<T = any>(forPage?: string): T | null {
  const want = forPage || currentPage.value
  if (!pageParams) return null
  if (pageParams.target !== want) return null
  const v = pageParams.value
  pageParams = null
  return v as T
}
