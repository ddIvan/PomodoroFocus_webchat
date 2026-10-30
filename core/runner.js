/**
 * 全局专注会话控制器，对应 Android 的 FocusSessionManager。
 *
 * 番茄规则（与 Android 完全一致）：
 * - 倒计时完整走完 → status = 0（已完成），记 1 个番茄
 * - 手动结束      → status = 1（已放弃），不计番茄
 * - 监控判定持续分心 → status = 2（未通过），不计番茄
 *
 * 计时基于 Date.now()，切后台时由页面 onHide 调用 pauseByBackground()，
 * 回来再 resumeFromBackground()，避免"无人监控"的时长被算作专注。
 */
const sessionDao = require('./session')
const prefs = require('./prefs')
const time = require('../utils/time')

const PHASE = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  INVALID: 'invalid',
  ABANDONED: 'abandoned'
}

const TICK_MS = 200
/** 监控启动后的预热时间，期间不累计分心 */
const MONITOR_WARMUP_MS = 3000
/** 检测结果超过该时长未更新，视为监控失活，立即停止累计 */
const MONITOR_STALE_MS = 6000
/** 会话开始后的保护期，期间只提示不作废 */
const SESSION_GRACE_MS = 60000
/** 超标后的宽限期：期间回到镜头前即可继续，否则判定未通过 */
const WARN_GRACE_MS = 15000
/** 分心占比判定的最小统计窗口 */
const RATIO_MIN_WINDOW_MS = 120000

function emptyState() {
  return {
    phase: PHASE.IDLE,
    planId: 0,
    planName: '',
    planGoal: '',
    plannedSeconds: 0,
    elapsedSeconds: 0,
    remainingSeconds: 0,
    monitorEnabled: false,
    monitorActive: false,
    instantDistracted: false,
    severeDistracted: false,
    pendingAbandon: false,
    distractionReason: '',
    distractionCount: 0,
    distractedSeconds: 0,
    strictness: 1,
    taskMode: 0,
    monitorNote: '',
    message: '',
    pausedByBackground: false,
    progress: 0
  }
}

let state = emptyState()
let listeners = []

// 计时内部量
let plannedMs = 0
let accumulatedMs = 0
let segmentStart = 0
let lastTickAt = 0
let sessionStartAt = 0
let totalDistractedMs = 0
let continuousDistractedMs = 0
let trackedMs = 0
let distractionCount = 0
let wasDistracted = false
let strictness = 1
let taskMode = 0
let lastMonitorUpdateAt = 0
let currentSevere = false
let pendingAbandon = false
let pendingSince = 0
let timer = null
let saving = false

// ------------------------------------------------------------ 订阅

function snapshot() {
  return Object.assign({}, state)
}

function emit() {
  const snap = snapshot()
  listeners.slice().forEach((fn) => {
    try {
      fn(snap)
    } catch (e) {
      console.error('会话状态回调异常', e)
    }
  })
}

function subscribe(fn) {
  listeners.push(fn)
  return function unsubscribe() {
    const i = listeners.indexOf(fn)
    if (i >= 0) listeners.splice(i, 1)
  }
}

function getState() {
  return snapshot()
}

function isActive() {
  return state.phase === PHASE.RUNNING || state.phase === PHASE.PAUSED
}

function isPaperTask() {
  return state.taskMode === 1
}

// ------------------------------------------------------------ 计时

function syncDerived() {
  const plannedSeconds = state.plannedSeconds
  state.progress = plannedSeconds > 0 ? Math.min(1, state.elapsedSeconds / plannedSeconds) : 0
}

function startTimer() {
  stopTimer()
  timer = setInterval(tick, TICK_MS)
}

function stopTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function elapsedMs(now) {
  if (state.phase === PHASE.RUNNING) {
    return Math.max(0, accumulatedMs + (now - segmentStart))
  }
  return accumulatedMs
}

function thresholds() {
  const paper = taskMode === 1
  const continuous = strictness === 0
    ? 60000
    : strictness === 2
      ? (paper ? 15000 : 12000)
      : (paper ? 30000 : 25000)
  const ratio = strictness === 0
    ? 0.5
    : strictness === 2
      ? (paper ? 0.1 : 0.15)
      : (paper ? 0.2 : 0.3)
  const total = Math.max(150000, Math.floor(plannedMs * ratio))
  // 占比规则只用于纸面任务：盯屏任务沿用原有两条判定
  return { continuousMs: continuous, totalMs: total, ratio: paper ? ratio : 0 }
}

