const time = require('./time')
const model = require('./model')
const calc = require('./calc')

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

  for (let dateKey = range.start; time.compareKeys(dateKey, range.end) <= 0; dateKey = time.addDays(dateKey, 1)) {
    const month = model.getMonth(store, time.toMonthKey(dateKey))
    const entry = month.entries[dateKey]
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

module.exports = {
  buildExportLines,
  buildExportText,
  buildDeltaExportLines,
  buildDeltaExportText
}
