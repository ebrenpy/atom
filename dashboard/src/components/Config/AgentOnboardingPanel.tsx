import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConnectionInfo } from '../../api/types';
import {
  buildClientSnippet,
  buildSessionPrompt,
  type OnboardingClient,
} from '../../lib/agentOnboarding';

interface AgentOnboardingPanelProps {
  agentId: string;
  secret?: string;
  connectionInfo: ConnectionInfo | null;
  onDismiss?: () => void;
}

const CLIENTS: { id: OnboardingClient; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'json', label: 'Claude Desktop / Cursor' },
  { id: 'curl', label: 'curl' },
];

export function AgentOnboardingPanel({
  agentId,
  secret,
  connectionInfo,
  onDismiss,
}: AgentOnboardingPanelProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'connect' | 'prompt'>('connect');
  const [client, setClient] = useState<OnboardingClient>('claude-code');
  const [copied, setCopied] = useState<string | null>(null);

  const inputs = {
    agentId,
    secret,
    mcpUrl: connectionInfo?.mcpUrl,
    headerName: connectionInfo?.headerName,
  };
  const connectSnippet = buildClientSnippet(client, inputs);
  const promptText = buildSessionPrompt(inputs);

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
    } catch {
      // ignore clipboard failures
    }
  };

  const pill = (active: boolean) =>
    `text-xs rounded px-2 py-0.5 font-sans cursor-pointer border ${
      active
        ? 'border-brand/40 bg-brand/10 text-brand'
        : 'border-border bg-transparent text-muted-foreground hover:bg-muted'
    }`;

  const copyBtn = (key: string, text: string) => (
    <button
      className="text-xs rounded px-2.5 py-1 border border-brand/40 bg-transparent text-brand cursor-pointer hover:bg-brand/10 font-sans whitespace-nowrap"
      onClick={() => copy(key, text)}
    >
      {copied === key ? t('common.copied') : t('common.copy')}
    </button>
  );

  return (
    <div className="flex flex-col gap-3 bg-brand/8 border border-brand/25 rounded-md px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-brand">
          {t('onboarding.panel_title', { agent: agentId })}
        </div>
        {onDismiss && (
          <button
            className="text-xs rounded px-2 py-0.5 border border-border bg-transparent text-muted-foreground cursor-pointer hover:bg-muted font-sans"
            onClick={onDismiss}
          >
            {t('agents.acknowledged')}
          </button>
        )}
      </div>

      {secret && (
        <div className="flex flex-col gap-1">
          <div className="text-xs text-brand">{t('agents.new_key_warning')}</div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-card border border-border rounded px-2 py-1.5 font-mono text-foreground break-all">
              {secret}
            </code>
            {copyBtn('secret', secret)}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button className={pill(tab === 'connect')} onClick={() => setTab('connect')}>
          {t('onboarding.tab_connect')}
        </button>
        <button className={pill(tab === 'prompt')} onClick={() => setTab('prompt')}>
          {t('onboarding.tab_prompt')}
        </button>
      </div>

      {tab === 'connect' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground">{t('onboarding.client_label')}</span>
            {CLIENTS.map((c) => (
              <button key={c.id} className={pill(client === c.id)} onClick={() => setClient(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex items-start gap-2">
            <pre className="flex-1 text-xs bg-card border border-border rounded px-2 py-1.5 font-mono text-foreground whitespace-pre-wrap break-all overflow-x-auto">
              {connectSnippet}
            </pre>
            {copyBtn('connect', connectSnippet)}
          </div>
          {!connectionInfo && (
            <div className="text-node-error text-xs">{t('onboarding.connect_hint')}</div>
          )}
          {!secret && (
            <div className="text-muted-foreground text-xs">{t('onboarding.secret_missing_hint')}</div>
          )}
        </div>
      )}

      {tab === 'prompt' && (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-muted-foreground">{t('onboarding.prompt_intro_hint')}</div>
          <div className="flex items-start gap-2">
            <pre className="flex-1 text-xs bg-card border border-border rounded px-2 py-1.5 font-mono text-foreground whitespace-pre-wrap overflow-x-auto">
              {promptText}
            </pre>
            {copyBtn('prompt', promptText)}
          </div>
        </div>
      )}
    </div>
  );
}
