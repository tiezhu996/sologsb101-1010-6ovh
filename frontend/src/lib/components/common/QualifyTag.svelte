<script lang="ts">
  /**
   * <QualifyTag> 按合格 / 不合格 / 待判定渲染底色与图标。
   * 被测点录入页（/points）与合格判定页（/verdicts）消费。
   */
  import { isQualified, limitRatio } from '$lib/utils/resistance.ts'
  import type { VerdictResult } from '$lib/types/verdict.ts'

  type ToneKey = VerdictResult

  let {
    /** 合格 / 不合格 / 待判定 */
    result = '待判定',
    /** 实测电阻（Ω），传入后展示数值与超限幅度 */
    measuredOhm = null,
    /** 限值（Ω） */
    limitOhm = null,
    /** 尺寸 */
    size = 'default',
    /** 是否以浅色描边风格展示 */
    plain = false
  }: {
    result?: VerdictResult
    measuredOhm?: number | null
    limitOhm?: number | null
    size?: 'default' | 'small' | 'large'
    plain?: boolean
  } = $props()

  const TONE: Record<ToneKey, { color: string; bg: string; icon: string }> = {
    合格: { color: '#1e8449', bg: '#eaf6ee', icon: '✔' },
    不合格: { color: '#c0392b', bg: '#fdecea', icon: '✕' },
    待判定: { color: '#8c8479', bg: '#f2f2f2', icon: '?' }
  }

  // 传入了实测值与限值就按限值现算，否则用传入的结论
  const resolvedResult = $derived<VerdictResult>(
    measuredOhm !== null && limitOhm !== null && limitOhm > 0
      ? isQualified(measuredOhm, limitOhm)
        ? '合格'
        : '不合格'
      : result
  )
  const tone = $derived(TONE[resolvedResult] ?? TONE.待判定)
  const ratio = $derived(measuredOhm !== null && limitOhm ? limitRatio(measuredOhm, limitOhm) : 0)
  const valueText = $derived(measuredOhm === null ? '' : `${measuredOhm} Ω`)
  const tip = $derived(
    measuredOhm === null || limitOhm === null
      ? `${resolvedResult}`
      : `${resolvedResult}：实测 ${measuredOhm} Ω / 限值 ${limitOhm} Ω（${ratio > 1 ? `超限 ${((ratio - 1) * 100).toFixed(1)}%` : `余量 ${(limitOhm - measuredOhm).toFixed(2)} Ω`}）`
  )
  const style = $derived(
    plain
      ? `color:${tone.color};background:${tone.bg};border-color:${tone.color};`
      : `color:#fff;background:${tone.color};border-color:${tone.color};`
  )
</script>

<span class="qualify-tag is-{size}" style={style} title={tip}>
  <i class="qualify-tag__icon" aria-hidden="true">{tone.icon}</i>
  <b class="qualify-tag__text">{resolvedResult}</b>
  {#if valueText}
    <em class="qualify-tag__value">· {valueText}</em>
  {/if}
</span>

<style>
  .qualify-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 10px;
    border-radius: 999px;
    border: 1px solid transparent;
    font-size: 13px;
    font-weight: 600;
    line-height: 20px;
    white-space: nowrap;
  }

  .qualify-tag.is-small {
    padding: 0 8px;
    font-size: 12px;
    line-height: 18px;
  }

  .qualify-tag.is-large {
    padding: 4px 14px;
    font-size: 15px;
    line-height: 24px;
  }

  .qualify-tag__icon {
    font-style: normal;
    font-size: 12px;
  }

  .qualify-tag__value {
    font-style: normal;
    font-weight: 400;
    opacity: 0.9;
  }
</style>
