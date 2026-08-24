import { ref } from 'vue'
import { store, send } from '@koishijs/client'

// 共享数据获取与变更封装
export function useGmData() {
  const data = ref<any>(store['qq-guanqun'] ?? null)

  async function refresh() {
    data.value = await send('qq-guanqun/refresh')
  }

  async function mutate(action: string, payload: any = {}) {
    const res = await send('qq-guanqun/mutate', { action, data: payload })
    if (res?.ok) data.value = res.snapshot
    return res
  }

  return { data, refresh, mutate }
}

export function formatTime(v: string | Date | number | undefined): string {
  if (!v) return '-'
  const d = new Date(v)
  if (isNaN(d.getTime())) return String(v)
  return d.toLocaleString()
}