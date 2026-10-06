/**
 * useIdbTable：Dexie 单表增删改查 + 响应式订阅封装。
 * 内部用 Svelte store（writable）暴露响应式数据，被全部页面消费；
 * 页面统一通过它读写 IndexedDB，避免组件内部直接触碰 Dexie 实例。
 */
import { get, writable, type Writable } from 'svelte/store'
import { liveQuery, type Table } from 'dexie'
import { createId, db } from '$lib/utils/db'

/** 所有持久化实体的公共字段 */
export interface IdbRecord {
  id: string
  createdAt?: number
  updatedAt?: number
}

/** 新增记录入参：id 与时间戳由封装层补齐 */
export type NewRecord<T extends IdbRecord> = Omit<T, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string
  createdAt?: number
  updatedAt?: number
}

export interface UseIdbTableOptions<T extends IdbRecord> {
  /** 是否按 updatedAt 倒序，默认 true */
  sortByUpdatedAt?: boolean
  /** 数据变化后的额外回调 */
  onChange?: (rows: T[]) => void
}

export interface UseIdbTableResult<T extends IdbRecord> {
  /** 响应式行集合，页面用 $rows 订阅 */
  rows: Writable<T[]>
  /** 是否已完成首次载入：用于区分「数据为空」与「尚未读取」 */
  ready: Writable<boolean>
  loading: Writable<boolean>
  error: Writable<string | null>
  refresh: () => Promise<void>
  /** 停止 liveQuery 订阅 */
  stop: () => void
  getById: (id: string) => Promise<T | undefined>
  list: () => Promise<T[]>
  create: (payload: NewRecord<T>, idPrefix?: string) => Promise<T>
  update: (id: string, patch: Partial<T>) => Promise<void>
  upsert: (row: T) => Promise<void>
  remove: (id: string) => Promise<void>
  bulkRemove: (ids: string[]) => Promise<void>
  bulkPut: (list: T[]) => Promise<void>
  clear: () => Promise<void>
}

/**
 * @param tableSelector 从 Dexie 实例取表的函数，例如 (database) => database.buildings
 */
export function useIdbTable<T extends IdbRecord>(
  tableSelector: (database: typeof db) => Table<T, string>,
  options: UseIdbTableOptions<T> = {}
): UseIdbTableResult<T> {
  const { sortByUpdatedAt = true, onChange } = options
  const table = tableSelector(db)

  const rows = writable<T[]>([])
  const ready = writable(false)
  const loading = writable(false)
  const error = writable<string | null>(null)

  const applySort = (list: T[]): T[] => {
    if (!sortByUpdatedAt) return [...list]
    return [...list].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  }

  const observable = liveQuery(async () => applySort(await table.toArray()))
  const subscription = observable.subscribe({
    next: (list) => {
      rows.set(list)
      ready.set(true)
      error.set(null)
      onChange?.(list)
    },
    error: (err: unknown) => {
      error.set(err instanceof Error ? err.message : '订阅本地数据失败')
    }
  })

  const refresh = async (): Promise<void> => {
    loading.set(true)
    try {
      const list = applySort(await table.toArray())
      rows.set(list)
      ready.set(true)
      error.set(null)
      onChange?.(list)
    } catch (err) {
      error.set(err instanceof Error ? err.message : '读取本地数据失败')
    } finally {
      loading.set(false)
    }
  }

  const stop = (): void => {
    subscription.unsubscribe()
  }

  const create = async (payload: NewRecord<T>, idPrefix = 'row'): Promise<T> => {
    const now = Date.now()
    const record = {
      ...(payload as object),
      id: payload.id ?? createId(idPrefix),
      createdAt: payload.createdAt ?? now,
      updatedAt: payload.updatedAt ?? now
    } as T
    await table.put(record)
    return record
  }

  const update = async (id: string, patch: Partial<T>): Promise<void> => {
    await table.update(id, { ...patch, updatedAt: Date.now() } as never)
  }

  const upsert = async (row: T): Promise<void> => {
    await table.put({ ...row, updatedAt: Date.now() } as T)
  }

  const remove = async (id: string): Promise<void> => {
    await table.delete(id)
  }

  const bulkRemove = async (ids: string[]): Promise<void> => {
    await table.bulkDelete(ids)
  }

  const bulkPut = async (list: T[]): Promise<void> => {
    await table.bulkPut(list)
  }

  const clear = async (): Promise<void> => {
    await table.clear()
  }

  void refresh()

  return {
    rows,
    ready,
    loading,
    error,
    refresh,
    stop,
    getById: (id: string) => table.get(id),
    list: () => table.toArray(),
    create,
    update,
    upsert,
    remove,
    bulkRemove,
    bulkPut,
    clear
  }
}

/** 读取当前行集合的快照（非订阅场景使用） */
export function snapshotRows<T>(store: Writable<T[]>): T[] {
  return get(store)
}
