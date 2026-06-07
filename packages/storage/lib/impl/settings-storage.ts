import { createStorage, StorageEnum } from '../base/index.js';

interface SettingsState {
  apiKey: string;
  apiProvider: 'openrouter' | 'nvidia' | 'custom';
  apiBaseUrl: string;
  model: string;
  uiMode: 'sidepanel' | 'popup';
}

const DEFAULT_SETTINGS: SettingsState = {
  apiKey: '',
  apiProvider: 'nvidia',
  apiBaseUrl: 'https://integrate.api.nvidia.com/v1',
  model: 'nvidia/llama-3.3-nemotron-super-49b-v1',
  uiMode: 'sidepanel',
};

const encode = (value: string): string => {
  if (!value) return '';
  return btoa(encodeURIComponent(value));
};

const decode = (value: string): string => {
  if (!value) return '';
  try {
    return decodeURIComponent(atob(value));
  } catch {
    return value;
  }
};

const storage = createStorage<SettingsState>('fp-settings', DEFAULT_SETTINGS, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

export const settingsStorage = {
  ...storage,
  getApiKey: async (): Promise<string> => {
    const state = await storage.get();
    return decode(state.apiKey);
  },
  setApiKey: async (key: string): Promise<void> => {
    await storage.set(current => ({ ...current, apiKey: encode(key) }));
  },
  getProvider: async () => {
    const state = await storage.get();
    return { provider: state.apiProvider, baseUrl: state.apiBaseUrl, model: state.model };
  },
  setProvider: async (provider: SettingsState['apiProvider'], baseUrl: string, model: string) => {
    await storage.set(current => ({ ...current, apiProvider: provider, apiBaseUrl: baseUrl, model }));
  },
  getUiMode: async () => {
    const state = await storage.get();
    return state.uiMode;
  },
  setUiMode: async (mode: SettingsState['uiMode']) => {
    await storage.set(current => ({ ...current, uiMode: mode }));
  },
};
