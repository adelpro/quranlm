import { useNavigate } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { ModelPicker } from '../features/models/ModelPicker';
import { ModelActions } from '../features/models/ModelActions';
import { DownloadProgress } from '../features/models/DownloadProgress';
import { StorageSelect } from '../features/models/StorageSelect';
import { PromptSettings } from '../features/settings/PromptSettings';
import { OutputFormatEditor } from '../features/settings/OutputFormatEditor';
import { ToolToggles } from '../features/settings/ToolToggles';
import { chatBusyAtom } from '../features/chat/chat.atoms';
import { SettingsNav } from '../components/settings/SettingsNav';
import { SettingsCard } from '../components/settings/SettingsCard';
import { Button } from '../components/ui/Button';

/**
 * Dedicated settings page, registered at `/settings`.
 *
 * Layout:
 *  - Two columns at `md+`: a sticky section nav on the left, the four
 *    section cards on the right.
 *  - Single column below `md`: the section nav collapses to a top pill
 *    row and cards stretch the full width.
 *
 * Functionality is unchanged from the previous modal — every widget is
 * reused verbatim, the only new pieces are the page chrome (nav,
 * cards, header) and the chatBusyAtom-disabled propagation that ties
 * the whole page together.
 */
export function Settings() {
  const navigate = useNavigate();
  const busy = useAtomValue(chatBusyAtom);

  return (
    <div className="h-full overflow-y-auto bg-bg">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-5 py-8 md:flex-row md:gap-10 md:px-10 md:py-12">
        <SettingsNav />

        <div className="min-w-0 flex-1">
          <header className="mb-8 flex items-start justify-between gap-6">
            <div>
              <h1 className="m-0 text-3xl font-semibold tracking-tight text-text">
                Settings
              </h1>
              <p className="mt-1.5 m-0 text-sm leading-relaxed text-text-secondary">
                Configure your LiteRT-LM session. Changes apply live.
              </p>
            </div>
            <Button variant="ghost" size="md" onClick={() => navigate('/')}>
              Done
            </Button>
          </header>

          <div className="flex flex-col gap-6">
            <SettingsCard
              index={0}
              id="models"
              title="Model"
              description="Pick the model to run and how its weights are stored. Downloads stream from HuggingFace and are verified before use."
            >
              <ModelPicker disabled={busy} />
              <StorageSelect disabled={busy} />
              <ModelActions disabled={busy} />
              <DownloadProgress />
            </SettingsCard>

            <SettingsCard
              index={1}
              id="prompt"
              title="System prompt"
              description="System message sent to the model on every turn. Pick a preset or write a custom instruction."
            >
              <PromptSettings disabled={busy} />
            </SettingsCard>

            <SettingsCard
              index={2}
              id="output"
              title="Output format"
              description="Optional JSON Schema for constrained decoding. Leave empty to chat free-form."
            >
              <OutputFormatEditor disabled={busy} />
            </SettingsCard>

            <SettingsCard
              index={3}
              id="tools"
              title="Tools"
              description="Side capabilities the assistant can use to enrich its replies."
            >
              <ToolToggles disabled={busy} />
            </SettingsCard>
          </div>
        </div>
      </div>
    </div>
  );
}
