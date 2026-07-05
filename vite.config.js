import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'offline.html'],
      manifest: {
        name: 'Daniel Body Plan',
        short_name: 'BodyPlan',
        description: '식단 · 운동 · 체성분 관리',
        theme_color: '#141414',
        background_color: '#141414',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        categories: ['health', 'fitness', 'lifestyle'],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        // 웹푸시 수신 핸들러(push/notificationclick)를 생성 SW에 합침
        importScripts: ['/push-sw.js'],
        // 구버전 수동 SW에서 전환 시 즉시 활성화 + 오래된 precache 정리
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // 오프라인 네비게이션 시 precache된 앱 셸 제공 (/api/* 는 SW 우회)
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [{
          urlPattern: /^https:\/\/fonts/,
          handler: 'CacheFirst',
          options: { cacheName: 'google-fonts', expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } }
        }]
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        // 자주 배포(앱 코드 변경) 시 큰 라이브러리 청크는 해시가 안 바뀌어 SW 캐시 유지 →
        // 업데이트 시 재다운로드 양 감소. firebase·recharts를 앱 코드와 분리.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('firebase') || id.includes('@firebase') || id.includes('@grpc') || id.includes('protobufjs')) return 'firebase';
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory') || id.includes('react-smooth') || id.includes('decimal')) return 'recharts';
          return 'vendor';
        }
      }
    }
  }
})
