<script lang="ts">
  /**
   * <EmptyPanel> 空数据引导与新建入口。
   * 被全部列表页消费；列表为空、筛选无结果、深层 id 不存在时统一使用。
   */
  import type { Snippet } from 'svelte'

  let {
    title = '暂无数据',
    description = '当前筛选条件下没有记录，可调整条件或新建一条。',
    /** 主按钮文案，为空则不渲染 */
    actionText = '',
    /** 次要按钮文案 */
    secondaryText = '',
    /** 是否展示样例数据按钮 */
    showSeed = false,
    compact = false,
    onAction = () => {},
    onSecondary = () => {},
    onSeed = () => {},
    children,
    actions
  }: {
    title?: string
    description?: string
    actionText?: string
    secondaryText?: string
    showSeed?: boolean
    compact?: boolean
    onAction?: () => void
    onSecondary?: () => void
    onSeed?: () => void
    children?: Snippet
    actions?: Snippet
  } = $props()
</script>

<div class="empty-panel" class:is-compact={compact}>
  <span class="empty-panel__icon" aria-hidden="true">{showSeed ? '✳' : actionText ? '＋' : '▤'}</span>
  <h3 class="empty-panel__title">{title}</h3>
  <p class="empty-panel__desc">{description}</p>
  <div class="empty-panel__actions">
    {#if actionText}
      <button class="btn btn--primary" type="button" onclick={() => onAction()}>{actionText}</button>
    {/if}
    {#if secondaryText}
      <button class="btn" type="button" onclick={() => onSecondary()}>{secondaryText}</button>
    {/if}
    {#if showSeed}
      <button class="btn btn--success" type="button" onclick={() => onSeed()}>生成样例数据</button>
    {/if}
    {@render actions?.()}
  </div>
  {@render children?.()}
</div>

<style>
  .empty-panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 44px 24px;
    background: #f7fafc;
    border: 1px dashed #b9c6d4;
    border-radius: 12px;
    text-align: center;
  }

  .empty-panel.is-compact {
    padding: 24px 16px;
  }

  .empty-panel__icon {
    font-size: 30px;
    color: #7f97ad;
  }

  .empty-panel__title {
    margin: 4px 0 0;
    font-size: 16px;
    color: #16232e;
  }

  .empty-panel__desc {
    margin: 0;
    max-width: 560px;
    font-size: 13px;
    line-height: 1.75;
    color: #5b6b78;
  }

  .empty-panel__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
</style>
