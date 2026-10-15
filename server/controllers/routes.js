import { handlers as miscHandlers } from './misc.controller.js'
import { handlers as authHandlers } from './auth.controller.js'
import { handlers as settingsHandlers } from './settings.controller.js'
import { handlers as chatHandlers } from './chat.controller.js'
import { handlers as distilleryHandlers } from './distillery.controller.js'
import { handlers as deliverablesHandlers } from './deliverables.controller.js'
import { handlers as projectsHandlers } from './projects.controller.js'
import { handlers as featuresHandlers } from './features.controller.js'
import { handlers as analysisHandlers } from './analysis.controller.js'
import { handlers as opportunitiesHandlers } from './opportunities.controller.js'
import { handlers as intentHandlers } from './intent.controller.js'
import { handlers as usageHandlers } from './usage.controller.js'
import { handlers as integrationsHandlers } from './integrations.controller.js'
import { handlers as tokentrackerHandlers } from './tokentracker.controller.js'
import { handlers as worksHandlers } from './works.controller.js'
import { handlers as marketHandlers } from './market.controller.js'
import { handlers as adminHandlers } from './admin.controller.js'

/** 全量路由表：按域合并各 controller 的 handlers，供入口分发。 */
export const handlers = Object.assign(
  {},
  miscHandlers,
  authHandlers,
  settingsHandlers,
  chatHandlers,
  distilleryHandlers,
  deliverablesHandlers,
  projectsHandlers,
  featuresHandlers,
  analysisHandlers,
  opportunitiesHandlers,
  intentHandlers,
  usageHandlers,
  integrationsHandlers,
  tokentrackerHandlers,
  worksHandlers,
  marketHandlers,
  adminHandlers,
)

/** 无需登录即可访问的接口（注册/登录/健康检查）。 */
export const PUBLIC_KEYS = new Set(['POST /api/auth/register', 'POST /api/auth/login', 'GET /api/health', 'GET /api/local-auth'])
