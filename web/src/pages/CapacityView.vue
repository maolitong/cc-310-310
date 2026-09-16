<template>
  <div>
    <div class="card" v-for="r in rides" :key="r.id">
      <h2>
        {{ r.name }}（{{ r.code }}）
        <span :class="['tag', r.status === 'open' ? 'ok' : 'bad']">
          {{ r.status === 'open' ? '开放' : '已关闭' }}
        </span>
      </h2>

      <div v-if="r.current_ruleset" class="row" style="margin-bottom:10px">
        <span class="muted">
          规则 v{{ r.current_ruleset.version }}：
          身高≥{{ r.current_ruleset.rules.min_height_cm ?? '不限' }}cm ·
          间隔 {{ r.current_ruleset.rules.interval_seconds || 0 }}s ·
          当日上限 {{ r.current_ruleset.rules.max_entries_per_day || '不限' }} 次
        </span>
      </div>

      <div v-if="r.current_window" class="row" style="margin-bottom:10px">
        <span>本时段（{{ fmtTime(r.current_window.window_start) }} 起）</span>
        <div class="bar">
          <div
            class="fill"
            :style="{ width: Math.min(100, (r.current_window.used / r.current_window.capacity) * 100) + '%' }"
          ></div>
        </div>
        <span>{{ r.current_window.used }} / {{ r.current_window.capacity }}</span>
      </div>
      <p class="muted" v-else>该项目无时段容量限制</p>

      <div class="row">
        <button v-if="r.status === 'open'" class="danger" @click="setStatus(r, 'close')">临时关闭</button>
        <button v-else @click="setStatus(r, 'open')">重新开放</button>
        <button class="ghost" @click="toggleEditor(r)">发布新规则版本</button>
        <button class="ghost" @click="loadHistory(r)">容量历史</button>
      </div>

      <div v-if="editorFor === r.id" style="margin-top:12px">
        <textarea
          v-model="editorText"
          rows="8"
          style="width:100%;font-family:monospace"
        ></textarea>
        <div class="row" style="margin-top:8px">
          <input v-model="editorEffective" placeholder="生效时间 ISO（缺省立即）" style="width:260px" />
          <button @click="publish(r)">发布</button>
          <span class="error" v-if="editorError">{{ editorError }}</span>
        </div>
      </div>

      <table v-if="historyFor === r.id" style="margin-top:12px">
        <thead><tr><th>窗口起点</th><th>已用</th></tr></thead>
        <tbody>
          <tr v-for="w in history" :key="w.window_start">
            <td>{{ fmtTime(w.window_start) }}</td>
            <td>{{ w.used }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="error" v-if="error">{{ error }}</p>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { fmtTime } from '../labels';

const rides = ref([]);
const error = ref('');
const editorFor = ref('');
const editorText = ref('');
const editorEffective = ref('');
const editorError = ref('');
const historyFor = ref('');
const history = ref([]);

async function load() {
  rides.value = await api.get('/api/rides');
}

async function setStatus(r, action) {
  error.value = '';
  try {
    await api.post(`/api/rides/${r.id}/${action}`);
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

function toggleEditor(r) {
  editorFor.value = editorFor.value === r.id ? '' : r.id;
  editorError.value = '';
  editorText.value = JSON.stringify(r.current_ruleset?.rules || {}, null, 2);
  editorEffective.value = '';
}

async function publish(r) {
  editorError.value = '';
  try {
    const rules = JSON.parse(editorText.value);
    await api.post(`/api/rides/${r.id}/rulesets`, {
      rules,
      effective_from: editorEffective.value || undefined,
    });
    editorFor.value = '';
    await load();
  } catch (e) {
    editorError.value = e.message;
  }
}

async function loadHistory(r) {
  historyFor.value = historyFor.value === r.id ? '' : r.id;
  if (historyFor.value) history.value = await api.get(`/api/rides/${r.id}/capacity`);
}

onMounted(load);
</script>

<style scoped>
.bar {
  flex: 1;
  max-width: 320px;
  height: 12px;
  background: #edf0f6;
  border-radius: 6px;
  overflow: hidden;
}
.fill { height: 100%; background: #2b4acb; transition: width .3s; }
</style>
