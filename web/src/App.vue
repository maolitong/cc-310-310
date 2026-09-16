<template>
  <div>
    <header class="topbar">
      <h1>🎡 游乐园腕带系统</h1>
      <nav>
        <RouterLink to="/desk">腕带服务台</RouterLink>
        <RouterLink to="/guardians">监护关系</RouterLink>
        <RouterLink to="/eligibility">资格解释</RouterLink>
        <RouterLink to="/capacity">项目容量</RouterLink>
        <RouterLink to="/devices">设备状态</RouterLink>
        <RouterLink to="/verifications">核验流水</RouterLink>
      </nav>
    </header>
    <main>
      <RouterView />
    </main>
  </div>
</template>

<style>
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  background: #f4f6fa;
  color: #223;
}
.topbar {
  background: #2b4acb;
  color: #fff;
  padding: 12px 24px;
}
.topbar h1 { margin: 0 0 8px; font-size: 20px; }
.topbar nav { display: flex; gap: 4px; flex-wrap: wrap; }
.topbar a {
  color: #cdd8ff;
  text-decoration: none;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 14px;
}
.topbar a.router-link-active { background: rgba(255,255,255,.18); color: #fff; }
main { padding: 20px 24px; max-width: 1200px; margin: 0 auto; }
.card {
  background: #fff;
  border-radius: 10px;
  padding: 16px 20px;
  margin-bottom: 16px;
  box-shadow: 0 1px 3px rgba(20,40,90,.08);
}
.card h2 { margin: 0 0 12px; font-size: 17px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #edf0f6; }
th { color: #667; font-weight: 600; }
button {
  background: #2b4acb;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}
button.ghost { background: #eef1f8; color: #2b4acb; }
button.danger { background: #d64545; }
button:disabled { opacity: .5; cursor: default; }
input, select, textarea {
  padding: 6px 8px;
  border: 1px solid #ccd3e0;
  border-radius: 6px;
  font-size: 14px;
}
.tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
}
.tag.ok { background: #e2f6e8; color: #1c7c36; }
.tag.bad { background: #fde4e4; color: #b3271e; }
.tag.warn { background: #fff3d6; color: #946200; }
.muted { color: #889; font-size: 13px; }
.error { color: #b3271e; margin: 8px 0; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
</style>
