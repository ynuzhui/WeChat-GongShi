const worktime = require('../../utils/worktime')
const storage = require('../../utils/storage')
const view = require('../../utils/view')

function diffClass(value) {
  if (value > 0) {
    return 'is-plus'
  }
  if (value < 0) {
    return 'is-minus'
  }
  return ''
}

function barWidth(value, maxValue) {
  if (!value || !maxValue) {
    return 0
  }
  return Math.max(8, Math.round(Math.abs(value) / maxValue * 100))
}

function getEventValue(event) {
  const detail = event ? event.detail : ''
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value
  }
  return detail
}

function buildDateStatusTheme(row) {
  if (!row || !row.hasEntry) {
    return 'default'
  }
  if (!row.calc.valid) {
    return 'warning'
  }
  if (row.calc.diffMinutes > 0) {
    return 'success'
  }
  if (row.calc.diffMinutes < 0) {
    return 'danger'
  }
  return 'primary'
}

Page({
  data: {
    store: worktime.createDefaultStore(),
    prevMonthText: String.fromCharCode(60, 60),
    prevDayText: String.fromCharCode(60),
    nextDayText: String.fromCharCode(62),
    nextMonthText: String.fromCharCode(62, 62),
    selectedDate: worktime.getTodayKey(),
    selectedMonthKey: worktime.toMonthKey(new Date()),
    monthLabel: '',
    previousMonthLabel: '',
    ledger: {
      openingBalanceMinutes: 0,
      monthDeltaMinutes: 0,
      closingBalanceMinutes: 0
    },
    openingInput: '0',
    isOpeningInputFocused: false,
    monthDeltaText: '0',
    closingBalanceText: '0',
    dateStatusTime: '未记录',
    dateStatusDiff: '-',
    dateStatusTheme: 'default',
    stats: {
      totalDays: 0,
      recordedCount: 0,
      workCount: 0,
      restCount: 0,
      leaveCount: 0,
      missingCount: 0
    },
    compareItems: []
  },

  onLoad() {
    this.refresh()
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const store = storage.loadStore()
    const selectedDate = this.data.selectedDate || worktime.getTodayKey()
    const selectedMonthKey = worktime.toMonthKey(selectedDate)
    const monthView = worktime.buildMonthView(store, selectedMonthKey)
    const stats = worktime.buildMonthStats(store, selectedMonthKey)
    const previousMonthKey = worktime.previousMonthKey(selectedMonthKey)
    const previousView = worktime.buildMonthView(store, previousMonthKey)
    const selectedRows = view.decorateRows(monthView.rows, selectedDate)
    const selectedRow = selectedRows.find((row) => row.dateKey === selectedDate)
    const dateStatus = view.buildDateStatus(selectedRow)
    const compareItems = this.buildCompareItems(monthView, previousView)

    this.setData({
      store,
      selectedDate,
      selectedMonthKey,
      monthLabel: monthView.monthLabel,
      previousMonthLabel: previousView.monthLabel,
      ledger: monthView.ledger,
      openingInput: worktime.formatHours(monthView.ledger.openingBalanceMinutes),
      monthDeltaText: worktime.formatHours(monthView.ledger.monthDeltaMinutes, true),
      closingBalanceText: worktime.formatHours(monthView.ledger.closingBalanceMinutes),
      dateStatusTime: dateStatus.time,
      dateStatusDiff: dateStatus.diff,
      dateStatusTheme: buildDateStatusTheme(selectedRow),
      stats,
      compareItems
    })
  },

  buildCompareItems(monthView, previousView) {
    const rawItems = [
      {
        label: '本月结算',
        currentValue: monthView.ledger.monthDeltaMinutes,
        previousValue: previousView.ledger.monthDeltaMinutes,
        diffValue: monthView.ledger.monthDeltaMinutes - previousView.ledger.monthDeltaMinutes,
        current: `${worktime.formatHours(monthView.ledger.monthDeltaMinutes, true)}h`,
        previous: `${worktime.formatHours(previousView.ledger.monthDeltaMinutes, true)}h`,
        unit: 'h'
      },
      {
        label: '本月结余',
        currentValue: monthView.ledger.closingBalanceMinutes,
        previousValue: previousView.ledger.closingBalanceMinutes,
        diffValue: monthView.ledger.closingBalanceMinutes - previousView.ledger.closingBalanceMinutes,
        current: `${worktime.formatHours(monthView.ledger.closingBalanceMinutes)}h`,
        previous: `${worktime.formatHours(previousView.ledger.closingBalanceMinutes)}h`,
        unit: 'h'
      }
    ]
    return rawItems.map((item) => {
      const maxValue = Math.max(Math.abs(item.currentValue), Math.abs(item.previousValue))
      const diff = `${worktime.formatHours(item.diffValue, true)}h`
      const currentBar = barWidth(item.currentValue, maxValue)
      const previousBar = barWidth(item.previousValue, maxValue)
      return Object.assign({}, item, {
        diff,
        diffClassName: `compare-diff ${diffClass(item.diffValue)}`.trim(),
        diffClass: diffClass(item.diffValue),
        currentBar,
        previousBar,
        currentBarStyle: `width: ${currentBar}%;`,
        previousBarStyle: `width: ${previousBar}%;`
      })
    })
  },

  goPrevDay() {
    this.setData({
      selectedDate: worktime.addDays(this.data.selectedDate, -1)
    }, () => this.refresh())
  },

  goNextDay() {
    this.setData({
      selectedDate: worktime.addDays(this.data.selectedDate, 1)
    }, () => this.refresh())
  },

  goPrevMonth() {
    this.setData({
      selectedDate: worktime.addMonthsClamped(this.data.selectedDate, -1)
    }, () => this.refresh())
  },

  goNextMonth() {
    this.setData({
      selectedDate: worktime.addMonthsClamped(this.data.selectedDate, 1)
    }, () => this.refresh())
  },

  onOpeningInput(event) {
    this.setData({
      openingInput: getEventValue(event)
    })
  },

  focusOpeningInput() {
    this.setData({
      isOpeningInputFocused: true
    })
  },

  onOpeningFocus() {
    this.setData({
      isOpeningInputFocused: true
    })
  },

  onOpeningBlur() {
    this.setData({
      isOpeningInputFocused: false
    })
    const minutes = worktime.parseHoursToMinutes(this.data.openingInput)
    if (minutes === null) {
      wx.showToast({
        title: '请输入数字',
        icon: 'none'
      })
      this.refresh()
      return
    }
    if (minutes === this.data.ledger.openingBalanceMinutes) {
      this.refresh()
      return
    }
    storage.saveStore(worktime.setOpeningBalance(this.data.store, this.data.selectedMonthKey, minutes))
    this.refresh()
  }
})
