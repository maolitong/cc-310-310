<template>
  <div>
    <div class="card">
      <h2>建立监护关系</h2>
      <div class="row">
        <select v-model="guardianId">
          <option value="" disabled>选择监护人（成人）</option>
          <option v-for="v in adults" :key="v.id" :value="v.id">{{ v.name }}</option>
        </select>
        <select v-model="dependentId">
          <option value="" disabled>选择被监护人</option>
          <option v-for="v in minors" :key="v.id" :value="v.id">{{ v.name }}</option>
        </select>
        <button @click="create" :disabled="!guardianId || !dependentId">建立</button>
        <span class="error" v-if="error">{{ error }}</span>
      </div>
    </div>

    <div class="card">
      <h2>监护关系列表 <button class="ghost" @click="load">刷新</button></h2>
      <table>
        <thead>
          <tr><th>监护人</th><th>被监护人</th><th>状态</th><th>建立时间</th><th>撤回时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="g in guardianships" :key="g.id">
            <td>{{ g.guardian_name }}</td>
            <td>{{ g.dependent_name }}</td>
            <td>
              <span :class="['tag', g.status === 'active' ? 'ok' : 'bad']">
                {{ g.status === 'active' ? '有效' : '已撤回' }}
              </span>
            </td>
            <td>{{ fmtTime(g.created_at) }}</td>
            <td>{{ fmtTime(g.revoked_at) }}</td>
            <td>
              <button class="danger" v-if="g.status === 'active'" @click="revoke(g)">撤回授权</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="muted">撤回授权后，被监护人在需要监护的项目上将被拒绝，直到重新建立授权。</p>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import { fmtTime } from '../labels';

const visitors = ref([]);
const guardianships = ref([]);
const guardianId = ref('');
const dependentId = ref('');
const error = ref('');

const adults = computed(() => visitors.value.filter((v) => v.age_band === 'adult' && !v.exited_at));
const minors = computed(() => visitors.value.filter((v) => v.age_band !== 'adult' && !v.exited_at));

async function load() {
  [visitors.value, guardianships.value] = await Promise.all([
    api.get('/api/visitors'),
    api.get('/api/guardianships'),
  ]);
}

async function create() {
  error.value = '';
  try {
    await api.post('/api/guardianships', {
      guardian_id: guardianId.value,
      dependent_id: dependentId.value,
    });
    guardianId.value = '';
    dependentId.value = '';
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

async function revoke(g) {
  error.value = '';
  try {
    await api.post(`/api/guardianships/${g.id}/revoke`);
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(load);
</script>
