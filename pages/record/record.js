const worktime = require('../../utils/worktime')
const storage = require('../../utils/storage')
const view = require('../../utils/view')

function cloneEntry(entry) {
  return entry ? JSON.parse(JSON.stringify(entry)) : null
}

function snapshotEntry(entry) {
  if (!entry || !entry.type) {
    return null
  }
  if (entry.type === worktime.DAY_TYPES.REST || entry.type === worktime.DAY_TYPES.LEAVE) {
    return {
      type: entry.type,
      note: entry.note ? String(entry.note) : ''
    }
  }
  return {
    type: worktime.DAY_TYPES.WORK,
    start: entry.start ? String(entry.start) : '',
    end: entry.end ? String(entry.end) : '',
    deductBreak: typeof entry.deductBreak === 'boolean' ? entry.deductBreak : null,
    presetId: entry.presetId ? String(entry.presetId) : '',
    note: entry.note ? String(entry.note) : ''
  }
}

function sameEntry(left, right) {
  return JSON.stringify(snapshotEntry(left)) === JSON.stringify(snapshotEntry(right))
}

function ensureDraftDefaults(entry, settings) {
  if (!entry || entry.type !== worktime.DAY_TYPES.WORK) {
    return entry
  }
  const draft = cloneEntry(entry)
  if (!draft.start) {
    draft.start = settings.defaultStart
  }
  if (!draft.end) {
    draft.end = settings.defaultEnd
  }
  if (typeof draft.deductBreak !== 'boolean') {
    draft.deductBreak = settings.defaultDeductBreak !== false
  }
  return draft
}

function buildDraftEntry(store, dateKey) {
  const savedEntry = storage.getStoredEntry(store, dateKey)
  if (savedEntry) {
    const draft = cloneEntry(savedEntry)
    if (draft.type === worktime.DAY_TYPES.WORK && typeof draft.deductBreak !== 'boolean') {
      draft.deductBreak = worktime.calculateEntry(draft, store.settings).breakDeducted > 0
    }
    return draft
  }
  return worktime.getDefaultWorkEntry(store.settings)
}

function normalizeBaselineEntry(entry, settings) {
  if (!entry || entry.type !== worktime.DAY_TYPES.WORK) {
    return entry
  }
  const baseline = cloneEntry(entry)
  if (typeof baseline.deductBreak !== 'boolean') {
    baseline.deductBreak = worktime.calculateEntry(baseline, settings).breakDeducted > 0
  }
  return baseline
}

function buildDraftState(store, dateKey, draftEntry) {
  const savedEntry = storage.getStoredEntry(store, dateKey)
  const baseline = savedEntry ? normalizeBaselineEntry(savedEntry, store.settings) : worktime.getDefaultWorkEntry(store.settings)
  const calc = worktime.calculateEntry(draftEntry, store.settings)
  return {
    savedEntry,
    isDirty: !sameEntry(draftEntry, baseline),
    calc
  }
}

function findPresetIndex(presets, presetId) {
  return presets.findIndex((preset) => preset.id === presetId)
}

function isSavedManualWorkEntry(entry) {
  return !!entry && entry.type === worktime.DAY_TYPES.WORK && !entry.presetId
}

function resolveManualEditorVisible(savedEntry, draftEntry, previousVisible) {
  if (!draftEntry || draftEntry.type !== worktime.DAY_TYPES.WORK || draftEntry.presetId) {
    return false
  }
  if (isSavedManualWorkEntry(savedEntry)) {
    return true
  }
  return !!previousVisible
}

function buildDraftStateTheme(hasRecord, isDirty) {
  if (isDirty) {
    return 'warning'
  }
  return hasRecord ? 'success' : 'primary'
}

function getEventValue(event) {
  const detail = event ? event.detail : ''
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value
  }
  return detail
}

function getEntryTimePickerValue(entry, key, settings) {
  const fallback = key === 'start' ? settings.defaultStart : settings.defaultEnd
  return worktime.getHalfHourTimePickerValue(entry && entry[key], fallback)
}

function normalizeManualEntryTimes(entry, settings) {
  const draft = cloneEntry(entry)
  draft.start = worktime.roundToHalfHourTime(draft.start, settings.defaultStart)
  draft.end = worktime.roundToHalfHourTime(draft.end, settings.defaultEnd)
  return draft
}

function getAutoNoteText(entry, settings) {
  if (!entry || !entry.type) {
    return ''
  }
  if (entry.type === worktime.DAY_TYPES.REST || entry.type === worktime.DAY_TYPES.LEAVE) {
    return worktime.TYPE_LABELS[entry.type]
  }
  if (entry.type !== worktime.DAY_TYPES.WORK) {
    return ''
  }
  const calc = worktime.calculateEntry(entry, settings)
  if (!calc.valid) {
    return ''
  }
  return calc.diffMinutes === 0 ? '全天' : worktime.formatTimeRange(entry)
}

