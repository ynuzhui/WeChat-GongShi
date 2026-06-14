const assert = require('assert')
const worktime = require('../utils/worktime')
const viewModel = require('../pages/index/view-model')

// ===== 日期胶囊标题:统一短格式(年份简写 + 星期) =====
assert.strictEqual(viewModel.buildDateTitle('2026-06-12'), '2026-06-12 周五')
assert.strictEqual(viewModel.buildDateTitle('2026-06-11'), '2026-06-11 周四')
assert.strictEqual(viewModel.buildDateTitle('2026-06-13'), '2026-06-13 周六')
assert.strictEqual(viewModel.buildDateTitle('2026-06-01'), '2026-06-01 周一')

// ===== 资产卡色调 =====
assert.strictEqual(viewModel.buildBalanceTone(90), 'is-positive')
assert.strictEqual(viewModel.buildBalanceTone(-30), 'is-negative')
assert.strictEqual(viewModel.buildBalanceTone(0), '')

// ===== 仪表盘整体状态 =====
// 2026-06-12 是周五；本周一为 06-08
let store = worktime.createDefaultStore()
store = worktime.setEntry(store, '2026-06-08', { type: 'work', start: '09:30', end: '18:30' })
store = worktime.setEntry(store, '2026-06-09', { type: 'rest' })
store = worktime.setEntry(store, '2026-06-10', { type: 'leave' })
store = worktime.setEntry(store, '2026-06-11', { type: 'work', start: '09:30', end: '17:00' })

const state = viewModel.buildDashboardState(store, '2026-06-12', '2026-06-12')

assert.strictEqual(state.dateTitle, '2026-06-12 周五')
assert.strictEqual(state.monthDeltaText, '-5.5')
assert.strictEqual(state.closingBalanceText, '-5.5')
assert.strictEqual(state.monthDeltaTone, 'is-negative')

// 周视图：+1.5 / 休 / 调 / 全 / 今天未记 / 空 / 空
assert.strictEqual(state.weekDays.length, 7)
assert.deepStrictEqual(
  state.weekDays.map((day) => day.dotText),
  ['+1.5', '休', '调', '全', '12', '13', '14']
)
assert.deepStrictEqual(
  state.weekDays.map((day) => day.dotTone),
  ['is-plus', 'is-rest', 'is-minus', 'is-full', 'is-empty', 'is-empty', 'is-empty']
)
assert.strictEqual(state.weekDays[4].isToday, true)
assert.strictEqual(state.weekDays[4].isSelected, true)
assert.strictEqual(state.weekDays[0].isToday, false)

// 近期出勤：选中日期前 5 天，最近在前
assert.strictEqual(state.recentRows.length, 5)
assert.deepStrictEqual(state.recentRows.map((row) => row.dateKey), [
  '2026-06-11',
  '2026-06-10',
  '2026-06-09',
  '2026-06-08',
  '2026-06-07'
])
assert.strictEqual(state.recentRows[0].dateLabel, '06-11 周四')
assert.strictEqual(state.recentRows[0].content, '09:30-17:00')
assert.strictEqual(state.recentRows[0].contentTone, 'is-time')
assert.strictEqual(state.recentRows[0].diffText, '全天')
assert.strictEqual(state.recentRows[1].content, '调休')
assert.strictEqual(state.recentRows[1].diffText, '-7h')
assert.strictEqual(state.recentRows[2].content, '本休')
assert.strictEqual(state.recentRows[2].diffText, '')
assert.strictEqual(state.recentRows[3].diffText, '+1.5h')
assert.strictEqual(state.recentRows[4].content, '未记录')

// 当日看板：今天未记录，时间位显示“点击填写”
assert.strictEqual(state.boardLabel, '今日出勤')
assert.strictEqual(state.boardTimeText, '点击填写')
assert.strictEqual(state.boardFilled, false)
assert.strictEqual(state.boardDiffText, '-')

// 一键复用：上次班次取 06-11 的记录
assert.strictEqual(state.lastShiftLabel, '09:30-17:00')

// 本月摘要
assert.strictEqual(state.stats.workCount, 2)
assert.strictEqual(state.stats.restCount, 1)
assert.strictEqual(state.stats.leaveCount, 1)
assert.strictEqual(state.stats.missingCount, 26)

// 选中非今天：看板取当日记录并显示差额
const pastState = viewModel.buildDashboardState(store, '2026-06-08', '2026-06-12')
assert.strictEqual(pastState.boardLabel, '当日出勤')
assert.strictEqual(pastState.boardTimeText, '09:30-18:30')
assert.strictEqual(pastState.boardFilled, true)
assert.strictEqual(pastState.boardDiffText, '+1.5h')
assert.strictEqual(pastState.boardDiffTone, 'is-plus')

// 本休日看板
const restState = viewModel.buildDashboardState(store, '2026-06-09', '2026-06-12')
assert.strictEqual(restState.boardTimeText, '本休')
assert.strictEqual(restState.boardDiffText, '无')

// 调休日看板
const leaveState = viewModel.buildDashboardState(store, '2026-06-10', '2026-06-12')
assert.strictEqual(leaveState.boardTimeText, '调休')
assert.strictEqual(leaveState.boardDiffText, '-7h')
assert.strictEqual(leaveState.boardDiffTone, 'is-minus')

console.log('index page tests passed')
