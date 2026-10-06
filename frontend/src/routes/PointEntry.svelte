<script lang="ts">
  /**
   * 模块 3：/points 接地电阻测点录入
   * 逐点录实测电阻与限值、支持批量粘贴；按装置筛选汇总，复用 <FilterBar>、<QualifyTag>。
   */
  import FilterBar from '$lib/components/common/FilterBar.svelte'
  import type { FilterChange } from '$lib/components/common/FilterBar.svelte'
  import QualifyTag from '$lib/components/common/QualifyTag.svelte'
  import StatBadge from '$lib/components/common/StatBadge.svelte'
  import EmptyPanel from '$lib/components/common/EmptyPanel.svelte'
  import {
    activeDeviceId,
    bulkSetMeasured,
    createPoint,
    importPointRows,
    pasteText,
    pointList,
    pointRows,
    pointsOfDevice,
    removePoint,
    setActiveDevice,
    updatePoint
  } from '$lib/stores/pointStore.ts'
  import { buildingById, deviceList, selectBuilding } from '$lib/stores/buildingStore.ts'
  import { parsePointPaste } from '$lib/types/point.ts'
  import type { Point, PointPasteRow } from '$lib/types/point.ts'
  import { DEVICE_TYPES } from '$lib/types/device.ts'
  import type { DeviceType } from '$lib/types/device.ts'
  import { isQualified, limitRatio, qualifyRate, suggestLimitOhm } from '$lib/utils/resistance.ts'
  import { readQuery, writeQuery } from '$lib/utils/query.ts'
  import { useRouter } from '$lib/utils/router.ts'

  const { push } = useRouter()

  interface PointForm {
    code: string
    location: string
    measuredOhm: number
    limitOhm: number
    meter: string
    measureDate: string
  }

  const query = readQuery()
  if (query.device) {
    setActiveDevice(query.device)
    const target = $deviceList.find((device) => device.id === query.device)
    if (target) selectBuilding(target.buildingId)
  }

  let keyword = $state('')
  let typeFilter = $state<DeviceType[]>([...DEVICE_TYPES])
  let showDialog = $state(false)
  let editingId = $state<string | null>(null)
  let formError = $state('')
  let showPaste = $state(false)
  let pasteErrors = $state<string[]>([])
  let pastePreview = $state<PointPasteRow[]>([])
  let bulkValue = $state<number | null>(null)

  let form = $state<PointForm>({
    code: '',
    location: '',
    measuredOhm: 0,
    limitOhm: 10,
    meter: '',
    measureDate: new Date().toISOString().slice(0, 10)
  })

  const deviceOptions = $derived(
    $deviceList.map((device) => {
      const building = buildingById(device.buildingId)
      return {
        label: `${building?.name ?? '未知建筑物'} · ${device.type}${device.spec ? ` ${device.spec}` : ''}`,
        value: device.id
      }
    })
  )

  const filterValues = $derived<Record<string, string | string[]>>({
    deviceIds: $activeDeviceId === null ? [] : [$activeDeviceId],
    types: typeFilter as string[]
  })

  /** 表格行：带装置与建筑物信息、合格标记 */
  const rows = $derived(
    $pointRows.filter((row) => {
      if (typeFilter.length > 0 && !typeFilter.includes(row.deviceType as DeviceType)) return false
      const device = row.device
      if (!device) return false
      const building = buildingById(device.buildingId)
      const text = `${row.point.code}${row.point.location}${row.point.meter}${building?.name ?? ''}${device.material}`
      return keyword.trim().length === 0 || text.includes(keyword.trim())
    })
  )

  const totals = $derived({
    points: rows.length,
    unqualified: rows.filter((row) => !row.qualified).length,
    rate: qualifyRate(rows.map((row) => row.qualified)),
    activeDevicePoints: $activeDeviceId ? pointsOfDevice($activeDeviceId).length : $pointList.length
  })

  const activeDevice = $derived(
    $activeDeviceId ? $deviceList.find((device) => device.id === $activeDeviceId) ?? null : null
  )
  const activeBuilding = $derived(activeDevice ? buildingById(activeDevice.buildingId) : null)
  const defaultLimit = $derived(
    activeDevice ? suggestLimitOhm(activeBuilding?.protectionClass ?? '三类', activeDevice.type) : 10
  )

  function openCreate(): void {
    if (!$activeDeviceId) {
      window.alert('请先在筛选栏选择一条防雷装置，再录入该装置的测点。')
      return
    }
    editingId = null
    formError = ''
    const existing = pointsOfDevice($activeDeviceId)
    const index = existing.length + 1
    form = {
      code: `JD-${String(index).padStart(2, '0')}`,
      location: '',
      measuredOhm: 0,
      limitOhm: defaultLimit,
      meter: existing[0]?.meter ?? '',
      measureDate: existing[0]?.measureDate ?? new Date().toISOString().slice(0, 10)
    }
    showDialog = true
  }

  function openEdit(point: Point): void {
    editingId = point.id
    formError = ''
    form = {
      code: point.code,
      location: point.location,
      measuredOhm: point.measuredOhm,
      limitOhm: point.limitOhm,
      meter: point.meter,
      measureDate: point.measureDate
    }
    showDialog = true
  }

  async function submitForm(): Promise<void> {
    if (!form.code.trim()) {
      formError = '请填写测点编号'
      return
    }
    if (!Number.isFinite(Number(form.measuredOhm)) || Number(form.measuredOhm) < 0) {
      formError = '实测电阻应为非负数字（Ω）'
      return
    }
    if (!Number.isFinite(Number(form.limitOhm)) || Number(form.limitOhm) <= 0) {
      formError = '限值应为大于 0 的数字（Ω）'
      return
    }
    const payload = {
      code: form.code.trim(),
      location: form.location.trim(),
      measuredOhm: Number(form.measuredOhm),
      limitOhm: Number(form.limitOhm),
      meter: form.meter.trim(),
      measureDate: form.measureDate
    }
    if (editingId) {
      await updatePoint(editingId, payload)
    } else if ($activeDeviceId) {
      await createPoint($activeDeviceId, payload)
    }
    showDialog = false
  }

  async function confirmRemove(point: Point): Promise<void> {
    const ok = window.confirm(`删除测点「${point.code}」（实测 ${point.measuredOhm} Ω）并同时删除其判定记录？`)
    if (!ok) return
    await removePoint(point.id)
  }

  async function applyBulkMeasured(): Promise<void> {
    if (!$activeDeviceId || bulkValue === null) return
    const ok = window.confirm(
      `将该装置全部 ${pointsOfDevice($activeDeviceId).length} 个测点的实测电阻统一改写为 ${bulkValue} Ω？`
    )
    if (!ok) return
    await bulkSetMeasured($activeDeviceId, Number(bulkValue))
    bulkValue = null
  }

  function openPaste(): void {
    pasteText.set('')
    pasteErrors = []
    pastePreview = []
    showPaste = true
  }

  function previewPaste(): void {
    const parsed = parsePointPaste($pasteText, defaultLimit)
    pasteErrors = parsed.errors
    pastePreview = parsed.rows
  }

  async function submitPaste(): Promise<void> {
    if (!$activeDeviceId) return
    const parsed = parsePointPaste($pasteText, defaultLimit)
    pasteErrors = parsed.errors
    pastePreview = parsed.rows
    if (parsed.rows.length === 0) return
    const ok = window.confirm(
      `将用 ${parsed.rows.length} 行数据替换该装置现有 ${pointsOfDevice($activeDeviceId).length} 个测点，确认导入？`
    )
    if (!ok) return
    await importPointRows($activeDeviceId, parsed.rows, {
      meter: pointsOfDevice($activeDeviceId)[0]?.meter ?? '未填写',
      measureDate: new Date().toISOString().slice(0, 10)
    })
    showPaste = false
  }

  function handleFilterChange(next: FilterChange): void {
    const deviceId = ((next.values.deviceIds as string[]) ?? [])[0] ?? null
    setActiveDevice(deviceId)
    typeFilter = ((next.values.types as string[]) ?? []) as DeviceType[]
    keyword = next.keyword
    writeQuery('/points', {
      device: deviceId,
      kw: next.keyword,
      type: ((next.values.types as string[]) ?? []).join(',')
    })
  }

  function handleReset(): void {
    setActiveDevice(null)
    typeFilter = [...DEVICE_TYPES]
    keyword = ''
    writeQuery('/points', {})
  }

  async function gotoVerdicts(): Promise<void> {
    push('/verdicts')
  }
