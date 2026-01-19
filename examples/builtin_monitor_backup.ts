/**
 * BACKUP: Built-in Ready/Valid Monitor Code
 *
 * This code was removed from WaveformEditor.vue after implementing the Python sieve system.
 * The sieve system provides a more flexible way to define custom monitors via Python scripts.
 *
 * To restore this functionality, uncomment the relevant sections and add them back to
 * WaveformEditor.vue in the appropriate locations.
 */

// =============================================================================
// IMPORTS (add to the import statement)
// =============================================================================
// import type { MonitorConfig, Transaction } from '../types/waveform';

// =============================================================================
// STATE (add after markers state)
// =============================================================================
/*
// Monitor state for ready/valid interface
const monitorConfig = reactive<MonitorConfig>({
  clockSignalId: null,
  readySignalId: null,
  validSignalId: null,
  dataSignalId: null,
  enabled: false,
});
const transactions = ref<Transaction[]>([]);
let transactionIdCounter = 0;

// Computed lists for signal selection in monitor
const singleBitSignals = computed(() => signals.value.filter(s => s.width === 1));
const vectorSignals = computed(() => signals.value.filter(s => s.width > 1));
*/

// =============================================================================
// FUNCTIONS (add after clearAllSignals)
// =============================================================================
/*
// Monitor functions
// Get signal value just BEFORE the given time (for sampling at clock edges)
function getSignalValueBeforeTime(signal: Signal, time: number): number | null {
  const sortedPoints = [...signal.points].sort((a, b) => a.x - b.x);
  if (sortedPoints.length === 0) return null;

  // Find the point that was active strictly before the given time
  let activeValue: number | null = null;
  for (const point of sortedPoints) {
    if (point.x < time) {
      activeValue = point.level;
    } else {
      break;
    }
  }
  return activeValue;
}

function detectTransactions() {
  transactions.value = [];

  if (!monitorConfig.clockSignalId || !monitorConfig.readySignalId ||
      !monitorConfig.validSignalId || !monitorConfig.dataSignalId) {
    return;
  }

  const clockSignal = signals.value.find(s => s.id === monitorConfig.clockSignalId);
  const readySignal = signals.value.find(s => s.id === monitorConfig.readySignalId);
  const validSignal = signals.value.find(s => s.id === monitorConfig.validSignalId);
  const dataSignal = signals.value.find(s => s.id === monitorConfig.dataSignalId);

  if (!clockSignal || !readySignal || !validSignal || !dataSignal) {
    return;
  }

  // Find rising edges of the clock signal
  const sortedClockPoints = [...clockSignal.points].sort((a, b) => a.x - b.x);
  const risingEdges: number[] = [];

  for (let i = 1; i < sortedClockPoints.length; i++) {
    const prevPoint = sortedClockPoints[i - 1];
    const currPoint = sortedClockPoints[i];
    if (prevPoint && currPoint && prevPoint.level === 0 && currPoint.level === 1) {
      risingEdges.push(currPoint.x);
    }
  }

  // Check each rising edge for ready=1 and valid=1
  // All signals are sampled just BEFORE the clock edge (setup time)
  for (const edgeTime of risingEdges) {
    const readyValue = getSignalValueBeforeTime(readySignal, edgeTime);
    const validValue = getSignalValueBeforeTime(validSignal, edgeTime);

    if (readyValue === 1 && validValue === 1) {
      // Data is also sampled just before the clock edge
      const dataValue = getSignalValueBeforeTime(dataSignal, edgeTime);
      if (dataValue !== null) {
        transactions.value.push({
          id: `txn_${++transactionIdCounter}`,
          time: edgeTime,
          dataValue: dataValue,
          displayFormat: dataSignal.displayFormat,
        });
      }
    }
  }
}

function clearTransactions() {
  transactions.value = [];
}
*/

// =============================================================================
// WATCH (add after sieve watch)
// =============================================================================
/*
// Watch for signal changes to re-detect transactions when monitor is enabled
watch(
  () => [
    monitorConfig.enabled,
    monitorConfig.clockSignalId,
    monitorConfig.readySignalId,
    monitorConfig.validSignalId,
    monitorConfig.dataSignalId,
    signals.value.map(s => s.points),
  ],
  () => {
    if (monitorConfig.enabled) {
      detectTransactions();
    }
  },
  { deep: true }
);
*/

