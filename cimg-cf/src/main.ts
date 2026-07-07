import { createApp } from 'vue'
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query'
import App from './App.vue'
import router from './router'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 照片 detail（imageUrl / prev / next）短時間內不太會變，5 分鐘內有 cache 就不重新打
      staleTime: 5 * 60 * 1000,
      // 避免切換分頁再切回來時，背景悄悄重新 fetch 導致 prev/next 在使用者瀏覽途中被替換
      refetchOnWindowFocus: false,
      // 預設會重試 3 次，這裡改成 1 次，讓錯誤狀態能比較快顯示出來
      retry: 1,
    },
  },
})

const app = createApp(App)

app.use(router)
app.use(VueQueryPlugin, { queryClient })

app.mount('#app')
