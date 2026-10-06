<script lang="ts">
  /**
   * <FilterBar> 建筑物、装置类型、判定结果多条件过滤组件。
   * 条件变化通过 onChange 回调抛给页面，由页面统一同步 URL query（Svelte 5 回调 props）。
   * 被装置登记页（/devices）、测点录入页（/points）、判定页（/verdicts）消费。
   */
  import type { Snippet } from 'svelte'

  export interface FilterSelectOption {
    label: string
    value: string
  }

  export interface FilterSelectConfig {
    key: string
    label: string
    options: FilterSelectOption[]
    multiple?: boolean
  }

  export interface FilterChange {
    keyword: string
    values: Record<string, string | string[]>
    switchValue: boolean
  }

  let {
    /** 关键字 */
    keyword = '',
    /** 下拉筛选配置：{ key, label, options: [{ label, value }], multiple } */
    selects = [],
    /** 当前筛选值：{ key: value } */
    values = {},
    /** 附加开关 */
    switchLabel = '',
    switchValue = false,
    hasSwitch = false,
    keywordPlaceholder = '搜索关键字…',
    /** 筛选变化回调 */
    onChange = (_next: FilterChange) => {},
    /** 重置回调 */
    onReset = () => {},
    disabled = false,
    extra,
    actions
  }: {
    keyword?: string
    selects?: FilterSelectConfig[]
    values?: Record<string, string | string[]>
    switchLabel?: string
    switchValue?: boolean
    hasSwitch?: boolean
    keywordPlaceholder?: string
    onChange?: (next: FilterChange) => void
    onReset?: () => void
    disabled?: boolean
    extra?: Snippet
    actions?: Snippet
  } = $props()

  /** 关键字本地输入态：props 变化时由 $derived 自动跟随，避免只捕获初始值 */
  const draft = $derived(keyword)

  const activeCount = $derived(
    selects.reduce((sum, select) => {
      const value = values[select.key]
      if (Array.isArray(value)) return sum + value.length
      if (typeof value === 'string' && value.length > 0) return sum + 1
      if (typeof value === 'number') return sum + 1
      return sum
    }, 0) + (hasSwitch && switchValue ? 1 : 0)
  )

  function emitChange(patch: { keyword?: string; values?: Record<string, string | string[]>; switchValue?: boolean } = {}) {
    onChange({
      keyword: patch.keyword ?? draft,
      values: { ...values, ...(patch.values ?? {}) },
      switchValue: patch.switchValue ?? switchValue
    })
  }

  function handleKeyword(value: string) {
    emitChange({ keyword: value })
  }

  function handleSelect(key: string, value: string[]) {
    emitChange({ values: { [key]: value } })
  }

  function handleSwitch(value: boolean) {
    emitChange({ switchValue: value })
  }

  function selectedValues(key: string): string[] {
    const value = values[key]
    if (Array.isArray(value)) return value
    return typeof value === 'string' && value.length > 0 ? [value] : []
  }
</script>

<div class="filter-bar">
  <div class="filter-bar__main">
    <label class="filter-bar__field">
      <span class="sr-only">关键字</span>
      <input
        class="filter-bar__input"
        type="search"
        placeholder={keywordPlaceholder}
        value={draft}
        {disabled}
        oninput={(event: Event) => handleKeyword((event.currentTarget as HTMLInputElement).value)}
      />
    </label>

    {#each selects as select (select.key)}
      <label class="filter-bar__field">
        <span class="filter-bar__label">{select.label}</span>
        <select
          class="filter-bar__select"
          multiple={select.multiple ?? true}
          size={1}
          {disabled}
          onchange={(event: Event) =>
            handleSelect(
              select.key,
              Array.from((event.currentTarget as HTMLSelectElement).selectedOptions).map((option) => option.value)
            )}
        >
          {#each select.options as option (option.value)}
            <option value={option.value} selected={selectedValues(select.key).includes(option.value)}>
              {option.label}
            </option>
          {/each}
        </select>
      </label>
    {/each}

    {#if hasSwitch}
      <label class="filter-bar__switch">
        <input
          type="checkbox"
          checked={switchValue}
          {disabled}
          onchange={(event: Event) => handleSwitch((event.currentTarget as HTMLInputElement).checked)}
        />
        <span>{switchLabel}</span>
      </label>
    {/if}

    {@render extra?.()}
  </div>

  <div class="filter-bar__side">
    {@render actions?.()}
    {#if activeCount > 0}
      <span class="filter-bar__count">{activeCount} 项条件</span>
    {/if}
    <button class="filter-bar__reset" type="button" {disabled} onclick={() => onReset()}>重置</button>
  </div>
</div>

<style>
  .filter-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    background: #ffffff;
    border: 1px solid #dfe4ea;
    border-radius: 10px;
  }

  .filter-bar__main {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 12px;
    flex: 1 1 520px;
  }

  .filter-bar__side {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .filter-bar__field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .filter-bar__label {
    font-size: 12px;
    color: #5b6b78;
  }

  .filter-bar__input {
    width: 220px;
    padding: 6px 10px;
    border: 1px solid #cfd8e3;
    border-radius: 6px;
    font-size: 13px;
  }

  .filter-bar__select {
    min-width: 170px;
    max-width: 240px;
    height: 34px;
    padding: 2px 6px;
    border: 1px solid #cfd8e3;
    border-radius: 6px;
    font-size: 13px;
  }

  .filter-bar__switch {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: #445566;
  }

  .filter-bar__count {
    padding: 2px 10px;
    border-radius: 999px;
    background: #fff4e0;
    color: #a86a12;
    font-size: 12px;
  }

  .filter-bar__reset {
    padding: 6px 12px;
    border: 1px solid #cfd8e3;
    border-radius: 6px;
    background: #fff;
    color: #1d3557;
    font-size: 13px;
    cursor: pointer;
  }

  .filter-bar__reset:hover {
    background: #f2f6fa;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
