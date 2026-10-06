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
  code: string
  location: string
  measuredOhm: number
  /** 粘贴行内填写的限值；null 表示未写，需入库时按当前防雷类别与装置类型重算 */
  limitOhm: number | null
  /** 该粘贴行是否显式给出限值（false 时位置 4 列留空，走默认限值） */
  limitSpecified: boolean
  /** 来源行号（从 1 起，按忽略空行后的序号计），便于定位冲突行 */
  lineNo: number
}

export interface PointPasteResult {
  rows: PointPasteRow[]
  errors: string[]
  /** 参与解析的非空行总数（含格式错误行），整批未受理时用于统计未受理数量 */
  lineCount: number
}

/** 编号归一化：去首尾空格后忽略大小写，用于同批查重与台账同编号匹配 */
export function normalizePointCode(code: string): string {
  return code.trim().toLowerCase()
}

/**
 * 解析批量粘贴文本：每行「测点编号,位置,实测电阻[,限值]」。
 * 逗号 / 制表符 / 分号均可作分隔，纯空格不定界（位置描述常含空格）。
 *
 * 规则：
 * - 位置允许留空（入库时保留台账原位置）；编号不能为空。
 * - 限值列可省略或留空，limitSpecified=false 交由入库方按防雷类别与装置类型重算。
 * - 编号去首尾空格、忽略大小写后同批不得重复。
 * - 任一行格式 / 数值错误或同批编号重复都会记录到 errors：调用方应在 errors 非空时整批拒绝写入。
 */
export function parsePointPaste(text: string, defaultLimitOhm = 10): PointPasteResult {
  const rows: PointPasteRow[] = []
  const errors: string[] = []
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const lineCount = lines.length
  /** 归一化编号 → 首次出现的行号，用于同批查重 */
  const seenCodes = new Map<string, number>()
  // defaultLimitOhm 仅为无装置上下文的调用方提供预览兜底；实际默认限值在入库时重算
  void defaultLimitOhm

  lines.forEach((line, index) => {
    const lineNo = index + 1
    // 逐分隔符切分并保留空单元（位置允许为空，故不能用 + 量词把连续分隔符合并）
    const cells = line.split(/[,，\t;；]/).map((cell) => cell.trim())
    if (cells.length < 3 || cells.length > 4) {
      errors.push(`第 ${lineNo} 行「${line}」需为「测点编号,位置,实测电阻[,限值]」3~4 列`)
      return
    }
    const code = cells[0]
    if (!code) {
      errors.push(`第 ${lineNo} 行「${line}」测点编号不能为空`)
      return
    }
    // 位置（cells[1]）允许为空字符串：入库时不抹掉台账原位置
    const measuredRaw = cells[2]
    const measuredOhm = Number(measuredRaw)
    if (measuredRaw === '' || !Number.isFinite(measuredOhm) || measuredOhm < 0) {
      errors.push(`第 ${lineNo} 行「${line}」实测电阻应为非负数字`)
      return
    }
    let limitOhm: number | null = null
    let limitSpecified = false
    if (cells.length === 4 && cells[3] !== '') {
      const parsedLimit = Number(cells[3])
      if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
        errors.push(`第 ${lineNo} 行「${line}」限值应为大于 0 的数字`)
        return
      }
      limitOhm = Number(parsedLimit.toFixed(3))
      limitSpecified = true
    }
    const codeKey = normalizePointCode(code)
    const firstLineNo = seenCodes.get(codeKey)
    if (firstLineNo !== undefined) {
      errors.push(
        `第 ${lineNo} 行编号「${code}」与第 ${firstLineNo} 行重复（编号去首尾空格、忽略大小写后相同）`
      )
      return
    }
    seenCodes.set(codeKey, lineNo)
    rows.push({
      code,
      location: cells[1],
      measuredOhm: Number(measuredOhm.toFixed(3)),
      limitOhm,
      limitSpecified,
      lineNo
    })
  })
  return { rows, errors, lineCount }
}
