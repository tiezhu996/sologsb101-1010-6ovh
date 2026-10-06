/**
 * 测点 store：维护测点集合、接地电阻录入草稿与装置筛选。
 * 数据经 utils/db.ts 的 Dexie liveQuery 订阅。
 *
 * 依赖方向（单向）：pointStore → utils/db、types/*、utils/resistance、buildingStore。
 * 装置维度的测点统计（同时依赖两个 store）已下沉到 stores/pointStats.ts，避免循环依赖。
 */
import { derived, get, writable } from 'svelte/store'
import { db, watchTable } from '$lib/utils/db'
import type { Point, PointDraft, PointPasteRow } from '$lib/types/point'
import { createEmptyPointDraft, normalizePointCode } from '$lib/types/point'
import { buildingById, deviceList } from '$lib/stores/buildingStore'
import { defaultBasis, judgePoint } from '$lib/types/verdict'
import type { Verdict } from '$lib/types/verdict'
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

/** 手记合并导入结果：新增 / 更新 / 保留 / 未受理数量与明细 */
export interface PointImportResult {
  /** 台账中不存在、本次新建的测点数 */
  created: number
  /** 按编号命中台账、本次改写了位置 / 实测 / 限值的测点数（编号命中但无字段变化计入 retained） */
  updated: number
  /** 未被触碰的测点数：粘贴中未出现的旧测点 + 命中但实测/限值/位置均无变化的测点 */
  retained: number
  /** 未受理行数：解析冲突 / 格式数值错误导致整批未写入时为粘贴行数，成功写入后为 0 */
  rejected: number
  /** 是否真正写入（false 表示整批未受理） */
  applied: boolean
  createdCodes: string[]
  updatedCodes: string[]
  retainedCodes: string[]
  /** 实测或限值变化、已撤销检测人确认、回退为自动初判待确认的测点编号 */
  revokedVerdictCodes: string[]
}

/**
 * 按编号把手记合并导入指定装置（不再整装置替换）。
 *
 * - 编号去首尾空格、忽略大小写后与该装置现有测点匹配；同编号更新位置、实测与限值。
 * - 粘贴行未写限值时，按当前装置所属建筑物防雷类别与装置类型重算建议限值。
 * - 粘贴位置为空时保留原位置，不抹掉。
 * - 实测或限值发生变化：判定结果与依据按新值重算，已确认的撤销确认（回退为待确认初判），
 *   未确认的仅刷新初判；仅位置变化或数据无变化时保留原判定（含确认状态）。
 * - 新测点自动生成一条待确认的初判记录；粘贴中未出现的旧测点原样留在台账。
 * - 调用方须先用 parsePointPaste 校验，errors 非空时不要调用本函数。
 */
