/** 整改状态机：待整改 → 已整改 → 已复检 */
export type RectifyState = '待整改' | '已整改' | '已复检'

export const RECTIFY_STATES: RectifyState[] = ['待整改', '已整改', '已复检']

/** 状态流转允许的下一步 */
export const RECTIFY_TRANSITIONS: Record<RectifyState, RectifyState[]> = {
  待整改: ['已整改'],
  已整改: ['已复检', '待整改'],
  已复检: ['待整改']
}

/** 整改建议：由不合格判定批量生成，跟踪到复检闭环 */
export interface Rectify {
  id: string
  /** 所属建筑物 */
  buildingId: string
  /** 关联的不合格测点 */
  pointId: string | null
  /** 问题描述 */
  problem: string
  /** 建议措施 */
  suggestion: string
  /** 建议期限 */
  deadline: string
  /** 状态 */
  state: RectifyState
  /** 责任人 */
  owner: string
  createdAt: number
  updatedAt: number
}

/** 整改单筛选条件（存于 rectifyStore） */
export interface RectifyFilterState {
  keyword: string
  buildingIds: string[]
  states: RectifyState[]
  /** 是否只看已超期未整改 */
  onlyOverdue: boolean
}

export function createEmptyRectifyFilter(): RectifyFilterState {
  return {
    keyword: '',
    buildingIds: [],
    states: [],
    onlyOverdue: false
  }
}

/** 建议措施模板：按问题类型给出常用整改措施 */
export const SUGGESTION_TEMPLATES: Array<{ key: string; problem: string; suggestion: string; days: number }> = [
  {
    key: 'resistance',
    problem: '接地电阻实测值超过限值',
    suggestion: '增设接地极或延长水平接地体，必要时换填低电阻率土壤并复测接地电阻',
    days: 15
  },
  {
    key: 'corrosion',
    problem: '接地装置锈蚀、截面减小',
    suggestion: '除锈后热镀锌处理或更换同规格接地体，焊接处做防腐处理',
    days: 30
  },
  {
    key: 'break',
    problem: '引下线断开或连接不可靠',
    suggestion: '重新焊接或加装连接卡具，保证引下线上下贯通并做防腐',
    days: 7
  },
  {
    key: 'airTerminal',
    problem: '接闪带（杆）保护范围不足或支架脱落',
    suggestion: '按滚球法校核保护范围，补齐接闪带并加固支架，间距不大于 1 m',
    days: 20
  }
]
