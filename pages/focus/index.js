const account = require('../../core/account')
const prefs = require('../../core/prefs')
const planDao = require('../../core/plan')
const sessionDao = require('../../core/session')
const runner = require('../../core/runner')
const gain = require('../../core/gain')
const labels = require('../../core/labels')
const monitorProfile = require('../../core/monitor-profile')
const statusbar = require('../../utils/statusbar')
const time = require('../../utils/time')

/** 等首页数据刷新后再播，避免先按旧值演一遍 0 → 1 */
const GAIN_PENDING_MS = 350

function greeting() {
  const h = new Date().getHours()
  if (h >= 5 && h <= 10) return '早上好，开始专注'
  if (h >= 11 && h <= 13) return '中午好，来一个番茄'
  if (h >= 14 && h <= 17) return '下午好，保持节奏'
  if (h >= 18 && h <= 22) return '晚上好，静心专注'
  return '夜深了，注意休息'
}

function buildPlanMeta(plan) {
  const taskTag = plan.monitorEnabled ? ' · ' + planDao.taskModeText(plan.taskMode) : ''
  const base = plan.durationMinutes + ' 分钟 · ' + planDao.frequencyText(plan) +
    ' · 每日 ' + plan.dailyTarget + ' 个' + taskTag
  const withGoal = plan.goal ? base + ' · ' + plan.goal : base
  return planDao.scheduledOn(plan, new Date())
    ? withGoal
    : withGoal + '\n今天不是该计划的执行日，仍可手动开始'
}

