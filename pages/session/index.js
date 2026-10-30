const prefs = require('../../core/prefs')
const planDao = require('../../core/plan')
const runner = require('../../core/runner')
const monitor = require('../../core/monitor')
const time = require('../../utils/time')

const PHASE = runner.PHASE

Page({
  data: {
    planName: '专注',
    goalText: '',
    warnGoal: false,
    remainingText: '00:00',
    phaseText: '',
    strictTag: '未开启监控',

    monitorStateText: '未开启摄像头监控',
    monitorStateClass: '',
    distractInfo: '本次不检测分心行为',
    cardDistraction: false,
    distractionText: '',

    active: false,
    paused: false,
    pauseText: '暂停',
    showAbandonConfirm: false,

    showCamera: false,
    cameraPosition: 'front'
  },

  onLoad(options) {
    this._unsub = null
    this._resultShown = false
    this._ringReady = false
    this._lastProgress = -1
    this._planId = Number(options && options.planId) || 0
    this._monitorArg = options && options.monitor === '1'
    this._lens = Number(options && options.lens) || 0
    this._started = false
    this._cameraReady = false
  },

  onReady() {
    this.initRing()
  },

  onShow() {
    if (runner.isActive()) {
      runner.resumeFromBackground()
      this.startMonitor()
    } else if (!this._started) {
      this._started = true
      this.startSession()
    }
    this.subscribe()
  },

  onHide() {
    monitor.stop()
    if (runner.isActive()) runner.pauseByBackground()
  },

  onUnload() {
    monitor.stop()
    if (this._unsub) {
      this._unsub()
      this._unsub = null
    }
    // 系统返回键直接离开：与 Android 结束本次专注一致，不计番茄
    if (runner.isActive()) runner.abandon()
  },

  // ------------------------------------------------------------ 启动

  startSession() {
    let planId = this._planId
    if (!planId) {
      const loggedId = prefs.currentAccountId()
      const plans = planDao.list(loggedId)
      const selected = plans.find((p) => p.id === prefs.selectedPlanId()) || plans[0]
      planId = selected ? selected.id : 0
    }
    const plan = planId > 0 ? planDao.get(planId) : null
    if (!plan) {
      wx.showToast({ title: '计划不存在', icon: 'none' })
      setTimeout(() => wx.navigateBack({ delta: 1 }), 600)
      return
    }
    if (this._lens) prefs.setMonitorLens(this._lens)
    runner.start(plan, this._monitorArg)
    wx.vibrateShort({ type: 'light' })

    if (this._monitorArg) this.requestCamera()
  },

  // ------------------------------------------------------------ 摄像头监控

  /** 首次开启监控时申请摄像头授权，拒绝则明确按无监控计时 */
  requestCamera() {
    const lens = this._lens || prefs.monitorLens()
    this.setData({ cameraPosition: lens === 1 ? 'back' : 'front' })
    wx.authorize({
      scope: 'scope.camera',
      success: () => {
        this.setData({ showCamera: true }, () => {
          // 个别机型 camera 的 initdone 不回调，这里延时兜底再试一次
          setTimeout(() => this.startMonitor(), 800)
        })
      },
      fail: () => {
        runner.markMonitorUnavailable('未获得摄像头授权，本次专注按无监控计时')
        wx.showModal({
          title: '摄像头未授权',
          content: '开启摄像头才能检测分心。可在小程序右上角「···」→「设置」里打开摄像头权限，重新开始后生效。',
          showCancel: false,
          confirmText: '知道了'
        })
      }
    })
  },

  onCameraReady() {
    this._cameraReady = true
    this.startMonitor()
  },

  onCameraError(e) {
    const detail = (e && e.detail && (e.detail.errMsg || e.detail.errCode)) || ''
    monitor.stop()
    runner.markMonitorUnavailable(
      '摄像头启动失败' + (detail ? '（' + detail + '）' : '') + '，本次专注按无监控计时'
    )
  },

  /** 用当前页面已就绪的 camera 启动取帧判定 */
  startMonitor() {
    const st = runner.getState()
    if (!st.monitorEnabled) return
    if (!this.data.showCamera) return
    // initdone 与延时兜底会各触发一次，避免重复注册监听
    if (monitor.isRunning()) return
    let ctx = null
    try {
      ctx = wx.createCameraContext()
    } catch (e) {
      ctx = null
    }
    if (!ctx) {
      runner.markMonitorUnavailable('当前环境不支持摄像头取帧，本次专注按无监控计时')
      return
    }
    monitor.start({
      ctx,
      lens: this._lens || prefs.monitorLens(),
      taskMode: st.taskMode
    })
  },

  subscribe() {
    if (this._unsub) return
    this._unsub = runner.subscribe((st) => this.render(st))
    this.render(runner.getState())
  },

  // ------------------------------------------------------------ 进度环

  initRing() {
    const query = wx.createSelectorQuery()
    query.select('#ring').fields({ node: true, size: true }).exec((res) => {
      const item = res && res[0]
      if (!item || !item.node) return
      const canvas = item.node
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const dpr = info.pixelRatio || 1
      canvas.width = item.width * dpr
      canvas.height = item.height * dpr
      const ctx = canvas.getContext('2d')
      ctx.scale(dpr, dpr)
      this._ctx = ctx
      this._ringSize = item.width
      // 环宽 14dp
      this._ringWidth = (28 * info.windowWidth) / 750
      this._ringReady = true
      const st = runner.getState()
      this.drawRing(st.progress || 0, false)
    })
  },

  drawRing(progress, warn) {
    if (!this._ringReady) return
    const ctx = this._ctx
    const size = this._ringSize
    const rw = this._ringWidth
    ctx.clearRect(0, 0, size, size)
    const c = size / 2
    const r = (size - rw) / 2
    ctx.lineWidth = rw
    ctx.lineCap = 'round'

    ctx.strokeStyle = '#F0E5DE'
    ctx.beginPath()
    ctx.arc(c, c, r, 0, Math.PI * 2)
    ctx.stroke()

    if (progress > 0) {
      ctx.strokeStyle = warn ? '#E9A23B' : '#E4572E'
      ctx.beginPath()
      ctx.arc(c, c, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, progress))
      ctx.stroke()
    }
  },

  // ------------------------------------------------------------ 渲染

  render(st) {
    if (!st) return
    const paper = st.taskMode === 1
    const warn = st.severeDistracted || st.pendingAbandon

    if (st.progress !== this._lastProgress) {
      this._lastProgress = st.progress
      this.drawRing(st.progress, warn)
    } else if (warn !== this._lastWarn) {
      this.drawRing(st.progress, warn)
    }
    this._lastWarn = warn

    const patch = {
      planName: st.planName || '专注',
      goalText: this.goalTextOf(st),
      warnGoal: !!st.pendingAbandon,
      remainingText: time.clock(st.remainingSeconds),
      phaseText: this.phaseTextOf(st),
      strictTag: this.strictTagOf(st),
      monitorStateText: this.monitorStateOf(st).text,
      monitorStateClass: this.monitorStateOf(st).cls,
      distractInfo: this.distractInfoOf(st),
      cardDistraction: !!(st.monitorActive && st.instantDistracted && st.phase === PHASE.RUNNING),
      distractionText: this.distractionTextOf(st),
      active: st.phase === PHASE.RUNNING || st.phase === PHASE.PAUSED,
      paused: st.phase === PHASE.PAUSED,
      pauseText: st.phase === PHASE.PAUSED ? '继续专注' : '暂停'
    }
    this.setData(patch)

    if (st.phase === PHASE.COMPLETED || st.phase === PHASE.INVALID || st.phase === PHASE.ABANDONED) {
      this.showResult(st)
    }
  },

  goalTextOf(st) {
    if (st.pendingAbandon) {
      if (st.message) return st.message
      return st.taskMode === 1 ? '请回到专注状态，否则本次不计入番茄' : '请回到镜头前，否则本次不计入番茄'
    }
    return st.planGoal || '保持专注，完成这个时段'
  },

  phaseTextOf(st) {
    if (st.phase === PHASE.RUNNING) {
      if (st.pendingAbandon || st.severeDistracted) {
        return st.taskMode === 1 ? '请回到专注状态' : '请回到镜头前'
      }
      if (st.instantDistracted) return '专注中（轻微偏离）'
      return '专注中'
    }
    if (st.phase === PHASE.PAUSED) return st.pausedByBackground ? '已暂停 · 请留在本页面' : '已暂停'
    if (st.phase === PHASE.COMPLETED) return '已完成'
    if (st.phase === PHASE.INVALID) return '监控未通过'
    if (st.phase === PHASE.ABANDONED) return '已结束'
    return ''
  },

  strictTagOf(st) {
    let tag = '未开启监控'
    if (st.monitorEnabled) {
      if (st.strictness === 0) tag = '宽松监控'
      else if (st.strictness === 2) tag = '严格监控'
      else tag = '标准监控'
      if (prefs.monitorLens() === 1) tag += ' · 俯拍'
      if (st.taskMode === 1) tag += ' · 纸面'
    }
    return tag
  },

  monitorStateOf(st) {
    if (!st.monitorEnabled) {
      // 授权失败、取帧中断等降级原因直接说明，不假装在检测
      if (st.message && st.message.indexOf('摄像头') >= 0) return { text: st.message, cls: 'warn' }
      return { text: '未开启摄像头监控', cls: '' }
    }
    if (st.pendingAbandon) return { text: '分心超标 · 宽限中', cls: 'warn' }
    if (st.monitorActive && st.instantDistracted) {
      return { text: st.severeDistracted ? '检测到分心' : '轻微偏离', cls: 'warn' }
    }
    if (st.monitorActive && st.monitorNote) return { text: '专注中', cls: 'ok' }
    if (st.monitorActive) return { text: '专注中', cls: 'ok' }
    return { text: st.phase === PHASE.RUNNING || st.phase === PHASE.PAUSED ? '监控启动中…' : '监控已停止', cls: '' }
  },

  distractInfoOf(st) {
    if (!st.monitorEnabled) return '本次不检测分心行为'
    if (st.pendingAbandon) return '请回到镜头前，否则本次不计入番茄'
    if (st.monitorActive && st.instantDistracted) {
      return '分心 ' + st.distractionCount + ' 次 · 累计 ' + st.distractedSeconds + ' 秒'
    }
    if (st.monitorActive && st.monitorNote) return st.monitorNote
    if (st.monitorActive) return '分心 ' + st.distractionCount + ' 次 · 累计 ' + st.distractedSeconds + ' 秒'
    return '分心 ' + st.distractionCount + ' 次'
  },

  distractionTextOf(st) {
    if (!st.severeDistracted) {
      if (st.distractionReason) return st.distractionReason
      return st.taskMode === 1 ? '轻微提醒，不影响本次专注' : '轻微偏离，不影响本次专注'
    }
    return st.distractionReason || '检测到分心，请回到专注状态'
  },

  // ------------------------------------------------------------ 交互

  onPauseToggle() {
    const st = runner.getState()
    if (st.phase === PHASE.PAUSED) {
      runner.resume()
      // 暂停期间摄像头已关闭，继续时重新取帧
      this.startMonitor()
    } else if (st.phase === PHASE.RUNNING) {
      runner.pause()
      monitor.stop()
    }
  },

  askAbandon() {
    this.setData({ showAbandonConfirm: true })
  },

  onAbandonCancel() {
    this.setData({ showAbandonConfirm: false })
  },

  onAbandonConfirm() {
    this.setData({ showAbandonConfirm: false })
    runner.abandon()
  },

  /** 结束收尾：只用一条提示说明结果，然后回首页看番茄入账 */
  showResult(st) {
    if (this._resultShown) return
    this._resultShown = true

    const completed = st.phase === PHASE.COMPLETED
    let message
    if (completed) {
      message = '「' + st.planName + '」专注 ' + Math.floor(st.plannedSeconds / 60) + ' 分钟，收获 1 个番茄'
    } else if (st.phase === PHASE.INVALID) {
      message = st.message || '检测到持续分心，本次专注不计入番茄'
    } else {
      message = '本次专注 ' + Math.floor(st.elapsedSeconds / 60) + ' 分钟，未计入番茄'
    }

    wx.showToast({ title: message, icon: 'none', duration: completed ? 1400 : 2200 })

    setTimeout(() => {
      runner.reset()
      wx.switchTab({ url: '/pages/focus/index' })
    }, completed ? 260 : 0)
  }
})
