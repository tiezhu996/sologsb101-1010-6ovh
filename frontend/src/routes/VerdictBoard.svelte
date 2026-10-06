<script lang="ts">
  /**
   * 模块 4：/verdicts 合格判定与整改建议
   * 自动初判、检测人确认并生成整改建议，整改状态机跟踪到复检闭环。
   * 复用 <QualifyTag>、<StatBadge>，并以 <FilterBar> 同步判定筛选。
   */
  import QualifyTag from '$lib/components/common/QualifyTag.svelte'
  import StatBadge from '$lib/components/common/StatBadge.svelte'
  import FilterBar from '$lib/components/common/FilterBar.svelte'
  import type { FilterChange } from '$lib/components/common/FilterBar.svelte'
  import EmptyPanel from '$lib/components/common/EmptyPanel.svelte'
  import {
    autoJudgeAll,
    autoJudgePoint,
    bulkSetVerdictResult,
    confirmVerdict,
    createRectify,
    filteredRectifies,
    generateRectifies,
    patchRectifyFilter,
    qualifyStats,
    rectifyFilter,
    rectifyList,
    rectifyStateCounts,
    removeRectify,
    resetRectifyFilter,
    transitionRectify,
    unhandledUnqualified,
    updateRectify,
    verdictRows
  } from '$lib/stores/rectifyStore.ts'
  import { buildingList, deviceList } from '$lib/stores/buildingStore.ts'
  import { pointList } from '$lib/stores/pointStore.ts'
  import { RECTIFY_STATES, RECTIFY_TRANSITIONS, SUGGESTION_TEMPLATES } from '$lib/types/rectify.ts'
  import type { RectifyState } from '$lib/types/rectify.ts'
  import { VERDICT_RESULTS } from '$lib/types/verdict.ts'
  import type { VerdictResult } from '$lib/types/verdict.ts'
  import { readQuery, writeQuery } from '$lib/utils/query.ts'

  interface RectifyForm {
    buildingId: string
    pointId: string | null
    problem: string
    suggestion: string
    deadline: string
    state: RectifyState
    owner: string
  }

  const query = readQuery()
  if (Object.keys(query).length > 0) {
    patchRectifyFilter({
      keyword: query.kw ?? '',
      buildingIds: query.bld ? query.bld.split(',') : [],
      onlyOverdue: query.overdue === '1'
    })
  }

  let inspector = $state('陈立群')
  let bulkInspector = $state('陈立群')
  let selected = $state<string[]>([])
  let notice = $state('')
  let editingRectifyId = $state<string | null>(null)
  let showRectifyDialog = $state(false)
  /** 判定结果筛选（合格 / 不合格 / 待判定），与整改状态机解耦 */
  let verdictFilterStates = $state<VerdictResult[]>(
    query.state ? (query.state.split(',') as VerdictResult[]) : []
  )
  let rectifyForm = $state<RectifyForm>({
    buildingId: '',
    pointId: null,
    problem: '',
    suggestion: '',
    deadline: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
    state: '待整改',
    owner: '王振海'
  })

  const rows = $derived(
    $verdictRows
      .filter((row) => {
        const keyword = $rectifyFilter.keyword.trim()
        if (keyword.length > 0) {
          const text = `${row.point.code}${row.point.location}${row.building?.name ?? ''}${row.device?.type ?? ''}`
          if (!text.includes(keyword)) return false
        }
        if ($rectifyFilter.buildingIds.length > 0 && !$rectifyFilter.buildingIds.includes(row.building?.id ?? ''))
          return false
        if (verdictFilterStates.length > 0) {
          const result = row.verdict?.result ?? row.autoResult
          if (!verdictFilterStates.includes(result)) return false
        }
        return true
      })
      .sort((a, b) => {
        if (a.qualified === b.qualified) return a.point.code.localeCompare(b.point.code, 'zh-Hans-CN')
        return a.qualified ? 1 : -1
      })
  )

  const totals = $derived({
    points: rows.length,
    unqualified: rows.filter((row) => !row.qualified).length,
    unconfirmed: rows.filter((row) => !row.verdict?.confirmed).length,
    inconsistent: rows.filter((row) => row.verdict && !row.consistent).length
  })

  const rectifyOptions = $derived(
    $pointList
      .map((point) => {
        const device = $deviceList.find((item) => item.id === point.deviceId)
        const building = device ? $buildingList.find((item) => item.id === device.buildingId) : undefined
        return {
          label: `${building?.name ?? '未知'} · ${point.code}（${point.measuredOhm} Ω）`,
          value: point.id
        }
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans-CN'))
  )

  function toggleSelect(pointId: string): void {
    selected = selected.includes(pointId) ? selected.filter((id) => id !== pointId) : [...selected, pointId]
  }

  function toggleSelectAll(): void {
    selected = selected.length === rows.length ? [] : rows.map((row) => row.point.id)
  }

  async function runAutoJudgeAll(): Promise<void> {
    const count = await autoJudgeAll(inspector)
    notice = `已对 ${count} 个测点完成自动初判，请逐条由检测人确认生效。`
  }

  async function runAutoJudge(pointId: string): Promise<void> {
    await autoJudgePoint(pointId, inspector)
    notice = '已按实测值与限值比对给出初判，请确认生效。'
  }

  async function confirmOne(row: (typeof rows)[number]): Promise<void> {
    if (!row.verdict) {
      await autoJudgePoint(row.point.id, inspector)
      const latest = $verdictRows.find((item) => item.point.id === row.point.id)
      if (latest?.verdict) await confirmVerdict(latest.verdict.id, { inspector })
      notice = `测点 ${row.point.code} 的判定已确认生效。`
      return
    }
    await confirmVerdict(row.verdict.id, { inspector })
    notice = `测点 ${row.point.code} 的判定已确认生效。`
  }

  async function bulkSet(result: VerdictResult): Promise<void> {
    if (selected.length === 0) {
      notice = '请先勾选要批量改判的测点。'
      return
    }
    const count = await bulkSetVerdictResult(selected, result, bulkInspector)
    notice = `已批量将 ${count} 个测点的判定结论改为「${result}」并确认生效。`
    selected = []
  }

  async function runGenerateRectifies(): Promise<void> {
    const count = await generateRectifies({ owner: '王振海', inspector })
    notice =
      count > 0
        ? `已按不合格判定生成 ${count} 条整改建议，可在下方整改单列表推进状态。`
        : '当前没有新的不合格测点需要生成整改建议。'
  }

  async function advance(
    row: { rectify: { id: string; state: RectifyState } },
    next: RectifyState
  ): Promise<void> {
    const ok = await transitionRectify(row.rectify.id, next)
    notice = ok
      ? `整改单已由「${row.rectify.state}」流转到「${next}」。`
      : `状态机不允许从「${row.rectify.state}」直接流转到「${next}」。`
  }

  async function confirmRemoveRectify(row: { rectify: { id: string; problem: string } }): Promise<void> {
    const ok = window.confirm(`删除整改建议「${row.rectify.problem}」？`)
    if (!ok) return
    await removeRectify(row.rectify.id)
    notice = '整改建议已删除。'
  }

  function openRectifyDialog(row: { rectify: { id: string; buildingId: string; pointId: string | null; problem: string; suggestion: string; deadline: string; state: RectifyState; owner: string } } | null): void {
    editingRectifyId = row?.rectify?.id ?? null
    if (row?.rectify) {
      rectifyForm = {
        buildingId: row.rectify.buildingId,
        pointId: row.rectify.pointId,
        problem: row.rectify.problem,
        suggestion: row.rectify.suggestion,
        deadline: row.rectify.deadline,
        state: row.rectify.state,
        owner: row.rectify.owner
      }
    } else {
      const template = SUGGESTION_TEMPLATES[0]
      rectifyForm = {
        buildingId: $buildingList[0]?.id ?? '',
        pointId: null,
        problem: template.problem,
        suggestion: template.suggestion,
        deadline: new Date(Date.now() + template.days * 86400000).toISOString().slice(0, 10),
        state: '待整改',
        owner: '王振海'
      }
    }
    showRectifyDialog = true
  }

  async function submitRectify(): Promise<void> {
    if (!rectifyForm.buildingId) {
      notice = '请选择所属建筑物。'
      return
    }
    if (!rectifyForm.problem.trim()) {
      notice = '请填写问题描述。'
      return
    }
    if (editingRectifyId) {
      await updateRectify(editingRectifyId, { ...rectifyForm })
      notice = '整改建议已更新。'
    } else {
      await createRectify({
        buildingId: rectifyForm.buildingId,
        pointId: rectifyForm.pointId,
        problem: rectifyForm.problem.trim(),
        suggestion: rectifyForm.suggestion.trim(),
        deadline: rectifyForm.deadline,
        state: rectifyForm.state,
        owner: rectifyForm.owner
      })
      notice = '整改建议已新增。'
    }
    showRectifyDialog = false
  }

  function applyTemplate(key: string): void {
    const template = SUGGESTION_TEMPLATES.find((item) => item.key === key)
    if (!template) return
    rectifyForm = {
      ...rectifyForm,
      problem: template.problem,
      suggestion: template.suggestion,
      deadline: new Date(Date.now() + template.days * 86400000).toISOString().slice(0, 10)
    }
  }

  function handleFilterChange(next: FilterChange): void {
    patchRectifyFilter({
      keyword: next.keyword,
      buildingIds: (next.values.buildingIds as string[]) ?? [],
      onlyOverdue: next.switchValue
    })
    verdictFilterStates = ((next.values.states as string[]) ?? []) as VerdictResult[]
    writeQuery('/verdicts', {
      kw: next.keyword,
      bld: ((next.values.buildingIds as string[]) ?? []).join(','),
      state: ((next.values.states as string[]) ?? []).join(','),
      overdue: next.switchValue ? '1' : null
    })
  }

  function handleReset(): void {
    resetRectifyFilter()
    verdictFilterStates = []
    writeQuery('/verdicts', {})
  }
</script>

<section class="page">
  <div class="gb-brand-bar"></div>

  <div class="page__head">
    <div>
      <h2 class="page__title">合格判定与整改建议</h2>
      <p class="gb-hint">
        实测值与限值比对自动给出初判，检测人确认后生效；不合格测点可一键批量生成整改建议，并跟踪整改状态机到复检闭环。
      </p>
    </div>
    <div class="page__actions">
      <label class="gb-field inline">
        <span>检测人</span>
        <input bind:value={inspector} maxlength="20" />
      </label>
      <button class="btn" type="button" onclick={runAutoJudgeAll}>全部自动初判</button>
      <button class="btn btn--primary" type="button" onclick={runGenerateRectifies}>
        由不合格判定生成整改建议（{$unhandledUnqualified.length}）
      </button>
    </div>
  </div>

  {#if notice}
    <p class="gb-alert">{notice}</p>
  {/if}

  <div class="gb-stats-row">
    <StatBadge label="待判定测点" value={totals.points} suffix="点" tone="primary" />
    <StatBadge
      label="不合格"
      value={totals.unqualified}
      suffix="点"
      tone={totals.unqualified > 0 ? 'danger' : 'success'}
    />
    <StatBadge label="未确认" value={totals.unconfirmed} suffix="条" tone={totals.unconfirmed > 0 ? 'warning' : 'success'} />
    <StatBadge label="整体合格率" value={$qualifyStats.overall.rate} percent={$qualifyStats.overall.rate} tone="success" />
    <StatBadge label="初判不一致" value={totals.inconsistent} suffix="条" tone={totals.inconsistent > 0 ? 'warning' : 'default'} />
  </div>

  <FilterBar
    keyword={$rectifyFilter.keyword}
    selects={[
      {
        key: 'buildingIds',
        label: '建筑物',
        options: $buildingList.map((building) => ({ label: building.name, value: building.id }))
      },
      { key: 'states', label: '判定结果', options: VERDICT_RESULTS.map((result) => ({ label: result, value: result })) }
    ]}
    values={{ buildingIds: $rectifyFilter.buildingIds as string[], states: verdictFilterStates as string[] }}
    hasSwitch={true}
    switchLabel="只看超期未整改"
    switchValue={$rectifyFilter.onlyOverdue}
    keywordPlaceholder="搜索测点编号 / 位置 / 建筑物"
    onChange={handleFilterChange}
    onReset={handleReset}
  >
    {#snippet actions()}
      <label class="gb-field inline">
        <span>批量判定人</span>
        <input bind:value={bulkInspector} maxlength="20" />
      </label>
      <button class="btn btn--small" type="button" onclick={() => bulkSet('合格')}>批量改合格</button>
      <button class="btn btn--small" type="button" onclick={() => bulkSet('不合格')}>批量改不合格</button>
    {/snippet}
  </FilterBar>

  {#if rows.length === 0}
    <EmptyPanel
      title="没有符合条件的测点"
      description="请先到「接地电阻测点」页录入测点数据，或调整当前筛选条件。"
      actionText="全部自动初判"
      secondaryText="重置筛选"
      onAction={runAutoJudgeAll}
      onSecondary={handleReset}
    />
  {:else}
    <div class="gb-panel">
      <div class="gb-panel-title">
        <h3>判定清单</h3>
        <span class="gb-hint">勾选后可批量改判；「初判不一致」表示检测人结论与自动初判不同。</span>
      </div>
      <table class="gb-table">
        <thead>
          <tr>
            <th class="is-check">
              <input type="checkbox" checked={selected.length === rows.length} onchange={toggleSelectAll} />
            </th>
            <th>测点</th>
            <th>建筑物 / 装置</th>
            <th class="is-num">实测（Ω）</th>
            <th class="is-num">限值（Ω）</th>
            <th>自动初判</th>
            <th>检测人结论</th>
            <th>判定依据</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.point.id)}
            <tr class:is-bad={!row.qualified}>
              <td class="is-check">
                <input type="checkbox" checked={selected.includes(row.point.id)} onchange={() => toggleSelect(row.point.id)} />
              </td>
              <td>
                <div class="gb-mono">{row.point.code}</div>
                <div class="gb-hint">{row.point.location}</div>
              </td>
              <td>
                <div>{row.building?.name ?? '未知建筑物'}</div>
                <div class="gb-hint">{row.device?.type ?? '未知装置'} · {row.point.measureDate}</div>
              </td>
              <td class="is-num gb-mono">{row.point.measuredOhm}</td>
              <td class="is-num gb-mono">{row.point.limitOhm}</td>
              <td><QualifyTag result={row.autoResult} size="small" plain /></td>
              <td>
                {#if row.verdict}
                  <QualifyTag result={row.verdict.result} size="small" />
                  <div class="gb-hint">
                    {row.verdict.confirmed ? '已确认生效' : '待检测人确认'} · {row.verdict.inspector || '未署名'}
                  </div>
                  {#if !row.consistent}
                    <div class="gb-danger">与初判不一致</div>
                  {/if}
                {:else}
                  <span class="gb-hint">尚未判定</span>
                {/if}
              </td>
              <td class="gb-hint">{row.verdict?.basis ?? '—'}</td>
              <td class="row-actions">
                <button class="btn btn--small" type="button" onclick={() => runAutoJudge(row.point.id)}>初判</button>
                <button class="btn btn--primary btn--small" type="button" onclick={() => confirmOne(row)}>
                  {row.verdict?.confirmed ? '重新确认' : '确认生效'}
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <div class="gb-panel">
    <div class="gb-panel-title">
      <h3>整改建议跟踪（{$rectifyList.length} 条）</h3>
      <div class="gb-stats-row">
        <StatBadge label="待整改" value={$rectifyStateCounts['待整改']} suffix="条" size="small" tone="danger" />
        <StatBadge label="已整改" value={$rectifyStateCounts['已整改']} suffix="条" size="small" tone="warning" />
        <StatBadge label="已复检" value={$rectifyStateCounts['已复检']} suffix="条" size="small" tone="success" />
        <button class="btn btn--small" type="button" onclick={() => openRectifyDialog(null)}>＋ 手工新增整改单</button>
      </div>
    </div>

    {#if $filteredRectifies.length === 0}
      <EmptyPanel
        title={$rectifyList.length === 0 ? '还没有整改建议' : '没有符合条件的整改单'}
        description="点击「由不合格判定生成整改建议」可按模板批量生成，也可手工新增一条整改单。"
        actionText="由不合格判定生成"
        onAction={runGenerateRectifies}
        compact
      />
    {:else}
      <table class="gb-table">
        <thead>
          <tr>
            <th>建筑物</th>
            <th>测点</th>
            <th>问题描述</th>
            <th>建议措施</th>
            <th>期限</th>
            <th>状态</th>
            <th>责任人</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {#each $filteredRectifies as row (row.rectify.id)}
            <tr class:is-bad={row.overdue}>
              <td>{row.buildingName}</td>
              <td class="gb-mono">{row.pointCode}</td>
              <td>{row.rectify.problem}</td>
              <td class="gb-hint">{row.rectify.suggestion}</td>
              <td class="gb-mono">
                {row.rectify.deadline}
                {#if row.overdue}
                  <span class="gb-danger">（超期）</span>
                {/if}
              </td>
              <td><span class="gb-tag">{row.rectify.state}</span></td>
              <td>{row.rectify.owner}</td>
              <td class="row-actions">
                {#each RECTIFY_TRANSITIONS[row.rectify.state] as next (next)}
                  <button class="btn btn--small" type="button" onclick={() => advance(row, next)}>→ {next}</button>
                {/each}
                <button class="btn btn--small" type="button" onclick={() => openRectifyDialog(row)}>编辑</button>
                <button class="btn btn--danger btn--small" type="button" onclick={() => confirmRemoveRectify(row)}>
                  删除
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</section>

{#if showRectifyDialog}
  <div class="gb-modal-backdrop" role="presentation" onclick={() => (showRectifyDialog = false)}>
    <div
      class="gb-modal"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      onclick={(event: MouseEvent) => event.stopPropagation()}
      onkeydown={(event: KeyboardEvent) => event.stopPropagation()}
    >
      <div class="gb-modal__head">
        <h3>{editingRectifyId ? '编辑整改建议' : '新增整改建议'}</h3>
        <button class="gb-modal__close" type="button" onclick={() => (showRectifyDialog = false)}>×</button>
      </div>
      <div class="gb-modal__body">
        <div class="gb-modal__grid">
          <label class="gb-field">
            <span>所属建筑物 *</span>
            <select bind:value={rectifyForm.buildingId}>
              <option value="">请选择</option>
              {#each $buildingList as building (building.id)}
                <option value={building.id}>{building.name}</option>
              {/each}
            </select>
          </label>
          <label class="gb-field">
            <span>关联测点</span>
            <select bind:value={rectifyForm.pointId}>
              <option value={null}>不关联</option>
              {#each rectifyOptions as option (option.value)}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </label>
          <label class="gb-field">
            <span>建议期限</span>
            <input type="date" bind:value={rectifyForm.deadline} />
          </label>
          <label class="gb-field">
            <span>责任人</span>
            <input bind:value={rectifyForm.owner} maxlength="20" />
          </label>
          <label class="gb-field">
            <span>状态</span>
            <select bind:value={rectifyForm.state}>
              {#each RECTIFY_STATES as state (state)}
                <option value={state}>{state}</option>
              {/each}
            </select>
          </label>
        </div>
        <div class="template-row">
          <span class="gb-hint">措施模板：</span>
          {#each SUGGESTION_TEMPLATES as template (template.key)}
            <button class="btn btn--small" type="button" onclick={() => applyTemplate(template.key)}>
              {template.problem}
            </button>
          {/each}
        </div>
        <label class="gb-field">
          <span>问题描述 *</span>
          <textarea rows="2" bind:value={rectifyForm.problem} maxlength="200"></textarea>
        </label>
        <label class="gb-field">
          <span>建议措施</span>
          <textarea rows="2" bind:value={rectifyForm.suggestion} maxlength="200"></textarea>
        </label>
      </div>
      <div class="gb-modal__foot">
        <button class="btn" type="button" onclick={() => (showRectifyDialog = false)}>取消</button>
        <button class="btn btn--primary" type="button" onclick={submitRectify}>
          {editingRectifyId ? '保存修改' : '新增整改单'}
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

  .page__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 8px;
  }

  .gb-field.inline {
    min-width: 120px;
  }

  .row-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .is-check {
    width: 36px;
  }

  tr.is-bad td {
    background: #fff6f4;
  }

  .template-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
</style>
