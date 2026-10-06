<script lang="ts">
  /**
   * 首页重定向：访问 "/" 时 replace 到 "/buildings"，
   * 保证根路径不会停在空路由上（history 模式下 address bar 同步变为 /buildings）。
   */
  import { onMount } from 'svelte'
  import { goHome } from '$lib/utils/router'

  onMount(() => {
    goHome()
  })
</script>

<section class="page">
  <div class="gb-brand-bar"></div>
  <div class="gb-panel gb-hint">正在进入建筑物与防雷类别台账（/buildings）…</div>
</section>
