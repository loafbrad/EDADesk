import { ref, computed, onUnmounted } from 'vue';
import type { Signal, WavePoint, DisplayFormat } from '../types/waveform';

// Backend API base URL
const API_BASE = '/api';
const WS_BASE = `ws://${window.location.hostname}:3001/ws`;

// Types matching backend
interface SimulatorInfo {
  id: string;
  name: string;
  available: boolean;
  version: string | null;
}

interface ProjectInfo {
  id: string;
  name: string;
  files: string[];
  createdAt: string;
  simulator?: string;
  compiled?: boolean;
}

interface WaveformChunk {
  signals: Array<{
    name: string;
    width: number;
    points: Array<{ x: number; level: number | string }>;
  }>;
  timeRange: { start: number; end: number };
  isComplete: boolean;
}

interface WebSocketMessage {
  type: string;
  projectId: string;
  data?: unknown;
  error?: string;
}

// Generate unique IDs for signals
let signalIdCounter = 10000;
function generateSignalId(): string {
  return `sim-signal-${signalIdCounter++}`;
}

// Signal colors for simulation results
const simSignalColors = [
  '#E91E63', // Pink
  '#00BCD4', // Cyan
  '#8BC34A', // Light Green
  '#FFC107', // Amber
  '#673AB7', // Deep Purple
  '#FF5722', // Deep Orange
  '#009688', // Teal
  '#3F51B5', // Indigo
];

