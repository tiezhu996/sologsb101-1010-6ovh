/**
 * 备份导入导出：整库 JSON 快照的组装、校验、下载与导入。
 * 与 utils/db.ts 的 BackupPayload 结构保持一致；JSON 中不含任何非数据内容。
 */
import {
  db,
  DB_NAME,
  DB_VERSION,
  createId,
  clearAllTables,
  stampBackupTime,
  type BackupPayload
} from '$lib/utils/db'

/** 备份集合键名 */
export const BACKUP_KEYS = ['buildings', 'devices', 'points', 'verdicts', 'rectifies'] as const
export type BackupKey = (typeof BACKUP_KEYS)[number]

export type CountMap = Record<BackupKey, number>

/** 组装当前本地数据的完整快照 */
export async function buildBackupPayload(): Promise<BackupPayload> {
  const [buildings, devices, points, verdicts, rectifies] = await Promise.all([
    db.buildings.toArray(),
    db.devices.toArray(),
    db.points.toArray(),
    db.verdicts.toArray(),
    db.rectifies.toArray()
  ])
  return {
    app: 'gblightprot',
    dbVersion: DB_VERSION,
    exportedAt: new Date().toISOString(),
    buildings,
    devices,
    points,
    verdicts,
    rectifies
  }
}

/** 校验外部 JSON 是否为本站可识别的备份文件 */
export function validateBackup(input: unknown): { ok: boolean; errors: string[]; payload: BackupPayload | null } {
  const errors: string[] = []
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: ['文件内容不是合法的 JSON 对象'], payload: null }
  }
  const obj = input as Partial<BackupPayload>
  if (obj.app !== undefined && obj.app !== 'gblightprot') {
    errors.push('app 字段应为 gblightprot，文件来源不明')
  }
  for (const key of BACKUP_KEYS) {
    if (!Array.isArray(obj[key])) errors.push(`${key} 字段缺失或不是数组`)
  }
  if (errors.length > 0) return { ok: false, errors, payload: null }
  const payload: BackupPayload = {
    app: 'gblightprot',
    dbVersion: typeof obj.dbVersion === 'number' ? obj.dbVersion : DB_VERSION,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
    buildings: obj.buildings ?? [],
    devices: obj.devices ?? [],
    points: obj.points ?? [],
    verdicts: obj.verdicts ?? [],
    rectifies: obj.rectifies ?? []
  }
  return { ok: true, errors, payload }
}

/** 统计快照各表行数 */
export function countPayload(payload: BackupPayload): CountMap {
  return {
    buildings: payload.buildings.length,
    devices: payload.devices.length,
    points: payload.points.length,
    verdicts: payload.verdicts.length,
    rectifies: payload.rectifies.length
  }
}

/** 导出 JSON 文件到浏览器下载目录 */
export async function exportBackupJson(): Promise<{ fileName: string; counts: CountMap }> {
  const payload = await buildBackupPayload()
  const fileName = `${DB_NAME}-backup-v${payload.dbVersion}-${payload.exportedAt
    .slice(0, 19)
    .replace(/[:T]/g, '')}.json`
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
  stampBackupTime(payload.exportedAt)
  return { fileName, counts: countPayload(payload) }
}

/** 读取用户选择的备份文件文本 */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsText(file, 'utf-8')
  })
}

/** 导入快照：overwrite=true 先清空全部表，否则按主键合并 */
export async function importBackup(payload: BackupPayload, overwrite: boolean): Promise<CountMap> {
  if (overwrite) await clearAllTables()
  await db.transaction('rw', [db.buildings, db.devices, db.points, db.verdicts, db.rectifies], async () => {
    await db.buildings.bulkPut(payload.buildings)
    await db.devices.bulkPut(payload.devices)
    await db.points.bulkPut(payload.points)
    await db.verdicts.bulkPut(payload.verdicts)
    await db.rectifies.bulkPut(payload.rectifies)
  })
  return countPayload(payload)
}

