const worktime = require('../../utils/worktime')

// 日期胶囊标题：统一为 "26-06-12 周五" 短格式
function buildDateTitle(selectedDate) {
  return worktime.getShortDateLabel(selectedDate)
}

// 结余正负决定资产卡的渐变色调
function buildBalanceTone(minutes) {
  if (minutes > 0) {
    return 'is-positive'
  }
  if (minutes < 0) {
    return 'is-negative'
  }
  return ''
}

// 单日圆点：上班按差额显示 +N/-N/全，本休“休”，调休“调”，未记录显示日号
function buildDayDot(row) {
  if (!row.hasEntry) {
    return { text: String(row.day), tone: 'is-empty' }
  }
  if (row.entry.type === worktime.DAY_TYPES.REST) {
    return { text: '休', tone: 'is-rest' }
  }
  if (row.entry.type === worktime.DAY_TYPES.LEAVE) {
    return { text: '调', tone: 'is-minus' }
  }
  if (!row.calc.valid) {
    return { text: '待', tone: 'is-warn' }
  }
  if (row.calc.diffMinutes > 0) {
    return { text: worktime.formatHours(row.calc.diffMinutes, true), tone: 'is-plus' }
  }
  if (row.calc.diffMinutes < 0) {
    return { text: worktime.formatHours(row.calc.diffMinutes), tone: 'is-minus' }
  }
  return { text: '全', tone: 'is-full' }
}

function buildWeekDays(store, selectedDate, todayKey) {
  const range = worktime.getWeekRange(selectedDate)
  const week = worktime.buildReportImageData(store, range.start, range.end)
  return week.rows.map((row) => {
    const dot = buildDayDot(row)
    return {
      dateKey: row.dateKey,
      weekday: row.weekday,
      dotText: dot.text,
      dotTone: dot.tone,
      isToday: row.dateKey === todayKey,
      isSelected: row.dateKey === selectedDate
    }
  })
}

// 近期出勤：选中日期之前 5 天，最近的排最上
function buildRecentRows(store, selectedDate) {
  const report = worktime.buildReportImageData(
    store,
    worktime.addDays(selectedDate, -5),
    worktime.addDays(selectedDate, -1)
  )
  return report.rows.slice().reverse().map((row) => {
    const parsed = worktime.parseDateKey(row.dateKey)
    let content = '未记录'
    let contentTone = 'is-empty'
    let diffText = ''
    if (row.hasEntry && row.entry.type === worktime.DAY_TYPES.WORK) {
      content = row.displayTime || '时间不完整'
      contentTone = 'is-time'
      if (!row.calc.valid) {
        diffText = '待算'
      } else {
        diffText = row.calc.diffMinutes === 0 ? '全天' : `${worktime.formatHours(row.calc.diffMinutes, true)}h`
      }
    } else if (row.hasEntry && row.entry.type === worktime.DAY_TYPES.REST) {
      content = '本休'
      contentTone = 'is-rest'
    } else if (row.hasEntry && row.entry.type === worktime.DAY_TYPES.LEAVE) {
      content = '调休'
      contentTone = 'is-leave'
      diffText = `${worktime.formatHours(row.calc.diffMinutes, true)}h`
    }
    return {
      dateKey: row.dateKey,
      dateLabel: `${worktime.pad(parsed.month)}-${worktime.pad(parsed.day)} 周${row.weekday}`,
      content,
      contentTone,
      diffText
    }
  })
}

// 当日出勤看板：上方标签 + 时间，右侧差额；未填写时时间位显示“点击填写”
function buildBoard(row, isToday) {
  const board = {
    boardLabel: isToday ? '今日出勤' : '当日出勤',
    boardTimeText: '点击填写',
    boardTimeTone: 'is-empty',
    boardFilled: false,
    boardDiffText: '-',
    boardDiffTone: ''
  }
  if (!row || !row.hasEntry) {
    return board
  }
  board.boardFilled = true
  if (row.entry.type === worktime.DAY_TYPES.REST) {
    board.boardTimeText = '本休'
    board.boardTimeTone = 'is-rest'
    board.boardDiffText = '无'
    return board
  }
  if (row.entry.type === worktime.DAY_TYPES.LEAVE) {
    board.boardTimeText = '调休'
    board.boardTimeTone = 'is-leave'
    board.boardDiffText = `${worktime.formatHours(row.calc.diffMinutes, true)}h`
    board.boardDiffTone = 'is-minus'
    return board
  }
  board.boardTimeText = row.displayTime || '时间不完整'
  board.boardTimeTone = 'is-time'
  if (!row.calc.valid) {
    board.boardDiffText = '待算'
    board.boardDiffTone = 'is-warn'
    return board
  }
  if (row.calc.diffMinutes === 0) {
    board.boardDiffText = '无'
    return board
  }
  board.boardDiffText = `${worktime.formatHours(row.calc.diffMinutes, true)}h`
  board.boardDiffTone = row.calc.diffMinutes > 0 ? 'is-plus' : 'is-minus'
  return board
}

function buildDashboardState(store, selectedDateInput, todayKeyInput) {
  const selectedDate = selectedDateInput || worktime.getTodayKey()
  const todayKey = todayKeyInput || worktime.getTodayKey()
  const selectedMonthKey = worktime.toMonthKey(selectedDate)
  const monthView = worktime.buildMonthView(store, selectedMonthKey)
  const selectedRow = monthView.rows.find((row) => row.dateKey === selectedDate)
  const lastShift = worktime.findLatestWorkEntry(store, selectedDate)

  return Object.assign(
    {
      selectedDate,
      selectedMonthKey,
      dateTitle: buildDateTitle(selectedDate),
      ledger: monthView.ledger,
      openingInput: worktime.formatHours(monthView.ledger.openingBalanceMinutes),
      openingTone: buildBalanceTone(monthView.ledger.openingBalanceMinutes),
      monthDeltaText: worktime.formatHours(monthView.ledger.monthDeltaMinutes, true),
      monthDeltaTone: buildBalanceTone(monthView.ledger.monthDeltaMinutes),
      closingBalanceText: worktime.formatHours(monthView.ledger.closingBalanceMinutes),
      closingTone: buildBalanceTone(monthView.ledger.closingBalanceMinutes),
      weekDays: buildWeekDays(store, selectedDate, todayKey),
      lastShiftLabel: lastShift ? worktime.formatTimeRange(lastShift) : '',
      recentRows: buildRecentRows(store, selectedDate),
      stats: worktime.buildRowsStats(monthView.rows)
    },
    buildBoard(selectedRow, selectedDate === todayKey)
  )
}

module.exports = {
  buildDashboardState,
  buildDateTitle,
  buildBalanceTone,
  buildDayDot
}
