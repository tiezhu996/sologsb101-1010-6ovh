/** 防雷类别：按 GB 50057 划分，决定接地电阻限值初始建议 */
export type ProtectionClass = '一类' | '二类' | '三类'

export const PROTECTION_CLASSES: ProtectionClass[] = ['一类', '二类', '三类']

/** 建筑物：防雷检测的基本对象 */
export interface Building {
  id: string
  /** 建筑物名称 */
  name: string
  /** 用途，如 住宅 / 办公 / 油库 / 机房 */
  usage: string
  /** 防雷类别 */
  protectionClass: ProtectionClass
  /** 层数 */
  floors: number
  /** 建筑高度（m） */
  heightM: number
  /** 地址 */
  address: string
  createdAt: number
  updatedAt: number
}

/** 建筑物台账筛选条件（存于 buildingStore，并同步 URL query） */
export interface BuildingFilterState {
  keyword: string
  /** 用途多选 */
  usages: string[]
  /** 防雷类别多选 */
  protectionClasses: ProtectionClass[]
  /** 层数下限 */
  minFloors: number | null
  /** 是否只看存在不合格测点的建筑物 */
  onlyUnqualified: boolean
}

export function createEmptyBuildingFilter(): BuildingFilterState {
  return {
    keyword: '',
    usages: [],
    protectionClasses: [],
    minFloors: null,
    onlyUnqualified: false
  }
}

/** 用途常用取值（表单联想与筛选下拉共用） */
export const COMMON_USAGES: string[] = [
  '住宅',
  '办公楼',
  '商业综合体',
  '学校',
  '医院',
  '油库',
  '化工厂',
  '通信机房',
  '变电站',
  '文物建筑'
]
