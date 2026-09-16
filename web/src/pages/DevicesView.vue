<template>
  <div>
    <div class="card">
      <h2>闸机设备 <button class="ghost" @click="load">刷新</button></h2>
      <table>
        <thead>
          <tr><th>设备</th><th>所属项目</th><th>状态</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="d in devices" :key="d.id">
            <td>{{ d.name }}</td>
            <td>{{ d.ride_name }}</td>
            <td>
              <span :class="['tag', d.status === 'active' ? 'ok' : 'bad']">
                {{ d.status === 'active' ? '运行中' : '已停用' }}
              </span>
            </td>
            <td>
              <button class="danger" v-if="d.status === 'active'" @click="decommission(d)">停用设备</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="error" v-if="error">{{ error }}</p>
    </div>

    <div class="card">
      <h2>事件流水</h2>
      <table>
        <thead><tr><th>时间</th><th>事件</th><th>详情</th></tr></thead>
        <tbody>
          <tr v-for="e in events" :key="e.id">
            <td>{{ fmtTime(e.created_at) }}</td>
            <td><span class="tag warn">{{ EVENT_LABELS[e.type] || e.type }}</span></td>
            <td><code>{{ e.detail }}</code></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { EVENT_LABELS, fmtTime } from '../labels';

const devices = ref([]);
const events = ref([]);
const error = ref('');

async function load() {
  [devices.value, events.value] = await Promise.all([
    api.get('/api/devices'),
    api.get('/api/events'),
  ]);
}

async function decommission(d) {
  error.value = '';
  try {
    await api.post(`/api/devices/${d.id}/decommission`);
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(load);
</script>
