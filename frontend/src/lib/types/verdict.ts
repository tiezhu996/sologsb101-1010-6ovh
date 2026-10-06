/** 判定结论 */
export type VerdictResult = '合格' | '不合格' | '待判定'

export const VERDICT_RESULTS: VerdictResult[] = ['合格', '不合格', '待判定']

/** 判定：实测值与限值比对后的结论，检测人确认后生效 */
export interface Verdict {
  id: string
  /** 被判定的测点 */
  pointId: string
  /** 判定结论 */
  result: VerdictResult
  /** 判定依据（规范条款 / 限值来源） */
  basis: string
  /** 检测人 */
  inspector: string
  /** 判定日期 */
  verdictDate: string
  /** 是否已由检测人确认生效 */
  confirmed: boolean
  createdAt: number
  updatedAt: number
}

/** 自动初判：实测值 ≤ 限值判合格，否则不合格 */
export function judgePoint(measuredOhm: number, limitOhm: number): VerdictResult {
  if (!Number.isFinite(measuredOhm) || !Number.isFinite(limitOhm) || limitOhm <= 0) return '待判定'
  return measuredOhm <= limitOhm ? '合格' : '不合格'
}

/** 判定依据模板：按防雷类别与装置类型给出常用条款说明 */
export function defaultBasis(protectionClass: string, deviceType: string, limitOhm: number): string {
  const clause =
    protectionClass === '一类'
      ? 'GB 50057-2010 第 4.3 节'
      : protectionClass === '二类'
        ? 'GB 50057-2010 第 4.4 节'
        : 'GB 50057-2010 第 4.5 节'
  return `${clause}：${protectionClass}防雷建筑物${deviceType}接地电阻不大于 ${limitOhm} Ω`
}
