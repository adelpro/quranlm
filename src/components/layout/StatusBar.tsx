import { useAtomValue } from 'jotai';
import { engineLifecycleAtom, webGpuStatusAtom } from '../../app/engine.atoms';
import { chatPhaseAtom } from '../../features/chat/chat.atoms';
import { downloadProgressAtom } from '../../features/models/model.atoms';
import { quranStatusAtom } from '../../features/quran/quran.atoms';
import { StatusBadge } from '../ui/StatusBadge';
import type { ReactNode } from 'react';

export function StatusBar() {
  const lifecycle = useAtomValue(engineLifecycleAtom);
  const webGpu = useAtomValue(webGpuStatusAtom);
  const chat = useAtomValue(chatPhaseAtom);
  const dl = useAtomValue(downloadProgressAtom);
  const quran = useAtomValue(quranStatusAtom);

  const engineLabel = (() => {
    switch (lifecycle.phase) {
      case 'idle':
        return 'Engine: idle';
      case 'checking':
        return 'Engine: checking…';
      case 'loading':
        return `Engine: loading ${lifecycle.modelId}…`;
      case 'ready':
        return `Engine: ${lifecycle.modelId} ready`;
      case 'error':
        return `Engine: error — ${lifecycle.message}`;
      case 'disposing':
        return 'Engine: disposing…';
    }
  })();

  const chatLabel = (() => {
    switch (chat) {
      case 'idle':
        return null;
      case 'streaming':
        return 'Chat: streaming…';
      case 'cancelling':
        return 'Chat: cancelling…';
      case 'error':
        return 'Chat: error';
    }
  })();

  const items: ReactNode[] = [];
  if (webGpu) {
    items.push(
      <StatusBadge key="webgpu" tone={webGpu.supported ? 'ok' : 'error'}>
        WebGPU: {webGpu.supported ? 'on' : `off${webGpu.reason ? ' — ' + webGpu.reason : ''}`}
      </StatusBadge>,
    );
  }
  items.push(
    <StatusBadge
      key="engine"
      tone={
        lifecycle.phase === 'ready'
          ? 'ok'
          : lifecycle.phase === 'error'
            ? 'error'
            : lifecycle.phase === 'loading' || lifecycle.phase === 'checking'
              ? 'accent'
              : 'neutral'
      }
    >
      {engineLabel}
    </StatusBadge>,
  );
  if (chatLabel) {
    items.push(
      <StatusBadge key="chat" tone={chat === 'error' ? 'error' : 'accent'}>
        {chatLabel}
      </StatusBadge>,
    );
  }
  if (dl) {
    items.push(
      <StatusBadge
        key="dl"
        tone={dl.phase === 'error' ? 'error' : dl.phase === 'done' ? 'ok' : 'accent'}
      >
        Download: {dl.phase}
      </StatusBadge>,
    );
  }
  items.push(
    <StatusBadge
      key="quran"
      tone={
        quran.phase === 'ready'
          ? 'ok'
          : quran.phase === 'error'
            ? 'error'
            : quran.phase === 'loading'
              ? 'accent'
              : 'neutral'
      }
    >
      Quran corpus: {quran.phase}
    </StatusBadge>,
  );

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-border bg-surface py-1.5 text-xs text-text-secondary -mx-5 px-5">
      {items}
    </div>
  );
}