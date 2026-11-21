import type { ReactNode } from 'react';
import { TriangleAlert, WifiOff } from 'lucide-react';

export function ErrorNotice({
  title,
  text,
  details,
  tone = 'rose',
  children,
}: {
  title: string;
  text: string;
  details?: string;
  tone?: 'rose' | 'amber';
  children?: ReactNode;
}) {
  const Icon = tone === 'amber' ? WifiOff : TriangleAlert;
  const colour = tone === 'amber' ? 'bg-hud-amber text-hud-amber-text' : 'bg-hud-rose text-hud-rose-text';
  return (
    <div role="alert" className={`flex flex-col gap-3 rounded-hud-control px-4 py-3 text-left text-sm/5 ${colour}`}>
      <div className="flex items-start gap-3">
        <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
        <p>
          <strong className="font-semibold">{title}</strong> {text}
        </p>
      </div>
      {details && (
        <details>
          <summary className="min-h-12 cursor-pointer content-center font-semibold">Details</summary>
          <pre className="rounded-hud-control bg-hud-inset p-3 font-mono text-sm/5 whitespace-pre-wrap text-hud-text [overflow-wrap:anywhere]">{details}</pre>
        </details>
      )}
      {children}
    </div>
  );
}