export function useSimulation() {
  // State
  const simulators = ref<SimulatorInfo[]>([]);
  const selectedSimulator = ref<string>('icarus');
  const topModule = ref<string>(''); // User-specified top module (empty = auto-detect)
  const currentProject = ref<ProjectInfo | null>(null);
  const isConnected = ref(false);
  const isCompiling = ref(false);
  const isSimulating = ref(false);
  const compileOutput = ref<string[]>([]);
  const simulationOutput = ref<string[]>([]);
  const simulatedSignals = ref<Signal[]>([]);
  const error = ref<string | null>(null);

  // WebSocket connection
  let ws: WebSocket | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  // Computed
  const availableSimulators = computed(() =>
    simulators.value.filter(s => s.available)
  );

  const canCompile = computed(() =>
    currentProject.value !== null &&
    currentProject.value.files.length > 0 &&
    !isCompiling.value &&
    !isSimulating.value
  );

  const canSimulate = computed(() =>
    currentProject.value !== null &&
    currentProject.value.compiled === true &&
    !isCompiling.value &&
    !isSimulating.value
  );

  // Connect to WebSocket
  function connectWebSocket(): void {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    ws = new WebSocket(WS_BASE);

    ws.onopen = () => {
      isConnected.value = true;
      error.value = null;

      // Subscribe to current project if any
      if (currentProject.value) {
        subscribeToProject(currentProject.value.id);
      }
    };

    ws.onclose = () => {
      isConnected.value = false;
      // Attempt to reconnect after 3 seconds
      reconnectTimeout = setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => {
      error.value = 'WebSocket connection error';
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WebSocketMessage;
        handleWebSocketMessage(message);
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };
  }

  function disconnectWebSocket(): void {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  function subscribeToProject(projectId: string): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'subscribe', projectId }));
    }
  }

  function unsubscribeFromProject(projectId: string): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'unsubscribe', projectId }));
    }
  }

  function handleWebSocketMessage(message: WebSocketMessage): void {
    switch (message.type) {
      case 'compile_output': {
        const data = message.data as { stream: string; text: string };
        compileOutput.value.push(data.text);
        break;
      }
      case 'compile_complete': {
        const data = message.data as { success: boolean; exitCode: number };
        isCompiling.value = false;
        if (currentProject.value) {
          currentProject.value.compiled = data.success;
        }
        if (!data.success) {
          error.value = `Compilation failed with exit code ${data.exitCode}`;
        }
        break;
      }
      case 'sim_started': {
        const data = message.data as { simulatorName: string };
        simulationOutput.value.push(`Simulation started with ${data.simulatorName}`);
        break;
      }
      case 'waveform_chunk': {
        const chunk = message.data as WaveformChunk;
        handleWaveformChunk(chunk);
        break;
      }
      case 'sim_complete': {
        const data = message.data as { success: boolean; exitCode: number };
        isSimulating.value = false;
        simulationOutput.value.push(
          data.success
            ? 'Simulation completed successfully'
            : `Simulation failed with exit code ${data.exitCode}`
        );
        break;
      }
      case 'error': {
        error.value = message.error || 'Unknown error';
        isCompiling.value = false;
        isSimulating.value = false;
        break;
      }
    }
  }

  function handleWaveformChunk(chunk: WaveformChunk): void {
    for (const sigData of chunk.signals) {
      // Find existing signal or create new one
      let signal = simulatedSignals.value.find(s => s.name === sigData.name);

      if (!signal) {
        // Create new signal
        const colorIndex = simulatedSignals.value.length % simSignalColors.length;
        signal = {
          id: generateSignalId(),
          name: sigData.name,
          width: sigData.width,
          points: [],
          color: simSignalColors[colorIndex]!,
          displayFormat: 'hex' as DisplayFormat,
        };
        simulatedSignals.value.push(signal);
      }

      // Add new points
      for (const point of sigData.points) {
        const level = typeof point.level === 'string'
          ? (point.level.startsWith('0b') ? BigInt(point.level) : BigInt('0b' + point.level))
          : point.level;

        // Check if point already exists at this time
        const existingIdx = signal.points.findIndex(p => p.x === point.x);
        if (existingIdx >= 0) {
          signal.points[existingIdx]!.level = level;
        } else {
          signal.points.push({ x: point.x, level });
        }
      }

      // Sort points by time
      signal.points.sort((a, b) => a.x - b.x);
    }
  }

  // API functions
  async function fetchSimulators(): Promise<void> {
    try {
      const response = await fetch(`${API_BASE}/simulators`);
      if (!response.ok) throw new Error('Failed to fetch simulators');
      simulators.value = await response.json();

      // Select first available simulator
      const available = simulators.value.find(s => s.available);
      if (available) {
        selectedSimulator.value = available.id;
      }
    } catch (err) {
      error.value = `Failed to fetch simulators: ${err}`;
    }
  }

  async function createProject(name?: string): Promise<ProjectInfo | null> {
    try {
      const response = await fetch(`${API_BASE}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) throw new Error('Failed to create project');

      const project = await response.json() as ProjectInfo;
      currentProject.value = project;

      // Subscribe to project updates
      subscribeToProject(project.id);

      return project;
    } catch (err) {
      error.value = `Failed to create project: ${err}`;
      return null;
    }
  }

  async function uploadFiles(files: FileList | File[]): Promise<boolean> {
    if (!currentProject.value) {
      // Create project first
      await createProject();
    }

    if (!currentProject.value) {
      error.value = 'No project to upload files to';
      return false;
    }

    try {
      const formData = new FormData();
      for (const file of files) {
        formData.append('files', file);
      }

      const response = await fetch(`${API_BASE}/projects/${currentProject.value.id}/files`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Failed to upload files');

      const result = await response.json() as { files: string[] };
      currentProject.value.files = result.files;

      return true;
    } catch (err) {
      error.value = `Failed to upload files: ${err}`;
      return false;
    }
  }

  async function compile(): Promise<boolean> {
    if (!currentProject.value) {
      error.value = 'No project to compile';
      return false;
    }

    try {
      isCompiling.value = true;
      compileOutput.value = [];
      error.value = null;

      const response = await fetch(`${API_BASE}/projects/${currentProject.value.id}/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          simulator: selectedSimulator.value,
          topModule: topModule.value || undefined, // Send undefined if empty to trigger auto-detect
        }),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Compilation failed');
      }

      // Compilation started, output will come via WebSocket
      return true;
    } catch (err) {
      isCompiling.value = false;
      error.value = `Compilation error: ${err}`;
      return false;
    }
  }

  async function simulate(): Promise<boolean> {
    if (!currentProject.value) {
      error.value = 'No project to simulate';
      return false;
    }

    if (!currentProject.value.compiled) {
      error.value = 'Project not compiled';
      return false;
    }

    try {
      isSimulating.value = true;
      simulationOutput.value = [];
      simulatedSignals.value = [];
      error.value = null;

      const response = await fetch(`${API_BASE}/projects/${currentProject.value.id}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'Simulation failed');
      }

      // Simulation started, updates will come via WebSocket
      return true;
    } catch (err) {
      isSimulating.value = false;
      error.value = `Simulation error: ${err}`;
      return false;
    }
  }

  async function stopSimulation(): Promise<void> {
    if (!currentProject.value || !isSimulating.value) return;

    try {
      await fetch(`${API_BASE}/projects/${currentProject.value.id}/simulate/stop`, {
        method: 'POST',
      });
    } catch (err) {
      error.value = `Failed to stop simulation: ${err}`;
    }
  }

  function clearError(): void {
    error.value = null;
  }

  function clearOutput(): void {
    compileOutput.value = [];
    simulationOutput.value = [];
  }

  // Initialize
  function init(): void {
    connectWebSocket();
    fetchSimulators();
  }

  // Cleanup
  onUnmounted(() => {
    disconnectWebSocket();
  });

  return {
    // State
    simulators,
    selectedSimulator,
    topModule,
    currentProject,
    isConnected,
    isCompiling,
    isSimulating,
    compileOutput,
    simulationOutput,
    simulatedSignals,
    error,

    // Computed
    availableSimulators,
    canCompile,
    canSimulate,

    // Methods
    init,
    fetchSimulators,
    createProject,
    uploadFiles,
    compile,
    simulate,
    stopSimulation,
    clearError,
    clearOutput,
  };
}
