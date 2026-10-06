/**
 * 路由状态与 URL query 工具（history 模式）。
 *
 * 深链形态为真实路径：`/devices?bld=bld_oil01&type=接闪带`（location.hash 恒为空）。
 * 地址读写全部委托给叶子模块 utils/location.ts，本模块只做 store 侧的响应式封装，
 * 页面通过 currentPath / readQuery / writeQuery 消费，不直接触碰 history API。
 */
import { readable, type Readable } from 'svelte/store'
import {
  LOCATION_CHANGE_EVENT,
  listenPopState,
  parseSearch,
  readPathname,
  readSearch,
  replaceLocation
} from '$lib/utils/location'

/** 读取当前 URL query 参数（页面首次渲染时应用筛选条件） */
export function readQuery(): Record<string, string> {
  return parseSearch(readSearch())
}

/** 把筛选条件写回真实路径的 query（空值不写入；replaceState 不新增历史记录） */
export function writeQuery(path: string, entries: Record<string, string | null | undefined>): void {
  replaceLocation(path, entries)
}

/**
 * 当前真实路径（不含 query）：用于导航高亮、路由匹配与页面间跳转判断。
 * 同时监听 popstate（浏览器前进/后退）与 pushState/replaceState 后的自定义事件。
 */
export const currentPath: Readable<string> = readable<string>(readPathname(), (set) => {
  const sync = (): void => set(readPathname())
  window.addEventListener(LOCATION_CHANGE_EVENT, sync)
  const stopPopState = listenPopState()
  return () => {
    window.removeEventListener(LOCATION_CHANGE_EVENT, sync)
    stopPopState()
  }
})