Page({
  data: {
    dateTitle: '',
    greeting: '',

    todayTomatoes: 0,
    todayTarget: 0,
    progressPercent: 0,
    todayFocusMinutes: 0,
    cardScale: 1,

    hasPlan: false,
    planName: '',
    planMeta: '',

    monitorEnabled: false,
    monitorLens: 0,
    monitorHint: '持续离开镜头才会判定本次未通过',
    monitorRuleHint: '前置正对：低头看书、闭眼只做提醒；后置俯拍：手机架高朝下，离开座位才算分心。画面仅本机分析，不保存不上传。',
    voiceEnabled: true,

    running: false,
    sessions: [],
    todayCount: 0,
    recordsEmpty: true,
    emptyTodayText: '今天还没有专注记录\n完成一个完整时段即可收获一枚番茄',

    showClearConfirm: false,

    showMenu: false,
    accountName: '',
    accountRoleText: '',
    avatarText: '',

    statusBarHeight: 20,
    navTop: 0,

    gainVisible: false,
    numText: '0',
    numAnim: false,
    tomatoStyle: '',
    rippleStyle: ''
  },

  onLoad() {
    this._dayKey = ''
    this._plan = null
    this._gainAnimating = false
    this._gainTimer = null
    this._gainPendingTimer = null
    // 自定义导航栏：让开状态栏，并避开右上角胶囊按钮
    this.setData({
      statusBarHeight: statusbar.height(),
      navTop: statusbar.safeTop(12)
    })
  },

  onReady() {
    // 冷启动首帧偶发取不到胶囊位置（返回全 0），渲染完成后再校正一次
    const navTop = statusbar.safeTop(12)
    if (navTop !== this.data.navTop) this.setData({ navTop })
  },

  onShow() {
    if (!account.isLoggedIn()) {
      wx.reLaunch({ url: '/pages/login/index' })
      return
    }
    account.autoClearIfNeeded()
    this.refreshAccount()
    this.refresh()
    this.syncTomatoGain()
  },

  onHide() {
    this.clearGainTimers()
  },

  onUnload() {
    this.clearGainTimers()
  },

  clearGainTimers() {
    if (this._gainTimer) {
      clearTimeout(this._gainTimer)
      this._gainTimer = null
    }
    if (this._gainPendingTimer) {
      clearTimeout(this._gainPendingTimer)
      this._gainPendingTimer = null
    }
  },

  // ------------------------------------------------------------ 数据

  refresh() {
    const accountId = prefs.currentAccountId()
    if (accountId <= 0) return

    const today = time.todayKey()
    const dayChanged = this._dayKey !== today
    this._dayKey = today

    const plans = planDao.list(accountId)
    const selected = plans.find((p) => p.id === prefs.selectedPlanId()) || plans[0] || null
    if (selected && selected.id !== prefs.selectedPlanId()) prefs.setSelectedPlanId(selected.id)
    this._plan = selected

    // 监控开关三态：手动设置过以用户为准，否则沿用计划默认值
    const prefMonitor = prefs.monitorEnabled()
    const monitorEnabled = prefMonitor === null
      ? (selected ? !!selected.monitorEnabled : false)
      : prefMonitor

    const tomatoes = sessionDao.dayTomatoes(today, accountId)
    const seconds = sessionDao.daySeconds(today, accountId)
    const rows = sessionDao.sessionsOfDay(today, accountId).map(labels.describeSession)
    const target = selected ? Math.max(0, selected.dailyTarget || 0) : 0
    const paper = !!selected && selected.taskMode === planDao.TASK_PAPER

    const patch = {
      todayTarget: target,
      todayFocusMinutes: Math.floor(seconds / 60),
      hasPlan: !!selected,
      planName: selected ? selected.name : '还没有计划',
      planMeta: selected ? buildPlanMeta(selected) : '点击创建你的第一个专注计划',
      monitorEnabled,
      monitorLens: prefs.monitorLens(),
      voiceEnabled: prefs.voiceOnDistraction(),
      monitorHint: paper
        ? '笔在动、手在动算专注，画面长时间不动才算分心'
        : '持续离开镜头才会判定本次未通过',
      monitorRuleHint: paper
        ? '纸面任务：低头书写、看不到脸都是常态，只要画面里还有笔或手在动就算专注；画面长时间没有动静（离座）才会提示分心。画面仅本机分析，不保存不上传。'
        : '前置正对：低头看书、闭眼只做提醒；后置俯拍：手机架高朝下，离开座位才算分心。画面仅本机分析，不保存不上传。',
      sessions: rows,
      todayCount: rows.length,
      recordsEmpty: rows.length === 0,
      running: runner.isActive()
    }

    // 入账动画期间数字由动画接管，数据刷新不许覆盖
    if (!this._gainAnimating) {
      patch.todayTomatoes = tomatoes
      patch.progressPercent = target > 0 ? Math.min(100, Math.round((tomatoes / target) * 100)) : 0
      patch.numText = String(tomatoes)
    }

    // 记录被清空但当天仍有番茄，说明番茄已计入统计
    const shown = this._gainAnimating ? this.data.todayTomatoes : tomatoes
    if (rows.length === 0) {
      patch.emptyTodayText = shown > 0
        ? '今日记录已清空\n番茄数已计入统计'
        : '今天还没有专注记录\n完成一个完整时段即可收获一枚番茄'
    }

    if (dayChanged) {
      patch.dateTitle = time.dayTitle(new Date())
      patch.greeting = greeting()
    }
    this.setData(patch)
  },

  // ------------------------------------------------------------ 入账动效

  syncTomatoGain() {
    const app = getApp()
    if (!app || !app.takeTomatoGained) return
    if (!app.takeTomatoGained()) return
    if (this._gainPendingTimer) clearTimeout(this._gainPendingTimer)
    // Android 里是等一次数据流，这里数据刷新是同步的，只留一拍让页面可见
    this._gainPendingTimer = setTimeout(() => {
      this._gainPendingTimer = null
      const value = this.data.todayTomatoes
      if (value > 0) this.playGain(value)
    }, GAIN_PENDING_MS)
  },

  playGain(newValue) {
    if (this._gainAnimating) return
    // 首页可能停在滚动中途，先回到顶部，落点才对得上卡片
    wx.pageScrollTo({
      scrollTop: 0,
      duration: 0,
      success: () => this.measureAndPlay(newValue)
    })
  },

  measureAndPlay(newValue) {
    const query = wx.createSelectorQuery()
    query.select('.today-num').boundingClientRect()
    query.exec((res) => {
      const rect = res && res[0]
      if (!rect) return
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const w = info.windowWidth
      const h = info.windowHeight
      const ctx = {
        endX: rect.left + rect.width / 2 - w / 2,
        endY: rect.top + rect.height / 2 - h / 2,
        startY: h * 0.12,
        lift: 44 * (w / 375)
      }
      const oldValue = Math.max(0, newValue - 1)
      this._gainAnimating = true
      const start = gain.initial(ctx)
      this.setData({
        gainVisible: true,
        numText: String(oldValue),
        numAnim: false,
        tomatoStyle: start.tomatoStyle,
        rippleStyle: start.rippleStyle,
        cardScale: 1
      }, () => this.runGainFrames(ctx, newValue))
    })
  },

  runGainFrames(ctx, newValue) {
    const startedAt = Date.now()
    let switched = false
    const step = () => {
      const t = Math.min(gain.TOTAL_MS, Date.now() - startedAt)
      const f = gain.frame(t, ctx)
      const patch = {
        tomatoStyle: f.tomatoStyle,
        rippleStyle: f.rippleStyle,
        cardScale: f.cardScale
      }
      if (!switched && f.switchNumber) {
        switched = true
        patch.numText = String(newValue)
        patch.numAnim = true
      }
      this.setData(patch)

      if (t < gain.TOTAL_MS) {
        this._gainTimer = setTimeout(step, 16)
      } else {
        this.finishGain()
      }
    }
    step()
  },

  finishGain() {
    this._gainTimer = null
    this._gainAnimating = false
    this.setData({
      gainVisible: false,
      cardScale: 1,
      numAnim: false,
      tomatoStyle: '',
      rippleStyle: ''
    })
    this.refresh()
  },

  // ------------------------------------------------------------ 交互

  onStart() {
    if (runner.isActive()) {
      this.openSession()
      return
    }
    if (!this._plan) {
      wx.showToast({ title: '请先创建一个专注计划', icon: 'none' })
      setTimeout(() => wx.switchTab({ url: '/pages/plans/index' }), 500)
      return
    }
    const url = '/pages/session/index?planId=' + this._plan.id +
      '&monitor=' + (this.data.monitorEnabled ? 1 : 0) +
      '&lens=' + this.data.monitorLens
    wx.navigateTo({ url })
  },

  /** 会话还在跑时点按钮，回到栈里已有的专注页而不是再开一个 */
  openSession() {
    const pages = getCurrentPages()
    for (let i = pages.length - 1; i >= 0; i--) {
      if (pages[i].route === 'pages/session/index') {
        wx.navigateBack({ delta: pages.length - 1 - i })
        return
      }
    }
    wx.navigateTo({ url: '/pages/session/index' })
  },

  openPlans() {
    wx.switchTab({ url: '/pages/plans/index' })
  },

  onMonitorChange(e) {
    prefs.setMonitorEnabled(!!e.detail.value)
    this.setData({ monitorEnabled: !!e.detail.value })
  },

  onLensTap(e) {
    const lens = Number(e.currentTarget.dataset.lens) === 1 ? 1 : 0
    prefs.setMonitorLens(lens)
    this.setData({ monitorLens: lens })
  },

  onVoiceChange(e) {
    prefs.setVoiceOnDistraction(!!e.detail.value)
    this.setData({ voiceEnabled: !!e.detail.value })
  },

  openMonitorSettings() {
    const plan = this._plan
    const scene = monitorProfile.sceneOf(
      this.data.monitorLens === 1,
      !!plan && plan.taskMode === planDao.TASK_PAPER
    )
    wx.navigateTo({ url: '/pages/monitor-settings/index?scene=' + scene.key })
  },

  // ------------------------------------------------------------ 账户菜单

  refreshAccount() {
    const acc = account.currentAccount()
    if (!acc) return
    this.setData({
      accountName: acc.username || '微信用户',
      accountRoleText: '微信登录',
      avatarText: '微'
    })
  },

  openMenu() {
    this.refreshAccount()
    this.setData({ showMenu: true })
  },

  closeMenu() {
    this.setData({ showMenu: false })
  },

  menuMonitor() {
    this.setData({ showMenu: false })
    this.openMonitorSettings()
  },

  menuAbout() {
    this.setData({ showMenu: false })
    wx.navigateTo({ url: '/pages/about/index' })
  },

  menuLogout() {
    this.setData({ showMenu: false })
    wx.showModal({
      title: '退出登录',
      content: '退出后本机数据仍然保留，下次用同一微信登录即可继续。',
      confirmText: '退出',
      success: (res) => {
        if (!res.confirm) return
        account.logout()
        wx.reLaunch({ url: '/pages/login/index' })
      }
    })
  },

  testVoice() {
    try {
      wx.vibrateShort({ type: 'medium' })
    } catch (e) {
      /* ignore */
    }
    wx.showToast({ title: '小程序不支持语音播报，已用震动代替', icon: 'none' })
  },

  askClearToday() {
    this.setData({ showClearConfirm: true })
  },

  onClearCancel() {
    this.setData({ showClearConfirm: false })
  },

  onClearConfirm() {
    this.setData({ showClearConfirm: false })
    const n = sessionDao.clearDay(time.todayKey(), prefs.currentAccountId())
    this.refresh()
    wx.showToast({
      title: n > 0 ? '已清空 ' + n + ' 条今日记录' : '今天没有可清空的记录',
      icon: 'none'
    })
  }
})
