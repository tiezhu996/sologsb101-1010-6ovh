/**
 * 路由表（history 模式）。
 *
 * 路径为真实地址：/buildings、/devices、/points、/verdicts、/backup，
 * location.hash 恒为空；深层链接刷新由 nginx `try_files $uri $uri/ /index.html` 兜底，
 * `vite preview` 同样内置 SPA fallback。
 *
 * 匹配规则（见 resolveRoute）：归一化末尾斜杠后做精确匹配，
 * 未命中任何模块时返回 NotFound（`*` 兜底），不再静默落到建筑物列表。
 *
 * 依赖方向：routes/index.ts → routes/*.svelte（页面）与 utils/location（叶子常量），
 * 不 import store 与 utils/db，避免与页面形成循环依赖。
 */
import type { Component } from 'svelte'
import BuildingList from './BuildingList.svelte'
import DeviceList from './DeviceList.svelte'
import PointEntry from './PointEntry.svelte'
import VerdictBoard from './VerdictBoard.svelte'
import BackupView from './BackupView.svelte'
import HomeRedirect from './HomeRedirect.svelte'
import NotFound from './NotFound.svelte'
import { HOME_PATH, NOT_FOUND_PATH, stripTrailingSlash } from '$lib/utils/location'

/** 页面组件统一收窄为「无 props」的 Svelte 5 组件签名 */
export type PageComponent = Component<Record<string, never>>

/** 单个路由项：真实路径 → 页面组件 */
export interface AppRoute {
  path: string
  component: PageComponent
}

/**
 * 路由表。`/` 为重定向页，`*` 为兜底页（不使用 hash 路由）。
 * 组件本身没有 props（数据一律来自 store），因此直接实例化即可。
 */
export const routes: AppRoute[] = [
  { path: '/', component: HomeRedirect as unknown as PageComponent },
  { path: HOME_PATH, component: BuildingList as unknown as PageComponent },
  { path: '/devices', component: DeviceList as unknown as PageComponent },
  { path: '/points', component: PointEntry as unknown as PageComponent },
  { path: '/verdicts', component: VerdictBoard as unknown as PageComponent },
  { path: '/backup', component: BackupView as unknown as PageComponent },
  { path: NOT_FOUND_PATH, component: NotFound as unknown as PageComponent }
]

/** 精确匹配用的路由映射（"*" 只作为兜底，不参与精确匹配） */
const exactRoutes = new Map<string, PageComponent>(
  routes.filter((route) => route.path !== NOT_FOUND_PATH).map((route) => [route.path, route.component])
)

/** 兜底页面组件 */
export const notFoundComponent: PageComponent = NotFound as unknown as PageComponent

/** 当前路径命中的路由项（未命中返回 `*` 兜底） */
export function resolveRoute(pathname: string): AppRoute {
  const normalized = stripTrailingSlash(pathname)
  const component = exactRoutes.get(normalized)
  if (component) return { path: normalized, component }
  return { path: NOT_FOUND_PATH, component: notFoundComponent }
}

export default routes