export async function importPointRows(
  deviceId: string,
  rows: PointPasteRow[],
  meta: { meter: string; measureDate: string }
): Promise<PointImportResult> {
  const device = get(deviceList).find((item) => item.id === deviceId)
  const building = device ? buildingById(device.buildingId) : null
  const recomputedLimit = suggestLimitOhm(building?.protectionClass ?? '三类', device?.type ?? '接地体')

  const existing = pointsOfDevice(deviceId)
  const existingByCode = new Map(existing.map((point) => [normalizePointCode(point.code), point]))

  const pointsToPut: Point[] = []
  const verdictsToPut: Verdict[] = []
  const createdCodes: string[] = []
  const updatedCodes: string[] = []
  /** 保留：编号命中但无字段变化的测点 + 粘贴中未出现的旧测点 */
  const retainedCodes: string[] = []
  const revokedCodes: string[] = []
  /** 粘贴中命中（含更新与无变化）的旧测点 id，用于识别完全未出现的旧测点 */
  const matchedIds = new Set<string>()
  const now = Date.now()

  // 在同一事务内先取本次可能命中的测点判定，再逐行合并，保证读到的是最新确认状态
  const protectionClass = building?.protectionClass ?? '三类'
  const deviceType = device?.type ?? '接地体'

  await db.transaction('rw', [db.points, db.verdicts], async () => {
    // Dexie 的 anyOf 不接受空数组：装置尚无旧测点时没有判定可查
    const existingVerdicts =
      existing.length === 0
        ? []
        : await db.verdicts.where('pointId').anyOf(existing.map((point) => point.id)).toArray()
    const verdictByPoint = new Map(existingVerdicts.map((verdict) => [verdict.pointId, verdict]))

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]
      const effectiveLimit = row.limitSpecified && row.limitOhm !== null ? row.limitOhm : recomputedLimit
      const old = existingByCode.get(normalizePointCode(row.code))

      if (!old) {
        const id = `pnt_${now.toString(36)}${index}${Math.random().toString(36).slice(2, 6)}`
        pointsToPut.push({
          id,
          deviceId,
          code: row.code.trim(),
          location: row.location,
          measuredOhm: row.measuredOhm,
          limitOhm: effectiveLimit,
          meter: meta.meter,
          measureDate: meta.measureDate,
          createdAt: now + index,
          updatedAt: now + index
        })
        // 新测点给一条待检测人确认的自动初判，结论随实测与限值
        verdictsToPut.push({
          id: `vrd_${id}`,
          pointId: id,
          result: judgePoint(row.measuredOhm, effectiveLimit),
          basis: defaultBasis(protectionClass, deviceType, effectiveLimit),
          inspector: '',
          verdictDate: meta.measureDate,
          confirmed: false,
          createdAt: now + index,
          updatedAt: now + index
        })
        createdCodes.push(row.code.trim())
        continue
      }

      matchedIds.add(old.id)
      // 粘贴位置为空时保留台账原位置，不抹掉
      const location = row.location === '' ? old.location : row.location
      const valueChanged = old.measuredOhm !== row.measuredOhm || old.limitOhm !== effectiveLimit
      const locationChanged = location !== old.location
      if (!valueChanged && !locationChanged) {
        retainedCodes.push(old.code)
        continue
      }

      pointsToPut.push({
        ...old,
        location,
        measuredOhm: row.measuredOhm,
        limitOhm: effectiveLimit,
        updatedAt: now + index
      })
      updatedCodes.push(old.code)

      if (valueChanged) {
        const verdict = verdictByPoint.get(old.id)
        if (verdict) {
          // 实测或限值变化：结果与依据按新值重算；已确认的撤销确认回退待确认，未确认的仅刷新初判
          const wasConfirmed = verdict.confirmed
          verdictsToPut.push({
            ...verdict,
            result: judgePoint(row.measuredOhm, effectiveLimit),
            basis: defaultBasis(protectionClass, deviceType, effectiveLimit),
            confirmed: false,
            updatedAt: now + index
          })
          if (wasConfirmed) revokedCodes.push(old.code)
        }
      }
    }

    if (pointsToPut.length > 0) await db.points.bulkPut(pointsToPut)
    if (verdictsToPut.length > 0) await db.verdicts.bulkPut(verdictsToPut)
  })

  // 粘贴中未出现的旧测点同样保留在台账
  existing.forEach((point) => {
    if (!matchedIds.has(point.id)) retainedCodes.push(point.code)
  })

  return {
    created: createdCodes.length,
    updated: updatedCodes.length,
    retained: retainedCodes.length,
    rejected: 0,
    applied: true,
    createdCodes,
    updatedCodes,
    retainedCodes,
    revokedVerdictCodes: revokedCodes
  }
}

/**
 * 整批未受理时的结果：不写任何数据，全部粘贴行计入未受理，现有测点全部保留。
 * 供页面在解析存在冲突行时给出与成功导入一致口径的统计。
 */
export function rejectedImportResult(rowCount: number, existingCount: number): PointImportResult {
  return {
    created: 0,
    updated: 0,
    retained: existingCount,
    rejected: rowCount,
    applied: false,
    createdCodes: [],
    updatedCodes: [],
    retainedCodes: [],
    revokedVerdictCodes: []
  }
}
