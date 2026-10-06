/**
 * 整改 store：维护判定记录与整改状态机、合格率派生值。
 * 判定（Verdict）与整改建议（Rectify）同属「合格判定与整改建议」模块，
 * 统一在此维护，供 /verdicts 与 /backup 两页共用。
 */
import { derived, get, writable } from 'svelte/store'
import { db, watchTable } from '$lib/utils/db'
import type { Verdict, VerdictResult } from '$lib/types/verdict'
import { defaultBasis, judgePoint } from '$lib/types/verdict'
import type { Rectify, RectifyFilterState, RectifyState } from '$lib/types/rectify'
import { RECTIFY_STATES, RECTIFY_TRANSITIONS, SUGGESTION_TEMPLATES, createEmptyRectifyFilter } from '$lib/types/rectify'
import { buildingList, deviceList } from '$lib/stores/buildingStore'
import { pointList } from '$lib/stores/pointStore'
import { isQualified, qualifyRate } from '$lib/utils/resistance'

/** 响应式判定集合 */
export const verdictList = writable<Verdict[]>([])
/** 响应式整改建议集合 */
export const rectifyList = writable<Rectify[]>([])
export const rectifyReady = writable(false)
export const rectifyFilter = writable<RectifyFilterState>(createEmptyRectifyFilter())

watchTable<Verdict>(() => db.verdicts).subscribe((rows) => {
  verdictList.set(rows)
})
watchTable<Rectify>(() => db.rectifies).subscribe((rows) => {
  rectifyList.set(rows)
  rectifyReady.set(true)
})

/** 判定行：判定 + 测点 + 装置 + 建筑物，供判定台表格展示 */
export const verdictRows = derived(
  [verdictList, pointList, deviceList, buildingList],
  ([$verdicts, $points, $devices, $buildings]) =>
    $points.map((point) => {
      const device = $devices.find((item) => item.id === point.deviceId)
      const building = device ? $buildings.find((item) => item.id === device.buildingId) : undefined
      const verdict = $verdicts.find((item) => item.pointId === point.id) ?? null
      const auto = judgePoint(point.measuredOhm, point.limitOhm)
      return {
        point,
        device,
        building,
        verdict,
        autoResult: auto,
        /** 初判与检测人结论是否一致 */
        consistent: verdict === null ? false : verdict.result === auto,
        qualified: verdict ? verdict.result === '合格' : auto === '合格'
      }
    })
)

/** 合格率派生值：全部测点、按建筑物、按装置 */
export const qualifyStats = derived([pointList, verdictList, deviceList, buildingList], ([$points, $verdicts, $devices, $buildings]) => {
  const qualifiedOf = (pointId: string, measuredOhm: number, limitOhm: number): boolean => {
    const verdict = $verdicts.find((item) => item.pointId === pointId)
    if (verdict && verdict.result !== '待判定') return verdict.result === '合格'
    return isQualified(measuredOhm, limitOhm)
  }
  const flags = $points.map((point) => qualifiedOf(point.id, point.measuredOhm, point.limitOhm))
  const overall = {
    total: flags.length,
    passed: flags.filter(Boolean).length,
    failed: flags.filter((flag) => !flag).length,
    rate: qualifyRate(flags)
  }

  const byBuilding = $buildings.map((building) => {
    const deviceIds = new Set($devices.filter((device) => device.buildingId === building.id).map((device) => device.id))
    const points = $points.filter((point) => deviceIds.has(point.deviceId))
    const buildingFlags = points.map((point) => qualifiedOf(point.id, point.measuredOhm, point.limitOhm))
    return {
      buildingId: building.id,
      buildingName: building.name,
      total: buildingFlags.length,
      failed: buildingFlags.filter((flag) => !flag).length,
      rate: qualifyRate(buildingFlags)
    }
  })

  const byDevice = $devices.map((device) => {
    const points = $points.filter((point) => point.deviceId === device.id)
    const deviceFlags = points.map((point) => qualifiedOf(point.id, point.measuredOhm, point.limitOhm))
    return {
      deviceId: device.id,
      deviceType: device.type,
      total: deviceFlags.length,
      failed: deviceFlags.filter((flag) => !flag).length,
      rate: qualifyRate(deviceFlags)
    }
  })

  return { overall, byBuilding, byDevice }
})

