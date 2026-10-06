/**
 * 导航封装（history 模式）：页面对外只依赖 useRouter().push / navigate，
 * 不直接触碰 history API，也不 import 任何路由库，避免形成循环依赖。
 */
import { currentPath } from '$lib/utils/query'
import { HOME_PATH, pushLocation, replaceLocation } from '$lib/utils/location'

/** 应用内真实路径跳转（新增一条历史记录） */
export function navigateTo(to: string): void {
  pushLocation(to)
}

/** 兼容旧调用点的 push：等价于 history.pushState 方式的站内跳转 */
export function push(to: string): void {
  pushLocation(to)
}

/** 替换当前历史记录跳转（根路径重定向等场景，避免后退又回到旧地址） */
export function replaceTo(to: string): void {
  replaceLocation(to)
}

/** 回到首页（/buildings），用于根路径重定向与兜底页 */
export function goHome(): void {
  replaceTo(HOME_PATH)
}

/** 页面统一的路由句柄：当前路径 + 跳转方法 */
export function useRouter(): {
  push: typeof push
  navigate: typeof navigateTo
  replace: typeof replaceTo
  currentPath: typeof currentPath
} {
  return { push, navigate: navigateTo, replace: replaceTo, currentPath }
}
