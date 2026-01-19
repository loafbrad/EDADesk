import { ref, computed } from 'vue';
import type { Signal, Transaction, DisplayFormat, SieveRegion, SignalModification, DerivedSignal, WavePoint } from '../types/waveform';
import { usePyodide } from './usePyodide';

export interface SieveState {
  id: string;           // Unique identifier
  name: string;         // Filename or display name
  code: string;         // Python source code
  enabled: boolean;     // Toggle execution
  color: string;        // Color for this sieve's regions (optional override)
  transactions: Transaction[];  // This sieve's transactions
  regions: SieveRegion[];       // This sieve's regions
  error: string | null;         // Per-sieve error state
  isGlobal: boolean;            // Whether this sieve analyzes all signals
  groupIds: string[];           // Group IDs this sieve is assigned to (can be multiple)
  signalModifications: SignalModification[];  // Modifications to existing signals
  derivedSignals: DerivedSignal[];            // New signals created by this sieve
}

// Array-based state for multiple sieves
const sieves = ref<SieveState[]>([]);
const isRunning = ref(false);

let sieveIdCounter = 0;
let transactionIdCounter = 0;
let regionIdCounter = 0;
let modificationIdCounter = 0;
let derivedSignalIdCounter = 0;

// Color palette for sieves
const sieveColors = [
  'rgba(76, 175, 80, 0.3)',   // Green
  'rgba(33, 150, 243, 0.3)',  // Blue
  'rgba(255, 152, 0, 0.3)',   // Orange
  'rgba(156, 39, 176, 0.3)',  // Purple
  'rgba(0, 188, 212, 0.3)',   // Cyan
  'rgba(244, 67, 54, 0.3)',   // Red
];

