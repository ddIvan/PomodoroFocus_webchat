/**
 * 摄像头专注监控，对应 Android 的 FocusMonitor + DistractionJudge。
 *
 * 小程序拿不到人脸关键点，只从 CameraContext.onCameraFrame 的原始像素里取两个指标：
 * - motionRatio：画面里"灰度变化明显"的采样格占比 → 手/笔在动
 * - faceRatio：画面中央肤色像素占比 → 人在镜头前
 *
 * 判定沿用 Android 的分场景语义：
 * - 前置盯屏：看不见人超过阈值 → 分心（作废级）
 * - 前置纸面：看不见人是常态，超长只提示不计入
 * - 俯拍纸面：画面静止超过提示阈值 → 提醒，超过作废阈值 → 拉响作废
 * - 俯拍盯屏：先提醒后作废
 */

const runner = require('./runner')
const profileDao = require('./monitor-profile')

const GRID = 8
/** 超过这么久没有新帧，认定摄像头失活 */
const FRAME_TIMEOUT_MS = 4000
/** 上报节流，避免每帧都触发页面重绘 */
const EMIT_MIN_MS = 300

// ------------------------------------------------------------ 帧分析

function isSkin(r, g, b) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return r > 95 && g > 40 && b > 20 && max - min > 15 &&
    Math.abs(r - g) > 15 && r > g && r > b
}

/**
 * 真机上 frame.data 是 ArrayBuffer，直接 data[i] 取到的是 undefined。
 * 开发者工具里可能是 TypedArray，这里统一转成可按下标读取的视图。
 */
function toBytes(data) {
  if (!data) return null
  const tag = Object.prototype.toString.call(data)
  if (tag === '[object ArrayBuffer]') {
    try {
      return new Uint8ClampedArray(data)
    } catch (e) {
      return null
    }
  }
  if (tag === '[object Uint8ClampedArray]' || tag === '[object Uint8Array]' ||
    tag === '[object Int8Array]') {
    return data
  }
  return null
}

function createAnalyzer(options) {
  const limit = Number(options && options.motionDiff) || 20
  let prevGray = null

  function reset() {
    prevGray = null
  }

  /** @returns {{faceRatio: number, motionRatio: number}} */
  function analyze(frame) {
    const w = (frame && frame.width) || 0
    const h = (frame && frame.height) || 0
    const data = toBytes(frame && frame.data)
    if (!w || !h || !data || data.length < w * h * 4) return null

    const step = Math.max(1, Math.round(Math.min(w, h) / 64))
    const gray = new Float32Array(GRID * GRID)
    const counts = new Int32Array(GRID * GRID)

    const x0 = Math.round(w * 0.28)
    const x1 = Math.round(w * 0.72)
    const y0 = Math.round(h * 0.2)
    const y1 = Math.round(h * 0.8)
    let centerSamples = 0
    let skinSamples = 0

    for (let y = 0; y < h; y += step) {
      const gy = Math.min(GRID - 1, Math.floor((y * GRID) / h))
      const inY = y >= y0 && y < y1
      const rowBase = y * w
      for (let x = 0; x < w; x += step) {
        const idx = (rowBase + x) * 4
        const r = data[idx]
        const g = data[idx + 1]
        const b = data[idx + 2]
        const cell = gy * GRID + Math.min(GRID - 1, Math.floor((x * GRID) / w))
        gray[cell] += (r * 299 + g * 587 + b * 114) / 1000
        counts[cell] += 1

        if (inY && x >= x0 && x < x1) {
          centerSamples++
          if (isSkin(r, g, b)) skinSamples++
        }
      }
    }

    // 每格取平均灰度
    const avg = new Float32Array(GRID * GRID)
    for (let i = 0; i < avg.length; i++) {
      avg[i] = counts[i] > 0 ? gray[i] / counts[i] : 0
    }

    let motionRatio = 0
    if (prevGray) {
      let active = 0
      let valid = 0
      for (let i = 0; i < avg.length; i++) {
        if (counts[i] === 0) continue
        valid++
        if (Math.abs(avg[i] - prevGray[i]) > limit) active++
      }
      motionRatio = valid > 0 ? active / valid : 0
    }
    prevGray = avg

    return {
      faceRatio: centerSamples > 0 ? skinSamples / centerSamples : 0,
      motionRatio
    }
  }

  return { analyze, reset }
}

