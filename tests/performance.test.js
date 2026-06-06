const assert = require('assert')
const { performance } = require('perf_hooks')
const worktime = require('../utils/worktime')

function pad(value) {
  return value < 10 ? `0${value}` : String(value)
}

function buildLargeStore(years) {
  const store = worktime.createDefaultStore()
  for (let year = 2010; year < 2010 + years; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const monthKey = `${year}-${pad(month)}`
      store.months[monthKey] = {
        openingBalanceMinutes: null,
        entries: {}
      }
      for (let day = 1; day <= 28; day += 1) {
        store.months[monthKey].entries[`${monthKey}-${pad(day)}`] = {
          type: 'work',
          start: '09:30',
          end: '17:00',
          deductBreak: true
        }
      }
    }
  }
  return store
}

function measure(fn) {
  const start = performance.now()
  const result = fn()
  return {
    result,
    duration: performance.now() - start
  }
}

const largeStore = buildLargeStore(15)
largeStore.months['2030-01'] = {
  openingBalanceMinutes: null,
  entries: {
    '2030-01-01': {
      type: 'rest'
    }
  }
}
const viewTiming = measure(() => worktime.buildMonthView(largeStore, '2024-12'))
assert.strictEqual(viewTiming.result.rows.length, 31)
assert.ok(viewTiming.duration < 1000, `buildMonthView took ${Math.round(viewTiming.duration)}ms`)

const exportLines = worktime.buildExportLines(largeStore, '2010-01-01', '2030-12-31')
assert.ok(exportLines.length <= worktime.MAX_EXPORT_RANGE_DAYS)
assert.ok(exportLines.length > 300)
assert.ok(!exportLines.some((line) => line.indexOf(worktime.TYPE_LABELS.rest) !== -1))

console.log('performance tests passed')
