/**
 * 建筑物 store：维护建筑物与防雷装置列表、当前选中建筑物与筛选条件。
 * 数据经 utils/db.ts 的 Dexie liveQuery 订阅，页面用 $store 只读订阅。
 *
 * 依赖方向（单向，禁止反向 import 上层）：
 *   buildingStore → utils/db、types/*、utils/resistance
 * 本模块**不得** import pointStore：那会与 pointStore → buildingStore 形成 ES 模块循环依赖，
 * 浏览器运行时抛 `Cannot access 'X' before initialization`，导致整站白屏。
 * 同时依赖两个 store 的派生值统一放在 stores/pointStats.ts。
 */
import { derived, get, writable } from 'svelte/store'
import { db, readLastBuildingId, watchTable, writeLastBuildingId } from '$lib/utils/db'
import type { Building, BuildingFilterState } from '$lib/types/building'
import { createEmptyBuildingFilter } from '$lib/types/building'
import type { Device, DeviceFilterState } from '$lib/types/device'
import { createEmptyDeviceFilter } from '$lib/types/device'

/** 响应式列表 */
export const buildingList = writable<Building[]>([])
export const deviceList = writable<Device[]>([])
export const buildingReady = writable(false)
export const currentBuildingId = writable<string | null>(readLastBuildingId())
export const buildingFilter = writable<BuildingFilterState>(createEmptyBuildingFilter())
export const deviceFilter = writable<DeviceFilterState>(createEmptyDeviceFilter())

// 模块加载即建立 IndexedDB 实时订阅，数据变化自动推送到页面
watchTable<Building>(() => db.buildings).subscribe((rows) => {
  buildingList.set(rows)
  buildingReady.set(true)
  if (get(currentBuildingId) === null && rows.length > 0) {
    selectBuilding(rows[0].id)
  }
})
watchTable<Device>(() => db.devices).subscribe((rows) => {
  deviceList.set(rows)
})

/** 当前选中建筑物 */
export const currentBuilding = derived([buildingList, currentBuildingId], ([$buildings, $id]) =>
  $id === null ? null : $buildings.find((building) => building.id === $id) ?? null
)

/** 全部可用用途（表单联想与筛选下拉共用） */
export const usageOptions = derived(buildingList, ($buildings) =>
  Array.from(new Set($buildings.map((building) => building.usage))).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
)

/** 按建筑物 id 取装置 */
export function devicesOfBuilding(buildingId: string | null | undefined): Device[] {
  if (!buildingId) return []
  return get(deviceList)
    .filter((device) => device.buildingId === buildingId)
    .sort((a, b) => a.type.localeCompare(b.type, 'zh-Hans-CN'))
}

/** 按筛选条件过滤后的建筑物 */
export const filteredBuildings = derived([buildingList, buildingFilter], ([$buildings, $filter]) =>
  $buildings.filter((building) => {
    const keyword = $filter.keyword.trim()
    if (keyword.length > 0) {
      const haystack = `${building.name}${building.usage}${building.address}${building.protectionClass}`
      if (!haystack.includes(keyword)) return false
    }
    if ($filter.usages.length > 0 && !$filter.usages.includes(building.usage)) return false
    if ($filter.protectionClasses.length > 0 && !$filter.protectionClasses.includes(building.protectionClass)) return false
    if ($filter.minFloors !== null && building.floors < $filter.minFloors) return false
    return true
  })
)

/** 按筛选条件过滤后的装置 */
export const filteredDevices = derived([deviceList, deviceFilter], ([$devices, $filter]) =>
  $devices.filter((device) => {
    const keyword = $filter.keyword.trim()
    if (keyword.length > 0) {
      const haystack = `${device.type}${device.material}${device.spec}`
      if (!haystack.includes(keyword)) return false
    }
    if ($filter.buildingIds.length > 0 && !$filter.buildingIds.includes(device.buildingId)) return false
    if ($filter.types.length > 0 && !$filter.types.includes(device.type)) return false
    return true
  })
)

export function patchBuildingFilter(patch: Partial<BuildingFilterState>): void {
  buildingFilter.update((current) => ({ ...current, ...patch }))
}

export function resetBuildingFilter(): void {
  buildingFilter.set(createEmptyBuildingFilter())
}

export function patchDeviceFilter(patch: Partial<DeviceFilterState>): void {
  deviceFilter.update((current) => ({ ...current, ...patch }))
}

export function resetDeviceFilter(): void {
  deviceFilter.set(createEmptyDeviceFilter())
}

export function selectBuilding(id: string | null): void {
  currentBuildingId.set(id)
  writeLastBuildingId(id)
}

export function buildingById(id: string | null | undefined): Building | null {
  if (!id) return null
  return get(buildingList).find((building) => building.id === id) ?? null
}

export function deviceById(id: string | null | undefined): Device | null {
  if (!id) return null
  return get(deviceList).find((device) => device.id === id) ?? null
}

/* ------------------------------ 建筑物 ------------------------------ */

export async function createBuilding(payload: Omit<Building, 'id' | 'createdAt' | 'updatedAt'>): Promise<Building> {
  const now = Date.now()
  const row: Building = {
    ...payload,
    id: `bld_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now
  }
  await db.buildings.put(row)
  return row
}

export async function updateBuilding(id: string, patch: Partial<Building>): Promise<void> {
  await db.buildings.update(id, { ...patch, updatedAt: Date.now() } as never)
}

/** 删除建筑物：级联删除其装置、测点、判定与整改建议 */
export async function removeBuilding(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.buildings, db.devices, db.points, db.verdicts, db.rectifies],
    async () => {
      const deviceIds = (await db.devices.where('buildingId').equals(id).toArray()).map((row) => row.id)
      if (deviceIds.length > 0) {
        const pointIds = (await db.points.where('deviceId').anyOf(deviceIds).toArray()).map((row) => row.id)
        if (pointIds.length > 0) {
          await db.verdicts.where('pointId').anyOf(pointIds).delete()
          await db.points.bulkDelete(pointIds)
        }
        await db.devices.bulkDelete(deviceIds)
      }
      await db.rectifies.where('buildingId').equals(id).delete()
      await db.buildings.delete(id)
    }
  )
  if (get(currentBuildingId) === id) selectBuilding(null)
}

/* ------------------------------ 防雷装置 ------------------------------ */

export async function createDevice(payload: Omit<Device, 'id' | 'createdAt' | 'updatedAt'>): Promise<Device> {
  const now = Date.now()
  const row: Device = {
    ...payload,
    id: `dev_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now
  }
  await db.devices.put(row)
  return row
}

export async function updateDevice(id: string, patch: Partial<Device>): Promise<void> {
  await db.devices.update(id, { ...patch, updatedAt: Date.now() } as never)
}

/** 删除装置：级联删除其测点与判定 */
export async function removeDevice(id: string): Promise<void> {
  await db.transaction('rw', [db.devices, db.points, db.verdicts], async () => {
    const pointIds = (await db.points.where('deviceId').equals(id).toArray()).map((row) => row.id)
    if (pointIds.length > 0) {
      await db.verdicts.where('pointId').anyOf(pointIds).delete()
      await db.points.bulkDelete(pointIds)
    }
    await db.devices.delete(id)
  })
}