/** 未生成整改建议的不合格测点（判定台一键生成入口） */
export const unhandledUnqualified = derived([verdictRows, rectifyList], ([$rows, $rectifies]) =>
  $rows.filter((row) => !row.qualified && !$rectifies.some((rectify) => rectify.pointId === row.point.id))
)

/** 按筛选条件过滤后的整改单 */
export const filteredRectifies = derived(
  [rectifyList, rectifyFilter, buildingList, pointList],
  ([$rectifies, $filter, $buildings, $points]) => {
    const today = new Date().toISOString().slice(0, 10)
    return $rectifies
      .filter((rectify) => {
        const keyword = $filter.keyword.trim()
        if (keyword.length > 0) {
          const point = $points.find((item) => item.id === rectify.pointId)
          const haystack = `${rectify.problem}${rectify.suggestion}${rectify.owner}${point?.code ?? ''}`
          if (!haystack.includes(keyword)) return false
        }
        if ($filter.buildingIds.length > 0 && !$filter.buildingIds.includes(rectify.buildingId)) return false
        if ($filter.states.length > 0 && !$filter.states.includes(rectify.state)) return false
        if ($filter.onlyOverdue && !(rectify.state === '待整改' && rectify.deadline < today)) return false
        return true
      })
      .map((rectify) => {
        const building = $buildings.find((item) => item.id === rectify.buildingId)
        const point = $points.find((item) => item.id === rectify.pointId)
        const overdue = rectify.state === '待整改' && rectify.deadline < today
        return { rectify, buildingName: building?.name ?? '未知建筑物', pointCode: point?.code ?? '—', overdue }
      })
      .sort((a, b) => a.rectify.deadline.localeCompare(b.rectify.deadline))
  }
)

/** 整改状态机统计 */
export const rectifyStateCounts = derived(rectifyList, ($rectifies) => {
  const counts: Record<RectifyState, number> = { 待整改: 0, 已整改: 0, 已复检: 0 }
  $rectifies.forEach((rectify) => {
    counts[rectify.state] += 1
  })
  return counts
})

/** 状态机是否允许流转 */
export function canTransition(from: RectifyState, to: RectifyState): boolean {
  return (RECTIFY_TRANSITIONS[from] ?? []).includes(to)
}

export function patchRectifyFilter(patch: Partial<RectifyFilterState>): void {
  rectifyFilter.update((current) => ({ ...current, ...patch }))
}

export function resetRectifyFilter(): void {
  rectifyFilter.set(createEmptyRectifyFilter())
}

/* ------------------------------- 判定 ------------------------------- */

