import { useEffect, useRef, useState } from 'react';
import { Music2, Play, Settings, X } from 'lucide-react';
import { api, type QueueSettings } from './api';
export const soundPresets = [
  { id: 'arrival', name: 'EV arrival' },
  { id: 'success', name: 'EV success' },
  { id: 'soft', name: 'Soft chime' },
] as const;
export interface Preferences {
  finishSound: boolean;
  showTaskPlan: boolean;
  volume: number;
  preset: string;
  customSound?: string;
  soundName?: string;
}
const defaults: Preferences = {
  finishSound: true,
  showTaskPlan: false,
  volume: 0.3,
  preset: 'arrival',
};
export function readPreferences(): Preferences {
  try {
    const data = JSON.parse(localStorage.getItem('pi-chat-settings') ?? '{}');
    return {
      ...defaults,
      preset: soundPresets.some((p) => p.id === data.preset) ? data.preset : defaults.preset,
      showTaskPlan:
        typeof data.showTaskPlan === 'boolean' ? data.showTaskPlan : defaults.showTaskPlan,
      finishSound: typeof data.finishSound === 'boolean' ? data.finishSound : defaults.finishSound,
      volume:
        typeof data.volume === 'number' ? Math.max(0, Math.min(1, data.volume)) : defaults.volume,
      ...(typeof data.customSound === 'string' && data.customSound.startsWith('data:audio/')
        ? { customSound: data.customSound, soundName: data.soundName }
        : {}),
    };
  } catch {
    return defaults;
  }
}
let audioContext: AudioContext | undefined;
let customAudio: HTMLAudioElement | undefined;
export async function unlockSound() {
  try {
    audioContext ??= new AudioContext();
    await audioContext.resume();
  } catch {}
}
export async function playFinishSound(preferences: Preferences) {
  if (preferences.customSound) {
    customAudio ??= new Audio();
    if (customAudio.src !== preferences.customSound) customAudio.src = preferences.customSound;
    customAudio.volume = preferences.volume;
    customAudio.currentTime = 0;
    await customAudio.play();
    return;
  }
  audioContext ??= new AudioContext();
  await audioContext.resume();
  if (audioContext.state !== 'running')
    throw new Error('Click Preview sound once to allow audio in this browser.');
  const now = audioContext.currentTime;
  const notes =
    preferences.preset === 'success'
      ? [523.25, 659.25, 783.99, 1046.5]
      : preferences.preset === 'soft'
        ? [660, 880]
        : [587.33, 880, 1174.66];
  for (const [index, frequency] of notes.entries()) {
    const oscillator = audioContext.createOscillator(),
      gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    const start = now + index * 0.12;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(preferences.volume * 0.2, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.34);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
}
export default function SettingsDialog({
  value,
  queueSettings,
  saveQueueSettings,
  version,
  updates,
  save,
  close,
}: {
  value: Preferences;
  queueSettings?: QueueSettings;
  saveQueueSettings: (settings: QueueSettings) => void;
  version?: string;
  updates: () => void;
  save: (preferences: Preferences) => void;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState('');
  const [savingQueue, setSavingQueue] = useState(false);
  async function toggleQueues(enabled: boolean) {
    setSavingQueue(true);
    try {
      saveQueueSettings(
        await api<QueueSettings>('/settings', {
          method: 'PATCH',
          body: JSON.stringify({ queuesEnabled: enabled }),
        }),
      );
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingQueue(false);
    }
  }
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  function update(next: Preferences) {
    try {
      localStorage.setItem('pi-chat-settings', JSON.stringify(next));
      save(next);
      setError('');
    } catch {
      setError(
        'Your browser could not save these preferences. Check storage permissions or try a smaller sound file.',
      );
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('audio/') || file.size > 1024 * 1024) {
      setError('Choose an audio file up to 1 MB (for example MP3, WAV, or OGG).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      update({ ...value, customSound: String(reader.result), soundName: file.name });
    reader.onerror = () => setError('Could not read the sound file.');
    reader.readAsDataURL(file);
  }
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <dialog
      ref={dialog}
      className="workspace-dialog settings-dialog"
      onCancel={close}
      aria-label="Settings"
    >
      <div className="dialog-heading">
        <span className="pi-avatar">
          <Settings size={19} />
        </span>
        <button className="icon-button" aria-label="Close settings" onClick={close}>
          <X size={18} />
        </button>
      </div>
      <h2>Make it yours</h2>
      <p>
        Chat for Pi <strong>v{version ?? '…'}</strong> · Display and sound preferences are saved in
        this browser.
      </p>
      <button className="secondary-button" onClick={updates}>
        Updates & releases
      </button>
      <div className="setting-row">
        <div>
          <strong>Prompt queues</strong>
          <small>
            Enabled by default. Applies to all chats and browser tabs on this server. Turning off
            keeps the current response running and pauses saved prompts. Re-enable, then resume each
            queue explicitly.
          </small>
        </div>
        <input
          type="checkbox"
          aria-label="Enable prompt queues"
          checked={queueSettings?.queuesEnabled ?? true}
          disabled={!queueSettings || savingQueue}
          onChange={(event) => void toggleQueues(event.target.checked)}
        />
      </div>
      <div className="setting-row">
        <div>
          <strong>Task plan bar</strong>
          <small>
            Hidden by default. Show the task-plan summary and controls in this browser. Hiding it
            does not delete or stop the plan.
          </small>
        </div>
        <input
          type="checkbox"
          aria-label="Show task plan bar"
          checked={value.showTaskPlan}
          onChange={(event) => update({ ...value, showTaskPlan: event.target.checked })}
        />
      </div>
      <div className="setting-row">
        <div>
          <strong>Finish sound</strong>
          <small>
            Automatically play after the full AI response finishes, even in another conversation.
            Enabled by default.
          </small>
        </div>
        <input
          aria-label="Enable finish sound"
          type="checkbox"
          checked={value.finishSound}
          onChange={(e) => update({ ...value, finishSound: e.target.checked })}
        />
      </div>
      <label htmlFor="sound-preset">Sound preset · original EV-inspired tones</label>
      <select
        id="sound-preset"
        value={value.preset}
        onChange={(e) =>
          update({ ...value, preset: e.target.value, customSound: undefined, soundName: undefined })
        }
      >
        {soundPresets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <label htmlFor="sound-volume">Volume · {Math.round(value.volume * 100)}%</label>
      <input
        id="sound-volume"
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={value.volume}
        onChange={(e) => update({ ...value, volume: Number(e.target.value) })}
      />
      <div className="sound-controls">
        <button
          className="secondary-button"
          onClick={() => void playFinishSound(value).catch((e) => setError(e.message))}
        >
          <Play size={13} />
          Preview sound
        </button>
        <label className="secondary-button sound-upload">
          <Music2 size={13} />
          Choose audio
          <input
            aria-label="Custom finish sound"
            type="file"
            accept="audio/*"
            onChange={(e) => void upload(e.target.files?.[0])}
          />
        </label>
      </div>
      <p className="sound-file">
        {value.soundName ?? soundPresets.find((p) => p.id === value.preset)?.name ?? 'EV arrival'}
        {value.customSound && (
          <button
            onClick={() => update({ ...value, customSound: undefined, soundName: undefined })}
          >
            Reset
          </button>
        )}
      </p>
      <p>
        Custom audio stays in this browser and is not uploaded. Keep a browser tab open for sounds;
        browser autoplay rules may require Preview sound first. Closing the terminal does not stop
        the background server.
      </p>
      <h3 className="settings-shortcuts-heading">{mac ? 'Mac shortcuts' : 'Keyboard shortcuts'}</h3>
      <dl className="shortcut-list">
        <div>
          <dt>Command palette</dt>
          <dd>{mac ? '⌘ K' : 'Ctrl K'}</dd>
        </div>
        <div>
          <dt>New chat</dt>
          <dd>{mac ? '⌘ ⇧ N' : 'Ctrl Shift N'}</dd>
        </div>
        <div>
          <dt>Settings</dt>
          <dd>{mac ? '⌘ ,' : 'Ctrl ,'}</dd>
        </div>
        <div>
          <dt>Workspace tools</dt>
          <dd>{mac ? '⌘ ⇧ E' : 'Ctrl Shift E'}</dd>
        </div>
        <div>
          <dt>Send / queue prompt</dt>
          <dd>↵</dd>
        </div>
        <div>
          <dt>New line</dt>
          <dd>⇧ ↵</dd>
        </div>
        <div>
          <dt>Close dialog</dt>
          <dd>⎋</dd>
        </div>
      </dl>
      {error && (
        <p className="failed" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="primary-button" onClick={close}>
          Done
        </button>
      </div>
    </dialog>
  );
}
