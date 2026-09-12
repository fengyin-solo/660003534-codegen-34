import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'

export interface SQLTable {
  name: string
  columns: { name: string; type: string; pk?: boolean; fk?: string }[]
  rowCount: number
}

export interface QueryPlan {
  operation: string
  table?: string
  cost: number
  rows: number
  children: QueryPlan[]
  index?: string
  filter?: string
}

export interface ParsedQuery {
  type: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'CREATE' | 'UNKNOWN'
  tables: string[]
  columns: string[]
  joins: { type: string; table: string; condition: string }[]
  whereConditions: string[]
  orderBy: string[]
  groupBy: string[]
  limit?: number
  complexity: number
  suggestions: string[]
  estimatedCost: number
}

export interface Snapshot {
  id: string
  label: string
  sql: string
  parsed: ParsedQuery
  plan: QueryPlan
  createdAt: number
}

export interface SnapshotComparison {
  complexity: { before: number; after: number }
  estimatedCost: { before: number; after: number; pct: number }
  planCost: { before: number; after: number; pct: number }
  joins: { before: number; after: number }
  whereConditions: { before: number; after: number }
  suggestions: { before: number; after: number }
  resolved: string[]
  introduced: string[]
}

const SCHEMA: SQLTable[] = [
  { name: 'users', rowCount: 50000, columns: [
    { name: 'id', type: 'INT', pk: true }, { name: 'username', type: 'VARCHAR(50)' },
    { name: 'email', type: 'VARCHAR(100)' }, { name: 'created_at', type: 'TIMESTAMP' },
    { name: 'status', type: 'ENUM' }
  ]},
  { name: 'orders', rowCount: 200000, columns: [
    { name: 'id', type: 'INT', pk: true }, { name: 'user_id', type: 'INT', fk: 'users.id' },
    { name: 'product_id', type: 'INT', fk: 'products.id' }, { name: 'amount', type: 'DECIMAL' },
    { name: 'status', type: 'VARCHAR(20)' }, { name: 'created_at', type: 'TIMESTAMP' }
  ]},
  { name: 'products', rowCount: 10000, columns: [
    { name: 'id', type: 'INT', pk: true }, { name: 'name', type: 'VARCHAR(200)' },
    { name: 'price', type: 'DECIMAL' }, { name: 'category_id', type: 'INT', fk: 'categories.id' },
    { name: 'stock', type: 'INT' }
  ]},
  { name: 'categories', rowCount: 100, columns: [
    { name: 'id', type: 'INT', pk: true }, { name: 'name', type: 'VARCHAR(50)' },
    { name: 'parent_id', type: 'INT' }
  ]},
]

function parseSQL(sql: string): ParsedQuery {
  const up = sql.toUpperCase().trim()
  const type = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE'].find(t => up.startsWith(t)) as ParsedQuery['type'] || 'UNKNOWN'
  const tables = Array.from(sql.matchAll(/(?:FROM|JOIN|INTO|UPDATE)\s+([a-zA-Z_]\w*)/gi)).map(m => m[1].toLowerCase())
  const columns = type === 'SELECT' ? (sql.match(/SELECT\s+([\s\S]*?)\s+FROM/i)?.[1]?.split(',').map(s => s.trim()) || []) : []
  const joins = Array.from(sql.matchAll(/(LEFT|RIGHT|INNER|OUTER|CROSS|FULL)?\s*JOIN\s+([a-zA-Z_]\w*)\s+ON\s+([^JOIN|WHERE|GROUP|ORDER|LIMIT]+)/gi)).map(m => ({ type: (m[1] || 'INNER').trim(), table: m[2], condition: m[3].trim() }))
  const whereMatch = sql.match(/WHERE\s+([\s\S]*?)(?:GROUP|ORDER|LIMIT|$)/i)
  const whereConditions = whereMatch ? whereMatch[1].split(/\s+AND\s+|\s+OR\s+/i).map(s => s.trim()).filter(Boolean) : []
  const orderBy = sql.match(/ORDER\s+BY\s+([\s\S]*?)(?:LIMIT|$)/i)?.[1]?.split(',').map(s => s.trim()) || []
  const groupBy = sql.match(/GROUP\s+BY\s+([\s\S]*?)(?:HAVING|ORDER|LIMIT|$)/i)?.[1]?.split(',').map(s => s.trim()) || []
  const limitMatch = sql.match(/LIMIT\s+(\d+)/i)
  const limit = limitMatch ? parseInt(limitMatch[1]) : undefined

  const complexity = tables.length + joins.length * 2 + whereConditions.length + orderBy.length + (sql.includes('DISTINCT') ? 3 : 0) + (sql.includes('HAVING') ? 2 : 0)
  const estimatedCost = tables.reduce((sum, t) => { const tbl = SCHEMA.find(s => s.name === t); return sum + (tbl?.rowCount || 1000) }, 0) * (joins.length + 1) / (limit || 100)

  const suggestions: string[] = []
  if (joins.length > 3) suggestions.push('连接表过多（>3），考虑分解查询')
  if (!whereConditions.length && type === 'SELECT') suggestions.push('无 WHERE 条件，将扫描全表')
  if (sql.includes('SELECT *')) suggestions.push('避免 SELECT *，明确指定列名')
  if (sql.toUpperCase().includes("LIKE '%")) suggestions.push("前缀通配符 LIKE '%...' 无法使用索引")
  if (!limit && type === 'SELECT') suggestions.push('建议添加 LIMIT 限制结果集大小')

  return { type, tables, columns, joins, whereConditions, orderBy, groupBy, limit, complexity, suggestions, estimatedCost: Math.round(estimatedCost) }
}

