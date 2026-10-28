import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { DIRECT_IMAGE_ORIGIN } from './lib/mediaProxy'
import './styles.css'

if (DIRECT_IMAGE_ORIGIN) {
  const link = document.createElement('link')
  link.rel = 'preconnect'
  link.href = DIRECT_IMAGE_ORIGIN
  document.head.append(link)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
