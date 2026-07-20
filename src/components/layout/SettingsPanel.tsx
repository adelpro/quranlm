import { useAtom, useAtomValue } from 'jotai';
import { settingsOpenAtom } from '../../features/loading/loading.atoms';
import { ModelPicker } from '../../features/models/ModelPicker';
import { ModelActions } from '../../features/models/ModelActions';
import { DownloadProgress } from '../../features/models/DownloadProgress';
import { StorageSelect } from '../../features/models/StorageSelect';
import { PromptSettings } from '../../features/settings/PromptSettings';
import { OutputFormatEditor } from '../../features/settings/OutputFormatEditor';
import { ToolToggles } from '../../features/settings/ToolToggles';
import { chatBusyAtom } from '../../features/chat/chat.atoms';

export function SettingsPanel() {
  const [open, setOpen] = useAtom(settingsOpenAtom);
  const busy = useAtomValue(chatBusyAtom);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Settings"
      className="absolute inset-x-0 top-12 z-10 mx-auto max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-surface p-4 shadow-lg"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-text m-0">Settings</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-2 py-1 text-text-secondary hover:bg-surface-2 hover:text-text focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          aria-label="Close settings"
        >
          ✕
        </button>
      </div>

      <Section title="Model">
        <ModelPicker disabled={busy} />
        <StorageSelect disabled={busy} />
        <ModelActions disabled={busy} />
        <DownloadProgress />
      </Section>

      <Section title="System prompt">
        <PromptSettings disabled={busy} />
      </Section>

      <Section title="Output format">
        <OutputFormatEditor disabled={busy} />
      </Section>

      <Section title="Tools">
        <ToolToggles disabled={busy} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted m-0">{title}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}