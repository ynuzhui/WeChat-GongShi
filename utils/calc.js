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

function calculateEntryWithSettings(entry, settings) {
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

function calculateEntry(entry, settingsInput) {
  return calculateEntryWithSettings(entry, model.normalizeSettings(settingsInput))
}

function getNormalizedMonth(store, monthKey) {
  const month = store.months && store.months[monthKey] ? store.months[monthKey] : {}
  return {
    openingBalanceMinutes: typeof month.openingBalanceMinutes === 'number' ? month.openingBalanceMinutes : null,
    entries: month.entries && typeof month.entries === 'object' ? month.entries : {}
  }
}

function getMonthDeltaFromStore(store, monthKey) {
  const month = getNormalizedMonth(store, monthKey)
  return Object.keys(month.entries).reduce((total, dateKey) => {
    const result = calculateEntryWithSettings(month.entries[dateKey], store.settings)
    return total + (result.valid ? result.diffMinutes : 0)
  }, 0)
}

function getMonthDelta(storeInput, monthKey) {
  return getMonthDeltaFromStore(model.normalizeStore(storeInput), monthKey)
}

function getKnownMonthKeysFromStore(store, extraMonthKey) {
  const keys = Object.keys(store.months || {})
  if (extraMonthKey && keys.indexOf(extraMonthKey) === -1) {
    keys.push(extraMonthKey)
  }
  return keys.sort(time.compareKeys)
}

function getKnownMonthKeys(storeInput, extraMonthKey) {
  return getKnownMonthKeysFromStore(model.normalizeStore(storeInput), extraMonthKey)
}

function createEmptyLedger(targetMonthKey) {
  return {
    monthKey: targetMonthKey,
    openingBalanceMinutes: 0,
    monthDeltaMinutes: 0,
    closingBalanceMinutes: 0
  }
}

function computeLedgerFromStore(store, targetMonthKey) {
  const keys = getKnownMonthKeysFromStore(store, targetMonthKey)
  let previousClosing = 0
  let result = createEmptyLedger(targetMonthKey)

  for (let index = 0; index < keys.length; index += 1) {
    const monthKey = keys[index]
    if (time.compareKeys(monthKey, targetMonthKey) > 0) {
      break
    }
    const month = getNormalizedMonth(store, monthKey)
    const opening = typeof month.openingBalanceMinutes === 'number' ? month.openingBalanceMinutes : previousClosing
    const delta = getMonthDeltaFromStore(store, monthKey)
    const closing = opening + delta
    previousClosing = closing

    if (monthKey === targetMonthKey) {
      result = {
        monthKey,
        openingBalanceMinutes: opening,
        monthDeltaMinutes: delta,
        closingBalanceMinutes: closing
      }
      break
    }
  }

  return result
}

function computeLedgersFromStore(store, targetMonthKeys) {
  const requestedKeys = Array.isArray(targetMonthKeys) ? targetMonthKeys.filter(Boolean) : []
  const uniqueTargetKeys = []
  requestedKeys.forEach((monthKey) => {
    if (uniqueTargetKeys.indexOf(monthKey) === -1) {
      uniqueTargetKeys.push(monthKey)
    }
  })
  if (!uniqueTargetKeys.length) {
    return {}
  }

  const maxTargetKey = uniqueTargetKeys.slice().sort(time.compareKeys).pop()
  const remaining = uniqueTargetKeys.reduce((result, monthKey) => {
    result[monthKey] = true
    return result
  }, {})
  const keys = getKnownMonthKeysFromStore(store, maxTargetKey)
  let previousClosing = 0
  const ledgers = {}

  for (let index = 0; index < keys.length; index += 1) {
    const monthKey = keys[index]
    if (time.compareKeys(monthKey, maxTargetKey) > 0) {
      break
    }
    const month = getNormalizedMonth(store, monthKey)
    const opening = typeof month.openingBalanceMinutes === 'number' ? month.openingBalanceMinutes : previousClosing
    const delta = getMonthDeltaFromStore(store, monthKey)
    const closing = opening + delta
    previousClosing = closing

    if (remaining[monthKey]) {
      ledgers[monthKey] = {
        monthKey,
        openingBalanceMinutes: opening,
        monthDeltaMinutes: delta,
        closingBalanceMinutes: closing
      }
      delete remaining[monthKey]
      if (!Object.keys(remaining).length) {
        break
      }
    }
  }

  uniqueTargetKeys.forEach((monthKey) => {
    if (!ledgers[monthKey]) {
      ledgers[monthKey] = createEmptyLedger(monthKey)
    }
  })
  return ledgers
}

function computeLedger(storeInput, targetMonthKey) {
  return computeLedgerFromStore(model.normalizeStore(storeInput), targetMonthKey)
}

function computeLedgers(storeInput, targetMonthKeys) {
  return computeLedgersFromStore(model.normalizeStore(storeInput), targetMonthKeys)
}

function buildMonthRowsFromStore(store, monthKey, ledgerInput) {
  const month = getNormalizedMonth(store, monthKey)
  const ledger = ledgerInput || computeLedgerFromStore(store, monthKey)
  const totalDays = time.daysInMonth(monthKey)
  const rows = []
  let runningBalance = ledger.openingBalanceMinutes

  for (let day = 1; day <= totalDays; day += 1) {
    const dateKey = time.getDateKey(monthKey, day)
    const entry = month.entries[dateKey] || null
    const calc = calculateEntryWithSettings(entry, store.settings)
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

function buildMonthRows(storeInput, monthKey) {
  return buildMonthRowsFromStore(model.normalizeStore(storeInput), monthKey)
}

function buildMonthView(storeInput, monthKey) {
  const store = model.normalizeStore(storeInput)
  const ledger = computeLedgerFromStore(store, monthKey)
  return {
    monthKey,
    monthLabel: time.getMonthLabel(monthKey),
    ledger,
    rows: buildMonthRowsFromStore(store, monthKey, ledger)
  }
}

function buildMonthViewWithLedger(storeInput, monthKey, ledgerInput) {
  const store = model.normalizeStore(storeInput)
  const ledger = ledgerInput || computeLedgerFromStore(store, monthKey)
  return {
    monthKey,
    monthLabel: time.getMonthLabel(monthKey),
    ledger,
    rows: buildMonthRowsFromStore(store, monthKey, ledger)
  }
}

function buildRowsStats(rowsInput) {
  const rows = Array.isArray(rowsInput) ? rowsInput : []
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

function buildMonthStats(storeInput, monthKey) {
  return buildRowsStats(buildMonthRows(storeInput, monthKey))
}

module.exports = {
  shouldDeductBreak,
  calculateBreakDeduction,
  calculateEntry,
  getMonthDelta,
  getKnownMonthKeys,
  computeLedger,
  computeLedgers,
  buildMonthRows,
  buildMonthView,
  buildMonthViewWithLedger,
  buildRowsStats,
  buildMonthStats
}