// ------------------------------------------------------------ 判定

/**
 * 判定状态机，直译 Android DistractionJudge 的结构：
 * 先算"瞬时状态"，再用 holdMs 消抖后上报。
 */
function createJudge(scene, profile) {
  let noFaceSince = 0
  let quietSince = 0
  let instant = { distracted: false, severe: false, reason: '', note: '', since: 0 }
  let escalateMs = 0
  let reported = { distracted: false, severe: false, reason: '', note: '' }

  function mark(value, severe, reason, escalate, now, note) {
    if (instant.distracted !== value || instant.severe !== severe) {
      instant = { distracted: value, severe, reason: reason || '', note: note || '', since: now }
    } else if (reason || note) {
      instant.reason = reason || instant.reason
      instant.note = note || instant.note
    }
    escalateMs = escalate || 0
  }

  function decide(sample, now) {
    if (!scene.lensBack) {
      // 前置：只看人在不在镜头前
      const hasFace = sample.faceRatio >= profile.faceSkinMin
      if (hasFace) {
        noFaceSince = 0
        mark(false, false, '', 0, now, '')
        return
      }
      if (!noFaceSince) noFaceSince = now
      const gap = now - noFaceSince
      if (scene.paper) {
        if (gap >= profile.paperNoFaceHintMs) {
          mark(false, false, '', 0, now, '长时间没看到你，请确认还在镜头前')
        } else {
          mark(false, false, '', 0, now, '')
        }
        return
      }
      if (gap >= profile.noFaceDelayMs) {
        mark(true, true, '未检测到人脸，请回到镜头前', 0, now, '')
      } else {
        mark(false, false, '', 0, now, '')
      }
      return
    }

    // 俯拍纸面：以画面动静为唯一判据
    if (scene.paper) {
      if (sample.motionRatio >= profile.paperActiveMin) {
        quietSince = 0
        mark(false, false, '', 0, now, '')
        return
      }
      if (!quietSince) quietSince = now
      const quiet = now - quietSince
      if (quiet >= profile.paperQuietSevereMs) {
        mark(true, true, '画面长时间没有动静，请回到座位继续书写', 0, now, '')
      } else if (quiet >= profile.paperQuietHintMs) {
        mark(true, false, '画面没有动静，请确认还在写作业',
          profile.paperQuietSevereMs, now, '')
      } else {
        mark(false, false, '', 0, now, '')
      }
      return
    }

    // 俯拍盯屏：先提醒后作废
    const hasFace = sample.faceRatio >= profile.faceSkinMin
    if (hasFace) {
      noFaceSince = 0
      mark(false, false, '', 0, now, '')
      return
    }
    if (!noFaceSince) noFaceSince = now
    const gap = now - noFaceSince
    if (gap >= profile.overheadNoFaceSevereMs) {
      mark(true, true, '长时间未检测到人，请回到座位', 0, now, '')
    } else if (gap >= profile.overheadNoFaceDelayMs) {
      mark(true, false, '未检测到人脸，请回到座位', 0, now, '')
    } else {
      mark(false, false, '', 0, now, '')
    }
  }

  return {
    reset() {
      noFaceSince = 0
      quietSince = 0
      instant = { distracted: false, severe: false, reason: '', note: '', since: 0 }
      escalateMs = 0
      reported = { distracted: false, severe: false, reason: '', note: '' }
    },

    update(sample, now) {
      decide(sample, now)

      if (instant.distracted) {
        if (now - instant.since >= profile.holdMs) {
          if (!reported.distracted) {
            reported = {
              distracted: true,
              severe: instant.severe,
              reason: instant.reason,
              note: ''
            }
          } else if (instant.severe && !reported.severe) {
            reported = Object.assign({}, reported, { severe: true })
          }
        }
        if (reported.distracted && !reported.severe && escalateMs > 0 &&
          now - instant.since >= escalateMs) {
          reported = Object.assign({}, reported, {
            severe: true,
            reason: instant.reason || reported.reason
          })
        }
      } else if (reported.distracted && now - instant.since >= profile.holdMs) {
        reported = { distracted: false, severe: false, reason: '', note: instant.note }
      } else if (!reported.distracted) {
        reported = Object.assign({}, reported, { note: instant.note })
      }

      return reported
    }
  }
}