function isSystemAutoNoteText(note) {
  const text = note ? String(note) : ''
  return text === '全天' || text === '本休' || text === '调休' || /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(text)
}

function getInitialAutoNoteText(entry, settings) {
  const note = entry && entry.note ? String(entry.note) : ''
  const autoNote = getAutoNoteText(entry, settings)
  return note && autoNote && note === autoNote ? autoNote : ''
}

function applyAutoNote(entry, settings, previousAutoNote) {
  const draft = cloneEntry(entry)
  if (!draft) {
    return {
      entry: draft,
      autoNoteText: ''
    }
  }
  const note = draft.note ? String(draft.note) : ''
  const autoNote = getAutoNoteText(draft, settings)
  if (!autoNote) {
    if (previousAutoNote && note === previousAutoNote) {
      draft.note = ''
    }
    return {
      entry: draft,
      autoNoteText: ''
    }
  }

  if (!note || note === previousAutoNote || isSystemAutoNoteText(note)) {
    draft.note = autoNote
    return {
      entry: draft,
      autoNoteText: autoNote
    }
  }

  return {
    entry: draft,
    autoNoteText: ''
  }
}

Page({
  autoNoteText: '',

  data: {
    store: worktime.createDefaultStore(),
    selectedDate: worktime.getTodayKey(),
    selectedDateLabel: '',
    selectedHasRecord: false,
    isDraftDirty: false,
    draftStateLabel: '草稿',
    draftStateTheme: 'primary',
    selectedEntry: worktime.getDefaultWorkEntry(),
    isManualEditorVisible: false,
    selectedSummary: '',
    selectedWarning: '',
    presets: [],
    presetOptions: [],
    selectedPresetIndex: 0,
    selectedPresetLabel: '选择班次',
    timePickerRange: worktime.buildHalfHourTimePickerRange(),
    startTimePickerValue: worktime.getHalfHourTimePickerValue('09:30'),
    endTimePickerValue: worktime.getHalfHourTimePickerValue('17:00')
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
    if (pendingDate) {
      this.setData({
        selectedDate: pendingDate
      })
    }
    this.refresh()
  },

  refresh() {
    const store = storage.loadStore()
    const selectedDate = this.data.selectedDate || worktime.getTodayKey()
    const draftEntry = buildDraftEntry(store, selectedDate)
    const draftState = buildDraftState(store, selectedDate, draftEntry)
    const selectedPreset = worktime.getPresetById(store, draftEntry.presetId)
    this.autoNoteText = getInitialAutoNoteText(draftEntry, store.settings)

    this.setData({
      store,
      selectedDate,
      selectedHasRecord: !!draftState.savedEntry,
      isDraftDirty: draftState.isDirty,
      draftStateLabel: view.buildSaveStateLabel(!!draftState.savedEntry, draftState.isDirty),
      draftStateTheme: buildDraftStateTheme(!!draftState.savedEntry, draftState.isDirty),
      selectedEntry: draftEntry,
      isManualEditorVisible: isSavedManualWorkEntry(draftState.savedEntry),
      presets: store.settings.presets,
      presetOptions: view.buildPresetOptions(store.settings.presets),
      selectedPresetIndex: Math.max(0, findPresetIndex(store.settings.presets, draftEntry.presetId)),
      selectedPresetLabel: selectedPreset ? worktime.formatPresetOption(selectedPreset) : '选择班次',
      selectedDateLabel: selectedDate,
      selectedSummary: view.buildEntrySummary(draftState.calc),
      selectedWarning: draftState.calc.valid ? '' : draftState.calc.error,
      startTimePickerValue: getEntryTimePickerValue(draftEntry, 'start', store.settings),
      endTimePickerValue: getEntryTimePickerValue(draftEntry, 'end', store.settings)
    })
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
        confirmColor: '#b13b2e',
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
    const preparedDraft = cloneEntry(nextEntry) || worktime.getDefaultWorkEntry(this.data.store.settings)
    const autoNoteResult = applyAutoNote(preparedDraft, this.data.store.settings, this.autoNoteText)
    const draftEntry = autoNoteResult.entry || worktime.getDefaultWorkEntry(this.data.store.settings)
    this.autoNoteText = autoNoteResult.autoNoteText
    const draftState = buildDraftState(this.data.store, this.data.selectedDate, draftEntry)
    const selectedPreset = worktime.getPresetById(this.data.store, draftEntry.presetId)
    const isManualEditorVisible = typeof manualEditorOverride === 'boolean'
      ? manualEditorOverride
      : resolveManualEditorVisible(draftState.savedEntry, draftEntry, this.data.isManualEditorVisible)
    this.setData({
      selectedEntry: draftEntry,
      isDraftDirty: draftState.isDirty,
      draftStateLabel: view.buildSaveStateLabel(!!draftState.savedEntry, draftState.isDirty),
      draftStateTheme: buildDraftStateTheme(!!draftState.savedEntry, draftState.isDirty),
      isManualEditorVisible,
      selectedPresetIndex: Math.max(0, findPresetIndex(this.data.store.settings.presets, draftEntry.presetId)),
      selectedPresetLabel: selectedPreset ? worktime.formatPresetOption(selectedPreset) : '选择班次',
      selectedSummary: view.buildEntrySummary(draftState.calc),
      selectedWarning: draftState.calc.valid ? '' : draftState.calc.error,
      startTimePickerValue: getEntryTimePickerValue(draftEntry, 'start', this.data.store.settings),
      endTimePickerValue: getEntryTimePickerValue(draftEntry, 'end', this.data.store.settings)
    })
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
    let entry = cloneEntry(this.data.selectedEntry) || worktime.getDefaultWorkEntry(this.data.store.settings)
    entry.type = type
    if (type === worktime.DAY_TYPES.WORK) {
      entry = ensureDraftDefaults(entry, this.data.store.settings)
    }
    this.updateDraft(entry, false)
  },

  selectPreset(event) {
    const preset = worktime.getPresetById(this.data.store, event.currentTarget.dataset.id)
    if (!preset) {
      wx.showToast({
        title: '班次不存在',
        icon: 'none'
      })
      return
    }
    this.updateDraft(worktime.entryFromPreset(preset, this.data.selectedEntry.note), false)
  },

  onPresetPickerChange(event) {
    const index = Number(event.detail.value)
    const preset = this.data.presets[index]
    if (!preset) {
      return
    }
    this.updateDraft(worktime.entryFromPreset(preset, this.data.selectedEntry.note), false)
  },

  useManualMode() {
    let entry = cloneEntry(this.data.selectedEntry) || worktime.getDefaultWorkEntry(this.data.store.settings)
    delete entry.presetId
    entry.type = worktime.DAY_TYPES.WORK
    entry = ensureDraftDefaults(entry, this.data.store.settings)
    entry = normalizeManualEntryTimes(entry, this.data.store.settings)
    this.updateDraft(entry, true)
  },

  saveDraft() {
    const result = worktime.saveEntry(this.data.store, this.data.selectedDate, this.data.selectedEntry)
    if (!result.ok) {
      wx.showToast({
        title: result.message,
        icon: 'none'
      })
      return
    }
    const savedStore = storage.saveStore(result.store)
    this.setData({
      store: savedStore
    }, () => this.refresh())
    wx.showToast({
      title: '已保存'
    })
  },

  onStartChange(event) {
    const entry = cloneEntry(this.data.selectedEntry) || worktime.getDefaultWorkEntry(this.data.store.settings)
    entry.type = worktime.DAY_TYPES.WORK
    entry.start = worktime.getHalfHourTimeFromPickerValue(event.detail.value, entry.start)
    delete entry.presetId
    this.updateDraft(entry)
  },

  onEndChange(event) {
    const entry = cloneEntry(this.data.selectedEntry) || worktime.getDefaultWorkEntry(this.data.store.settings)
    entry.type = worktime.DAY_TYPES.WORK
    entry.end = worktime.getHalfHourTimeFromPickerValue(event.detail.value, entry.end)
    delete entry.presetId
    this.updateDraft(entry)
  },

  onDeductBreakChange(event) {
    const entry = cloneEntry(this.data.selectedEntry) || worktime.getDefaultWorkEntry(this.data.store.settings)
    entry.type = worktime.DAY_TYPES.WORK
    entry.deductBreak = getEventValue(event)
    delete entry.presetId
    this.updateDraft(entry)
  },

  onNoteInput(event) {
    this.autoNoteText = ''
    const entry = cloneEntry(this.data.selectedEntry) || worktime.getDefaultWorkEntry(this.data.store.settings)
    entry.note = getEventValue(event)
    this.updateDraft(entry)
  },

  onNoteBlur() {
    return
  },

  clearSelected() {
    const nextStore = storage.saveStore(worktime.clearEntry(this.data.store, this.data.selectedDate))
    this.setData({
      store: nextStore,
      selectedEntry: worktime.getDefaultWorkEntry(nextStore.settings)
    }, () => this.refresh())
    this.autoNoteText = ''
    wx.showToast({
      title: '已清空',
      icon: 'none'
    })
  }
})