</script>

<section class="page">
  <div class="gb-brand-bar"></div>

  <div class="page__head">
    <div>
      <h2 class="page__title">接地电阻测点录入</h2>
      <p class="gb-hint">
        按装置逐点录入实测电阻与限值，可批量粘贴整段手记数据；实测值 ≤ 限值判合格，超限会即时标红。
      </p>
      {#if activeDevice}
        <p class="gb-hint">
          当前装置：{activeBuilding?.name ?? '未知建筑物'} · {activeDevice.type}
          {activeDevice.spec ? `（${activeDevice.spec}）` : ''} · 建议限值 {defaultLimit} Ω
        </p>
      {/if}
    </div>
    <div class="page__actions">
      <button class="btn" type="button" onclick={openPaste}>批量粘贴</button>
      <button class="btn btn--primary" type="button" onclick={openCreate}>＋ 新增测点</button>
    </div>
  </div>

  <FilterBar
    keyword={keyword}
    selects={[
      { key: 'deviceIds', label: '防雷装置', options: deviceOptions, multiple: false },
      { key: 'types', label: '装置类型', options: DEVICE_TYPES.map((type) => ({ label: type, value: type })) }
    ]}
    values={filterValues}
    keywordPlaceholder="搜索测点编号 / 位置 / 仪器"
    onChange={handleFilterChange}
    onReset={handleReset}
  />

  <div class="gb-stats-row">
    <StatBadge label="当前测点" value={totals.points} suffix="点" tone="primary" />
    <StatBadge
      label="不合格"
      value={totals.unqualified}
      suffix="点"
      tone={totals.unqualified > 0 ? 'danger' : 'success'}
    />
    <StatBadge label="合格率" value={totals.rate} percent={totals.rate} tone="success" />
    <StatBadge label="选中装置测点" value={totals.activeDevicePoints} suffix="点" tone="info" />
  </div>

  {#if $activeDeviceId}
    <div class="gb-panel">
      <div class="gb-panel-title">
        <h3>批量录入</h3>
        <span class="gb-hint">适合野外手记一次性录入：统一改写实测值，或整段粘贴导入。</span>
      </div>
      <div class="bulk-row">
        <label class="gb-field">
          <span>统一实测电阻（Ω）</span>
          <input type="number" min="0" step="0.01" bind:value={bulkValue} placeholder="如 4.5" />
        </label>
        <button class="btn" type="button" onclick={applyBulkMeasured}>批量改写实测值</button>
        <button class="btn" type="button" onclick={openPaste}>批量粘贴导入</button>
      </div>
    </div>
  {/if}

  {#if rows.length === 0}
    <EmptyPanel
      title={$pointList.length === 0 ? '还没有接地电阻测点' : '没有符合条件的测点'}
      description="选择一条防雷装置后逐点录入测点编号、位置与实测电阻；也可以批量粘贴导入手记数据。"
      actionText="新增测点"
      secondaryText="重置筛选"
      onAction={openCreate}
      onSecondary={handleReset}
    />
  {:else}
    <div class="gb-panel">
      <table class="gb-table">
        <thead>
          <tr>
            <th>测点编号</th>
            <th>位置</th>
            <th>所属装置</th>
            <th class="is-num">实测（Ω）</th>
            <th class="is-num">限值（Ω）</th>
            <th class="is-num">占限值</th>
            <th>判定</th>
            <th>检测仪器</th>
            <th>检测日期</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.point.id)}
            <tr class:is-bad={!row.qualified}>
              <td class="gb-mono">{row.point.code}</td>
              <td>{row.point.location}</td>
              <td>
                <span class="gb-tag">{row.deviceType}</span>
                <span class="gb-hint"> {buildingById(row.device?.buildingId)?.name ?? ''}</span>
              </td>
              <td class="is-num gb-mono">{row.point.measuredOhm}</td>
              <td class="is-num gb-mono">{row.point.limitOhm}</td>
              <td class="is-num gb-mono">{limitRatio(row.point.measuredOhm, row.point.limitOhm)}</td>
              <td>
                <QualifyTag measuredOhm={row.point.measuredOhm} limitOhm={row.point.limitOhm} size="small" />
                {#if !isQualified(row.point.measuredOhm, row.point.limitOhm)}
                  <span class="gb-danger">
                    超限 {((limitRatio(row.point.measuredOhm, row.point.limitOhm) - 1) * 100).toFixed(1)}%
                  </span>
                {/if}
              </td>
              <td class="gb-hint">{row.point.meter}</td>
              <td class="gb-mono">{row.point.measureDate}</td>
              <td class="row-actions">
                <button class="btn btn--small" type="button" onclick={() => openEdit(row.point)}>编辑</button>
                <button class="btn btn--danger btn--small" type="button" onclick={() => confirmRemove(row.point)}>
                  删除
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <p class="gb-hint">
    下一步：到「合格判定与整改」页执行自动初判与检测人确认，并由不合格判定批量生成整改建议。
    <button class="link" type="button" onclick={gotoVerdicts}>前往合格判定 →</button>
  </p>
</section>

{#if showDialog}
  <div class="gb-modal-backdrop" role="presentation" onclick={() => (showDialog = false)}>
    <div
      class="gb-modal"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(event: MouseEvent) => event.stopPropagation()}
      onkeydown={(event: KeyboardEvent) => event.stopPropagation()}
    >
      <div class="gb-modal__head">
        <h3>{editingId ? '编辑测点' : '新增接地电阻测点'}</h3>
        <button class="gb-modal__close" type="button" onclick={() => (showDialog = false)}>×</button>
      </div>
      <div class="gb-modal__body">
        {#if formError}
          <p class="gb-alert">{formError}</p>
        {/if}
        <div class="gb-modal__grid">
          <label class="gb-field">
            <span>测点编号 *</span>
            <input bind:value={form.code} placeholder="如 JD-01" maxlength="24" />
          </label>
          <label class="gb-field">
            <span>位置</span>
            <input bind:value={form.location} placeholder="如 屋面西北角接闪带引下点" maxlength="60" />
          </label>
          <label class="gb-field">
            <span>实测电阻（Ω）*</span>
            <input type="number" min="0" max="1000" step="0.01" bind:value={form.measuredOhm} />
          </label>
          <label class="gb-field">
            <span>限值（Ω）*</span>
            <input type="number" min="0.01" max="1000" step="0.01" bind:value={form.limitOhm} />
          </label>
          <label class="gb-field">
            <span>检测仪器</span>
            <input bind:value={form.meter} placeholder="如 ZC-8 接地电阻测试仪 / No.20230517" maxlength="60" />
          </label>
          <label class="gb-field">
            <span>检测日期</span>
            <input type="date" bind:value={form.measureDate} />
          </label>
        </div>
      </div>
      <div class="gb-modal__foot">
        <button class="btn" type="button" onclick={() => (showDialog = false)}>取消</button>
        <button class="btn btn--primary" type="button" onclick={submitForm}>
          {editingId ? '保存修改' : '新增测点'}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if showPaste}
  <div class="gb-modal-backdrop" role="presentation" onclick={() => (showPaste = false)}>
    <div
      class="gb-modal"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(event: MouseEvent) => event.stopPropagation()}
      onkeydown={(event: KeyboardEvent) => event.stopPropagation()}
    >
      <div class="gb-modal__head">
        <h3>批量粘贴导入测点</h3>
        <button class="gb-modal__close" type="button" onclick={() => (showPaste = false)}>×</button>
      </div>
      <div class="gb-modal__body">
        <p class="gb-hint">
          每行一条，格式「测点编号,位置,实测电阻[,限值]」，逗号 / 制表符 / 分号均可。示例：<br />
          <span class="gb-mono">JD-07,罐区东侧测试井,3.8,4</span><br />
          <span class="gb-mono">JD-08;罐区西侧测试井;5.6;4</span>
        </p>
        <label class="gb-field">
          <span>粘贴内容</span>
          <textarea
            rows="8"
            value={$pasteText}
            placeholder="JD-07,罐区东侧测试井,3.8,4"
            oninput={(event: Event) => pasteText.set((event.currentTarget as HTMLTextAreaElement).value)}
          ></textarea>
        </label>
        {#if pasteErrors.length > 0}
          <div class="errors">
            {#each pasteErrors as error, index (index)}
              <p class="gb-alert">{error}</p>
            {/each}
          </div>
        {/if}
        {#if pastePreview.length > 0}
          <table class="gb-table">
            <thead>
              <tr><th>编号</th><th>位置</th><th class="is-num">实测</th><th class="is-num">限值</th></tr>
            </thead>
            <tbody>
              {#each pastePreview as row, index (index)}
                <tr>
                  <td class="gb-mono">{row.code}</td>
                  <td>{row.location}</td>
                  <td class="is-num gb-mono">{row.measuredOhm}</td>
                  <td class="is-num gb-mono">{row.limitOhm}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
      <div class="gb-modal__foot">
        <button class="btn" type="button" onclick={() => (showPaste = false)}>取消</button>
        <button class="btn" type="button" onclick={previewPaste}>解析预览</button>
        <button class="btn btn--primary" type="button" onclick={submitPaste}>覆盖导入</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .page__head {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .page__title {
    margin: 0 0 4px;
    font-size: 19px;
    color: #1d3557;
  }

  .page__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .bulk-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px;
  }

  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  tr.is-bad td {
    background: #fff6f4;
  }

  .errors {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 160px;
    overflow: auto;
  }

  .link {
    border: none;
    background: transparent;
    color: #1d3557;
    text-decoration: underline;
    cursor: pointer;
    font-size: 12px;
  }
</style>
