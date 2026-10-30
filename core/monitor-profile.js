/**
 * 监控判定参数，对应 Android 版 MonitorProfile.kt / MonitorScene。
 *
 * 场景仍是「视角 × 任务」四象限，参数按场景分别保存，切换计划时自动取用。
 *
 * 与 Android 的差异（微信小程序能力所限，参数页已明示）：
 * - 小程序拿不到人脸关键点，无法读取扭头/低头/闭眼角度；
 * - 判定改用画面活动占比与肤色区域占比近似「人在镜头前 / 手在动」；
 * - 因此 Android 的角度类参数在小程序里保留但不可调，新增 faceSkinMin 代替。
 */

const prefs = require('./prefs')

const SCENES = [
  {
    key: 'front_screen',
    lensBack: false,
    paper: false,
    title: '前置 · 盯屏',
    summary: '手机正对自己，看网课、看视频类计划。以画面中能否持续看到人判断。'
  },
  {
    key: 'front_paper',
    lensBack: false,
    paper: true,
    title: '前置 · 纸面',
    summary: '手机正对自己，写作业、看书类计划。低头是常态，只看人是否还在镜头前。'
  },
  {
    key: 'back_screen',
    lensBack: true,
    paper: false,
    title: '俯拍 · 盯屏',
    summary: '手机架高从上往下拍，看网课类计划。以画面中是否还有人判断。'
  },
  {
    key: 'back_paper',
    lensBack: true,
    paper: true,
    title: '俯拍 · 纸面',
    summary: '手机架高俯拍桌面，写作业类计划。看不到脸是常态，以画面有没有动静判断。'
  }
]

/** 出厂参数，与 Android 默认值保持一致；faceSkinMin 为小程序新增 */
const DEFAULT = {
  yawLimit: 42,
  lookDownPitch: 32,
  paperWorkPitchMax: -8,
  paperLookUpPitchMin: -4,
  eyeOpenMin: 0.2,
  holdMs: 1500,
  noFaceDelayMs: 4000,
  overheadNoFaceDelayMs: 6000,
  overheadNoFaceSevereMs: 25000,
  paperNoFaceHintMs: 60000,
  lookUpSevereMs: 20000,
  eyesSevereMs: 30000,
  offSeatSevereMs: 30000,
  overheadMaxOffset: 0.4,
  paperActiveMin: 0.01,
  paperQuietHintMs: 12000,
  paperQuietSevereMs: 45000,
  analysisIntervalMs: 300,
  motionDiff: 20,
  faceSkinMin: 0.03
}

const PRESETS = [
  { key: 'loose', label: '宽松', timeScale: 1.6, angleScale: 1.2 },
  { key: 'normal', label: '标准', timeScale: 1, angleScale: 1 },
  { key: 'strict', label: '严格', timeScale: 0.65, angleScale: 0.85 }
]

function sceneOf(lensBack, paper) {
  return SCENES.find((s) => s.lensBack === !!lensBack && s.paper === !!paper) || SCENES[0]
}

function fromKey(key) {
  return SCENES.find((s) => s.key === key) || SCENES[0]
}

function defaultFor(scene) {
  return Object.assign({}, DEFAULT)
}

/** 预设永远基于出厂值缩放，不在当前值上反复叠加 */
function preset(base, presetKey) {
  const p = PRESETS.find((it) => it.key === presetKey) || PRESETS[1]
  const t = (value, min, max) => Math.min(max, Math.max(min, Math.round(value * p.timeScale)))
  return Object.assign({}, base, {
    holdMs: t(base.holdMs, 800, 4000),
    noFaceDelayMs: t(base.noFaceDelayMs, 1500, 20000),
    overheadNoFaceDelayMs: t(base.overheadNoFaceDelayMs, 2000, 20000),
    overheadNoFaceSevereMs: t(base.overheadNoFaceSevereMs, 6000, 60000),
    paperNoFaceHintMs: t(base.paperNoFaceHintMs, 15000, 180000),
    paperQuietHintMs: t(base.paperQuietHintMs, 3000, 60000),
    paperQuietSevereMs: t(base.paperQuietSevereMs, 15000, 180000)
  })
}

/** 该场景是否被手动调过 */
function hasCustom(sceneKey) {
  return prefs.hasMonitorProfile(sceneKey)
}

/** 读取某场景参数，缺失或损坏时回退到出厂值 */
function load(scene) {
  const raw = prefs.monitorProfileJson(scene.key)
  if (!raw) return defaultFor(scene)
  try {
    const saved = typeof raw === 'string' ? JSON.parse(raw) : raw
    const merged = Object.assign({}, DEFAULT)
    Object.keys(DEFAULT).forEach((k) => {
      const v = saved[k]
      if (typeof v === 'number' && isFinite(v)) merged[k] = v
    })
    return merged
  } catch (e) {
    return defaultFor(scene)
  }
}

function save(scene, profile) {
  prefs.saveMonitorProfileJson(scene.key, JSON.stringify(profile))
}

function reset(scene) {
  prefs.resetMonitorProfile(scene.key)
}

