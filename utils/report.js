const time = require('./time')
const model = require('./model')
const calc = require('./calc')

const MAX_EXPORT_RANGE_DAYS = 370

function normalizeRange(startDateKey, endDateKey) {
  let start = startDateKey
  let end = endDateKey
  if (time.compareKeys(start, end) > 0) {
    start = endDateKey
    end = startDateKey
  }
  return {
    start,
    end
  }
}

function walkRange(storeInput, startDateKey, endDateKey, visitor) {
  const store = model.normalizeStore(storeInput)
  const range = normalizeRange(startDateKey, endDateKey)
  const lines = []
  const monthCache = {}

  for (
    let dateKey = range.start, dayCount = 0;
    time.compareKeys(dateKey, range.end) <= 0 && dayCount < MAX_EXPORT_RANGE_DAYS;
    dateKey = time.addDays(dateKey, 1), dayCount += 1
  ) {
    const monthKey = time.toMonthKey(dateKey)
    if (!monthCache[monthKey]) {
      const sourceMonth = store.months[monthKey] || {}
      monthCache[monthKey] = sourceMonth.entries && typeof sourceMonth.entries === 'object'
        ? sourceMonth.entries
        : {}
    }
    const entries = monthCache[monthKey]
    const entry = entries[dateKey]
    if (!entry || !entry.type) {
      continue
    }
    const result = calc.calculateEntry(entry, store.settings)
    const line = visitor({
      store,
      dateKey,
      entry,
      result
    })
    if (line) {
      lines.push(line)
    }
  }

  return lines
}

function buildExportLines(storeInput, startDateKey, endDateKey) {
  return walkRange(storeInput, startDateKey, endDateKey, ({ dateKey, entry, result }) => {
    if (entry.type === model.DAY_TYPES.WORK) {
      if (!result.valid) {
        return ''
      }
      if (result.diffMinutes === 0) {
        return `${time.getExportDateLabel(dateKey)}  全天`
      }
      return `${time.getExportDateLabel(dateKey)}  ${time.formatTimeRange(entry)}   ${time.formatHours(result.diffMinutes, true)}`
    }
    return `${time.getExportDateLabel(dateKey)}  ${model.TYPE_LABELS[entry.type]}`
  })
}

function buildExportText(storeInput, startDateKey, endDateKey) {
  return buildExportLines(storeInput, startDateKey, endDateKey).join('\n')
}

function buildDeltaExportLines(storeInput, startDateKey, endDateKey) {
  return walkRange(storeInput, startDateKey, endDateKey, ({ dateKey, entry, result }) => {
    if (entry.type === model.DAY_TYPES.WORK) {
      if (!result.valid) {
        return ''
      }
      if (result.diffMinutes === 0) {
        return `${time.getExportDateLabel(dateKey)}  全天`
      }
      return `${time.getExportDateLabel(dateKey)}  ${time.formatHours(result.diffMinutes, true)}`
    }
    return `${time.getExportDateLabel(dateKey)}  ${model.TYPE_LABELS[entry.type]}`
  })
}

function buildDeltaExportText(storeInput, startDateKey, endDateKey) {
  return buildDeltaExportLines(storeInput, startDateKey, endDateKey).join('\n')
}

function isFullNaturalMonth(startDateKey, endDateKey) {
  const startMonthKey = time.toMonthKey(startDateKey)
  const endMonthKey = time.toMonthKey(endDateKey)
  return startMonthKey === endMonthKey
    && startDateKey === time.getDateKey(startMonthKey, 1)
    && endDateKey === time.getDateKey(startMonthKey, time.daysInMonth(startMonthKey))
}

function buildReportTitle(startDateKey, endDateKey) {
  if (isFullNaturalMonth(startDateKey, endDateKey)) {
    return `${time.parseDateKey(startDateKey).month}月工时`
  }
  if (startDateKey === endDateKey) {
    return `${startDateKey} 工时`
  }
  return `${startDateKey} 至 ${endDateKey} 工时`
}

function buildReportImageData(storeInput, startDateKey, endDateKey) {
  const store = model.normalizeStore(storeInput)
  const range = normalizeRange(startDateKey, endDateKey)
  const rows = []
  const monthCache = {}
  let rangeDeltaMinutes = 0
  let recordedCount = 0

  for (
    let dateKey = range.start, dayCount = 0;
    time.compareKeys(dateKey, range.end) <= 0 && dayCount < MAX_EXPORT_RANGE_DAYS;
    dateKey = time.addDays(dateKey, 1), dayCount += 1
  ) {
    const monthKey = time.toMonthKey(dateKey)
    if (!monthCache[monthKey]) {
      const sourceMonth = store.months[monthKey] || {}
      monthCache[monthKey] = sourceMonth.entries && typeof sourceMonth.entries === 'object'
        ? sourceMonth.entries
        : {}
    }

    const entry = monthCache[monthKey][dateKey] || null
    const result = calc.calculateEntry(entry, store.settings)
    const hasEntry = !!(entry && entry.type)
    const hasValidEntry = hasEntry && result.valid
    if (hasEntry) {
      recordedCount += 1
    }
    if (hasValidEntry) {
      rangeDeltaMinutes += result.diffMinutes
    }

    rows.push({
      dateKey,
      day: time.parseDateKey(dateKey).day,
      weekday: time.getWeekdayLabel(dateKey),
      entry,
      hasEntry,
      calc: result,
      displayDate: time.getDateLabel(dateKey),
      displayType: hasEntry ? model.TYPE_LABELS[entry.type] : '无记录',
      displayTime: entry && entry.type === model.DAY_TYPES.WORK ? time.formatTimeRange(entry) : '',
      displayDelta: hasValidEntry ? time.formatHours(result.diffMinutes, true) : ''
    })
  }

  return {
    start: range.start,
    end: range.end,
    title: buildReportTitle(range.start, range.end),
    isFullMonth: isFullNaturalMonth(range.start, range.end),
    rows,
    rangeDeltaMinutes,
    recordedCount,
    missingCount: rows.length - recordedCount
  }
}

module.exports = {
  MAX_EXPORT_RANGE_DAYS,
  normalizeRange,
  isFullNaturalMonth,
  buildReportTitle,
  buildReportImageData,
  buildExportLines,
  buildExportText,
  buildDeltaExportLines,
  buildDeltaExportText
}