export function useSieve() {
  const { isReady, isLoading, loadError, loadPyodideRuntime, runPython, setGlobal } = usePyodide();

  const hasSieve = computed(() => sieves.value.length > 0);

  // Computed aggregations for all enabled sieves
  const allTransactions = computed(() =>
    sieves.value
      .filter(s => s.enabled)
      .flatMap(s => s.transactions.map(t => ({ ...t, sieveName: s.name, sieveId: s.id })))
      .sort((a, b) => a.time - b.time)
  );

  const allRegions = computed(() =>
    sieves.value
      .filter(s => s.enabled)
      .flatMap(s => s.regions.map(r => ({ ...r, sieveId: s.id })))
  );

  // For backward compatibility
  const currentSieve = computed(() => sieves.value[0] || null);
  const sieveTransactions = allTransactions;
  const sieveRegions = allRegions;
  const sieveError = computed(() => {
    const errored = sieves.value.find(s => s.error);
    return errored?.error || null;
  });

  async function addSieve(name: string, code: string): Promise<string> {
    // Load Pyodide if not ready
    await loadPyodideRuntime();

    const id = `sieve_${++sieveIdCounter}`;
    const colorIndex = sieves.value.length % sieveColors.length;
    const color = sieveColors[colorIndex] ?? sieveColors[0] ?? 'rgba(76, 175, 80, 0.3)';

    const newSieve: SieveState = {
      id,
      name,
      code,
      enabled: true,
      color,
      transactions: [],
      regions: [],
      error: null,
      isGlobal: true,   // Global by default
      groupIds: [],     // No group assignments initially
      signalModifications: [],
      derivedSignals: [],
    };

    sieves.value.push(newSieve);
    return id;
  }

  // Legacy function for backward compatibility
  async function loadSieve(name: string, code: string): Promise<void> {
    await addSieve(name, code);
  }

  function removeSieveById(id: string): void {
    const index = sieves.value.findIndex(s => s.id === id);
    if (index !== -1) {
      sieves.value.splice(index, 1);
    }
  }

  // Legacy function for backward compatibility (removes first sieve)
  function removeSieve(): void {
    if (sieves.value.length > 0) {
      sieves.value.splice(0, 1);
    }
  }

  function toggleSieveById(id: string, enabled: boolean): void {
    const sieve = sieves.value.find(s => s.id === id);
    if (sieve) {
      sieve.enabled = enabled;
      if (!enabled) {
        sieve.transactions = [];
        sieve.regions = [];
        sieve.signalModifications = [];
        sieve.derivedSignals = [];
      }
    }
  }

  // Legacy function for backward compatibility
  function toggleSieve(enabled: boolean): void {
    if (sieves.value.length > 0 && sieves.value[0]) {
      toggleSieveById(sieves.value[0].id, enabled);
    }
  }

  // Add a sieve to a group (keeps existing assignments)
  function addSieveToGroup(sieveId: string, groupId: string): void {
    const sieve = sieves.value.find(s => s.id === sieveId);
    if (sieve && !sieve.groupIds.includes(groupId)) {
      sieve.groupIds.push(groupId);
      // Clear results when assignment changes - will be re-executed
      sieve.transactions = [];
      sieve.regions = [];
    }
  }

  // Remove a sieve from a group
  function removeSieveFromGroup(sieveId: string, groupId: string): void {
    const sieve = sieves.value.find(s => s.id === sieveId);
    if (sieve) {
      const index = sieve.groupIds.indexOf(groupId);
      if (index !== -1) {
        sieve.groupIds.splice(index, 1);
        // Clear results when assignment changes
        sieve.transactions = [];
        sieve.regions = [];
      }
    }
  }

  // Set whether a sieve is global
  function setSieveGlobal(sieveId: string, isGlobal: boolean): void {
    const sieve = sieves.value.find(s => s.id === sieveId);
    if (sieve) {
      sieve.isGlobal = isGlobal;
      // Clear results when assignment changes
      sieve.transactions = [];
      sieve.regions = [];
    }
  }

  // Get sieves that are global
  const globalSieves = computed(() =>
    sieves.value.filter(s => s.isGlobal)
  );

  // Get sieves assigned to a specific group
  function getSievesForGroup(groupId: string): SieveState[] {
    return sieves.value.filter(s => s.groupIds.includes(groupId));
  }

  async function executeSieveById(sieveId: string, signals: Signal[]): Promise<Transaction[]> {
    const sieve = sieves.value.find(s => s.id === sieveId);
    if (!sieve || !sieve.enabled) {
      return [];
    }

    if (!isReady.value) {
      return [];
    }

    sieve.error = null;
    const transactions: Transaction[] = [];
    const regions: SieveRegion[] = [];
    const modifications: SignalModification[] = [];
    const derivedSignals: DerivedSignal[] = [];

    try {
      // Create the signals data as JSON for Python
      const signalsData = createSignalsData(signals);

      // Create the add_transaction callback
      // Value can be number or bigint for large bit widths
      const addTransaction = (time: number, value: number | bigint, _label?: string) => {
        // Find a data signal to get display format (use first vector signal)
        const dataSignal = signals.find(s => s.width > 1);
        const displayFormat: DisplayFormat = dataSignal?.displayFormat ?? 'hex';

        transactions.push({
          id: `sieve_txn_${++transactionIdCounter}`,
          time,
          dataValue: value,
          displayFormat,
        });
      };

      // Create the add_region callback for visual annotations
      // Use the sieve's color as default
      const addRegion = (
        startX: number,
        endX: number,
        color: string = sieve.color,
        signalName?: string,
        label?: string,
        tooltip?: string
      ) => {
        regions.push({
          id: `sieve_region_${++regionIdCounter}`,
          startX,
          endX,
          color,
          signalName,
          label,
          tooltip,
        });
      };

      // Create the modify_signal callback for modifying existing signals
      const modifySignal = (signalName: string, newPoints: Array<{x: number; level: number | string}>) => {
        const original = signals.find(s => s.name === signalName);
        if (!original) return;

        modifications.push({
          id: `mod_${sieve.id}_${original.id}_${++modificationIdCounter}`,
          sourceSignalId: original.id,
          sourceSignalName: signalName,
          sieveId: sieve.id,
          modifiedPoints: newPoints.map(p => ({
            x: p.x,
            level: typeof p.level === 'string' ? BigInt(p.level) : p.level,
          })),
          timestamp: Date.now(),
        });
      };

      // Create the create_signal callback for creating new derived signals
      // Points and sourceSignalNames are passed as JSON strings from Python to avoid proxy issues
      const createSignal = (
        name: string,
        width: number,
        pointsJson: string,
        displayFormat: DisplayFormat = 'hex',
        color?: string,
        sourceSignalNamesJson?: string | null
      ) => {
        console.log('create_signal called:', name, 'width:', width, 'pointsJson:', pointsJson?.substring(0, 100));

        // Handle name collisions by appending sieve name
        let finalName = name;
        const existingReal = signals.find(s => s.name === name && !s.isDerived);
        if (existingReal) {
          finalName = `${name}_${sieve.name}`;
        }

        // Parse JSON strings
        const rawPoints: Array<{x: number; level: string}> = JSON.parse(pointsJson);
        const sourceNames: string[] | undefined = sourceSignalNamesJson ? JSON.parse(sourceSignalNamesJson) : undefined;

        console.log('Parsed points:', rawPoints.slice(0, 3));

        // Convert to proper WavePoint format
        const plainPoints: WavePoint[] = rawPoints.map(p => {
          const x = p.x;
          let level: number | bigint;
          if (width === 1 && (p.level === '0' || p.level === '1')) {
            level = parseInt(p.level, 10);
          } else {
            level = BigInt(p.level);
          }
          return { x, level };
        });

        console.log('Converted points:', plainPoints.slice(0, 3));

        // Use deterministic ID based on sieve ID and signal name to avoid churn
        const derivedSignal: DerivedSignal = {
          id: `derived_${sieve.id}_${finalName}`,
          name: finalName,
          sieveId: sieve.id,
          width,
          displayFormat,
          color: color || sieve.color.replace('0.3)', '1)'), // Make color opaque for signal
          points: plainPoints,
          sourceSignalNames: sourceNames,
        };
        console.log('Derived signal created:', derivedSignal);
        derivedSignals.push(derivedSignal);
      };

      // Set up Python globals
      setGlobal('_signals_json', JSON.stringify(signalsData));
      setGlobal('_add_transaction', addTransaction);
      setGlobal('_add_region', addRegion);
      setGlobal('_modify_signal', modifySignal);
      setGlobal('_create_signal', createSignal);

      // Wrap and execute the sieve code
      // First, parse the signals JSON and create Signal objects with helper methods
      const wrappedCode = `
import json

def _parse_level(level):
    """Convert level to int (handles string levels for large integers)"""
    if isinstance(level, str):
        return int(level)
    return level

class Signal:
    def __init__(self, data):
        self.name = data['name']
        self.width = data['width']
        # Convert levels from strings to ints for large values
        self.points = [{'x': p['x'], 'level': _parse_level(p['level'])} for p in data['points']]
        self._sorted_points = sorted(self.points, key=lambda p: p['x'])

    def value_at(self, time):
        """Get value at or just before the given time"""
        if not self._sorted_points:
            return None
        for i in range(len(self._sorted_points) - 1, -1, -1):
            if self._sorted_points[i]['x'] <= time:
                return self._sorted_points[i]['level']
        return None

    def value_before(self, time):
        """Get value strictly before the given time"""
        if not self._sorted_points:
            return None
        value = None
        for point in self._sorted_points:
            if point['x'] < time:
                value = point['level']
            else:
                break
        return value

# Helper functions for sieves
def modify_signal(signal_name, new_points):
    """Modify an existing signal's waveform data.

    Args:
        signal_name: Name of the signal to modify
        new_points: List of {'x': time, 'level': value} dictionaries
    """
    # Convert points to the expected format (level as string for large ints)
    formatted_points = [{'x': p['x'], 'level': str(p['level'])} for p in new_points]
    _modify_signal(signal_name, formatted_points)

def create_signal(name, width, points, display_format='hex', color=None, source_signals=None):
    """Create a new derived signal.

    Args:
        name: Name for the new signal
        width: Bit width of the signal (1 for single-bit, >1 for vector)
        points: List of {'x': time, 'level': value} dictionaries
        display_format: 'hex', 'decimal', or 'binary' (default: 'hex')
        color: Optional color for the signal (default: sieve color)
        source_signals: Optional list of source signal names for documentation
    """
    import json
    # Convert points to JSON string to avoid Pyodide proxy issues
    formatted_points = [{'x': p['x'], 'level': str(p['level'])} for p in points]
    points_json = json.dumps(formatted_points)
    source_json = json.dumps(source_signals) if source_signals else None
    _create_signal(name, width, points_json, display_format, color, source_json)

# Parse signals from JSON
_signals_data = json.loads(_signals_json)
signals = {name: Signal(data) for name, data in _signals_data.items()}

${sieve.code}

# Call the run function if it exists
if 'run' in dir():
    run(signals, _add_transaction, _add_region, modify_signal, create_signal)
`;

      await runPython(wrappedCode);

      sieve.transactions = transactions;
      sieve.regions = regions;
      sieve.signalModifications = modifications;
      sieve.derivedSignals = derivedSignals;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sieve execution failed';
      sieve.error = message;
      console.error('Sieve error:', err);
    }

    return transactions;
  }

  async function executeAllSieves(signals: Signal[]): Promise<void> {
    if (!isReady.value) {
      return;
    }

    isRunning.value = true;

    // Execute all enabled sieves in parallel
    const enabledSieves = sieves.value.filter(s => s.enabled);
    await Promise.all(enabledSieves.map(s => executeSieveById(s.id, signals)));

    isRunning.value = false;
  }

  // Legacy function for backward compatibility
  async function executeSieve(signals: Signal[]): Promise<Transaction[]> {
    await executeAllSieves(signals);
    return allTransactions.value;
  }

  // Layer composition functions

  // Get effective points for a signal (original or last modification)
  function getEffectivePoints(signal: Signal, showOriginal = false): WavePoint[] {
    if (showOriginal) return signal.points;

    const modifications = sieves.value
      .filter(s => s.enabled)
      .flatMap(s => s.signalModifications)
      .filter(m => m.sourceSignalId === signal.id)
      .sort((a, b) => a.timestamp - b.timestamp);

    return modifications.length > 0
      ? modifications[modifications.length - 1]!.modifiedPoints
      : signal.points;
  }

  // Get all derived signals from enabled sieves
  const allDerivedSignals = computed(() =>
    sieves.value.filter(s => s.enabled).flatMap(s => s.derivedSignals)
  );

  // Check if signal is modified by any enabled sieve
  function isSignalModified(signalId: string): boolean {
    return sieves.value.filter(s => s.enabled)
      .some(s => s.signalModifications.some(m => m.sourceSignalId === signalId));
  }

  // Get all signal modifications from enabled sieves
  const allSignalModifications = computed(() =>
    sieves.value.filter(s => s.enabled).flatMap(s => s.signalModifications)
  );

  return {
    // State
    sieves,
    currentSieve,
    sieveTransactions,
    sieveRegions,
    sieveError,
    isRunning,
    hasSieve,
    allTransactions,
    allRegions,
    globalSieves,
    allDerivedSignals,
    allSignalModifications,
    pyodideReady: isReady,
    pyodideLoading: isLoading,
    pyodideError: loadError,
    // Actions
    addSieve,
    loadSieve,
    removeSieveById,
    removeSieve,
    toggleSieveById,
    toggleSieve,
    addSieveToGroup,
    removeSieveFromGroup,
    setSieveGlobal,
    getSievesForGroup,
    executeSieveById,
    executeAllSieves,
    executeSieve,
    // Layer composition
    getEffectivePoints,
    isSignalModified,
  };
}

// Helper to create JSON-serializable signals data for Python
// Converts bigint levels to strings for JSON serialization (Python can handle large integers)
function createSignalsData(signals: Signal[]): Record<string, { name: string; width: number; points: { x: number; level: number | string }[] }> {
  const data: Record<string, { name: string; width: number; points: { x: number; level: number | string }[] }> = {};

  for (const signal of signals) {
    const sortedPoints = [...signal.points].sort((a, b) => a.x - b.x);
    data[signal.name] = {
      name: signal.name,
      width: signal.width,
      points: sortedPoints.map(p => ({
        x: p.x,
        // Convert bigint to string for JSON, keep number as-is
        level: typeof p.level === 'bigint' ? p.level.toString() : p.level,
      })),
    };
  }

  return data;
}
