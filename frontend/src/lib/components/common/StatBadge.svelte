<script lang="ts">
  /**
   * <StatBadge> 测点计数与合格率徽标。
   * 被建筑物台账（/buildings）与合格判定页（/verdicts）消费。
   */
  import type { Snippet } from 'svelte'

  let {
    label = '计数',
    value = 0,
    /** 单位或补充说明 */
    suffix = '',
    /** 占比（0-100），传入后渲染进度条 */
    percent = null,
    /** default / primary / success / warning / danger / info */
    tone = 'primary',
    size = 'default',
    children
  }: {
    label?: string
    value?: number | string
    suffix?: string
    percent?: number | null
    tone?: string
    size?: 'default' | 'small'
    children?: Snippet
  } = $props()

  const TONE_COLOR: Record<string, string> = {
    default: '#5b6b78',
    primary: '#1d3557',
    success: '#1e8449',
    warning: '#d68910',
    danger: '#c0392b',
    info: '#457b9d'
  }

  const color = $derived(TONE_COLOR[tone] ?? TONE_COLOR.primary)
  const shown = $derived(percent !== null ? `${percent}%` : value)
</script>

<div class="stat-badge is-{size}" style="--badge-color:{color}">
  <div class="stat-badge__head">
    <span class="stat-badge__dot"></span>
    <span class="stat-badge__label">{label}</span>
  </div>
  <div class="stat-badge__body">
    <strong class="stat-badge__value">{shown}</strong>
    {#if suffix}
      <span class="stat-badge__suffix">{suffix}</span>
    {/if}
  </div>
  {#if percent !== null}
    <div class="stat-badge__bar">
      <span style="width:{Math.min(100, Math.max(0, percent))}%;background:{color}"></span>
    </div>
  {/if}
  {@render children?.()}
</div>

<style>
  .stat-badge {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 132px;
    padding: 12px 14px;
    background: #ffffff;
    border: 1px solid #dfe4ea;
    border-left: 4px solid var(--badge-color);
    border-radius: 10px;
  }

  .stat-badge.is-small {
    min-width: 104px;
    padding: 8px 10px;
  }

  .stat-badge__head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: #5b6b78;
  }

  .stat-badge__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--badge-color);
  }

  .stat-badge__body {
    display: flex;
    align-items: baseline;
    gap: 4px;
  }

  .stat-badge__value {
    font-size: 22px;
    color: #16232e;
    font-variant-numeric: tabular-nums;
  }

  .stat-badge.is-small .stat-badge__value {
    font-size: 18px;
  }

  .stat-badge__suffix {
    font-size: 12px;
    color: #8194a2;
  }

  .stat-badge__bar {
    height: 6px;
    border-radius: 999px;
    background: #eef2f6;
    overflow: hidden;
  }

  .stat-badge__bar span {
    display: block;
    height: 100%;
  }
</style>