function buildPlan(parsed: ParsedQuery): QueryPlan {
  if (parsed.tables.length === 0) return { operation: 'EMPTY', cost: 0, rows: 0, children: [] }
  const tableScans: QueryPlan[] = parsed.tables.map(t => {
    const tbl = SCHEMA.find(s => s.name === t)
    return { operation: parsed.whereConditions.length > 0 ? 'Index Scan' : 'Seq Scan', table: t, cost: (tbl?.rowCount || 1000) * 0.01, rows: Math.round((tbl?.rowCount || 1000) * (parsed.whereConditions.length > 0 ? 0.1 : 1)), children: [], index: parsed.whereConditions.length > 0 ? 'idx_' + t + '_id' : undefined }
  })
  if (tableScans.length === 1) {
    const root: QueryPlan = { operation: 'Sort', cost: tableScans[0].cost * 1.2, rows: tableScans[0].rows, children: [tableScans[0]] }
    return root
  }
  const join: QueryPlan = { operation: 'Hash Join', cost: tableScans.reduce((s, n) => s + n.cost, 0) * 1.5, rows: Math.round(tableScans[0].rows * 0.5), children: tableScans, filter: parsed.joins[0]?.condition }
  return { operation: parsed.orderBy.length ? 'Sort' : 'Result', cost: join.cost * 1.1, rows: join.rows, children: [join] }
}

export const SQL_TEMPLATES = [
  { name: '基础查询', sql: `SELECT id, username, email
FROM users
WHERE status = 'active'
LIMIT 100;` },
  { name: '多表JOIN', sql: `SELECT u.username, o.id AS order_id, p.name AS product, o.amount
FROM users u
INNER JOIN orders o ON u.id = o.user_id
INNER JOIN products p ON o.product_id = p.id
WHERE o.status = 'completed'
ORDER BY o.created_at DESC
LIMIT 50;` },
  { name: '聚合分析', sql: `SELECT c.name AS category, COUNT(o.id) AS order_count, SUM(o.amount) AS revenue, AVG(o.amount) AS avg_amount
FROM categories c
LEFT JOIN products p ON c.id = p.category_id
LEFT JOIN orders o ON p.id = o.product_id
GROUP BY c.id, c.name
HAVING COUNT(o.id) > 10
ORDER BY revenue DESC;` },
  { name: '子查询', sql: `SELECT username, email
FROM users
WHERE id IN (
  SELECT DISTINCT user_id
  FROM orders
  WHERE amount > 1000
  AND created_at >= '2024-01-01'
)
ORDER BY username;` },
  { name: '全表扫描', sql: `SELECT *
FROM orders
WHERE YEAR(created_at) = 2024;` },
]

export const SCHEMA_TABLES = SCHEMA

