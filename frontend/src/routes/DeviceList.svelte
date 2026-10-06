<script lang="ts">
  /**
   * 模块 2：/devices 接闪器 / 引下线 / 接地装置登记
   * 登记材质、规格与数量，按建筑物与装置类型筛选，展开该装置全部测点。
   * 复用 <FilterBar>、<EmptyPanel>。
   */
  import FilterBar from '$lib/components/common/FilterBar.svelte'
  import type { FilterChange } from '$lib/components/common/FilterBar.svelte'
  import EmptyPanel from '$lib/components/common/EmptyPanel.svelte'
  import StatBadge from '$lib/components/common/StatBadge.svelte'
  import QualifyTag from '$lib/components/common/QualifyTag.svelte'
  import {
    buildingById,
    buildingList,
    createDevice,
    currentBuildingId,
    deviceFilter,
    filteredDevices,
    patchDeviceFilter,
    removeDevice,
    resetDeviceFilter,
    updateDevice
  } from '$lib/stores/buildingStore.ts'
  import { pointStatsByDevice } from '$lib/stores/pointStats.ts'
  import { pointsOfDevice } from '$lib/stores/pointStore.ts'
  import { DEVICE_MATERIALS, DEVICE_TYPES } from '$lib/types/device.ts'
  import type { Device, DeviceType } from '$lib/types/device.ts'
  import { suggestLimitOhm } from '$lib/utils/resistance.ts'
  import { readQuery, writeQuery } from '$lib/utils/query.ts'
  import { useRouter } from '$lib/utils/router.ts'

  const { push } = useRouter()

  interface DeviceForm {
    buildingId: string
    type: DeviceType
    material: string
    spec: string
    quantity: number
    installDate: string
  }

  const initialQuery = readQuery()
  if (initialQuery.bld) {
    patchDeviceFilter({ buildingIds: initialQuery.bld.split(',') })
  }
  if (initialQuery.type) {
    patchDeviceFilter({ types: initialQuery.type.split(',') as DeviceType[] })
  }

  let showDialog = $state(false)
  let editingId = $state<string | null>(null)
  let formError = $state('')
  let expandedDeviceId = $state<string | null>(initialQuery.device ?? null)
  let form = $state<DeviceForm>({
    buildingId: '',
    type: '接闪带',
    material: DEVICE_MATERIALS[0],
    spec: '',
    quantity: 1,
    installDate: new Date().toISOString().slice(0, 10)
  })

  const filterValues = $derived<Record<string, string | string[]>>({
    buildingIds: $deviceFilter.buildingIds as string[],
    types: $deviceFilter.types as string[]
  })

  /** 装置行：附带建筑物名、测点统计与是否展开 */
  const rows = $derived(
    $filteredDevices
      .map((device) => {
        const building = buildingById(device.buildingId)
        const stats = $pointStatsByDevice[device.id] ?? { count: 0, unqualified: 0, minOhm: 0, maxOhm: 0 }
        return { device, building, stats, expanded: expandedDeviceId === device.id }
      })
      .filter((row) => !$deviceFilter.onlyWithoutPoint || row.stats.count === 0)
      .sort((a, b) => (a.building?.name ?? '').localeCompare(b.building?.name ?? '', 'zh-Hans-CN'))
  )

  const totals = $derived({
    devices: rows.length,
    quantity: rows.reduce((sum, row) => sum + row.device.quantity, 0),
    points: rows.reduce((sum, row) => sum + row.stats.count, 0),
    unqualified: rows.reduce((sum, row) => sum + row.stats.unqualified, 0)
  })

  function openCreate(): void {
    editingId = null
    formError = ''
    form = {
      buildingId: $currentBuildingId ?? $buildingList[0]?.id ?? '',
      type: '接闪带',
      material: DEVICE_MATERIALS[0],
      spec: '',
      quantity: 1,
      installDate: new Date().toISOString().slice(0, 10)
    }
    showDialog = true
  }

  function openEdit(device: Device): void {
    editingId = device.id
    formError = ''
    form = {
      buildingId: device.buildingId,
      type: device.type,
      material: device.material,
      spec: device.spec,
      quantity: device.quantity,
      installDate: device.installDate
    }
    showDialog = true
  }

  async function submitForm(): Promise<void> {
    if (!form.buildingId) {
      formError = '请选择所属建筑物'
      return
    }
    if (!form.material.trim()) {
      formError = '请填写材质'
      return
    }
    if (!Number.isFinite(Number(form.quantity)) || Number(form.quantity) <= 0) {
      formError = '数量应为大于 0 的数字'
      return
    }
    const payload = {
      buildingId: form.buildingId,
      type: form.type,
      material: form.material.trim(),
      spec: form.spec.trim(),
      quantity: Number(form.quantity),
      installDate: form.installDate
    }
    if (editingId) {
      await updateDevice(editingId, payload)
    } else {
      const created = await createDevice(payload)
      expandedDeviceId = created.id
    }
    showDialog = false
  }

  async function confirmRemove(device: Device): Promise<void> {
    const stats = $pointStatsByDevice[device.id] ?? { count: 0 }
    const ok = window.confirm(
      `删除「${device.type}（${device.spec || '未填规格'}）」将同时删除其 ${stats.count} 个测点与判定记录，确认删除？`
    )
    if (!ok) return
    await removeDevice(device.id)
  }

  function toggleExpand(device: Device): void {
    expandedDeviceId = expandedDeviceId === device.id ? null : device.id
  }

  async function gotoPoints(device: Device): Promise<void> {
    writeQuery('/points', { device: device.id })
    push('/points')
  }

  function handleFilterChange(next: FilterChange): void {
    patchDeviceFilter({
      keyword: next.keyword,
      buildingIds: (next.values.buildingIds as string[]) ?? [],
      types: ((next.values.types as string[]) ?? []) as DeviceType[],
      onlyWithoutPoint: next.switchValue
    })
    writeQuery('/devices', {
      kw: next.keyword,
      bld: ((next.values.buildingIds as string[]) ?? []).join(','),
      type: ((next.values.types as string[]) ?? []).join(','),
      noPoint: next.switchValue ? '1' : null
    })
  }

  function handleReset(): void {
    resetDeviceFilter()
    writeQuery('/devices', {})
  }