/** 判定当前参数是否恰好等于某个预设 */
function matchedPreset(scene, profile) {
  const base = defaultFor(scene)
  const keys = Object.keys(DEFAULT)
  const found = PRESETS.find((p) => {
    const scaled = preset(base, p.key)
    return keys.every((k) => Math.abs(scaled[k] - profile[k]) < 0.001)
  })
  return found ? found.key : ''
}

// ------------------------------------------------------------ 参数表

/**
 * 可调参数表。页面只按这张表渲染，换场景时同一套代码重建控件。
 *
 * - scale：存储值与展示值的换算（百分比存 0~1，秒存毫秒）
 * - visible：只在哪些场景出现
 */
const SPECS = [
  {
    key: 'analysisIntervalMs',
    group: '画面判定',
    label: '分析间隔',
    hint: '每多少毫秒分析一帧，调大更省电、反应更慢',
    min: 200,
    max: 1000,
    step: 50,
    kind: 'ms',
    visible: null
  },
  {
    key: 'motionDiff',
    group: '画面判定',
    label: '帧差阈值',
    hint: '单格灰度差超过这个值才算画面在动，光线抖动大可调高',
    min: 5,
    max: 50,
    step: 1,
    kind: 'int',
    visible: null
  },
  {
    key: 'paperActiveMin',
    group: '画面判定',
    label: '画面活动阈值',
    hint: '俯拍纸面：变化格占比达到这个值算在写',
    min: 1,
    max: 100,
    step: 1,
    kind: 'percent',
    scale: 100,
    visible: ['back_paper']
  },
  {
    key: 'faceSkinMin',
    group: '画面判定',
    label: '人脸占比阈值',
    hint: '前置与俯拍盯屏：画面中央肤色像素达到这个比例算人在镜头前',
    min: 1,
    max: 30,
    step: 1,
    kind: 'percent',
    scale: 100,
    visible: ['front_screen', 'back_screen']
  },
  {
    key: 'holdMs',
    group: '时间门槛',
    label: '判定确认',
    hint: '状态要持续这么久才上报，用来过滤瞬时抖动',
    min: 0.8,
    max: 4,
    step: 0.1,
    kind: 'seconds',
    scale: 0.001,
    visible: null
  },
  {
    key: 'noFaceDelayMs',
    group: '时间门槛',
    label: '看不见人提醒',
    hint: '前置盯屏：看不到人多久开始判为分心',
    min: 2,
    max: 20,
    step: 0.5,
    kind: 'seconds',
    scale: 0.001,
    visible: ['front_screen']
  },
  {
    key: 'paperNoFaceHintMs',
    group: '时间门槛',
    label: '无脸提示',
    hint: '前置纸面：超过这个时长才单纯提醒，不计入分心',
    min: 15,
    max: 180,
    step: 5,
    kind: 'seconds',
    scale: 0.001,
    visible: ['front_paper']
  },
  {
    key: 'overheadNoFaceDelayMs',
    group: '时间门槛',
    label: '看不见人开始提醒',
    hint: '俯拍盯屏：看不到人多久给出提醒',
    min: 2,
    max: 20,
    step: 0.5,
    kind: 'seconds',
    scale: 0.001,
    visible: ['back_screen']
  },
  {
    key: 'overheadNoFaceSevereMs',
    group: '时间门槛',
    label: '看不见人作废',
    hint: '俯拍盯屏：看不到人多久判本次失败',
    min: 6,
    max: 60,
    step: 1,
    kind: 'seconds',
    scale: 0.001,
    visible: ['back_screen']
  },
  {
    key: 'paperQuietHintMs',
    group: '时间门槛',
    label: '画面静止提示',
    hint: '俯拍纸面：画面没动静多久开始提醒',
    min: 3,
    max: 60,
    step: 1,
    kind: 'seconds',
    scale: 0.001,
    visible: ['back_paper']
  },
  {
    key: 'paperQuietSevereMs',
    group: '时间门槛',
    label: '画面静止作废',
    hint: '俯拍纸面：画面没动静多久判本次失败',
    min: 15,
    max: 180,
    step: 5,
    kind: 'seconds',
    scale: 0.001,
    visible: ['back_paper']
  }
]

function specsFor(scene) {
  return SPECS.filter((s) => !s.visible || s.visible.indexOf(scene.key) >= 0)
}

/** scale 是"存储值 → 展示值"的乘数：百分比 0.01 → 1，毫秒 20000 → 20 */
function toDisplay(spec, stored) {
  return spec.scale ? Number((stored * spec.scale).toFixed(3)) : stored
}

function toStored(spec, display) {
  return spec.scale ? Math.round(Number(display) / spec.scale) : Number(display)
}

function formatValue(spec, stored) {
  const v = toDisplay(spec, stored)
  if (spec.kind === 'percent') return Math.round(v) + '%'
  if (spec.kind === 'seconds') {
    return Math.abs(v - Math.round(v)) < 0.01 ? Math.round(v) + ' 秒' : v.toFixed(1) + ' 秒'
  }
  if (spec.kind === 'ms') return Math.round(v) + ' 毫秒'
  return String(Math.round(v))
}

module.exports = {
  SCENES,
  PRESETS,
  DEFAULT,
  sceneOf,
  fromKey,
  defaultFor,
  preset,
  matchedPreset,
  hasCustom,
  load,
  save,
  reset,
  specsFor,
  toDisplay,
  toStored,
  formatValue
}
