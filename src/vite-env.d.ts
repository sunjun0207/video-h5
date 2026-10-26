/// <reference types="vite/client" />

declare module '*.css' {
  const css: string
  export default css
}

interface ImportMetaEnv {
  /** 环境标识: local | dev | pro */
  readonly VITE_APP_ENV: 'local' | 'dev' | 'pro'
  readonly VITE_APP_TITLE: string
  readonly VITE_BASE: string
  readonly VITE_SOURCEMAP: string
  readonly VITE_DEV_PORT: string
  /** true 走本站代理，false 浏览器直连片源库 */
  readonly VITE_USE_PROXY: string
  readonly VITE_VOD_TARGET: string
  readonly VITE_IMG_TARGET: string
  readonly VITE_IMG_A_TARGET: string
  readonly VITE_IMG_B_TARGET: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
