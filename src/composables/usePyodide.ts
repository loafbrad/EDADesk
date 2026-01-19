import { ref, shallowRef } from 'vue';

// Pyodide types (simplified)
interface PyodideInterface {
  runPython(code: string): unknown;
  runPythonAsync(code: string): Promise<unknown>;
  globals: {
    get(name: string): unknown;
    set(name: string, value: unknown): void;
  };
}

declare global {
  interface Window {
    loadPyodide: (config?: { indexURL?: string }) => Promise<PyodideInterface>;
  }
}

const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v0.24.1/full/';

// Singleton state - shared across all components
const pyodide = shallowRef<PyodideInterface | null>(null);
const isLoading = ref(false);
const isReady = ref(false);
const loadError = ref<string | null>(null);

let loadPromise: Promise<PyodideInterface> | null = null;

export function usePyodide() {

  async function loadPyodideRuntime(): Promise<PyodideInterface> {
    // Return existing instance if already loaded
    if (pyodide.value) {
      return pyodide.value;
    }

    // Return existing promise if already loading
    if (loadPromise) {
      return loadPromise;
    }

    isLoading.value = true;
    loadError.value = null;

    loadPromise = (async () => {
      try {
        // Load the Pyodide script if not already loaded
        if (!window.loadPyodide) {
          await loadScript(`${PYODIDE_CDN}pyodide.js`);
        }

        // Initialize Pyodide
        const py = await window.loadPyodide({
          indexURL: PYODIDE_CDN,
        });

        pyodide.value = py;
        isReady.value = true;
        isLoading.value = false;

        return py;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load Pyodide';
        loadError.value = message;
        isLoading.value = false;
        loadPromise = null;
        throw err;
      }
    })();

    return loadPromise;
  }

  async function runPython(code: string): Promise<unknown> {
    const py = await loadPyodideRuntime();
    return py.runPythonAsync(code);
  }

  function setGlobal(name: string, value: unknown): void {
    if (pyodide.value) {
      pyodide.value.globals.set(name, value);
    }
  }

  function getGlobal(name: string): unknown {
    if (pyodide.value) {
      return pyodide.value.globals.get(name);
    }
    return undefined;
  }

  return {
    pyodide,
    isLoading,
    isReady,
    loadError,
    loadPyodideRuntime,
    runPython,
    setGlobal,
    getGlobal,
  };
}

// Helper to load external script
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}
