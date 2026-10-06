/** 防雷装置类型 */
export type DeviceType = '接闪带' | '接闪杆' | '引下线' | '接地体'

export const DEVICE_TYPES: DeviceType[] = ['接闪带', '接闪杆', '引下线', '接地体']

/** 常用材质 */
export const DEVICE_MATERIALS: string[] = [
  '热镀锌圆钢',
  '热镀锌扁钢',
  '铜包钢',
  '紫铜排',
  '不锈钢',
  '镀锌钢管',
  '石墨接地模块'
]

/** 防雷装置：建筑物上的接闪器 / 引下线 / 接地装置 */
export interface Device {
  id: string
  /** 所属建筑物 */
  buildingId: string
  /** 装置类型 */
  type: DeviceType
  /** 材质 */
  material: string
  /** 规格，如 Φ12 / -40×4 */
  spec: string
  /** 数量（根 / 处 / 米） */
  quantity: number
  /** 安装日期 */
  installDate: string
  createdAt: number
  updatedAt: number
}

/** 装置登记页筛选条件（存于 buildingStore） */
export interface DeviceFilterState {
  keyword: string
  /** 所属建筑物 */
  buildingIds: string[]
  /** 装置类型多选 */
  types: DeviceType[]
  /** 是否只看未录入测点的装置 */
  onlyWithoutPoint: boolean
}

export function createEmptyDeviceFilter(): DeviceFilterState {
  return {
    keyword: '',
    buildingIds: [],
    types: [],
    onlyWithoutPoint: false
  }
}
