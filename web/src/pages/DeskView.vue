<template>
  <div>
    <div class="card">
      <h2>登记游客（虚构资料）</h2>
      <div class="row">
        <input v-model="form.name" placeholder="姓名" style="width:120px" />
        <input v-model.number="form.height_cm" type="number" placeholder="身高 cm" style="width:100px" />
        <select v-model="form.age_band">
          <option value="child">儿童</option>
          <option value="teen">青少年</option>
          <option value="adult">成人</option>
        </select>
        <label><input type="checkbox" v-model="form.health_ack" /> 已确认健康提示</label>
        <button @click="createVisitor">登记并发带</button>
        <span class="error" v-if="error">{{ error }}</span>
      </div>
    </div>

    <div class="card">
      <h2>游客与腕带 <button class="ghost" @click="load">刷新</button></h2>
      <table>
        <thead>
          <tr>
            <th>姓名</th><th>年龄段</th><th>身高</th><th>健康确认</th>
            <th>有效腕带</th><th>状态</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in visitors" :key="v.id">
            <td>{{ v.name }}</td>
            <td>{{ AGE_BAND_LABELS[v.age_band] }}</td>
            <td>{{ v.height_cm }}cm</td>
            <td>
              <span :class="['tag', v.health_ack ? 'ok' : 'warn']">
                {{ v.health_ack ? '已确认' : '未确认' }}
              </span>
            </td>
            <td><code>{{ v.wristband_public_id || '—' }}</code></td>
            <td>
              <span :class="['tag', v.exited_at ? 'bad' : 'ok']">
                {{ v.exited_at ? '已离园' : '在园' }}
              </span>
            </td>
            <td class="row">
              <button class="ghost" @click="reissue(v)" :disabled="!!v.exited_at">补发腕带</button>
              <button class="ghost" @click="measure(v)">身高复测</button>
              <button class="ghost" v-if="!v.health_ack" @click="ackHealth(v)">确认健康提示</button>
              <button class="danger" v-if="!v.exited_at" @click="exit(v)">办理离园</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="muted" v-if="message">{{ message }}</p>
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import { AGE_BAND_LABELS } from '../labels';

const visitors = ref([]);
const error = ref('');
const message = ref('');
const form = reactive({ name: '', height_cm: 120, age_band: 'child', health_ack: false });

async function load() {
  visitors.value = await api.get('/api/visitors');
}

async function run(fn, ok) {
  error.value = '';
  message.value = '';
  try {
    await fn();
    message.value = ok;
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

async function createVisitor() {
  await run(async () => {
    const v = await api.post('/api/visitors', { ...form });
    await api.post(`/api/visitors/${v.id}/wristbands`);
  }, '已登记并发放腕带');
}

async function reissue(v) {
  await run(async () => {
    const band = await api.post(`/api/visitors/${v.id}/wristbands`);
    message.value = `新腕带：${band.public_id}（旧带已立即停用）`;
  }, '');
}

async function measure(v) {
  const input = window.prompt(`复测 ${v.name} 的身高（cm）`, String(v.height_cm));
  if (!input) return;
  await run(() => api.post(`/api/visitors/${v.id}/measure`, { height_cm: Number(input) }), '身高已更新，后续项目将重新判断');
}

async function ackHealth(v) {
  await run(() => api.post(`/api/visitors/${v.id}/health-ack`), '已确认健康提示');
}

async function exit(v) {
  await run(() => api.post(`/api/visitors/${v.id}/exit`), `${v.name} 已办理离园`);
}

onMounted(load);
</script>
