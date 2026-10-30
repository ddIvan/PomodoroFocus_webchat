/**
 * 「获得一个番茄」入账动效的数值计算。
 * 全部参数与 Android FocusFragment.animateGain 保持一致：
 * 总长 900ms（弹出 0-200 过冲、回落 200-300、飞行 300-700、波纹 600-880、数字翻入 620）。
 */
const TOTAL_MS = 900
const FLIGHT_START = 300
const FLIGHT_MS = 400

function outCubic(t) {
  const u = 1 - t
  return 1 - u * u * u
}

function inOutCubic(t) {
  if (t < 0.5) return 4 * t * t * t
  const u = -2 * t + 2
  return 1 - (u * u * u) / 2
}

/** 带过冲的弹性缓动，弹出那一下才有重量 */
function outBack(t, c1) {
  const c3 = c1 + 1
  const u = t - 1
  return 1 + c3 * u * u * u + c1 * u * u
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function fx(n) {
  return Number(n).toFixed(3)
}

/**
 * 计算单帧样式。
 * ctx = { endX, endY, startY, lift }（单位 px，相对屏幕中心）
 */
function frame(t, ctx) {
  let scale
  let alpha
  if (t < 200) {
    const p = t / 200
    scale = 0.45 + (1.16 - 0.45) * outBack(p, 2.2)
    alpha = p
  } else {
    const p = clamp01((t - 200) / 100)
    scale = 1.16 + (1 - 1.16) * outCubic(p)
    alpha = 1
  }

  let x = 0
  let y = ctx.startY
  let rot = 0
  if (t > FLIGHT_START) {
    const p = inOutCubic(clamp01((t - FLIGHT_START) / FLIGHT_MS))
    x = ctx.endX * p
    // 抛物线抬升，直线飞过去会显得很机械
    y = ctx.startY + (ctx.endY - ctx.startY) * p - Math.sin(p * Math.PI) * ctx.lift
    rot = 18 * p
    scale += (0.3 - scale) * p
  }
  if (t > 700) alpha = clamp01(1 - (t - 700) / 80)

  const tomato = 'transform: translate3d(' + fx(x) + 'px,' + fx(y) + 'px,0) rotate(' + fx(rot) +
    'deg) scale(' + fx(scale) + '); opacity: ' + fx(alpha) + ';'

  // 落点光晕
  let ripple = 'opacity: 0;'
  if (t >= 600) {
    const p = clamp01((t - 600) / 280)
    const rs = 0.5 + 1.9 * outCubic(p)
    ripple = 'transform: translate3d(' + fx(ctx.endX) + 'px,' + fx(ctx.endY) + 'px,0) scale(' +
      fx(rs) + '); opacity: ' + fx(0.55 * (1 - p)) + ';'
  }

  // 卡片被打中的一下回弹
  let bounce = 0
  if (t >= 600 && t <= 880) {
    bounce = Math.sin(((t - 600) / 280) * Math.PI) * 0.035
  }

  return {
    tomatoStyle: tomato,
    rippleStyle: ripple,
    cardScale: 1 + bounce,
    switchNumber: t >= 620
  }
}

/** 起始样式：番茄还没弹出、光晕不可见 */
function initial(ctx) {
  return {
    tomatoStyle: 'transform: translate3d(0px,' + fx(ctx.startY) + 'px,0) rotate(0deg) scale(0.45); opacity: 0;',
    rippleStyle: 'opacity: 0;',
    cardScale: 1
  }
}

module.exports = {
  TOTAL_MS,
  frame,
  initial
}