function tick() {
  if (state.phase !== PHASE.RUNNING) return
  const now = Date.now()
  const delta = Math.max(0, now - lastTickAt)
  lastTickAt = now

  const elapsed = elapsedMs(now)

  // 检测结果是否新鲜：某帧检测失败/卡住时不再按旧结果累计
  const monitorFresh = lastMonitorUpdateAt > 0 && now - lastMonitorUpdateAt <= MONITOR_STALE_MS
  const monitorCounting = state.monitorEnabled && state.monitorActive && monitorFresh &&
    now - sessionStartAt > MONITOR_WARMUP_MS && elapsed >= SESSION_GRACE_MS

  if (monitorCounting) trackedMs += delta

  const countable = state.instantDistracted && (currentSevere || strictness === 2)
  if (monitorCounting && countable) {
    totalDistractedMs += delta
    continuousDistractedMs += delta
    if (!wasDistracted) {
      distractionCount++
      wasDistracted = true
    }
  } else {
    continuousDistractedMs = 0
    wasDistracted = false
  }

  if (elapsed >= plannedMs) {
    state.elapsedSeconds = Math.floor(plannedMs / 1000)
    state.remainingSeconds = 0
    state.distractedSeconds = Math.floor(totalDistractedMs / 1000)
    state.distractionCount = distractionCount
    syncDerived()
    finish(PHASE.COMPLETED, '')
    return
  }

  // 超标后先给 15 秒宽限期：回到镜头前即可继续，避免短暂低头被判失败
  let pending = pendingAbandon
  let hint = state.message
  if (strictness > 0 && monitorCounting) {
    const limits = thresholds()
    const ratioOver = limits.ratio > 0 && trackedMs >= RATIO_MIN_WINDOW_MS &&
      totalDistractedMs / trackedMs >= limits.ratio
    const over = continuousDistractedMs >= limits.continuousMs ||
      totalDistractedMs >= limits.totalMs || ratioOver
    if (over) {
      if (!pending) {
        pending = true
        pendingSince = now
        hint = taskMode === 1
          ? '请回到专注状态，15 秒内未恢复本次将不计入番茄'
          : '请回到镜头前，15 秒内未恢复本次将不计入番茄'
      } else if (now - pendingSince >= WARN_GRACE_MS) {
        let reason
        if (continuousDistractedMs >= limits.continuousMs) {
          reason = '连续分心超过 ' + Math.floor(limits.continuousMs / 1000) + ' 秒，本次专注不计入番茄'
        } else if (ratioOver) {
          reason = '分心时间占比超过 ' + Math.floor(limits.ratio * 100) + '%，本次专注不计入番茄'
        } else {
          reason = '累计分心时间过长，本次专注不计入番茄'
        }
        state.elapsedSeconds = Math.floor(elapsed / 1000)
        state.remainingSeconds = Math.max(0, Math.floor((plannedMs - elapsed) / 1000))
        state.distractedSeconds = Math.floor(totalDistractedMs / 1000)
        state.distractionCount = distractionCount
        syncDerived()
        finish(PHASE.INVALID, reason)
        return
      }
    } else if (pending) {
      pending = false
      hint = ''
    }
  } else if (pending) {
    pending = false
    hint = ''
  }
  pendingAbandon = pending

  state.elapsedSeconds = Math.floor(elapsed / 1000)
  state.remainingSeconds = Math.max(0, Math.floor((plannedMs - elapsed) / 1000))
  state.distractedSeconds = Math.floor(totalDistractedMs / 1000)
  state.distractionCount = distractionCount
  state.pendingAbandon = pending
  state.message = hint
  syncDerived()
  emit()
}

// ------------------------------------------------------------ 开始 / 控制

function start(plan, monitorEnabled) {
  if (isActive() || !plan) return
  plannedMs = Math.max(1, Number(plan.durationMinutes) || 25) * 60000
  accumulatedMs = 0
  segmentStart = Date.now()
  lastTickAt = segmentStart
  sessionStartAt = segmentStart
  totalDistractedMs = 0
  continuousDistractedMs = 0
  trackedMs = 0
  distractionCount = 0
  wasDistracted = false
  lastMonitorUpdateAt = 0
  currentSevere = false
  pendingAbandon = false
  pendingSince = 0
  saving = false
  strictness = Math.min(2, Math.max(0, Number(plan.strictness) || 0))
  taskMode = Number(plan.taskMode) || 0

  const plannedSeconds = Math.floor(plannedMs / 1000)
  state = Object.assign(emptyState(), {
    phase: PHASE.RUNNING,
    planId: plan.id,
    planName: plan.name || '',
    planGoal: plan.goal || '',
    plannedSeconds,
    elapsedSeconds: 0,
    remainingSeconds: plannedSeconds,
    monitorEnabled: !!monitorEnabled,
    monitorActive: false,
    strictness,
    taskMode,
    message: ''
  })
  syncDerived()
  emit()
  startTimer()
}

function pause() {
  if (state.phase !== PHASE.RUNNING) return
  const now = Date.now()
  accumulatedMs += Math.max(0, now - segmentStart)
  segmentStart = now
  stopTimer()
  state.phase = PHASE.PAUSED
  state.elapsedSeconds = Math.floor(accumulatedMs / 1000)
  state.remainingSeconds = Math.max(0, Math.floor((plannedMs - accumulatedMs) / 1000))
  syncDerived()
  emit()
}

