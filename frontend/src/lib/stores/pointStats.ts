/**
 * 装置维度的测点统计（跨 store 的派生值），独立为叶子 store 模块。
 *
 * 为什么要单独一个文件：buildingStore 与 pointStore 互相 import 会形成
 * ES 模块循环依赖，浏览器里表现为 `Cannot access 'X' before initialization` 的白屏。
 * 把「同时依赖两个 store 的派生值」下沉到这里，即可让 buildingStore → pointStore
 * 变成单向依赖（buildingStore 不再 import pointStore），彻底断环。
 */
import { derived } from 'svelte/store'
import { deviceList } from '$lib/stores/buildingStore'
import { pointList } from '$lib/stores/pointStore'
import { isQualified } from '$lib/utils/resistance'

/** 某装置的测点统计 */
export interface DevicePointStats {
  count: number
  unqualified: number
  minOhm: number
  maxOhm: number
}

/** 装置 id → 测点数 / 不合格数 / 实测电阻极值 */
export const pointStatsByDevice = derived([pointList, deviceList], ([$points, $devices]) => {
  const stats: Record<string, DevicePointStats> = {}
  $devices.forEach((device) => {
    const list = $points.filter((point) => point.deviceId === device.id)
    const values = list.map((point) => point.measuredOhm)
    stats[device.id] = {
      count: list.length,
      unqualified: list.filter((point) => !isQualified(point.measuredOhm, point.limitOhm)).length,
      minOhm: values.length > 0 ? Math.min(...values) : 0,
      maxOhm: values.length > 0 ? Math.max(...values) : 0
    }
  })
  return stats
})
