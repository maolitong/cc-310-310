<template>
  <div>
    <div class="card">
      <h2>资格解释</h2>
      <div class="row">
        <select v-model="visitorId">
          <option value="" disabled>选择游客</option>
          <option v-for="v in visitors" :key="v.id" :value="v.id">{{ v.name }}</option>
        </select>
        <select v-model="rideId">
          <option value="" disabled>选择项目</option>
          <option v-for="r in rides" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
        <button @click="explain" :disabled="!visitorId || !rideId">查询</button>
        <span class="error" v-if="error">{{ error }}</span>
      </div>
    </div>

    <div class="card" v-if="result">
      <h2>
        {{ result.visitor.name }} × {{ result.ride.name }}
        <span :class="['tag', result.decision === 'allow' ? 'ok' : 'bad']">
          {{ result.decision === 'allow' ? '可进入' : reasonLabel(result.reason_code) }}
        </span>
      </h2>
      <p class="muted" v-if="result.ruleset">
        当前规则版本 v{{ result.ruleset.version }}（{{ fmtTime(result.ruleset.effective_from) }} 起生效）
      </p>
      <table>
        <thead><tr><th>检查项</th><th>结果</th><th>说明</th></tr></thead>
        <tbody>
          <tr v-for="c in result.checks" :key="c.key">
            <td>{{ c.label }}</td>
            <td><span :class="['tag', c.pass ? 'ok' : 'bad']">{{ c.pass ? '通过' : '未通过' }}</span></td>
            <td>{{ c.detail }}</td>
          </tr>
        </tbody>
      </table>
      <p class="muted">资格解释仅供服务台查看；闸机端只会收到「放行」或拒绝原因码。</p>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { fmtTime, reasonLabel } from '../labels';

const visitors = ref([]);
const rides = ref([]);
const visitorId = ref('');
const rideId = ref('');
const result = ref(null);
const error = ref('');

async function explain() {
  error.value = '';
  result.value = null;
  try {
    result.value = await api.get(`/api/visitors/${visitorId.value}/eligibility/${rideId.value}`);
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(async () => {
  [visitors.value, rides.value] = await Promise.all([
    api.get('/api/visitors'),
    api.get('/api/rides'),
  ]);
});
</script>