function resume() {
  if (state.phase !== PHASE.PAUSED) return
  const now = Date.now()
  segmentStart = now
  lastTickAt = now
  state.phase = PHASE.RUNNING
  state.pausedByBackground = false
  emit()
  startTimer()
}

/** 离开专注界面（切后台/锁屏）时暂停计时 */
function pauseByBackground() {
  if (state.phase !== PHASE.RUNNING) return
  pause()
  state.pausedByBackground = true
  state.message = '已离开专注界面，计时已暂停'
  emit()
}

function resumeFromBackground() {
  if (state.phase !== PHASE.PAUSED || !state.pausedByBackground) return
  state.message = ''
  emit()
  resume()
}

function abandon() {
  if (!isActive()) return
  finish(PHASE.ABANDONED, '已手动结束本次专注，不计入番茄')
}

/** 会话结束后清理状态 */
function reset() {
  if (isActive()) return
  stopTimer()
  state = emptyState()
  emit()
}

// ------------------------------------------------------------ 监控输入

function updateMonitor(active, distracted, severe, reason, note) {
  if (!isActive() || !state.monitorEnabled) return
  lastMonitorUpdateAt = Date.now()
  currentSevere = !!distracted && !!severe
  state.monitorActive = !!active
  state.instantDistracted = !!distracted
  state.severeDistracted = !!distracted && !!severe
  state.distractionReason = distracted ? (reason || '') : ''
  state.monitorNote = distracted ? '' : (note || '')
  emit()
}

function markMonitorUnavailable(reason) {
  if (!isActive()) return
  state.monitorEnabled = false
  state.monitorActive = false
  state.instantDistracted = false
  state.severeDistracted = false
  state.message = reason || ''
  emit()
}

function notifyDistractionFeedback() {
  // 语音在微信小程序不可用，用震动代替；重复提醒的节流交给页面
  try {
    wx.vibrateShort({ type: 'medium' })
  } catch (e) {
    /* ignore */
  }
}

// ------------------------------------------------------------ 结算

function finish(phase, reason) {
  if (!isActive()) return
  stopTimer()

  const now = Date.now()
  const actualMs = phase === PHASE.COMPLETED ? plannedMs : elapsedMs(now)
  accumulatedMs = actualMs
  const actualSeconds = Math.floor(actualMs / 1000)
  // 必须在清状态前抓快照：emit 会同步唤醒页面，页面可能立刻调 reset()
  const snap = Object.assign({}, state, {
    phase,
    elapsedSeconds: phase === PHASE.COMPLETED ? state.plannedSeconds : actualSeconds,
    remainingSeconds: phase === PHASE.COMPLETED
      ? 0
      : Math.max(0, Math.floor((plannedMs - actualMs) / 1000)),
    distractedSeconds: Math.floor(totalDistractedMs / 1000),
    distractionCount,
    message: reason,
    pausedByBackground: false,
    monitorActive: false,
    instantDistracted: false,
    severeDistracted: false,
    monitorNote: '',
    pendingAbandon: false
  })
  state = snap
  syncDerived()
  emit()

  let status = sessionDao.STATUS_ABANDONED
  if (phase === PHASE.COMPLETED) status = sessionDao.STATUS_COMPLETED
  if (phase === PHASE.INVALID) status = sessionDao.STATUS_INVALID

  saveSession(snap, status, actualSeconds, reason)

  if (phase === PHASE.COMPLETED) {
    try {
      wx.vibrateShort({ type: 'heavy' })
    } catch (e) {
      /* ignore */
    }
    try {
      const app = getApp()
      if (app && app.markTomatoGained) app.markTomatoGained()
    } catch (e) {
      /* ignore */
    }
  }
}

function saveSession(st, status, actualSeconds, reason) {
  if (saving) return
  saving = true
  const accountId = prefs.currentAccountId()
  if (accountId <= 0) {
    saving = false
    return
  }
  try {
    sessionDao.add({
      planId: st.planId,
      planName: st.planName,
      startTime: sessionStartAt,
      endTime: Date.now(),
      plannedSeconds: st.plannedSeconds,
      actualSeconds,
      dateKey: time.dateKey(new Date(sessionStartAt)),
      status,
      monitorEnabled: st.monitorEnabled ? 1 : 0,
      strictness,
      taskMode,
      distractionCount: st.distractionCount,
      distractedSeconds: st.distractedSeconds,
      invalidReason: reason || ''
    }, accountId)
  } catch (e) {
    console.error('保存专注记录失败', e)
  }
  saving = false
}

module.exports = {
  PHASE,
  subscribe,
  getState,
  isActive,
  isPaperTask,
  start,
  pause,
  resume,
  pauseByBackground,
  resumeFromBackground,
  abandon,
  reset,
  updateMonitor,
  markMonitorUnavailable,
  notifyDistractionFeedback
}
