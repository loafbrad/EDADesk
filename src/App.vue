<script setup lang="ts">
import { ref } from 'vue'
import WaveformEditor from './components/WaveformEditor.vue'

const isDarkMode = ref(false)

function handleDarkModeChange(value: boolean) {
  isDarkMode.value = value
}
</script>

<template>
  <div class="app" :class="{ 'dark-mode': isDarkMode }">
    <header class="app-header">
      <h1>Digital Waveform Editor</h1>
    </header>
    <main>
      <WaveformEditor @update:dark-mode="handleDarkModeChange" />
    </main>
    <footer class="app-footer">
      Thought of by Bradley Boccuzzi... Written by Claude
    </footer>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  background: #f5f5f5;
  transition: background-color 0.3s;
  display: flex;
  flex-direction: column;
}

.app.dark-mode {
  background: #1a1a2e;
}

.app-header {
  background: #1976D2;
  color: white;
  padding: 16px 24px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.app.dark-mode .app-header {
  background: #0d47a1;
}

.app-header h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 500;
}

main {
  padding: 0;
  flex: 1;
}

.app-footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  text-align: center;
  padding: 8px 16px;
  color: #666;
  font-size: 14px;
  font-style: italic;
  background: #f5f5f5;
}

.app.dark-mode .app-footer {
  color: #888;
  background: #1a1a2e;
}
</style>
