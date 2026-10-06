/** 测点：接地电阻实测点，逐个录入实测值与限值 */
export interface Point {
  id: string
  /** 所属防雷装置 */
  deviceId: string
  /** 测点编号，如 JD-01 */
  code: string
  /** 测点位置描述 */
  location: string
  /** 实测接地电阻（Ω） */
  measuredOhm: number
  /** 限值（Ω），按防雷类别与装置类型给出初始值 */
  limitOhm: number
  /** 检测仪器与编号 */
  meter: string
  /** 检测日期 */
  measureDate: string
  createdAt: number
  updatedAt: number
}

/** 测点录入草稿（批量粘贴与单条新增共用） */
export interface PointDraft {
  code: string
  location: string
  measuredOhm: number
  limitOhm: number
  meter: string
  measureDate: string
}

export function createEmptyPointDraft(limitOhm = 10, meter = '', measureDate = ''): PointDraft {
  return {
    code: '',
    location: '',
    measuredOhm: 0,
    limitOhm,
    meter,
    measureDate: measureDate || new Date().toISOString().slice(0, 10)
  }
}

/** 批量粘贴解析出的一行测点草稿 */
export interface PointPasteRow {
  /** 原始文本中的行号（从 1 开始，跳过空行后仍按原文行计） */
  line: number
  /** 去首尾空格后的编号原文（比对时再忽略大小写） */
  code: string
  location: string
  measuredOhm: number
  limitOhm: number
  /** 该行是否显式填写了限值；未填时由入库层按当前防雷类别与装置类型重算 */
  hasLimit: boolean
}

/** 编号归一化：去首尾空格后忽略大小写，用于同批查重与台账同编号匹配 */
export function normalizePointCode(code: string): string {
  return code.trim().toLowerCase()
}

/**
 * 解析批量粘贴文本：每行「测点编号,位置,实测电阻[,限值]」。
 * 逗号 / 制表符 / 分号均可作分隔，纯空格不定界（位置描述常含空格）。
 *
 * 整批原子：任一行格式或数值有错、或同批出现重复编号（去首尾空格后忽略大小写），
 * 都只返回错误列表、rows 为空，调用方不得写入任何数据。
 */
export function parsePointPaste(text: string, defaultLimitOhm = 10): {
  rows: PointPasteRow[]
  errors: string[]
  /** 参与解析的非空行数（整批不受理时即未受理数量） */
  totalLines: number
} {
  const rows: PointPasteRow[] = []
  const errors: string[] = []
  const seenCodes = new Map<string, number>()
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  lines.forEach((line, index) => {
    const lineNo = index + 1
    // 逐字符切分：连续分隔符之间的空列（如「编号,,实测,限值」表示位置留空）必须保留
    const cells = line.split(/[,，\t;；]/).map((cell) => cell.trim())
    if (cells.length < 3 || cells.length > 4) {
      errors.push(`第 ${lineNo} 行「${line}」格式有误：应为「测点编号,位置,实测电阻[,限值]」三至四列`)
      return
    }
    const code = cells[0]
    if (!code) {
      errors.push(`第 ${lineNo} 行测点编号不能为空`)
      return
    }
    const measuredOhm = Number(cells[2])
    if (cells[2] === '' || !Number.isFinite(measuredOhm) || measuredOhm < 0) {
      errors.push(`第 ${lineNo} 行实测电阻应为非负数字`)
      return
    }
    // 第四列留空等同于没写限值：入库时按当前防雷类别与装置类型重算
    const hasLimit = cells.length === 4 && cells[3].length > 0
    const limitOhm = hasLimit ? Number(cells[3]) : defaultLimitOhm
    if (hasLimit && (!Number.isFinite(limitOhm) || limitOhm <= 0)) {
      errors.push(`第 ${lineNo} 行限值应为大于 0 的数字`)
      return
    }
    const normalized = normalizePointCode(code)
    const firstLine = seenCodes.get(normalized)
    if (firstLine !== undefined) {
      errors.push(`第 ${lineNo} 行编号「${code}」与第 ${firstLine} 行重复（编号忽略大小写）`)
      return
    }
    seenCodes.set(normalized, lineNo)
    rows.push({
      line: lineNo,
      code,
      location: cells[1],
      measuredOhm: Number(measuredOhm.toFixed(3)),
      limitOhm: Number(limitOhm.toFixed(3)),
      hasLimit
    })
  })

  // 整批原子：存在任何冲突行时不产出任何数据
  return { rows: errors.length > 0 ? [] : rows, errors, totalLines: lines.length }
}
