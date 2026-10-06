/**
 * 浏览器地址读写（history 模式）的**叶子模块**，同时承担最小可用的 history 路由内核。
 *
 * 设计约束（刻意为之）：
 * 1. 只依赖 window / history / URL API，不 import 任何 store、页面或组件，
 *    因此不会参与 ES 模块循环依赖（TDZ 白屏）链。
 * 2. 不引入任何第三方路由库：应用只需要「真实路径 + pushState + popstate」，
 *    自建内核可以保证 Svelte 5 运行时行为可控、无 legacy 编译产物。
 *
 * 核心动作：
 *   - pushLocation(path)    → history.pushState + 广播
 *   - replaceLocation(...)  → history.replaceState + 广播（筛选条件回写，不新增历史记录）
 *   - popstate             → 浏览器前进/后退时广播
 */

/** 应用内的真实路径（history 模式），用于导航与高亮 */
export const ROUTE_PATHS = ['/buildings', '/devices', '/points', '/verdicts', '/backup'] as const
export type RoutePath = (typeof ROUTE_PATHS)[number]

/** 未知路径兜底（catch-all）路径 */
export const NOT_FOUND_PATH = '*'

/** 首页落点 */
export const HOME_PATH: RoutePath = '/buildings'

/** 地址变化后派发的自定义事件（replaceState / pushState 都不会触发 popstate） */
export const LOCATION_CHANGE_EVENT = 'gblightprot:locationchange'

/** 判断是否为应用内可直接 pushState 的路径 */
export function isInternalPath(href: string): boolean {
  if (!href || !href.startsWith('/') || href.startsWith('//')) return false
  const path = href.split(/[?#]/)[0]
  return ROUTE_PATHS.some((routePath) => path === routePath || path.startsWith(`${routePath}/`))
}

/** 规范化路径：去掉末尾多余的 "/"（保留根路径） */
export function stripTrailingSlash(pathname: string): string {
  const stripped = pathname.replace(/\/+$/, '')
  return stripped === '' ? '/' : stripped
}

/** 读取当前真实路径（不含 query），根路径归一为 "/" */
export function readPathname(): string {
  return stripTrailingSlash(window.location.pathname)
}

/** 当前 query 字符串（不含 "?"），history 模式下取自 location.search */
export function readSearch(): string {
  return window.location.search.replace(/^\?/, '')
}

/** 拼出 history 模式下的完整地址：/points?device=xxx */
export function buildUrl(path: string, search = ''): string {
  return `${stripTrailingSlash(path)}${search ? `?${search.replace(/^\?/, '')}` : ''}`
}

/** 解析 query 字符串为普通对象 */
export function parseSearch(search: string): Record<string, string> {
  const params = new URLSearchParams(search.replace(/^\?/, ''))
  const result: Record<string, string> = {}
  params.forEach((value, key) => {
    result[key] = value
  })
  return result
}

/** 由筛选条件拼出 query 字符串（空值不写入，保持 URL 干净） */
export function buildSearch(entries: Record<string, string | null | undefined>): string {
  const params = new URLSearchParams()
  Object.entries(entries).forEach(([key, value]) => {
    if (value === null || value === undefined) return
    if (String(value).trim().length === 0) return
    params.set(key, String(value))
  })
  return params.toString()
}

/** 广播地址变化（由 utils/query.ts 的 currentPath store 消费） */
function broadcast(): void {
  window.dispatchEvent(new CustomEvent(LOCATION_CHANGE_EVENT))
}

/** 当前 history.state 的浅拷贝（保留 history 库写入的 key，避免覆盖） */
function currentState(): Record<string, unknown> {
  const state = window.history.state
  return state && typeof state === 'object' ? { ...(state as Record<string, unknown>) } : {}
}

/**
 * history.pushState 跳转：真实路径导航的唯一入口，hash 恒为空。
 * @param to 站内地址，如 "/devices" 或 "/points?device=dev_x"
 */
export function pushLocation(to: string): void {
  const url = to.startsWith('/') ? to : `/${to}`
  window.history.pushState({ ...currentState(), key: `k${Date.now().toString(36)}` }, '', url)
  broadcast()
}

/** history.replaceState 跳转：不新增历史记录（根路径重定向、筛选回写） */
export function replaceLocation(path: string, entries: Record<string, string | null | undefined> = {}): string {
  const url = buildUrl(path, buildSearch(entries))
  const current = `${window.location.pathname}${window.location.search}`
  if (current !== url) window.history.replaceState(currentState(), '', url)
  broadcast()
  return url
}

/** 浏览器前进/后退：popstate 后广播，让 currentPath store 与页面同步 */
export function listenPopState(): () => void {
  const onPop = (): void => broadcast()
  window.addEventListener('popstate', onPop)
  return () => window.removeEventListener('popstate', onPop)
}