</script>

<section class="page">
  <div class="gb-brand-bar"></div>

  <div class="page__head">
    <div>
      <h2 class="page__title">接闪器 / 引下线 / 接地装置登记</h2>
      <p class="gb-hint">
        登记装置类型、材质、规格与数量，按建筑物与装置类型筛选；展开某条装置即可查看其全部接地电阻测点。
      </p>
    </div>
    <button class="btn btn--primary" type="button" onclick={openCreate}>＋ 登记装置</button>
  </div>

  <FilterBar
    keyword={$deviceFilter.keyword}
    selects={[
      {
        key: 'buildingIds',
        label: '建筑物',
        options: $buildingList.map((building) => ({ label: building.name, value: building.id }))
      },
      { key: 'types', label: '装置类型', options: DEVICE_TYPES.map((type) => ({ label: type, value: type })) }
    ]}
    values={filterValues}
    hasSwitch={true}
    switchLabel="仅看未录入测点的装置"
    switchValue={$deviceFilter.onlyWithoutPoint}
    keywordPlaceholder="搜索类型 / 材质 / 规格"
    onChange={handleFilterChange}
    onReset={handleReset}
  />

  <div class="gb-stats-row">
    <StatBadge label="装置条数" value={totals.devices} suffix="处" tone="primary" />
    <StatBadge label="数量合计" value={totals.quantity} suffix="根/处" tone="info" />
    <StatBadge label="关联测点" value={totals.points} suffix="点" tone="default" />
    <StatBadge
      label="不合格测点"
      value={totals.unqualified}
      suffix="点"
      tone={totals.unqualified > 0 ? 'danger' : 'success'}
    />
  </div>

  {#if rows.length === 0}
    <EmptyPanel
      title={$deviceFilter.keyword || $deviceFilter.types.length > 0 ? '没有符合条件的装置' : '还没有登记防雷装置'}
      description="按建筑物登记接闪带、接闪杆、引下线与接地体，随后在测点录入页逐点录入接地电阻。"
      actionText="登记装置"
      secondaryText="重置筛选"
      onAction={openCreate}
      onSecondary={handleReset}
    />
  {:else}
    <div class="gb-panel">
      <table class="gb-table">
        <thead>
          <tr>
            <th>建筑物</th>
            <th>装置类型</th>
            <th>材质 / 规格</th>
            <th class="is-num">数量</th>
            <th>安装日期</th>
            <th class="is-num">测点数</th>
            <th>合格情况</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.device.id)}
            <tr>
              <td>{row.building?.name ?? '未知建筑物'}</td>
              <td><span class="gb-tag">{row.device.type}</span></td>
              <td>
                {row.device.material}
                {#if row.device.spec}
                  <span class="gb-mono gb-hint"> {row.device.spec}</span>
                {/if}
              </td>
              <td class="is-num gb-mono">{row.device.quantity}</td>
              <td class="gb-mono">{row.device.installDate}</td>
              <td class="is-num">
                <button class="link" type="button" onclick={() => toggleExpand(row.device)}>
                  {row.stats.count} 点 {row.expanded ? '▲' : '▼'}
                </button>
              </td>
              <td>
                {#if row.stats.count === 0}
                  <span class="gb-hint">未录入测点</span>
                {:else if row.stats.unqualified > 0}
                  <span class="gb-danger">{row.stats.unqualified} 点不合格</span>
                {:else}
                  <span class="ok-text">全部合格</span>
                {/if}
              </td>
              <td class="row-actions">
                <button class="btn btn--primary btn--small" type="button" onclick={() => gotoPoints(row.device)}>
                  测点
                </button>
                <button class="btn btn--small" type="button" onclick={() => openEdit(row.device)}>编辑</button>
                <button class="btn btn--danger btn--small" type="button" onclick={() => confirmRemove(row.device)}>
                  删除
                </button>
              </td>
            </tr>
            {#if row.expanded}
              <tr class="expand-row">
                <td colspan="8">
                  <div class="expand">
                    <strong class="expand__title">
                      {row.device.type} · 全部测点（限值建议 {suggestLimitOhm(
                        row.building?.protectionClass ?? '三类',
                        row.device.type
                      )} Ω）
                    </strong>
                    {#if pointsOfDevice(row.device.id).length === 0}
                      <p class="gb-hint">该装置还没有测点，点击「测点」进入录入页。</p>
                    {:else}
                      <table class="gb-table">
                        <thead>
                          <tr>
                            <th>测点编号</th>
                            <th>位置</th>
                            <th class="is-num">实测（Ω）</th>
                            <th class="is-num">限值（Ω）</th>
                            <th>判定</th>
                            <th>检测仪器</th>
                          </tr>
                        </thead>
                        <tbody>
                          {#each pointsOfDevice(row.device.id) as point (point.id)}
                            <tr>
                              <td class="gb-mono">{point.code}</td>
                              <td>{point.location}</td>
                              <td class="is-num gb-mono">{point.measuredOhm}</td>
                              <td class="is-num gb-mono">{point.limitOhm}</td>
                              <td><QualifyTag measuredOhm={point.measuredOhm} limitOhm={point.limitOhm} size="small" /></td>
                              <td class="gb-hint">{point.meter}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    {/if}
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <p class="gb-hint">
    提示：装置数量用于统计接闪带长度（m）、引下线根数与接地体数量；数量单位为「根 / 处 / 米」，可按实际填写。
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
        <h3>{editingId ? '编辑防雷装置' : '登记防雷装置'}</h3>
        <button class="gb-modal__close" type="button" onclick={() => (showDialog = false)}>×</button>
      </div>
      <div class="gb-modal__body">
        {#if formError}
          <p class="gb-alert">{formError}</p>
        {/if}
        <div class="gb-modal__grid">
          <label class="gb-field">
            <span>所属建筑物 *</span>
            <select bind:value={form.buildingId}>
              <option value="">请选择</option>
              {#each $buildingList as building (building.id)}
                <option value={building.id}>{building.name}（{building.protectionClass}）</option>
              {/each}
            </select>
          </label>
          <label class="gb-field">
            <span>装置类型 *</span>
            <select bind:value={form.type}>
              {#each DEVICE_TYPES as type (type)}
                <option value={type}>{type}</option>
              {/each}
            </select>
          </label>
          <label class="gb-field">
            <span>材质 *</span>
            <input bind:value={form.material} list="material-options" maxlength="30" />
            <datalist id="material-options">
              {#each DEVICE_MATERIALS as material (material)}
                <option value={material}></option>
              {/each}
            </datalist>
          </label>
          <label class="gb-field">
            <span>规格</span>
            <input bind:value={form.spec} placeholder="如 Φ12 / -40×4" maxlength="30" />
          </label>
          <label class="gb-field">
            <span>数量（根/处/米）*</span>
            <input type="number" min="1" max="100000" bind:value={form.quantity} />
          </label>
          <label class="gb-field">
            <span>安装日期</span>
            <input type="date" bind:value={form.installDate} />
          </label>
        </div>
      </div>
      <div class="gb-modal__foot">
        <button class="btn" type="button" onclick={() => (showDialog = false)}>取消</button>
        <button class="btn btn--primary" type="button" onclick={submitForm}>
          {editingId ? '保存修改' : '登记并录入测点'}
        </button>
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

  .link {
    border: none;
    background: transparent;
    color: #1d3557;
    text-decoration: underline;
    cursor: pointer;
    font-size: 13px;
  }

  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .ok-text {
    color: #1e8449;
  }

  .expand-row td {
    background: #f9fbfd;
  }

  .expand {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 6px 0;
  }

  .expand__title {
    font-size: 13px;
    color: #1d3557;
  }
</style>