// =============================================================================
// COMPUTED (add before </script>)
// =============================================================================
/*
// Get data signal width for formatting
const dataSignalWidth = computed(() => {
  if (!monitorConfig.dataSignalId) return 8;
  const signal = signals.value.find(s => s.id === monitorConfig.dataSignalId);
  return signal?.width ?? 8;
});
*/

// =============================================================================
// TEMPLATE (add after Sieve Panel)
// =============================================================================
/*
<!-- Monitor Panel -->
<div class="monitor-panel">
  <div class="monitor-header">
    <h3>Ready/Valid Monitor</h3>
    <label class="enable-toggle">
      <input type="checkbox" v-model="monitorConfig.enabled" />
      Enable
    </label>
  </div>

  <div class="monitor-config">
    <div class="config-row">
      <label>
        Clock:
        <select v-model="monitorConfig.clockSignalId" class="signal-select">
          <option :value="null">-- Select --</option>
          <option v-for="sig in singleBitSignals" :key="sig.id" :value="sig.id">
            {{ sig.name }}
          </option>
        </select>
      </label>

      <label>
        Ready:
        <select v-model="monitorConfig.readySignalId" class="signal-select">
          <option :value="null">-- Select --</option>
          <option v-for="sig in singleBitSignals" :key="sig.id" :value="sig.id">
            {{ sig.name }}
          </option>
        </select>
      </label>

      <label>
        Valid:
        <select v-model="monitorConfig.validSignalId" class="signal-select">
          <option :value="null">-- Select --</option>
          <option v-for="sig in singleBitSignals" :key="sig.id" :value="sig.id">
            {{ sig.name }}
          </option>
        </select>
      </label>

      <label>
        Data:
        <select v-model="monitorConfig.dataSignalId" class="signal-select">
          <option :value="null">-- Select --</option>
          <option v-for="sig in vectorSignals" :key="sig.id" :value="sig.id">
            {{ sig.name }} [{{ sig.width - 1 }}:0]
          </option>
        </select>
      </label>
    </div>
  </div>

  <div v-if="monitorConfig.enabled && transactions.length > 0" class="transactions-section">
    <div class="transactions-header">
      <h4>Captured Transactions ({{ transactions.length }})</h4>
      <button @click="clearTransactions" class="btn btn-small">Clear</button>
    </div>
    <div class="transactions-table-container">
      <table class="transactions-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Time</th>
            <th>Data</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(txn, index) in transactions" :key="txn.id">
            <td>{{ index + 1 }}</td>
            <td>{{ txn.time }}</td>
            <td class="data-value">{{ formatTransactionValue(txn.dataValue, txn.displayFormat, dataSignalWidth) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <div v-else-if="monitorConfig.enabled" class="no-transactions">
    No transactions captured yet. Ensure all signals are configured and have valid data.
  </div>
</div>
*/

// =============================================================================
// STYLES (add to <style scoped>)
// =============================================================================
/*
.monitor-panel {
  margin-top: 20px;
  padding: 16px;
  background: #f0f4f8;
  border: 1px solid #ddd;
  border-radius: 8px;
}

.monitor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.monitor-header h3 {
  margin: 0;
  font-size: 16px;
  color: #333;
}

.enable-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  cursor: pointer;
}

.enable-toggle input {
  cursor: pointer;
}

.monitor-config {
  margin-bottom: 16px;
}

.config-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.config-row label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: #555;
}

.signal-select {
  padding: 6px 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 13px;
  min-width: 140px;
  background: white;
}

.signal-select:focus {
  outline: none;
  border-color: #2196F3;
}

.dark-mode .monitor-panel {
  background: #2a2a3e;
  border-color: #444;
}

.dark-mode .monitor-header h3 {
  color: #e0e0e0;
}

.dark-mode .enable-toggle {
  color: #ccc;
}

.dark-mode .config-row label {
  color: #aaa;
}

.dark-mode .signal-select {
  background: #2a2a3e;
  border-color: #444;
  color: #e0e0e0;
}
*/
