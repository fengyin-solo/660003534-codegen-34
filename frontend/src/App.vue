<template>
  <div class="min-h-screen bg-slate-900 text-slate-200">
    <header class="border-b border-slate-700 px-6 py-4">
      <h1 class="text-2xl font-bold text-cyan-400">SQL 查询可视化与执行计划分析器</h1>
      <p class="text-sm text-slate-500 mt-1">SQL语法解析 · 执行计划树 · ER图 · 复杂度评分 · 优化建议 · 优化前后快照对比</p>
    </header>
    <div class="flex flex-col lg:flex-row gap-4 p-4">
      <div class="lg:w-2/5 space-y-4">
        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-bold text-slate-400">SQL 编辑器</h3>
            <div class="flex gap-2">
              <select @change="(e) => { store.sql = SQL_TEMPLATES[+(e.target as HTMLSelectElement).value].sql }" class="text-xs bg-slate-900 border border-slate-600 rounded px-2 py-1 text-slate-300">
                <option v-for="(t, i) in SQL_TEMPLATES" :key="i" :value="i">{{ t.name }}</option>
              </select>
            </div>
          </div>
          <textarea v-model="store.sql" rows="12" class="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm font-mono text-green-400 focus:outline-none focus:border-cyan-500 resize-none"></textarea>
          <button @click="store.analyze" class="w-full mt-3 py-2 bg-cyan-600 hover:bg-cyan-500 rounded text-sm font-bold">分析查询</button>
          <div class="flex gap-2 mt-2">
            <button @click="saveAs('before')" class="flex-1 py-1.5 bg-blue-900/40 hover:bg-blue-900/70 border border-blue-700 rounded text-xs text-blue-300">📷 存为优化前快照</button>
            <button @click="saveAs('after')" class="flex-1 py-1.5 bg-green-900/40 hover:bg-green-900/70 border border-green-700 rounded text-xs text-green-300">📷 存为优化后快照</button>
          </div>
        </div>
        <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 class="text-sm font-bold text-slate-400 mb-3">数据库 Schema</h3>
          <div class="space-y-2">
            <div v-for="t in SCHEMA_TABLES" :key="t.name" @click="store.activeSchema = store.activeSchema?.name === t.name ? null : t"
              :class="['cursor-pointer rounded border p-2 text-xs transition-all', store.activeSchema?.name === t.name ? 'border-cyan-500 bg-cyan-900/20' : 'border-slate-700 hover:border-slate-500']">
              <div class="flex justify-between items-center">
                <span class="font-bold text-slate-200">{{ t.name }}</span>
                <span class="text-slate-500">{{ t.rowCount.toLocaleString() }} 行</span>
              </div>
              <div v-if="store.activeSchema?.name === t.name" class="mt-2 space-y-0.5">
                <div v-for="c in t.columns" :key="c.name" class="flex gap-2">
                  <span :class="c.pk ? 'text-yellow-400' : c.fk ? 'text-blue-400' : 'text-slate-400'">{{ c.pk ? '🔑 ' : c.fk ? '🔗 ' : '  ' }}{{ c.name }}</span>
                  <span class="text-slate-600">{{ c.type }}</span>
                  <span v-if="c.fk" class="text-blue-600">→ {{ c.fk }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="lg:w-3/5 space-y-4">
        <div v-if="store.parsed" class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 class="text-sm font-bold text-slate-400 mb-3">查询解析结果</h3>
          <div class="grid grid-cols-4 gap-3 text-sm mb-4">
            <div class="bg-slate-900 rounded p-2 text-center"><div class="text-xs text-slate-500 mb-1">类型</div><div class="text-cyan-400 font-bold">{{ store.parsed.type }}</div></div>
            <div class="bg-slate-900 rounded p-2 text-center"><div class="text-xs text-slate-500 mb-1">复杂度</div><div class="font-bold" :class="store.complexityLabel.color">{{ store.complexityLabel.label }}</div></div>
            <div class="bg-slate-900 rounded p-2 text-center"><div class="text-xs text-slate-500 mb-1">JOIN数</div><div class="text-orange-400 font-bold">{{ store.parsed.joins.length }}</div></div>
            <div class="bg-slate-900 rounded p-2 text-center"><div class="text-xs text-slate-500 mb-1">预估行数</div><div class="text-purple-400 font-bold">{{ store.parsed.estimatedCost }}</div></div>
          </div>
          <div v-if="store.parsed.suggestions.length" class="space-y-1">
            <div class="text-xs text-slate-500 mb-1">优化建议</div>
            <div v-for="(s, i) in store.parsed.suggestions" :key="i" class="text-xs flex items-start gap-2 bg-orange-900/30 border border-orange-700 rounded p-2">
              <span class="text-orange-400">⚠</span><span class="text-orange-300">{{ s }}</span>
            </div>
          </div>
          <div v-else class="text-xs text-green-400 bg-green-900/20 border border-green-700 rounded p-2">✓ 未发现明显性能问题</div>
        </div>
        <div v-if="store.plan" class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 class="text-sm font-bold text-slate-400 mb-3">执行计划树</h3>
          <div class="overflow-x-auto">
            <div class="font-mono text-xs text-slate-300 space-y-1">
              <PlanNode :node="store.plan" :depth="0" />
            </div>
          </div>
        </div>
        <div v-if="store.parsed" class="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <h3 class="text-sm font-bold text-slate-400 mb-3">涉及表与关联关系</h3>
          <canvas ref="erCanvasRef" class="w-full bg-slate-900 rounded" style="height:200px"></canvas>
        </div>
      </div>
    </div>
    <div class="px-4 pb-4">
      <div class="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-bold text-slate-400">优化前后快照对比</h3>
          <span class="text-xs text-slate-500">{{ store.snapshots.length }} 个快照 · 本地持久化</span>
        </div>
        <div v-if="!store.snapshots.length" class="text-xs text-slate-500 border border-dashed border-slate-600 rounded p-4 text-center">
          暂无快照：点击「分析查询」后保存优化前快照，调整 SQL 再次分析并保存优化后快照，即可在此对比优化效果。
        </div>
        <div v-else class="flex flex-col lg:flex-row gap-4">
          <div class="lg:w-2/5 space-y-2 max-h-96 overflow-y-auto pr-1">
            <div v-for="s in sortedSnapshots" :key="s.id"
              :class="['bg-slate-900 rounded border p-2 text-xs', s.id === store.compareBeforeId ? 'border-blue-500' : s.id === store.compareAfterId ? 'border-green-500' : 'border-slate-700']">
              <div class="flex items-center justify-between">
                <span class="font-bold text-slate-200">{{ s.label }}</span>
                <span class="text-slate-500">{{ fmtTime(s.createdAt) }}</span>
              </div>
              <div class="font-mono text-slate-500 truncate mt-1">{{ oneLine(s.sql) }}</div>
              <div class="flex gap-3 mt-1">
                <span class="text-slate-500">复杂度 <b :class="complexityTagCls(s.parsed.complexity)">{{ s.parsed.complexity }}</b></span>
                <span class="text-slate-500">预估行数 <b class="text-purple-400">{{ s.parsed.estimatedCost.toLocaleString() }}</b></span>
                <span class="text-slate-500">建议 <b class="text-orange-400">{{ s.parsed.suggestions.length }}</b></span>
              </div>
              <div class="flex gap-1.5 mt-2">
                <button @click="store.compareBeforeId = s.id" :class="markBtnClass(s.id === store.compareBeforeId, 'before')">优化前</button>
                <button @click="store.compareAfterId = s.id" :class="markBtnClass(s.id === store.compareAfterId, 'after')">优化后</button>
                <button @click="store.loadSnapshot(s.id)" class="px-2 py-0.5 rounded border border-slate-600 bg-slate-800 text-slate-400 hover:border-slate-400">载入</button>
                <button @click="store.deleteSnapshot(s.id)" class="px-2 py-0.5 rounded border border-slate-600 bg-slate-800 text-slate-500 hover:border-red-500 hover:text-red-400">删除</button>
              </div>
            </div>
          </div>
          <div class="lg:w-3/5">
            <div v-if="comparison && beforeSnapshot && afterSnapshot">
              <div class="flex items-center gap-2 text-xs mb-2">
                <span class="px-1.5 py-0.5 rounded bg-blue-900/40 border border-blue-700 text-blue-300">优化前 · {{ beforeSnapshot.label }}</span>
                <span class="text-slate-600">→</span>
                <span class="px-1.5 py-0.5 rounded bg-green-900/40 border border-green-700 text-green-300">优化后 · {{ afterSnapshot.label }}</span>
              </div>
              <div :class="['rounded border p-2 text-xs font-bold mb-3', verdict.cls]">{{ verdict.text }}</div>
              <div class="grid grid-cols-3 gap-2 text-xs mb-3">
                <div v-for="m in metricRows" :key="m.label" class="bg-slate-900 rounded p-2 text-center">
                  <div class="text-slate-500 mb-1">{{ m.label }}</div>
                  <div class="font-bold">
                    <span class="text-slate-400">{{ fmtMetric(m.before) }}</span>
                    <span class="text-slate-600 mx-1">→</span>
                    <span :class="m.neutral ? 'text-slate-300' : deltaCls(m.before, m.after)">{{ fmtMetric(m.after) }}</span>
                  </div>
                  <div :class="m.neutral ? 'text-slate-600' : deltaCls(m.before, m.after)">{{ deltaText(m.before, m.after) }}</div>
                </div>
              </div>
              <div v-if="comparison.resolved.length" class="space-y-1 mb-2">
                <div class="text-xs text-slate-500">已解决的问题</div>
                <div v-for="(s, i) in comparison.resolved" :key="'r' + i" class="text-xs flex items-start gap-2 bg-green-900/20 border border-green-700 rounded p-2">
                  <span class="text-green-400">✓</span><span class="text-green-300">{{ s }}</span>
                </div>
              </div>
              <div v-if="comparison.introduced.length" class="space-y-1">
                <div class="text-xs text-slate-500">新出现的问题</div>
                <div v-for="(s, i) in comparison.introduced" :key="'n' + i" class="text-xs flex items-start gap-2 bg-orange-900/30 border border-orange-700 rounded p-2">
                  <span class="text-orange-400">⚠</span><span class="text-orange-300">{{ s }}</span>
                </div>
              </div>
              <div v-if="!comparison.resolved.length && !comparison.introduced.length" class="text-xs text-slate-500 bg-slate-900 rounded p-2">优化建议无变化</div>
            </div>
            <div v-else class="h-full min-h-[120px] flex items-center justify-center text-xs text-slate-500 border border-dashed border-slate-700 rounded p-4 text-center">
              在左侧列表中为快照标记「优化前」「优化后」，<br/>即可查看调整前后的效果差异
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, defineComponent, h, computed } from 'vue'
import { useSQLStore, SQL_TEMPLATES, SCHEMA_TABLES } from './store/sql'

