/** 管理员权限守卫（配合入口层的登录校验使用）。 */
export function requireAdmin(req) {
  if (req.user?.role !== 'admin') throw Object.assign(new Error('需要管理员权限'), { status: 403 })
}