const SNAPSHOTS_KEY = 'sql-visualizer:snapshots'
const COMPARE_KEY = 'sql-visualizer:compare'

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function pctChange(from: number, to: number): number {
  if (from === 0) return to === 0 ? 0 : 100
  return Math.round(((to - from) / from) * 100)
}

export const useSQLStore = defineStore('sql', () => {
  const sql = ref(SQL_TEMPLATES[0].sql)
  const parsed = ref<ParsedQuery | null>(null)
  const plan = ref<QueryPlan | null>(null)
  const activeSchema = ref<SQLTable | null>(null)

  // 优化前后快照：持久化到 localStorage，刷新后仍可回顾
  const snapshots = ref<Snapshot[]>(loadJSON(SNAPSHOTS_KEY, []))
  const savedCompare = loadJSON<{ before: string | null; after: string | null }>(COMPARE_KEY, { before: null, after: null })
  const compareBeforeId = ref<string | null>(savedCompare.before)
  const compareAfterId = ref<string | null>(savedCompare.after)

  watch(snapshots, val => localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(val)), { deep: true })
  watch([compareBeforeId, compareAfterId], ([before, after]) => {
    localStorage.setItem(COMPARE_KEY, JSON.stringify({ before, after }))
  })

  function analyze() {
    parsed.value = parseSQL(sql.value)
    plan.value = buildPlan(parsed.value)
  }

  function saveSnapshot(label = ''): Snapshot {
    if (!parsed.value || !plan.value) analyze()
    const snap: Snapshot = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: label.trim() || `快照 ${snapshots.value.length + 1}`,
      sql: sql.value,
      parsed: JSON.parse(JSON.stringify(parsed.value)),
      plan: JSON.parse(JSON.stringify(plan.value)),
      createdAt: Date.now(),
    }
    snapshots.value.push(snap)
    return snap
  }

  function deleteSnapshot(id: string) {
    snapshots.value = snapshots.value.filter(s => s.id !== id)
    if (compareBeforeId.value === id) compareBeforeId.value = null
    if (compareAfterId.value === id) compareAfterId.value = null
  }

  function loadSnapshot(id: string) {
    const snap = snapshots.value.find(s => s.id === id)
    if (!snap) return
    sql.value = snap.sql
    analyze()
  }

  const beforeSnapshot = computed(() => snapshots.value.find(s => s.id === compareBeforeId.value) || null)
  const afterSnapshot = computed(() => snapshots.value.find(s => s.id === compareAfterId.value) || null)

  const comparison = computed<SnapshotComparison | null>(() => {
    const b = beforeSnapshot.value
    const a = afterSnapshot.value
    if (!b || !a) return null
    return {
      complexity: { before: b.parsed.complexity, after: a.parsed.complexity },
      estimatedCost: { before: b.parsed.estimatedCost, after: a.parsed.estimatedCost, pct: pctChange(b.parsed.estimatedCost, a.parsed.estimatedCost) },
      planCost: { before: b.plan.cost, after: a.plan.cost, pct: pctChange(b.plan.cost, a.plan.cost) },
      joins: { before: b.parsed.joins.length, after: a.parsed.joins.length },
      whereConditions: { before: b.parsed.whereConditions.length, after: a.parsed.whereConditions.length },
      suggestions: { before: b.parsed.suggestions.length, after: a.parsed.suggestions.length },
      resolved: b.parsed.suggestions.filter(s => !a.parsed.suggestions.includes(s)),
      introduced: a.parsed.suggestions.filter(s => !b.parsed.suggestions.includes(s)),
    }
  })

  const complexityLabel = computed(() => {
    const c = parsed.value?.complexity || 0
    if (c <= 2) return { label: '简单', color: 'text-green-400' }
    if (c <= 5) return { label: '中等', color: 'text-yellow-400' }
    if (c <= 8) return { label: '复杂', color: 'text-orange-400' }
    return { label: '非常复杂', color: 'text-red-400' }
  })

  return {
    sql, parsed, plan, activeSchema, complexityLabel, analyze,
    snapshots, compareBeforeId, compareAfterId,
    beforeSnapshot, afterSnapshot, comparison,
    saveSnapshot, deleteSnapshot, loadSnapshot,
  }
})