const store = useSQLStore()
const erCanvasRef = ref<HTMLCanvasElement | null>(null)

const comparison = computed(() => store.comparison)
const beforeSnapshot = computed(() => store.beforeSnapshot)
const afterSnapshot = computed(() => store.afterSnapshot)
const sortedSnapshots = computed(() => [...store.snapshots].reverse())

function saveAs(kind: 'before' | 'after') {
  const snap = store.saveSnapshot(kind === 'before' ? '优化前' : '优化后')
  if (kind === 'before') store.compareBeforeId = snap.id
  else store.compareAfterId = snap.id
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function oneLine(sql: string) {
  return sql.replace(/\s+/g, ' ').trim()
}

function complexityTagCls(c: number) {
  if (c <= 2) return 'text-green-400'
  if (c <= 5) return 'text-yellow-400'
  if (c <= 8) return 'text-orange-400'
  return 'text-red-400'
}

function markBtnClass(active: boolean, kind: 'before' | 'after') {
  const base = 'px-2 py-0.5 rounded border '
  if (!active) return base + 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-400'
  return base + (kind === 'before'
    ? 'bg-blue-900/50 border-blue-500 text-blue-300'
    : 'bg-green-900/50 border-green-500 text-green-300')
}

function fmtMetric(n: number) {
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1)
}

