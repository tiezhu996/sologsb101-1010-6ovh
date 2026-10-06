<script lang="ts">
  /**
   * 应用外壳：顶部导航（真实路径 + history 跳转）、主内容区与页脚。
   *
   * 路由为自建 history 路由（utils/location.ts 提供内核，routes/index.ts 提供路由表），
   * 不使用 hash 路由：地址形如 http://host/devices，location.hash 恒为空。
   *
   * 依赖方向：App.svelte → routes/index.ts、routes/nav.ts、utils/router、stores；
   * 本身不被任何模块 import，因此不会出现在循环依赖链中。
   */
  import { resolveRoute } from './routes/index.ts'
  import { NAV_ITEMS } from './routes/nav.ts'
  import { currentPath } from '$lib/utils/query.ts'
  import { useRouter } from '$lib/utils/router.ts'
  import { buildingList, buildingReady, deviceList } from '$lib/stores/buildingStore.ts'
  import { pointList } from '$lib/stores/pointStore.ts'
  import { rectifyList } from '$lib/stores/rectifyStore.ts'
  import { DB_NAME, DB_VERSION } from '$lib/utils/db.ts'
  import { qualifyRate, isQualified } from '$lib/utils/resistance.ts'

  const { push } = useRouter()

  const current = $derived($currentPath)
  /** 当前命中的路由项（未命中即 `*` 兜底页） */
  const activeRoute = $derived(resolveRoute(current))

  const pointCount = $derived($pointList.length)
  const unqualifiedCount = $derived($pointList.filter((point) => !isQualified(point.measuredOhm, point.limitOhm)).length)
  const rate = $derived(qualifyRate($pointList.map((point) => isQualified(point.measuredOhm, point.limitOhm))))
  const pendingRectify = $derived($rectifyList.filter((rectify) => rectify.state !== '已复检').length)

  /** 导航高亮：根路径也算建筑物台账 */
  function isActive(path: string): boolean {
    if (path === '/buildings') return current === '/' || current === '/buildings'
    return current === path
  }
</script>

<div class="app-shell">
  <header class="app-header">
    <div class="app-header__brand">
      <span class="app-header__mark">雷</span>
      <div>
        <h1 class="app-header__title">防雷装置检测与接地电阻台账</h1>
        <p class="app-header__sub">建筑物 · 接闪器/引下线/接地装置 · 接地电阻测点 · 合格判定 · 整改闭环</p>
      </div>
    </div>
    <nav class="app-nav" aria-label="主导航">
      {#each NAV_ITEMS as item (item.path)}
        <a
          class="app-nav__item"
          class:is-active={isActive(item.path)}
          href={item.path}
          aria-current={isActive(item.path) ? 'page' : undefined}
          onclick={(event: MouseEvent) => {
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
            event.preventDefault()
            push(item.path)
          }}
        >
          {item.label}
          {#if item.path === '/buildings'}
            <em class="app-nav__badge">{$buildingList.length}</em>
          {:else if item.path === '/devices'}
            <em class="app-nav__badge">{$deviceList.length}</em>
          {:else if item.path === '/points'}
            <em class="app-nav__badge">{pointCount}</em>
          {:else if item.path === '/verdicts'}
            <em class="app-nav__badge">{unqualifiedCount}</em>
          {/if}
        </a>
      {/each}
    </nav>
  </header>

  <main class="app-main">
    {#if !$buildingReady}
      <div class="gb-panel gb-hint">正在打开本地数据库（IndexedDB）并载入数据…</div>
    {/if}
    {#key activeRoute.path}
      {@const Page = activeRoute.component}
      <Page />
    {/key}
  </main>

  <footer class="app-footer">
    <span>
      本地库 {DB_NAME} · 结构版本 v{DB_VERSION} · 数据仅存于本浏览器 IndexedDB，不上传任何服务器。
    </span>
    <span>
      建筑物 {$buildingList.length} · 装置 {$deviceList.length} · 测点 {pointCount} · 不合格 {unqualifiedCount} · 合格率 {rate}% · 未闭环整改 {pendingRectify}
    </span>
  </footer>
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  .app-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 24px;
    background: linear-gradient(120deg, #16304f 0%, #1d3557 55%, #2a5478 100%);
    color: #eaf2f8;
  }

  .app-header__brand {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .app-header__mark {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.14);
    border: 1px solid rgba(255, 255, 255, 0.3);
    font-size: 20px;
    font-weight: 700;
  }

  .app-header__title {
    margin: 0;
    font-size: 18px;
    letter-spacing: 1px;
  }

  .app-header__sub {
    margin: 2px 0 0;
    font-size: 12px;
    letter-spacing: 1px;
    color: rgba(234, 242, 248, 0.75);
  }

  .app-nav {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .app-nav__item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    color: #eaf2f8;
    font-size: 13px;
    text-decoration: none;
    transition: all 0.18s ease;
  }

  .app-nav__item:hover {
    background: rgba(255, 255, 255, 0.16);
  }

  .app-nav__item.is-active {
    background: #eaf2f8;
    color: #1d3557;
    font-weight: 600;
  }

  .app-nav__badge {
    font-style: normal;
    font-size: 11px;
    padding: 0 6px;
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.18);
  }

  .app-main {
    flex: 1;
    width: 100%;
    max-width: 1360px;
    margin: 0 auto;
    padding: 16px 24px 32px;
  }

  .app-footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 24px 20px;
    font-size: 12px;
    color: #6b7d8b;
  }
</style>
