import { Save, Check } from 'lucide-react';
import { useState, useEffect } from 'react';
import type { FC } from 'react';

interface SettingsViewProps {
  apiKey: string;
  provider: string;
  baseUrl: string;
  model: string;
  onSave: (settings: { apiKey: string; provider: string; baseUrl: string; model: string }) => void;
}

const PROVIDERS = [
  {
    id: 'google',
    label: 'Google AI Studio (free)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-flash-lite',
  },
  {
    id: 'nvidia',
    label: 'NVIDIA (free)',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'nvidia/nemotron-3-super-120b-a12b',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-2.0-flash-001',
  },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', baseUrl: '', defaultModel: '' },
];

const SettingsView: FC<SettingsViewProps> = ({ apiKey, provider, baseUrl, model, onSave }) => {
  const [key, setKey] = useState(apiKey);
  const [selectedProvider, setSelectedProvider] = useState(provider);
  const [customBaseUrl, setCustomBaseUrl] = useState(baseUrl);
  const [selectedModel, setSelectedModel] = useState(model);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const p = PROVIDERS.find(pr => pr.id === selectedProvider);
    if (p && p.id !== 'custom') {
      setCustomBaseUrl(p.baseUrl);
      if (!selectedModel) setSelectedModel(p.defaultModel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProvider]);

  const handleSave = () => {
    onSave({ apiKey: key, provider: selectedProvider, baseUrl: customBaseUrl, model: selectedModel });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="font-doodle text-secondary text-xl">settings</h2>

      <div className="flex flex-col gap-2">
        <label htmlFor="fp-provider" className="font-doodle text-sm text-gray-600">
          provider
        </label>
        <select
          id="fp-provider"
          value={selectedProvider}
          onChange={e => setSelectedProvider(e.target.value)}
          className="font-doodle focus:border-primary w-full rounded-lg border-2 border-dashed border-gray-300 bg-white p-2 text-sm outline-none">
          {PROVIDERS.map(p => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="fp-apikey" className="font-doodle text-sm text-gray-600">
          api key
        </label>
        <input
          id="fp-apikey"
          type="password"
          value={key}
          onChange={e => setKey(e.target.value)}
          placeholder="sk-..."
          className="focus:border-primary w-full rounded-lg border-2 border-dashed border-gray-300 bg-white p-2 font-mono text-sm outline-none"
        />
      </div>

      {selectedProvider === 'custom' && (
        <div className="flex flex-col gap-2">
          <label htmlFor="fp-baseurl" className="font-doodle text-sm text-gray-600">
            base url
          </label>
          <input
            id="fp-baseurl"
            type="url"
            value={customBaseUrl}
            onChange={e => setCustomBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
            className="focus:border-primary w-full rounded-lg border-2 border-dashed border-gray-300 bg-white p-2 font-mono text-sm outline-none"
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="fp-model" className="font-doodle text-sm text-gray-600">
          model
        </label>
        <input
          id="fp-model"
          type="text"
          value={selectedModel}
          onChange={e => setSelectedModel(e.target.value)}
          placeholder="model-name"
          className="focus:border-primary w-full rounded-lg border-2 border-dashed border-gray-300 bg-white p-2 font-mono text-sm outline-none"
        />
      </div>

      <button
        onClick={handleSave}
        className="font-doodle border-primary text-secondary mt-2 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-white py-3 text-base transition-all hover:scale-[1.02] hover:bg-blue-50 active:scale-[0.98]">
        {saved ? <Check size={18} /> : <Save size={18} />}
        <span>{saved ? 'saved!' : 'save settings'}</span>
      </button>
    </div>
  );
};

export { SettingsView };