/** 追加式导入：为导入数据重新分配 id，避免覆盖现有档案 */
export function remapIds(payload: BackupPayload): BackupPayload {
  const buildingMap = new Map<string, string>()
  const deviceMap = new Map<string, string>()
  const pointMap = new Map<string, string>()

  const buildings = payload.buildings.map((building) => {
    const id = createId('bld')
    buildingMap.set(building.id, id)
    return { ...building, id }
  })
  const devices = payload.devices.map((device) => {
    const id = createId('dev')
    deviceMap.set(device.id, id)
    return { ...device, id, buildingId: buildingMap.get(device.buildingId) ?? device.buildingId }
  })
  const points = payload.points.map((point) => {
    const id = createId('pnt')
    pointMap.set(point.id, id)
    return { ...point, id, deviceId: deviceMap.get(point.deviceId) ?? point.deviceId }
  })
  const verdicts = payload.verdicts.map((verdict) => ({
    ...verdict,
    id: createId('vrd'),
    pointId: pointMap.get(verdict.pointId) ?? verdict.pointId
  }))
  const rectifies = payload.rectifies.map((rectify) => ({
    ...rectify,
    id: createId('rct'),
    buildingId: buildingMap.get(rectify.buildingId) ?? rectify.buildingId,
    pointId: rectify.pointId ? pointMap.get(rectify.pointId) ?? rectify.pointId : null
  }))
  return { ...payload, buildings, devices, points, verdicts, rectifies }
}

/** 检测结论行：按建筑物汇总测点数、不合格数与结论文字 */
export interface ConclusionLine {
  buildingId: string
  buildingName: string
  usage: string
  protectionClass: string
  deviceCount: number
  pointCount: number
  unqualifiedCount: number
  qualifyRatePct: number
  /** 最不利（实测/限值比最大）测点摘要 */
  worstPoint: string
  conclusion: string
  advice: string
}

/** 生成按建筑物的检测结论与整改建议汇总 */
export function buildConclusionLines(payload: BackupPayload): ConclusionLine[] {
  const deviceById = new Map(payload.devices.map((device) => [device.id, device]))
  const verdictByPoint = new Map(payload.verdicts.map((verdict) => [verdict.pointId, verdict]))

  return payload.buildings.map((building) => {
    const devices = payload.devices.filter((device) => device.buildingId === building.id)
    const deviceIds = new Set(devices.map((device) => device.id))
    const points = payload.points.filter((point) => deviceIds.has(point.deviceId))
    const verdicts = points
      .map((point) => verdictByPoint.get(point.id))
      .filter((verdict): verdict is NonNullable<typeof verdict> => Boolean(verdict))
    const unqualified = verdicts.filter((verdict) => verdict.result === '不合格')
    let worstRatio = 0
    let worstPoint = '无测点数据'
    points.forEach((point) => {
      const ratio = point.limitOhm > 0 ? point.measuredOhm / point.limitOhm : 0
      if (ratio > worstRatio) {
        worstRatio = ratio
        const device = deviceById.get(point.deviceId)
        worstPoint = `${point.code}（${device?.type ?? '装置'}）实测 ${point.measuredOhm} Ω / 限值 ${point.limitOhm} Ω`
      }
    })
    const qualifyRatePct =
      verdicts.length === 0
        ? 0
        : Number((((verdicts.length - unqualified.length) / verdicts.length) * 100).toFixed(1))
    const rectifies = payload.rectifies.filter((rectify) => rectify.buildingId === building.id)
    const pending = rectifies.filter((rectify) => rectify.state !== '已复检').length
    const conclusion =
      points.length === 0
        ? '未录入测点，无法出具结论'
        : unqualified.length === 0
          ? `所检 ${points.length} 个测点接地电阻均不大于限值，判定合格`
          : `所检 ${points.length} 个测点中 ${unqualified.length} 个不合格，判定不合格`
    const advice =
      rectifies.length === 0
        ? '无需整改，建议按周期复测'
        : `已生成 ${rectifies.length} 条整改建议，其中 ${pending} 条未完成复检闭环`
    return {
      buildingId: building.id,
      buildingName: building.name,
      usage: building.usage,
      protectionClass: building.protectionClass,
      deviceCount: devices.length,
      pointCount: points.length,
      unqualifiedCount: unqualified.length,
      qualifyRatePct,
      worstPoint,
      conclusion,
      advice
    }
  })
}
