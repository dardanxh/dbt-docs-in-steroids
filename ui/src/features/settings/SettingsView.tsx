import type { BadgeMetric, ThemePref } from "@/lib/settings";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

const THEMES: { value: ThemePref; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

const BADGE_METRICS: { value: BadgeMetric; label: string }[] = [
  { value: "loc", label: "Lines of code" },
  { value: "test_count", label: "Test count" },
  { value: "complexity", label: "Complexity" },
  { value: "cohesion", label: "Cohesion" },
  { value: "column_count", label: "Column count" },
  { value: "downstream_count", label: "Downstream users" },
  { value: "none", label: "None (off)" },
];

export function SettingsView() {
  const { settings, update } = useSettings();

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto p-8">
      <h2 className="mb-6 font-semibold text-fg text-lg">Settings</h2>

      <Section title="Appearance">
        <Row label="Theme" hint="System follows your OS preference.">
          <Segmented options={THEMES} value={settings.theme} onChange={(theme) => update({ theme })} />
        </Row>
      </Section>

      <Section title="Lineage graph">
        <Row label="Node badge" hint="Shown on the right of each model when nothing is selected.">
          <select
            value={settings.badgeMetric}
            onChange={(e) => update({ badgeMetric: e.target.value as BadgeMetric })}
            className="rounded border border-border bg-panel-2 px-2 py-1.5 text-fg text-xs outline-none"
          >
            {BADGE_METRICS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Column fractions" hint="On a selected model, show used/total columns on each neighbour.">
          <Toggle
            checked={settings.showColumnFractions}
            onChange={(v) => update({ showColumnFractions: v })}
          />
        </Row>
        <Row label="Minimap" hint="Show the React Flow minimap in the lineage canvas.">
          <Toggle checked={settings.minimap} onChange={(v) => update({ minimap: v })} />
        </Row>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 rounded-lg border border-border bg-panel">
      <div className="border-border border-b px-4 py-2 font-medium text-fg text-xs uppercase tracking-wide">
        {title}
      </div>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="text-fg text-sm">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-border">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "px-3 py-1.5 text-xs",
            value === o.value ? "bg-accent text-white" : "bg-panel-2 text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 rounded-full transition-colors",
        checked ? "bg-accent" : "bg-panel-2 border border-border",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