function deltaCls(before: number, after: number) {
  if (after < before) return 'text-green-400'
  if (after > before) return 'text-red-400'
  return 'text-slate-500'
}

function deltaText(before: number, after: number) {
  const d = after - before
  if (d === 0) return '持平'
  return (d > 0 ? '+' : '') + (Number.isInteger(d) ? d : d.toFixed(1))
}

const metricRows = computed<{ label: string; before: number; after: number; neutral?: boolean }[]>(() => {
  const c = store.comparison
  if (!c) return []
  return [
    { label: '复杂度', before: c.complexity.before, after: c.complexity.after },
    { label: '预估行数', before: c.estimatedCost.before, after: c.estimatedCost.after },
    { label: '计划成本', before: c.planCost.before, after: c.planCost.after },
    { label: 'JOIN 数', before: c.joins.before, after: c.joins.after },
    { label: 'WHERE 条件', before: c.whereConditions.before, after: c.whereConditions.after, neutral: true },
    { label: '优化建议', before: c.suggestions.before, after: c.suggestions.after },
  ]
})

const verdict = computed(() => {
  const c = store.comparison
  if (!c) return { text: '', cls: '' }
  const pct = c.estimatedCost.pct
  if (pct < 0) return { text: `✓ 预估成本下降 ${-pct}%，优化有效`, cls: 'bg-green-900/30 border-green-700 text-green-300' }
  if (pct > 0) return { text: `✗ 预估成本上升 ${pct}%，优化可能适得其反`, cls: 'bg-red-900/30 border-red-700 text-red-300' }
  return { text: '预估成本基本持平', cls: 'bg-slate-900 border-slate-600 text-slate-400' }
})

