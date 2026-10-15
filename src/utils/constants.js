/** 跨页面共享常量与格式化工具。 */

export const SOURCE_TYPES = [
  { value: 'ai_chat', label: '项目对话' },
  { value: 'manual', label: '手动问题' },
  { value: 'feedback', label: '用户反馈素材' },
  { value: 'community', label: '社群讨论' },
  { value: 'competitor_review', label: '竞品评论' },
]

export const scoreClass = (v) => (v >= 70 ? 'score-high' : v >= 45 ? 'score-mid' : 'score-low')
export const scoreColor = (v) => (v >= 70 ? 'var(--green)' : v >= 45 ? 'var(--yellow)' : 'var(--red)')

export const WORK_STATUS_LABEL = { pending: '待审核', approved: '已通过', rejected: '未通过' }
export const WORK_STATUS_COLOR = { pending: 'var(--yellow)', approved: 'var(--green)', rejected: 'var(--red)' }
