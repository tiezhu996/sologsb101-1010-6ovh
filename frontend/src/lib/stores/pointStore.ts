/**
 * 测点 store：维护测点集合、接地电阻录入草稿与装置筛选。
 * 数据经 utils/db.ts 的 Dexie liveQuery 订阅。
 *
 * 依赖方向（单向）：pointStore → utils/db、types/*、utils/resistance、buildingStore。
 * 装置维度的测点统计（同时依赖两个 store）已下沉到 stores/pointStats.ts，避免循环依赖。
 */
import { derived, get, writable } from 'svelte/store'
import { createId, db, watchTable } from '$lib/utils/db'
import type { Point, PointDraft, PointPasteRow } from '$lib/types/point'
import { createEmptyPointDraft, normalizePointCode } from '$lib/types/point'
import { buildingById, deviceList } from '$lib/stores/buildingStore'
import { isQualified, limitRatio, suggestLimitOhm } from '$lib/utils/resistance'

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

/** 手记补充导入结果：新增 / 更新 / 台账保留 / 未受理（解析失败时由调用方统计） */
export interface PointMergeResult {
  created: number
  updated: number
  kept: number
  rejected: number
}

/**
 * 把手记粘贴行合并进指定防雷装置（不做整装置替换）：
 * - 编号去首尾空格后忽略大小写与台账匹配；同编号更新位置、实测、限值；
 * - 行内未写限值时按当前防雷类别与装置类型重算；位置为空不抹掉原位置；
 * - 未出现在粘贴内容里的旧测点全部保留；
 * - 同编号测点实测或限值发生变化时撤销其判定确认（判定记录保留），无变化则保留确认；
 * - 新测点沿用装置既有检测仪器与本次检测日期；新增点暂无判定记录，到判定页再初判。
 */
export async function mergePointRows(
  deviceId: string,
  rows: PointPasteRow[],
  meta: { meter: string; measureDate: string }
): Promise<PointMergeResult> {
  const device = get(deviceList).find((item) => item.id === deviceId)
  if (!device) return { created: 0, updated: 0, kept: 0, rejected: rows.length }
  const building = buildingById(device.buildingId)
  const defaultLimitOhm = suggestLimitOhm(building?.protectionClass ?? '三类', device.type)

  const existing = get(pointList).filter((point) => point.deviceId === deviceId)
  const byCode = new Map(existing.map((point) => [normalizePointCode(point.code), point]))

  const now = Date.now()
  const toCreate: Point[] = []
  const toUpdate: Point[] = []
  /** 需要撤销判定确认的测点 id（实测或限值已变化） */
  const verdictToRevoke: string[] = []
  const matched = new Set<string>()

  rows.forEach((row, index) => {
    const limitOhm = row.hasLimit ? row.limitOhm : defaultLimitOhm
    const found = byCode.get(normalizePointCode(row.code))
    if (!found) {
      toCreate.push({
        id: createId('pnt'),
        deviceId,
        code: row.code,
        location: row.location,
        measuredOhm: row.measuredOhm,
        limitOhm,
        meter: meta.meter,
        measureDate: meta.measureDate,
        createdAt: now + index,
        updatedAt: now + index
      })
      return
    }
    matched.add(found.id)
    const resistanceChanged = found.measuredOhm !== row.measuredOhm || found.limitOhm !== limitOhm
    toUpdate.push({
      ...found,
      // 位置为空不抹掉原位置
      location: row.location.trim() ? row.location : found.location,
      measuredOhm: row.measuredOhm,
      limitOhm,
      updatedAt: now + index
    })
    if (resistanceChanged) verdictToRevoke.push(found.id)
  })

  await db.transaction('rw', [db.points, db.verdicts], async () => {
    if (toCreate.length > 0) await db.points.bulkPut(toCreate)
    if (toUpdate.length > 0) await db.points.bulkPut(toUpdate)
    // 实测或限值变化：撤销判定确认（判定记录保留，检测人重新初判/确认后再生效）
    if (verdictToRevoke.length > 0) {
      await db.verdicts
        .where('pointId')
        .anyOf(verdictToRevoke)
        .modify((verdict) => {
          verdict.confirmed = false
          verdict.updatedAt = now
        })
    }
  })

  return {
    created: toCreate.length,
    updated: toUpdate.length,
    kept: existing.length - matched.size,
    rejected: 0
  }
}