const PlanNode = defineComponent({
  props: { node: Object, depth: Number },
  setup(props) {
    return () => {
      if (!props.node) return null
      const n = props.node as any
      const indent = '  '.repeat(props.depth || 0)
      const opColor = n.operation.includes('Scan') ? '#22c55e' : n.operation.includes('Join') ? '#f97316' : n.operation.includes('Sort') ? '#8b5cf6' : '#06b6d4'
      return h('div', [
        h('div', { style: `padding-left: ${(props.depth || 0) * 20}px` }, [
          h('span', { style: 'color: #475569' }, indent.replace(/\s\s/g, '│ ').replace(/│ $/, '└─')),
          h('span', { style: `color: ${opColor}; font-weight: bold` }, n.operation),
          n.table ? h('span', { style: 'color: #94a3b8' }, ` on ${n.table}`) : null,
          n.index ? h('span', { style: 'color: #eab308' }, ` [${n.index}]`) : null,
          h('span', { style: 'color: #64748b' }, ` cost=${n.cost.toFixed(1)} rows=${n.rows}`),
        ]),
        ...(n.children || []).map((child: any) => h(PlanNode, { node: child, depth: (props.depth || 0) + 1 }))
      ])
    }
  }
})

function drawER() {
  const canvas = erCanvasRef.value
  if (!canvas || !store.parsed) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const tables = store.parsed.tables
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  canvas.width = canvas.clientWidth
  canvas.height = 200
  const W = canvas.width, H = 200
  const spacing = W / (tables.length + 1)
  const positions: Record<string, { x: number; y: number }> = {}
  tables.forEach((t, i) => { positions[t] = { x: spacing * (i + 1), y: H / 2 } })

  // Draw joins
  store.parsed.joins.forEach(j => {
    const src = positions[tables[0]]
    const dst = positions[j.table]
    if (!src || !dst) return
    ctx.beginPath()
    ctx.moveTo(src.x, src.y)
    ctx.lineTo(dst.x, dst.y)
    ctx.strokeStyle = '#f97316'
    ctx.lineWidth = 2
    ctx.setLineDash([4, 4])
    ctx.stroke()
    ctx.setLineDash([])
    const mx = (src.x + dst.x) / 2, my = (src.y + dst.y) / 2
    ctx.fillStyle = '#f97316'
    ctx.font = '10px monospace'
    ctx.textAlign = 'center'
    ctx.fillText(j.type, mx, my - 5)
  })

  // Draw table boxes
  tables.forEach((t, i) => {
    const pos = positions[t]
    if (!pos) return
    const x = pos.x, y = pos.y
    ctx.fillStyle = '#1e293b'
    ctx.strokeStyle = '#3b82f6'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(x - 50, y - 30, 100, 60, 6)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#06b6d4'
    ctx.font = 'bold 13px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(t, x, y - 10)
    const schema = SCHEMA_TABLES.find(s => s.name === t)
    if (schema) {
      ctx.fillStyle = '#64748b'
      ctx.font = '10px monospace'
      ctx.fillText(schema.rowCount.toLocaleString() + ' rows', x, y + 10)
    }
  })
}

onMounted(() => { store.analyze(); setTimeout(drawER, 200) })
watch(() => store.parsed, () => setTimeout(drawER, 100), { deep: true })
</script>
