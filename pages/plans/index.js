const planDao = require('../../core/plan')
const prefs = require('../../core/prefs')

Page({
  data: {
    plans: [],
    empty: true,
    showDelete: false,
    deleteName: '',
    deleteId: 0
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const accountId = prefs.currentAccountId()
    const list = planDao.list(accountId)
    const selectedId = prefs.selectedPlanId()
    const resolved = list.find((p) => p.id === selectedId) || list[0] || null
    if (resolved && resolved.id !== selectedId) prefs.setSelectedPlanId(resolved.id)

    const plans = list.map((p) => ({
      id: p.id,
      name: p.name,
      goalText: p.goal || '未设置专注目标',
      tags: p.durationMinutes + ' 分钟 · ' + planDao.frequencyText(p) + ' · 每日 ' +
        p.dailyTarget + ' 个' +
        (p.monitorEnabled ? ' · 监控 · ' + planDao.taskModeText(p.taskMode) : ''),
      current: !!resolved && p.id === resolved.id
    }))
    this.setData({ plans, empty: plans.length === 0 })
  },

  /** 点卡片即切为当前计划，与 Android 一致 */
  onSelect(e) {
    const id = Number(e.currentTarget.dataset.id)
    const target = this.data.plans.find((p) => p.id === id)
    if (!target) return
    prefs.setSelectedPlanId(id)
    this.refresh()
    wx.showToast({ title: '已选择「' + target.name + '」', icon: 'none' })
  },

  onMore(e) {
    const id = Number(e.currentTarget.dataset.id)
    const target = this.data.plans.find((p) => p.id === id)
    if (!target) return
    wx.showActionSheet({
      itemList: ['编辑', '删除'],
      success: (res) => {
        if (res.tapIndex === 0) this.openEditor(id)
        else if (res.tapIndex === 1) this.askDelete(target)
      }
    })
  },

  onCreate() {
    wx.navigateTo({ url: '/pages/plan-edit/index' })
  },

  openEditor(id) {
    wx.navigateTo({ url: '/pages/plan-edit/index?id=' + id })
  },

  askDelete(target) {
    this.setData({
      showDelete: true,
      deleteName: target.name,
      deleteId: target.id
    })
  },

  onDeleteCancel() {
    this.setData({ showDelete: false })
  },

  onDeleteConfirm() {
    const id = this.data.deleteId
    this.setData({ showDelete: false })
    planDao.remove(id)
    if (prefs.selectedPlanId() === id) prefs.setSelectedPlanId(0)
    this.refresh()
    wx.showToast({ title: '已删除', icon: 'none' })
  }
})
