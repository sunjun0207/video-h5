import { handle } from './dushe.mjs'

export function dusheSourcePlugin() {
  const middleware = (req, res, next) => {
    const url = req.url || ''
    if (!url.startsWith('/source/')) {
      next()
      return
    }
    handle(req, res).catch((error) => {
      if (res.headersSent) return
      res.statusCode = 502
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : '片源请求失败' }))
    })
  }
  return {
    name: 'dushe-source',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
