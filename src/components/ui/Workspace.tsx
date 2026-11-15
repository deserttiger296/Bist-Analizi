import type { ReactNode } from "react";

type Tone = "neutral" | "positive" | "warning" | "negative";

export function WorkspacePage({ title, description, eyebrow = "RSI ANALİZİ", actions, children, className = "" }: {
  title: string; description?: ReactNode; eyebrow?: string; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return <div className={`rsi-workspace ${className}`}>
    <header className="workspace-header"><div><span className="rsi-eyebrow">{eyebrow}</span><h1>{title}</h1>{description && <div className="workspace-description">{description}</div>}</div>{actions && <div className="workspace-actions">{actions}</div>}</header>
    {children}
  </div>;
}

export function Panel({ title, description, actions, children, className = "", id }: {
  title?: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string;
}) {
  return <section className={`workspace-panel ${className}`} id={id}>
    {(title || description || actions) && <header className="workspace-panel-header"><div>{title && <h2>{title}</h2>}{description && <p>{description}</p>}</div>{actions && <div className="workspace-actions">{actions}</div>}</header>}
    <div className="workspace-panel-body">{children}</div>
  </section>;
}

export function MetricCard({ label, value, detail, tone = "neutral" }: {
  label: string; value?: ReactNode; detail?: ReactNode; tone?: Tone;
}) {
  return <div className={`workspace-metric workspace-tone-${tone}`}><span>{label}</span><strong>{value ?? "—"}</strong>{detail && <p>{detail}</p>}</div>;
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return <div className="workspace-empty"><svg className="rsi-icon" aria-hidden="true"><use href="/static/rsi-icons.svg#radar" /></svg><h3>{title}</h3>{description && <p>{description}</p>}{action && <div className="workspace-actions">{action}</div>}</div>;
}

export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`workspace-badge workspace-tone-${tone}`}>{children}</span>;
}
