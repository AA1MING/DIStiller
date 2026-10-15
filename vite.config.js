import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 本机开发：一键启动.bat / scripts/dev.mjs 会自动挑选可用端口并注入 VITE_PORT / API_PORT；
// Docker 部署使用预构建 dist/（不走 vite 代理），此处保持 8787 默认值兼容。
const webPort = Number(process.env.VITE_PORT || 5173)
const apiPort = Number(process.env.API_PORT || process.env.PORT || 8787)

export default defineConfig({
  plugins: [react()],
  // 静态资源从 src/public 读取（构建时复制到输出根目录，路径引用不变）
  publicDir: 'src/public',
  build: {
    // 构建产物归入 data/dist（运行期生成物，不入库）
    outDir: 'data/dist',
    emptyOutDir: true,
  },
  server: {
    port: webPort,
    host: true,
    proxy: {
      '/api': `http://localhost:${apiPort}`,
      '/integrations': `http://localhost:${apiPort}`,
      '/functions': `http://localhost:${apiPort}`,
    },
  },
})