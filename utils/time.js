const DEFAULT_ROUNDING_MINUTES = 30
const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']
const HALF_HOUR_MINUTE_OPTIONS = ['00', '30']

function pad(value) {
  return value < 10 ? `0${value}` : String(value)
}

function toDateKey(value) {
  const date = value instanceof Date ? value : new Date(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function toMonthKey(value) {
  if (typeof value === 'string') {
    return value.slice(0, 7)
  }
  const date = value instanceof Date ? value : new Date(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

function parseDateKey(dateKey) {
  const parts = String(dateKey).split('-').map((item) => Number(item))
  return {
    year: parts[0],
    month: parts[1],
    day: parts[2] || 1
  }
}

function dateFromKey(dateKey) {
  const parsed = parseDateKey(dateKey)
  return new Date(parsed.year, parsed.month - 1, parsed.day)
}

function getTodayKey() {
  return toDateKey(new Date())
}

function getDateKey(monthKey, day) {
  return `${monthKey}-${pad(day)}`
}

function getMonthLabel(monthKey) {
  const parsed = parseDateKey(monthKey)
  return `${parsed.year}年${parsed.month}月`
}

function getDateLabel(dateKey) {
  const parsed = parseDateKey(dateKey)
  return `${parsed.month}月${parsed.day}日`
}

function getExportDateLabel(dateKey) {
  const parsed = parseDateKey(dateKey)
  return `${parsed.month}.${parsed.day}日`
}

function getWeekdayLabel(dateKey) {
  return WEEKDAY_LABELS[dateFromKey(dateKey).getDay()]
}

function daysInMonth(monthKey) {
  const parsed = parseDateKey(monthKey)
  return new Date(parsed.year, parsed.month, 0).getDate()
}

function nextMonthKey(monthKey) {
  const parsed = parseDateKey(monthKey)
  const date = new Date(parsed.year, parsed.month, 1)
  return toMonthKey(date)
}

function previousMonthKey(monthKey) {
  const parsed = parseDateKey(monthKey)
  const date = new Date(parsed.year, parsed.month - 2, 1)
  return toMonthKey(date)
}

function addMonthsClamped(dateKey, amount) {
  const parsed = parseDateKey(dateKey)
  const targetFirstDay = new Date(parsed.year, parsed.month - 1 + amount, 1)
  const targetMonthKey = toMonthKey(targetFirstDay)
  const targetDay = Math.min(parsed.day, daysInMonth(targetMonthKey))
  return getDateKey(targetMonthKey, targetDay)
}

function compareKeys(left, right) {
  return String(left).localeCompare(String(right))
}

function addDays(dateKey, amount) {
  const date = dateFromKey(dateKey)
  date.setDate(date.getDate() + amount)
  return toDateKey(date)
}

function getWeekRange(dateKey) {
  const normalizedDateKey = toDateKey(dateFromKey(dateKey))
  const day = dateFromKey(normalizedDateKey).getDay()
  const startOffset = day === 0 ? -6 : 1 - day
  const start = addDays(normalizedDateKey, startOffset)
  return {
    start,
    end: addDays(start, 6)
  }
}

function parseTime(input) {
  if (input === null || input === undefined || input === '') {
    return null
  }
  const text = String(input).trim().replace(/[.：]/g, ':')
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(text)
  if (!match) {
    return null
  }
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null
  }
  return hour * 60 + minute
}

function adjustTimeForCalculation(minutes) {
  if (minutes === null || minutes === undefined) {
    return null
  }
  const minute = minutes % 60
  if (minute === 20 || minute === 50) {
    return minutes + 10
  }
  return minutes
}

function formatPickerTime(input) {
  const minutes = typeof input === 'number' ? input : parseTime(input)
  if (minutes === null) {
    return ''
  }
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

function roundToHalfHourTime(input, fallback) {
  const source = parseTime(input)
  const fallbackMinutes = parseTime(fallback)
  const minutes = source === null ? fallbackMinutes : source
  if (minutes === null) {
    return '00:00'
  }
  const rounded = Math.round(minutes / 30) * 30
  return formatPickerTime(Math.max(0, Math.min(23 * 60 + 30, rounded)))
}

function buildHalfHourTimePickerRange() {
  const hours = []
  for (let hour = 0; hour < 24; hour += 1) {
    hours.push(pad(hour))
  }
  return [hours, HALF_HOUR_MINUTE_OPTIONS.slice()]
}

function getHalfHourTimePickerValue(input, fallback) {
  const normalized = roundToHalfHourTime(input, fallback)
  const minutes = parseTime(normalized)
  if (minutes === null) {
    return [0, 0]
  }
  return [Math.floor(minutes / 60), minutes % 60 === 30 ? 1 : 0]
}

function getHalfHourTimeFromPickerValue(value, fallback) {
  if (typeof value === 'string') {
    return roundToHalfHourTime(value, fallback)
  }
  const source = Array.isArray(value) ? value : getHalfHourTimePickerValue(fallback)
  const hour = Math.max(0, Math.min(23, Number(source[0]) || 0))
  const minuteIndex = Number(source[1]) === 1 ? 1 : 0
  return `${pad(hour)}:${HALF_HOUR_MINUTE_OPTIONS[minuteIndex]}`
}

function formatExportTime(input) {
  const minutes = typeof input === 'number' ? input : parseTime(input)
  if (minutes === null) {
    return ''
  }
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

function formatTimeRange(entry) {
  if (!entry || !entry.start || !entry.end) {
    return ''
  }
  const start = formatExportTime(entry.start)
  const end = formatExportTime(entry.end)
  if (!start || !end) {
    return ''
  }
  return `${start}-${end}`
}

function roundToStep(minutes, step) {
  if (!step) {
    return minutes
  }
  const sign = minutes < 0 ? -1 : 1
  return sign * Math.round(Math.abs(minutes) / step) * step
}

function formatHours(minutes, withPositiveSign) {
  const safeMinutes = Object.is(minutes, -0) ? 0 : minutes
  const hours = safeMinutes / 60
  const abs = Math.abs(hours)
  const body = Number.isInteger(abs) ? String(abs) : abs.toFixed(1).replace(/\.0$/, '')
  if (hours > 0 && withPositiveSign) {
    return `+${body}`
  }
  if (hours < 0) {
    return `-${body}`
  }
  return body
}

function parseHoursToMinutes(input, roundingMinutes) {
  if (input === null || input === undefined || input === '') {
    return null
  }
  const value = Number(String(input).trim().replace(',', '.'))
  if (!Number.isFinite(value)) {
    return null
  }
  return roundToStep(value * 60, roundingMinutes || DEFAULT_ROUNDING_MINUTES)
}

function formatBeijingMinuteStamp(input) {
  const source = input ? new Date(input) : new Date()
  const beijingTime = new Date(source.getTime() + 8 * 60 * 60 * 1000)
  return [
    beijingTime.getUTCFullYear(),
    pad(beijingTime.getUTCMonth() + 1),
    pad(beijingTime.getUTCDate())
  ].join('-') + '-' + [
    pad(beijingTime.getUTCHours()),
    pad(beijingTime.getUTCMinutes())
  ].join('-')
}

function formatBeijingCompactMinuteStamp(input) {
  const source = input ? new Date(input) : new Date()
  const beijingTime = new Date(source.getTime() + 8 * 60 * 60 * 1000)
  return [
    pad(beijingTime.getUTCFullYear() % 100),
    pad(beijingTime.getUTCMonth() + 1),
    pad(beijingTime.getUTCDate())
  ].join('') + '-' + [
    pad(beijingTime.getUTCHours()),
    pad(beijingTime.getUTCMinutes())
  ].join('')
}

module.exports = {
  DEFAULT_ROUNDING_MINUTES,
  WEEKDAY_LABELS,
  HALF_HOUR_MINUTE_OPTIONS,
  pad,
  toDateKey,
  toMonthKey,
  parseDateKey,
  dateFromKey,
  getTodayKey,
  getDateKey,
  getMonthLabel,
  getDateLabel,
  getExportDateLabel,
  getWeekdayLabel,
  daysInMonth,
  nextMonthKey,
  previousMonthKey,
  addMonthsClamped,
  compareKeys,
  addDays,
  getWeekRange,
  parseTime,
  adjustTimeForCalculation,
  formatPickerTime,
  roundToHalfHourTime,
  buildHalfHourTimePickerRange,
  getHalfHourTimePickerValue,
  getHalfHourTimeFromPickerValue,
  formatExportTime,
  formatTimeRange,
  formatBeijingMinuteStamp,
  formatBeijingCompactMinuteStamp,
  roundToStep,
  formatHours,
  parseHoursToMinutes
}