/** 自动初判某测点，并写入判定记录（检测人确认前 confirmed = false） */
export async function autoJudgePoint(pointId: string, inspector = ''): Promise<Verdict | null> {
  const point = get(pointList).find((item) => item.id === pointId)
  if (!point) return null
  const device = get(deviceList).find((item) => item.id === point.deviceId)
  const building = device ? get(buildingList).find((item) => item.id === device.buildingId) : undefined
  const result = judgePoint(point.measuredOhm, point.limitOhm)
  const existing = get(verdictList).find((item) => item.pointId === pointId)
  const now = Date.now()
  const row: Verdict = {
    id: existing?.id ?? `vrd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    pointId,
    result,
    basis: existing?.basis || defaultBasis(building?.protectionClass ?? '三类', device?.type ?? '接地体', point.limitOhm),
    inspector: inspector || existing?.inspector || '',
    verdictDate: point.measureDate,
    confirmed: false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  }
  await db.verdicts.put(row)
  return row
}

/** 批量自动初判（判定台一键操作） */
export async function autoJudgeAll(inspector = '陈立群'): Promise<number> {
  const points = get(pointList)
  for (const point of points) {
    await autoJudgePoint(point.id, inspector)
  }
  return points.length
}

/** 检测人确认判定结论生效 */
export async function confirmVerdict(id: string, patch: Partial<Verdict> = {}): Promise<void> {
  await db.verdicts.update(id, { ...patch, confirmed: true, updatedAt: Date.now() } as never)
}

/** 批量改判定结论（判定台批量操作） */
export async function bulkSetVerdictResult(pointIds: string[], result: VerdictResult, inspector: string): Promise<number> {
  const now = Date.now()
  for (const pointId of pointIds) {
    const point = get(pointList).find((item) => item.id === pointId)
    if (!point) continue
    const device = get(deviceList).find((item) => item.id === point.deviceId)
    const building = device ? get(buildingList).find((item) => item.id === device.buildingId) : undefined
    const existing = get(verdictList).find((item) => item.pointId === pointId)
    const row: Verdict = {
      id: existing?.id ?? `vrd_${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      pointId,
      result,
      basis: existing?.basis || defaultBasis(building?.protectionClass ?? '三类', device?.type ?? '接地体', point.limitOhm),
      inspector,
      verdictDate: existing?.verdictDate ?? point.measureDate,
      confirmed: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    await db.verdicts.put(row)
  }
  return pointIds.length
}

export async function removeVerdict(id: string): Promise<void> {
  await db.verdicts.delete(id)
}

/* ------------------------------ 整改建议 ------------------------------ */

/** 由不合格判定生成整改建议（可一次批量生成） */
export async function generateRectifies(options: {
  templateKeys?: string[]
  owner?: string
  inspector?: string
} = {}): Promise<number> {
  const owner = options.owner ?? '王振海'
  const inspector = options.inspector ?? '陈立群'
  const rows = get(verdictRows).filter((row) => !row.qualified)
  const existingPointIds = new Set(get(rectifyList).map((rectify) => rectify.pointId))
  const now = Date.now()
  let created = 0
  const records: Rectify[] = []
  rows.forEach((row, index) => {
    if (existingPointIds.has(row.point.id)) return
    const template = SUGGESTION_TEMPLATES[index % SUGGESTION_TEMPLATES.length]
    const deadline = new Date(now + template.days * 86400000).toISOString().slice(0, 10)
    records.push({
      id: `rct_${now.toString(36)}${index}${Math.random().toString(36).slice(2, 6)}`,
      buildingId: row.building?.id ?? row.device?.buildingId ?? '',
      pointId: row.point.id,
      problem: `${template.problem}：${row.point.code} 实测 ${row.point.measuredOhm} Ω，限值 ${row.point.limitOhm} Ω`,
      suggestion: template.suggestion,
      deadline,
      state: '待整改',
      owner,
      createdAt: now + index,
      updatedAt: now + index
    })
    created += 1
  })
  if (records.length > 0) await db.rectifies.bulkPut(records)
  // 同步刷新判定人信息，保证导出结论有检测人署名
  for (const row of rows) {
    if (row.verdict && !row.verdict.inspector) {
      await db.verdicts.update(row.verdict.id, { inspector, updatedAt: now } as never)
    }
  }
  return created
}

export async function createRectify(payload: Omit<Rectify, 'id' | 'createdAt' | 'updatedAt'>): Promise<Rectify> {
  const now = Date.now()
  const row: Rectify = {
    ...payload,
    id: `rct_${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now
  }
  await db.rectifies.put(row)
  return row
}

export async function updateRectify(id: string, patch: Partial<Rectify>): Promise<void> {
  await db.rectifies.update(id, { ...patch, updatedAt: Date.now() } as never)
}

/** 推进整改状态机（校验合法流转） */
export async function transitionRectify(id: string, next: RectifyState): Promise<boolean> {
  const current = get(rectifyList).find((item) => item.id === id)
  if (!current) return false
  if (!canTransition(current.state, next)) return false
  await db.rectifies.update(id, { state: next, updatedAt: Date.now() } as never)
  return true
}

export async function removeRectify(id: string): Promise<void> {
  await db.rectifies.delete(id)
}

/** 导出「检测结论 + 整改建议」文本（供备份页复制） */
export function buildRectifySummary(): string {
  const lines = get(filteredRectifies).map(
    (row) =>
      `${row.buildingName}｜${row.pointCode}｜${row.rectify.state}｜期限 ${row.rectify.deadline}｜责任人 ${row.rectify.owner}｜${row.rectify.problem}｜建议：${row.rectify.suggestion}`
  )
  return lines.join('\n')
}

export { RECTIFY_STATES }
