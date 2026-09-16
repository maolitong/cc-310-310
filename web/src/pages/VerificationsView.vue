<template>
  <div class="card">
    <h2>核验流水 <button class="ghost" @click="load">刷新</button></h2>
    <div class="row" style="margin-bottom:12px">
      <select v-model="decision">
        <option value="">全部结果</option>
        <option value="allow">放行</option>
        <option value="deny">拒绝</option>
      </select>
      <select v-model="rideId">
        <option value="">全部项目</option>
        <option v-for="r in rides" :key="r.id" :value="r.id">{{ r.name }}</option>
      </select>
      <label><input type="checkbox" v-model="offlineOnly" /> 仅看离线补传</label>
    </div>
    <table>
      <thead>
        <tr>
          <th>发生时间</th><th>项目</th><th>闸机</th><th>腕带</th>
          <th>结果</th><th>原因码</th><th>规则版本</th><th>来源</th><th>接收时间</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="v in filtered" :key="v.id">
          <td>{{ fmtTime(v.occurred_at) }}</td>
          <td>{{ v.ride_name || '—' }}</td>
          <td>{{ v.device_name || '—' }}</td>
          <td><code>{{ v.wristband_public_id }}</code></td>
          <td>
            <span :class="['tag', v.decision === 'allow' ? 'ok' : 'bad']">
              {{ v.decision === 'allow' ? '放行' : '拒绝' }}
            </span>
          </td>
          <td>{{ reasonLabel(v.reason_code) }}</td>
          <td>{{ v.ruleset_version ? 'v' + v.ruleset_version : '—' }}</td>
          <td>
            <span :class="['tag', v.offline ? 'warn' : 'ok']">{{ v.offline ? '离线补传' : '在线' }}</span>
          </td>
          <td>{{ fmtTime(v.received_at) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../api';
import { fmtTime, reasonLabel } from '../labels';

const rows = ref([]);
const rides = ref([]);
const decision = ref('');
const rideId = ref('');
const offlineOnly = ref(false);

const filtered = computed(() => (offlineOnly.value ? rows.value.filter((r) => r.offline) : rows.value));

async function load() {
  const params = new URLSearchParams();
  if (decision.value) params.set('decision', decision.value);
  if (rideId.value) params.set('ride_id', rideId.value);
  rows.value = await api.get(`/api/verifications?${params}`);
}

onMounted(async () => {
  rides.value = await api.get('/api/rides');
  await load();
});

// 筛选条件变化时重新查询
watch([decision, rideId], load);
</script>
