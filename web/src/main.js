import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import DeskView from './pages/DeskView.vue';
import GuardiansView from './pages/GuardiansView.vue';
import EligibilityView from './pages/EligibilityView.vue';
import CapacityView from './pages/CapacityView.vue';
import DevicesView from './pages/DevicesView.vue';
import VerificationsView from './pages/VerificationsView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/desk' },
    { path: '/desk', component: DeskView, meta: { title: '腕带服务台' } },
    { path: '/guardians', component: GuardiansView, meta: { title: '监护关系' } },
    { path: '/eligibility', component: EligibilityView, meta: { title: '资格解释' } },
    { path: '/capacity', component: CapacityView, meta: { title: '项目容量' } },
    { path: '/devices', component: DevicesView, meta: { title: '设备状态' } },
    { path: '/verifications', component: VerificationsView, meta: { title: '核验流水' } },
  ],
});

createApp(App).use(router).mount('#app');