// ------------------------------------------------------------ 运行控制

let ctx = null
let listener = null
let running = false
let scene = null
let profile = null
let judge = null
let analyzer = createAnalyzer()
let lastAnalyzeAt = 0
let lastFrameAt = 0
let lastEmitAt = 0
let watchdog = null
let unavailable = false

function errorText(err) {
  return (err && (err.errMsg || err.message)) || ''
}

function start(options) {
  stop()
  const opts = options || {}
  const lens = Number(opts.lens) === 1 ? 1 : 0
  const taskMode = Number(opts.taskMode) === 1 ? 1 : 0
  scene = profileDao.sceneOf(lens === 1, taskMode === 1)
  profile = profileDao.load(scene)
  judge = createJudge(scene, profile)
  analyzer = createAnalyzer(profile)
  lastAnalyzeAt = 0
  lastFrameAt = Date.now()
  lastEmitAt = 0
  unavailable = false
  ctx = opts.ctx || null

  if (!ctx || typeof ctx.onCameraFrame !== 'function') {
    unavailable = true
    runner.markMonitorUnavailable('当前环境不支持摄像头取帧，本次专注按无监控计时')
    return false
  }

  try {
    listener = ctx.onCameraFrame(onFrame)
  } catch (e) {
    unavailable = true
    runner.markMonitorUnavailable('摄像头启动失败，本次专注按无监控计时')
    return false
  }
  if (!listener) {
    unavailable = true
    runner.markMonitorUnavailable('当前环境不支持摄像头取帧，本次专注按无监控计时')
    return false
  }

  running = true
  lastFrameAt = Date.now()
  watchdog = setInterval(checkAlive, 1000)

  // 关键：onCameraFrame 只注册回调，必须再调 listener.start() 才会真正开始泵帧，
  // 否则真机上摄像头有预览但永远收不到帧，4 秒后被 watchdog 误判为画面中断。
  if (typeof listener.start === 'function') {
    try {
      listener.start({
        fail: (err) => {
          stop()
          unavailable = true
          const detail = errorText(err)
          runner.markMonitorUnavailable(
            '摄像头取帧启动失败' + (detail ? '（' + detail + '）' : '') + '，本次按无监控计时'
          )
        }
      })
    } catch (e) {
      stop()
      unavailable = true
      runner.markMonitorUnavailable('摄像头取帧启动失败，本次按无监控计时')
      return false
    }
  }
  return true
}

function stop() {
  running = false
  if (listener && typeof listener.stop === 'function') {
    try {
      listener.stop()
    } catch (e) {
      /* ignore */
    }
  }
  listener = null
  if (watchdog) {
    clearInterval(watchdog)
    watchdog = null
  }
  ctx = null
}

function isRunning() {
  return running
}

function currentScene() {
  return scene
}

function currentProfile() {
  return profile
}

function onFrame(frame) {
  if (!running) return
  const now = Date.now()
  lastFrameAt = now
  const interval = profile.analysisIntervalMs || 300
  if (now - lastAnalyzeAt < interval) return
  lastAnalyzeAt = now

  let sample = null
  try {
    sample = analyzer.analyze(frame)
  } catch (e) {
    console.error('帧分析失败', errorText(e))
    return
  }
  if (!sample) return

  const verdict = judge.update(sample, now)
  if (!verdict) return
  if (now - lastEmitAt < EMIT_MIN_MS && !verdict.distracted) return
  lastEmitAt = now

  runner.updateMonitor(true, verdict.distracted, verdict.severe, verdict.reason, verdict.note)
}

function checkAlive() {
  if (!running) return
  if (Date.now() - lastFrameAt > FRAME_TIMEOUT_MS) {
    stop()
    unavailable = true
    runner.markMonitorUnavailable('摄像头画面中断，请检查授权与占用情况，本次按无监控计时')
  }
}

/** 上一次启动是否因为环境不支持而失败 */
function isUnavailable() {
  return unavailable
}

module.exports = {
  start,
  stop,
  isRunning,
  isUnavailable,
  currentScene,
  currentProfile,
  createJudge,
  createAnalyzer
}
