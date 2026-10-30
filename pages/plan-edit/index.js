const planDao = require('../../core/plan')
const prefs = require('../../core/prefs')

const TASK_HINT_SCREEN = '看网课、看视频：面部朝向屏幕才算专注，低头、闭眼只提醒'
const TASK_HINT_PAPER = '写作业、看书：低头书写算专注；俯拍时笔和手在动就不判分心，画面长时间没动静才提示'

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

function strictHint(strictness, taskMode) {
  const paper = taskMode === planDao.TASK_PAPER
  if (paper) {
    if (strictness === 0) return '只做页内提醒，不会判定失败；抬头、离座都不影响番茄'
    if (strictness === 2) return '抬头、闭眼也计入分心，连续 15 秒或分心占比超过 10% 即判定未通过'
    return '低头书写视为专注；连续抬头或离座 30 秒、分心占比超过 20% 才判定未通过'
  }
  if (strictness === 0) return '只做页内提醒，不会判定失败；低头看书、短暂离开都不影响番茄'
  if (strictness === 2) return '低头、闭眼也计入分心，连续 12 秒或累计 15% 时长即判定未通过'
  return '低头看书只提醒；连续离开镜头 25 秒或累计 30% 时长才判定未通过'
}

function weekdayList(mask) {
  return WEEKDAY_LABELS.map((label, bit) => ({
    bit,
    label,
    on: ((mask >> bit) & 1) === 1
  }))
}

Page({
  data: {
    planId: 0,
    isEdit: false,
    name: '',
    nameError: '',
    goal: '',
    duration: 25,
    durationText: '25',
    dailyTarget: 4,
    dailyTargetText: '4',
    frequencyType: 0,
    customVisible: false,
    weekdays: weekdayList(planDao.MASK_ALL),
    taskMode: planDao.TASK_SCREEN,
    taskHint: TASK_HINT_SCREEN,
    strictness: 1,
    strictHint: strictHint(1, planDao.TASK_SCREEN),
    monitorEnabled: false,
    showDelete: false
  },

  onLoad(options) {
    const id = Number(options && options.id) || 0
    this.setData({ planId: id, isEdit: id > 0 })
    wx.setNavigationBarTitle({ title: id > 0 ? '编辑计划' : '新建计划' })
    if (id > 0) {
      const plan = planDao.get(id)
      if (plan) this.fill(plan)
    }
  },

  fill(plan) {
    this.setData({
      name: plan.name,
      goal: plan.goal || '',
      duration: plan.durationMinutes,
      durationText: String(plan.durationMinutes),
      dailyTarget: plan.dailyTarget,
      dailyTargetText: String(plan.dailyTarget),
      frequencyType: plan.frequencyType,
      customVisible: plan.frequencyType === planDao.FREQ_CUSTOM,
      weekdays: weekdayList(plan.weekdaysMask),
      taskMode: plan.taskMode,
      taskHint: plan.taskMode === planDao.TASK_PAPER ? TASK_HINT_PAPER : TASK_HINT_SCREEN,
      strictness: plan.strictness,
      strictHint: strictHint(plan.strictness, plan.taskMode),
      monitorEnabled: !!plan.monitorEnabled
    })
  },

  // ------------------------------------------------------------ 表单

  onNameInput(e) {
    this.setData({ name: e.detail.value, nameError: '' })
  },

  onGoalInput(e) {
    this.setData({ goal: e.detail.value })
  },

  onDurationChange(e) {
    const v = Number(e.detail.value) || 25
    this.setData({ duration: v, durationText: String(v) })
  },

  onDailyTargetChange(e) {
    const v = Number(e.detail.value) || 1
    this.setData({ dailyTarget: v, dailyTargetText: String(v) })
  },

  onFreqTap(e) {
    const type = Number(e.currentTarget.dataset.type) || 0
    this.setData({ frequencyType: type, customVisible: type === planDao.FREQ_CUSTOM })
  },

  onWeekdayTap(e) {
    const bit = Number(e.currentTarget.dataset.bit)
    const weekdays = this.data.weekdays.map((w) => (
      w.bit === bit ? { bit: w.bit, label: w.label, on: !w.on } : w
    ))
    this.setData({ weekdays })
  },

  onTaskTap(e) {
    const mode = Number(e.currentTarget.dataset.mode) === planDao.TASK_PAPER
      ? planDao.TASK_PAPER
      : planDao.TASK_SCREEN
    this.setData({
      taskMode: mode,
      taskHint: mode === planDao.TASK_PAPER ? TASK_HINT_PAPER : TASK_HINT_SCREEN,
      strictHint: strictHint(this.data.strictness, mode)
    })
  },

  onStrictTap(e) {
    const strictness = Number(e.currentTarget.dataset.strict) || 0
    this.setData({
      strictness,
      strictHint: strictHint(strictness, this.data.taskMode)
    })
  },

  onMonitorChange(e) {
    this.setData({ monitorEnabled: !!e.detail.value })
  },

  // ------------------------------------------------------------ 保存 / 删除

  onSave() {
    const name = String(this.data.name || '').trim()
    if (!name) {
      this.setData({ nameError: '请输入计划名称' })
      return
    }

    let mask = planDao.MASK_ALL
    if (this.data.frequencyType === planDao.FREQ_CUSTOM) {
      mask = this.data.weekdays.reduce((acc, w) => acc | (w.on ? (1 << w.bit) : 0), 0)
      if (mask === 0) {
        wx.showToast({ title: '请至少选择一天', icon: 'none' })
        return
      }
    }

    const saved = planDao.save(planDao.fromForm({
      id: this.data.planId,
      accountId: prefs.currentAccountId(),
      name,
      goal: this.data.goal,
      durationMinutes: this.data.duration,
      frequencyType: this.data.frequencyType,
      weekdaysMask: mask,
      dailyTarget: this.data.dailyTarget,
      monitorEnabled: this.data.monitorEnabled,
      strictness: this.data.strictness,
      taskMode: this.data.taskMode
    }))

    // 第一个计划自动成为当前计划
    if (saved && prefs.selectedPlanId() === 0) prefs.setSelectedPlanId(saved.id)
    wx.showToast({ title: '计划已保存', icon: 'none' })
    setTimeout(() => wx.navigateBack({ delta: 1 }), 300)
  },

  askDelete() {
    this.setData({ showDelete: true })
  },

  onDeleteCancel() {
    this.setData({ showDelete: false })
  },

  onDeleteConfirm() {
    const id = this.data.planId
    this.setData({ showDelete: false })
    planDao.remove(id)
    if (prefs.selectedPlanId() === id) prefs.setSelectedPlanId(0)
    wx.showToast({ title: '已删除', icon: 'none' })
    setTimeout(() => wx.navigateBack({ delta: 1 }), 300)
  }
})
