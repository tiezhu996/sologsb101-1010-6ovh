<script lang="ts">
  /**
   * 深链兜底页：未知路径（如 /foo）给出友好提示与可用入口，不再静默落到建筑物列表。
   * 复用 <EmptyPanel>，与 5 个业务模块保持一致的视觉语言。
   */
  import EmptyPanel from '$lib/components/common/EmptyPanel.svelte'
  import { useRouter } from '$lib/utils/router'
  import { ROUTE_PATHS } from '$lib/utils/location'

  const { push } = useRouter()

  /** 当前真实路径：history 模式下直接展示 location.pathname */
  const pathname = $derived(window.location.pathname)
</script>

<section class="page">
  <div class="gb-brand-bar"></div>

  <div class="page__head">
    <div>
      <h2 class="page__title">页面不存在（404）</h2>
      <p class="gb-hint">
        没有匹配到路由 <code>{pathname}</code>，请从下面的模块入口重新进入。
      </p>
    </div>
  </div>

  <EmptyPanel
    title="该地址不在本应用的模块清单内"
    description="本应用只提供建筑物台账、防雷装置登记、接地电阻测点、合格判定与整改、结论与备份 5 个模块，可点击下方按钮回到建筑物台账。"
    actionText="返回建筑物台账"
    onAction={() => push(ROUTE_PATHS[0])}
  >
    <ul class="notfound-list">
      {#each ROUTE_PATHS as path (path)}
        <li>
          <button class="btn btn--small" type="button" onclick={() => push(path)}>{path}</button>
        </li>
      {/each}
    </ul>
  </EmptyPanel>
</section>

<style>
  .notfound-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
  }
</style>
