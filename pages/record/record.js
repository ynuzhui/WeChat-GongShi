const worktime = require('../../utils/worktime')
const storage = require('../../utils/storage')
const theme = require('../../utils/theme')
const draft = require('./draft')
const autoNote = require('./auto-note')

function getEventValue(event) {
  const detail = event ? event.detail : ''
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value
  }
  return detail
}

Page({
  store: worktime.createDefaultStore(),
  autoNoteText: '',

  data: {
    selectedDate: worktime.getTodayKey(),
    selectedDateLabel: '',
    selectedHasRecord: false,
    isDraftDirty: false,
    draftStateLabel: '草稿',
    draftStateTheme: 'primary',
    selectedEntry: worktime.getDefaultWorkEntry(),
    isManualEditorVisible: false,
    timePickerRange: worktime.buildHalfHourTimePickerRange(),
    selectedSummary: '',
    selectedWarning: '',
    presets: [],
    presetOptions: [],
    selectedPresetIndex: 0,
    selectedPresetLabel: ''
  },

  onLoad(options) {
    if (options && options.date) {
      this.setData({
        selectedDate: options.date
      })
    }
  },

  onShow() {
    const pendingDate = storage.takePendingRecordDate()
    if (pendingDate && pendingDate !== this.data.selectedDate) {
      // 由其它页面指定日期跳转：复用切日期逻辑，脏草稿会先弹确认
      this.requestDateSwitch(pendingDate)
      return
    }
    if (this.data.isDraftDirty) {
      // 保留未保存的草稿，避免切换 Tab 返回时丢失编辑
      return
    }
    this.refresh()
  },

  refresh() {
    const store = storage.loadStore()
    const selectedDate = this.data.selectedDate || worktime.getTodayKey()
    const draftEntry = draft.buildDraftEntry(store, selectedDate)
    this.store = store
    this.autoNoteText = autoNote.getInitialAutoNoteText(draftEntry, store.settings)
    this.setData(draft.buildDraftViewState(store, selectedDate, draftEntry))
  },

  requestDateSwitch(nextDate) {
    if (!nextDate || nextDate === this.data.selectedDate) {
      return
    }
    if (this.data.isDraftDirty) {
      wx.showModal({
        title: '放弃草稿',
        content: '当前未保存的修改会丢失，是否继续切换日期？',
        confirmText: '放弃',
        confirmColor: theme.DANGER_COLOR,
        success: (result) => {
          if (!result.confirm) {
            return
          }
          this.setData({
            selectedDate: nextDate
          }, () => this.refresh())
        }
      })
      return
    }
    this.setData({
      selectedDate: nextDate
    }, () => this.refresh())
  },

  updateDraft(nextEntry, manualEditorOverride) {
    const preparedDraft = draft.cloneEntry(nextEntry) || worktime.getDefaultWorkEntry(this.store.settings)
    const autoNoteResult = autoNote.applyAutoNote(preparedDraft, this.store.settings, this.autoNoteText)
    const draftEntry = autoNoteResult.entry || worktime.getDefaultWorkEntry(this.store.settings)
    this.autoNoteText = autoNoteResult.autoNoteText
    const state = draft.buildDraftViewState(this.store, this.data.selectedDate, draftEntry, this.data.isManualEditorVisible)
    if (typeof manualEditorOverride === 'boolean') {
      state.isManualEditorVisible = manualEditorOverride
    }
    this.setData(state)
  },

  onDateChange(event) {
    this.requestDateSwitch(event.detail.value)
  },

  goPrevDay() {
    this.requestDateSwitch(worktime.addDays(this.data.selectedDate, -1))
  },

  goNextDay() {
    this.requestDateSwitch(worktime.addDays(this.data.selectedDate, 1))
  },

  onTypeTap(event) {
    const type = event.currentTarget.dataset.type
    if (type === this.data.selectedEntry.type) {
      return
    }
    let entry = draft.cloneEntry(this.data.selectedEntry) || worktime.getDefaultWorkEntry(this.store.settings)
    entry.type = type
    if (type === worktime.DAY_TYPES.WORK) {
      entry = draft.ensureDraftDefaults(entry, this.store.settings)
    }
    this.updateDraft(entry, false)
  },

  // 原生 picker 选择已保存班次
  onPresetPickerChange(event) {
    const index = Number(getEventValue(event))
    const preset = this.data.presets[index]
    if (!preset) {
      wx.showToast({
        title: '班次不存在',
        icon: 'none'
      })
      return
    }
    this.updateDraft(worktime.entryFromPreset(preset, this.data.selectedEntry.note), false)
  },

  useManualMode() {
    let entry = draft.cloneEntry(this.data.selectedEntry) || worktime.getDefaultWorkEntry(this.store.settings)
    delete entry.presetId
    entry.type = worktime.DAY_TYPES.WORK
    entry = draft.ensureDraftDefaults(entry, this.store.settings)
    entry = draft.normalizeManualEntryTimes(entry, this.store.settings)
    this.updateDraft(entry, true)
  },

  saveDraft() {
    const result = worktime.saveEntry(this.store, this.data.selectedDate, this.data.selectedEntry)
    if (!result.ok) {
      wx.showToast({
        title: result.message,
        icon: 'none'
      })
      return
    }
    this.store = storage.saveStore(result.store)
    this.refresh()
    wx.showToast({
      title: '已保存'
    })
  },

  onStartChange(event) {
    const entry = draft.cloneEntry(this.data.selectedEntry) || worktime.getDefaultWorkEntry(this.store.settings)
    entry.type = worktime.DAY_TYPES.WORK
    entry.start = worktime.getHalfHourTimeFromPickerValue(event.detail.value, entry.start)
    delete entry.presetId
    this.updateDraft(entry)
  },

  onEndChange(event) {
    const entry = draft.cloneEntry(this.data.selectedEntry) || worktime.getDefaultWorkEntry(this.store.settings)
    entry.type = worktime.DAY_TYPES.WORK
    entry.end = worktime.getHalfHourTimeFromPickerValue(event.detail.value, entry.end)
    delete entry.presetId
    this.updateDraft(entry)
  },

  onDeductBreakChange(event) {
    const entry = draft.cloneEntry(this.data.selectedEntry) || worktime.getDefaultWorkEntry(this.store.settings)
    entry.type = worktime.DAY_TYPES.WORK
    entry.deductBreak = getEventValue(event)
    delete entry.presetId
    this.updateDraft(entry)
  },

  onNoteInput(event) {
    this.autoNoteText = ''
    const entry = draft.cloneEntry(this.data.selectedEntry) || worktime.getDefaultWorkEntry(this.store.settings)
    entry.note = getEventValue(event)
    this.updateDraft(entry)
  },

  clearSelected() {
    const nextStore = storage.saveStore(worktime.clearEntry(this.store, this.data.selectedDate))
    this.store = nextStore
    this.setData({
      selectedEntry: worktime.getDefaultWorkEntry(nextStore.settings)
    }, () => this.refresh())
    this.autoNoteText = ''
    wx.showToast({
      title: '已清空',
      icon: 'none'
    })
  }
})
