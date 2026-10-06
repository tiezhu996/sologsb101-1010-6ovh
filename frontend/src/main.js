/**
 * 入口文件：挂载 Svelte 5 应用并打开 IndexedDB（首次自动播种演示数据）。
 * 数据全部保存在浏览器本地，不依赖任何后端服务。
 */
import { mount } from 'svelte'
import App from './App.svelte'
import { initDatabase } from '$lib/utils/db.ts'
import './app.css'

const target = document.getElementById('app')
if (!target) {
  throw new Error('未找到 #app 挂载节点')
}

const app = mount(App, { target })

// 首屏打开数据库并幂等播种演示数据（建筑物 → 装置 → 测点 → 判定 → 整改建议），
// 播种完成后 store 的 liveQuery 订阅会自动把数据推到页面。
void initDatabase()

export default app
