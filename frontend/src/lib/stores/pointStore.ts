/**
 * 测点 store：维护测点集合、接地电阻录入草稿与装置筛选。
 * 数据经 utils/db.ts 的 Dexie liveQuery 订阅。
 *
 * 依赖方向（单向）：pointStore → utils/db、types/*、utils/resistance、buildingStore。
 * 装置维度的测点统计（同时依赖两个 store）已下沉到 stores/pointStats.ts，避免循环依赖。
 */
import { derived, get, writable } from 'svelte/store'
import { db, watchTable } from '$lib/utils/db'
import type { Point, PointDraft } from '$lib/types/point'
import { createEmptyPointDraft } from '$lib/types/point'
import { deviceList } from '$lib/stores/buildingStore'
import { isQualified, limitRatio } from '$lib/utils/resistance'

/** 响应式测点集合 */
export const pointList = writable<Point[]>([])
export const pointReady = writable(false)

/** 电阻录入草稿（跨页面保留）与批量粘贴文本 */
export const pointDraft = writable<PointDraft>(createEmptyPointDraft())
export const pasteText = writable<string>('')
/** 装置筛选：当前查看的装置 id（null 表示全部） */
export const activeDeviceId = writable<string | null>(null)

watchTable<Point>(() => db.points).subscribe((rows) => {
  pointList.set(rows)
  pointReady.set(true)
})

/** 按装置取测点（按测点编号排序） */
export function pointsOfDevice(deviceId: string | null | undefined): Point[] {
  if (!deviceId) return []
  return get(pointList)
    .filter((point) => point.deviceId === deviceId)
    .sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
}

/** 当前装置筛选下的测点 */
export const activePoints = derived([pointList, activeDeviceId], ([$points, $deviceId]) => {
  if ($deviceId === null) return [...$points].sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
  return $points
    .filter((point) => point.deviceId === $deviceId)
    .sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
})

/** 测点行：附带装置类型与合格标记，供测点录入页表格展示 */
export const pointRows = derived([pointList, deviceList], ([$points, $devices]) =>
  $points
    .map((point) => {
      const device = $devices.find((item) => item.id === point.deviceId)
      return {
        point,
        device,
        deviceType: device?.type ?? '未知装置',
        qualified: isQualified(point.measuredOhm, point.limitOhm),
        ratio: limitRatio(point.measuredOhm, point.limitOhm)
      }
    })
    .sort((a, b) => b.ratio - a.ratio)
)

export function resetPointDraft(limitOhm = 10): void {
  pointDraft.set(createEmptyPointDraft(limitOhm))
}

export function setActiveDevice(deviceId: string | null): void {
  activeDeviceId.set(deviceId)
}

/* ------------------------------- 测点 ------------------------------- */

export async function createPoint(
  deviceId: string,
  payload: Omit<Point, 'id' | 'createdAt' | 'updatedAt' | 'deviceId'>
): Promise<Point> {
  const now = Date.now()
  const row: Point = {
    ...payload,
    deviceId,
    id: `pnt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now
  }
  await db.points.put(row)
  return row
}

export async function updatePoint(id: string, patch: Partial<Point>): Promise<void> {
  await db.points.update(id, { ...patch, updatedAt: Date.now() } as never)
}

/** 删除测点：同时删除其判定记录 */
export async function removePoint(id: string): Promise<void> {
  await db.transaction('rw', [db.points, db.verdicts], async () => {
    await db.verdicts.where('pointId').equals(id).delete()
    await db.points.delete(id)
  })
}

/** 批量改写某装置全部测点的实测电阻（批量录入场景） */
export async function bulkSetMeasured(deviceId: string, measuredOhm: number): Promise<number> {
  const now = Date.now()
  await db.points
    .where('deviceId')
    .equals(deviceId)
    .modify((point) => {
      point.measuredOhm = measuredOhm
      point.updatedAt = now
    })
  return pointsOfDevice(deviceId).length
}

/** 批量导入解析后的粘贴行（替换该装置原有测点） */
export async function importPointRows(
  deviceId: string,
  rows: Array<{ code: string; location: string; measuredOhm: number; limitOhm: number }>,
  meta: { meter: string; measureDate: string }
): Promise<number> {
  const now = Date.now()
  const records: Point[] = rows.map((row, index) => ({
    id: `pnt_${Date.now().toString(36)}${index}${Math.random().toString(36).slice(2, 6)}`,
    deviceId,
    code: row.code,
    location: row.location,
    measuredOhm: row.measuredOhm,
    limitOhm: row.limitOhm,
    meter: meta.meter,
    measureDate: meta.measureDate,
    createdAt: now + index,
    updatedAt: now + index
  }))
  await db.transaction('rw', [db.points, db.verdicts], async () => {
    const oldIds = (await db.points.where('deviceId').equals(deviceId).toArray()).map((row) => row.id)
    if (oldIds.length > 0) await db.verdicts.where('pointId').anyOf(oldIds).delete()
    await db.points.where('deviceId').equals(deviceId).delete()
    await db.points.bulkPut(records)
  })
  return records.length
}
