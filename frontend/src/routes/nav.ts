/**
 * 顶部导航配置（纯常量叶子模块，history 模式的真实路径）。
 * 仅依赖 utils/location 的路径常量，不 import store 与页面，避免形成循环依赖。
 */
import { ROUTE_PATHS } from '$lib/utils/location'

export interface NavItem {
  /** 真实路径（history 模式，非 hash） */
  path: (typeof ROUTE_PATHS)[number]
  label: string
  /** 徽标含义说明，供 aria-label 使用 */
  badgeHint: string
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/buildings', label: '建筑物台账', badgeHint: '建筑物数量' },
  { path: '/devices', label: '防雷装置登记', badgeHint: '防雷装置数量' },
  { path: '/points', label: '接地电阻测点', badgeHint: '测点数量' },
  { path: '/verdicts', label: '合格判定与整改', badgeHint: '不合格测点数量' },
  { path: '/backup', label: '结论与备份', badgeHint: '数据备份' }
]
