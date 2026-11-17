import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { installTokens } from './design/tokens'
import router from './router'

installTokens()

const app = createApp(App)

app.use(createPinia())
app.use(router)

app.mount('#app')
