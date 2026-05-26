const time = require('./time')
const model = require('./model')

function shouldDeductBreak(startMinutes, endMinutes, settings) {
  const startLimit = time.parseTime(settings.breakStartLimit)
  const endLimit = time.parseTime(settings.breakEndLimit)
  return startMinutes <= startLimit && endMinutes >= endLimit
}

function calculateBreakDeduction(entry, start, end, settings) {
  if (typeof entry.deductBreak === 'boolean') {
    return entry.deductBreak ? settings.breakMinutes : 0
  }
  return shouldDeductBreak(start, end, settings) ? settings.breakMinutes : 0
}

function calculateEntry(entry, settingsInput) {
  const settings = model.normalizeSettings(settingsInput)
  if (!entry || !entry.type) {
    return {
      valid: true,
      type: '',
      workedMinutes: 0,
      breakDeducted: 0,
      diffMinutes: 0,
      label: '未记录'
    }
  }

  if (entry.type === model.DAY_TYPES.REST) {
    return {
      valid: true,
      type: entry.type,
      workedMinutes: 0,
      breakDeducted: 0,
      diffMinutes: 0,
      label: model.TYPE_LABELS.rest
    }
  }

  if (entry.type === model.DAY_TYPES.LEAVE) {
    return {
      valid: true,
      type: entry.type,
      workedMinutes: 0,
      breakDeducted: 0,
      diffMinutes: -settings.standardMinutes,
      label: model.TYPE_LABELS.leave
    }
  }

  const start = time.adjustTimeForCalculation(time.parseTime(entry.start))
  const end = time.adjustTimeForCalculation(time.parseTime(entry.end))
  if (start === null || end === null || end <= start) {
    return {
      valid: false,
      type: model.DAY_TYPES.WORK,
      workedMinutes: 0,
      breakDeducted: 0,
      diffMinutes: 0,
      label: '时间不完整',
      error: '上班时间需要早于下班时间'
    }
  }

  const breakDeducted = calculateBreakDeduction(entry, start, end, settings)
  const workedMinutes = Math.max(0, end - start - breakDeducted)
  const diffMinutes = time.roundToStep(workedMinutes - settings.standardMinutes, settings.roundingMinutes)
  return {
    valid: true,
    type: model.DAY_TYPES.WORK,
    workedMinutes,
    breakDeducted,
    diffMinutes,
    label: diffMinutes === 0 ? '全天' : time.formatTimeRange(entry)
  }
}

function getMonthDelta(store, monthKey) {
  const normalized = model.normalizeStore(store)
  const month = model.getMonth(normalized, monthKey)
  return Object.keys(month.entries).reduce((total, dateKey) => {
    const result = calculateEntry(month.entries[dateKey], normalized.settings)
    return total + (result.valid ? result.diffMinutes : 0)
  }, 0)
}

function getKnownMonthKeys(store, extraMonthKey) {
  const normalized = model.normalizeStore(store)
  const keys = Object.keys(normalized.months || {})
  if (extraMonthKey && keys.indexOf(extraMonthKey) === -1) {
    keys.push(extraMonthKey)
  }
  return keys.sort(time.compareKeys)
}

function computeLedger(storeInput, targetMonthKey) {
  const store = model.normalizeStore(storeInput)
  const keys = getKnownMonthKeys(store, targetMonthKey)
  let previousClosing = 0
  let result = {
    monthKey: targetMonthKey,
    openingBalanceMinutes: 0,
    monthDeltaMinutes: 0,
    closingBalanceMinutes: 0
  }

  keys.forEach((monthKey) => {
    if (time.compareKeys(monthKey, targetMonthKey) > 0) {
      return
    }
    const month = model.getMonth(store, monthKey)
    const opening = typeof month.openingBalanceMinutes === 'number' ? month.openingBalanceMinutes : previousClosing
    const delta = getMonthDelta(store, monthKey)
    const closing = opening + delta
    previousClosing = closing

    if (monthKey === targetMonthKey) {
      result = {
        monthKey,
        openingBalanceMinutes: opening,
        monthDeltaMinutes: delta,
        closingBalanceMinutes: closing
      }
    }
  })

  return result
}

function buildMonthRows(storeInput, monthKey) {
  const store = model.normalizeStore(storeInput)
  const month = model.getMonth(store, monthKey)
  const ledger = computeLedger(store, monthKey)
  const totalDays = time.daysInMonth(monthKey)
  const rows = []
  let runningBalance = ledger.openingBalanceMinutes

  for (let day = 1; day <= totalDays; day += 1) {
    const dateKey = time.getDateKey(monthKey, day)
    const entry = month.entries[dateKey] || null
    const calc = calculateEntry(entry, store.settings)
    const hasEntry = !!(entry && entry.type)
    const hasValidEntry = hasEntry && calc.valid
    if (hasValidEntry) {
      runningBalance += calc.diffMinutes
    }
    rows.push({
      dateKey,
      day,
      weekday: time.getWeekdayLabel(dateKey),
      entry,
      hasEntry,
      calc,
      balanceMinutes: runningBalance,
      displayDate: time.getDateLabel(dateKey),
      displayType: hasEntry ? model.TYPE_LABELS[entry.type] : '未记录',
      displayTime: entry && entry.type === model.DAY_TYPES.WORK ? time.formatTimeRange(entry) : '',
      displayDelta: hasValidEntry ? time.formatHours(calc.diffMinutes, true) : '',
      displayBalance: hasValidEntry ? time.formatHours(runningBalance) : ''
    })
  }

  return rows
}

function buildMonthView(storeInput, monthKey) {
  const store = model.normalizeStore(storeInput)
  return {
    monthKey,
    monthLabel: time.getMonthLabel(monthKey),
    ledger: computeLedger(store, monthKey),
    rows: buildMonthRows(store, monthKey)
  }
}

function buildMonthStats(storeInput, monthKey) {
  const rows = buildMonthRows(storeInput, monthKey)
  return rows.reduce((stats, row) => {
    if (!row.hasEntry) {
      stats.missingCount += 1
      return stats
    }
    stats.recordedCount += 1
    if (row.entry.type === model.DAY_TYPES.WORK) {
      stats.workCount += 1
    } else if (row.entry.type === model.DAY_TYPES.REST) {
      stats.restCount += 1
    } else if (row.entry.type === model.DAY_TYPES.LEAVE) {
      stats.leaveCount += 1
    }
    return stats
  }, {
    totalDays: rows.length,
    recordedCount: 0,
    workCount: 0,
    restCount: 0,
    leaveCount: 0,
    missingCount: 0
  })
}

module.exports = {
  shouldDeductBreak,
  calculateBreakDeduction,
  calculateEntry,
  getMonthDelta,
  getKnownMonthKeys,
  computeLedger,
  buildMonthRows,
  buildMonthView,
  buildMonthStats
}
