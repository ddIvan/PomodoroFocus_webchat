/**
 * 后端服务地址（微信登录用）。
 *
 * 正式环境：https://api.tainylong.cn:8443/zhuanzhu
 *   该地址已配置为小程序后台「开发管理 → 开发设置 → 服务器域名」的
 *   request 合法域名，配置项形如 https://api.tainylong.cn:8443。
 *
 *   注意：小程序对请求地址做的是完全匹配校验（协议 + 域名 + 端口 + 路径前缀），
 *   所以这里的值必须与后台配置逐字一致，否则真机报“不在以下 request 合法域名列表中”。
 *
 *   服务器侧要求：8443 已在云安全组与防火墙放行；证书为 TrustAsia DV
 *   （CN=api.tainylong.cn），证书链完整，TLS 1.2 及以上。
 *
 * 本机调试：改成 http://127.0.0.1:5080，并在「详情 → 本地设置」勾选
 *   「不校验合法域名、web-view、TLS 版本以及 HTTPS 证书」。
 *
 * 登录页底部也提供了临时修改入口（写入本地 api_base_override），
 * 它优先级高于这里的默认值；若之前手动改过地址，请在这里重新改一次，
 * 或在登录页底部点「服务器」重填，否则仍会请求旧地址。
 */
const DEFAULT_API_BASE = 'https://api.tainylong.cn:8443/zhuanzhu'

module.exports = {
  DEFAULT_API_BASE
}
