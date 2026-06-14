const worktime = require('../../utils/worktime')
const storage = require('../../utils/storage')
const theme = require('../../utils/theme')
const dashboard = require('./view-model')

function getEventValue(event) {
  const detail = event ? event.detail : ''
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value
  }
  return detail
}

Page({
  store: worktime.createDefaultStore(),
  hasLoadedOnce: false,
  skippedInitialShow: false,

  data: {
    selectedDate: worktime.getTodayKey(),
    selectedMonthKey: worktime.toMonthKey(new Date()),
    dateTitle: '',
    ledger: {
      openingBalanceMinutes: 0,
      monthDeltaMinutes: 0,
      closingBalanceMinutes: 0
    },
    openingInput: '0',
    openingTone: '',
    isOpeningInputFocused: false,
    monthDeltaText: '0',
    monthDeltaTone: '',
    closingBalanceText: '0',
    closingTone: '',
    boardLabel: '今日出勤',
    boardTimeText: '未记录',
    boardTimeTone: 'is-empty',
    boardDiffText: '—',
    boardDiffTone: '',
    boardFilled: false,
    weekDays: [],
    lastShiftLabel: '',
    recentRows: [],
    stats: {
      totalDays: 0,
      recordedCount: 0,
      workCount: 0,
      restCount: 0,
      leaveCount: 0,
      missingCount: 0
    }
  },

  onLoad() {
    this.hasLoadedOnce = true
    this.refresh()
  },

  onShow() {
    if (this.hasLoadedOnce && !this.skippedInitialShow) {
      this.skippedInitialShow = true
      return
    }
    this.refresh()
  },

  refresh() {
    const store = storage.loadStore()
    this.store = store
    this.setData(dashboard.buildDashboardState(store, this.data.selectedDate || worktime.getTodayKey()))
  },

  selectDate(dateKey) {
    if (!dateKey || dateKey === this.data.selectedDate) {
      return
    }
    this.setData({
      selectedDate: dateKey
    }, () => this.refresh())
  },

  goPrevDay() {
    this.selectDate(worktime.addDays(this.data.selectedDate, -1))
  },

  goNextDay() {
    this.selectDate(worktime.addDays(this.data.selectedDate, 1))
  },

  onDatePicked(event) {
    this.selectDate(getEventValue(event))
  },

  // 周视图与近期出勤共用：点击切换选中日期
  onDayTap(event) {
    this.selectDate(event.currentTarget.dataset.date)
  },

  // 点击当日看板跳转填写页并带上选中日期；当日已填写时先弹原生确认
  goRecordSelected() {
    const goRecord = () => {
      storage.setPendingRecordDate(this.data.selectedDate)
      wx.switchTab({
        url: '/pages/record/record'
      })
    }
    if (this.data.boardFilled) {
      wx.showModal({
        title: '修改当日记录',
        content: `${this.data.selectedDate} 已有记录，确定前往填写页修改吗？`,
        confirmText: '去修改',
        success: (result) => {
          if (result.confirm) {
            goRecord()
          }
        }
      })
      return
    }
    goRecord()
  },

  // 一键把最近一条上班记录复用到选中日期
  applyLastShift() {
    const lastShift = worktime.findLatestWorkEntry(this.store, this.data.selectedDate)
    if (!lastShift) {
      wx.showToast({
        title: '暂无可复用的班次',
        icon: 'none'
      })
      return
    }
    const apply = () => {
      const result = worktime.saveEntry(this.store, this.data.selectedDate, {
        type: worktime.DAY_TYPES.WORK,
        start: lastShift.start,
        end: lastShift.end,
        deductBreak: lastShift.deductBreak,
        note: ''
      })
      if (!result.ok) {
        wx.showToast({
          title: result.message || '保存失败',
          icon: 'none'
        })
        return
      }
      this.store = storage.saveStore(result.store)
      this.refresh()
      wx.showToast({
        title: '已复用上次班次',
        icon: 'success'
      })
    }
    if (storage.getStoredEntry(this.store, this.data.selectedDate)) {
      wx.showModal({
        title: '覆盖已有记录',
        content: `${this.data.selectedDate} 已有记录，确定覆盖为 ${worktime.formatTimeRange(lastShift)} 吗？`,
        confirmText: '覆盖',
        confirmColor: theme.DANGER_COLOR,
        success: (result) => {
          if (result.confirm) {
            apply()
          }
        }
      })
      return
    }
    apply()
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
    this.store = storage.saveStore(worktime.setOpeningBalance(this.store, this.data.selectedMonthKey, minutes))
    this.refresh()
  }
})
