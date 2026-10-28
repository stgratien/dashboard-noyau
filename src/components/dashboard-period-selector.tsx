import { useRef, useState } from "react";
import type { DateRange } from "react-day-picker";
import { fr } from "date-fns/locale";
import { CalendarIcon, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { allTimeShortcut, calendarDate, calendarISO, comparisonChoice, comparisonEditions, formatPeriod, periodShortcutGroups, twoYearsAvailable, type Period, type ComparisonMode } from "@/lib/dashboard-periods";

/** Dates de début et de fin, calendrier, Annuler / Appliquer : commun à la période et à la comparaison personnalisée (démonté à la fermeture, il repart de `value`). */
function RangePanel({ value, onApply, onCancel }: { value: Period; onApply: (period: Period) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(value);
  const [range, setRange] = useState<DateRange | undefined>({ from: calendarDate(value.start), to: calendarDate(value.end) });
  const [month, setMonth] = useState(calendarDate(value.start));
  const valid = Boolean(draft.start && draft.end && draft.start <= draft.end);
  const setDates = (next: Period) => {
    setDraft(next);
    setRange({ from: next.start ? calendarDate(next.start) : undefined, to: next.end ? calendarDate(next.end) : undefined });
    if (next.start) setMonth(calendarDate(next.start));
  };
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-2">
      <label className="space-y-1 text-xs text-muted-foreground">Date de début
        <Input aria-label="Date de début" type="date" value={draft.start} onChange={(event) => setDates({ ...draft, start: event.target.value })} className="min-w-0" />
      </label>
      <label className="space-y-1 text-xs text-muted-foreground">Date de fin
        <Input aria-label="Date de fin" type="date" value={draft.end} onChange={(event) => setDates({ ...draft, end: event.target.value })} className="min-w-0" />
      </label>
    </div>
    <Calendar locale={fr} mode="range" month={month} onMonthChange={setMonth} selected={range}
      onSelect={(next) => { setRange(next); setDraft({ start: next?.from ? calendarISO(next.from) : "", end: next?.to ? calendarISO(next.to) : "" }); }}
      captionLayout="dropdown" startMonth={new Date(1900, 0)} endMonth={new Date(2100, 11)} className="pointer-events-auto mx-auto" />
    {!valid && <p className="text-xs text-destructive">Choisissez une date de fin égale ou postérieure au début.</p>}
    <div className="flex justify-end gap-2">
      <Button variant="ghost" onClick={onCancel}>Annuler</Button>
      <Button disabled={!valid} onClick={() => onApply({ start: draft.start, end: draft.end })}>Appliquer</Button>
    </div>
  </div>;
}

export function DashboardPeriodSelector({ period, comparison, mode, onPeriodChange, onModeChange, onCustomComparison }: {
  period: Period; comparison: Period; mode: ComparisonMode; onPeriodChange: (period: Period) => void; onModeChange: (mode: ComparisonMode) => void;
  /** Dates choisies pour « Période personnalisée », ou édition choisie en raccourci (la période porte alors son nom) : le parent les garde et passe la comparaison en mode « custom ». */
  onCustomComparison: (period: Period) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  // « Période personnalisée » choisie dans la liste : le sélecteur de dates s'ouvre quand la liste est refermée (le focus ne revient plus au bouton pendant).
  const askCustom = useRef(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedYear, setExpandedYear] = useState<string | null>(null);
  const editions = comparisonEditions(period);
  // Une comparaison nommée (« Édition 2023 ») est un raccourci d'édition ; sans nom, ou si l'édition n'est plus proposée, c'est la période personnalisée.
  const editionValue = mode === "custom" ? editions.find((edition) => edition.name === comparison.name)?.name : undefined;
  return <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" title={formatPeriod(period)} aria-label="Sélectionner la période" className="max-w-full text-xs shadow-none sm:text-sm">
          <CalendarIcon className="size-4 shrink-0" /><span className="truncate">{period.name ?? formatPeriod(period)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="pointer-events-auto w-auto max-w-[calc(100vw-1rem)] max-h-[85vh] overflow-y-auto p-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="grid grid-cols-2 content-start gap-1 sm:w-44 sm:grid-cols-1">
            {(() => { const all = allTimeShortcut(); return <Button variant={period.start === all.start && period.end === all.end ? "secondary" : "ghost"}
              title={formatPeriod(all)} className="w-full justify-start text-xs" onClick={() => { onPeriodChange(all); setOpen(false); }}>{all.name}</Button>; })()}
            {periodShortcutGroups().map(group => <div key={group.name} className="min-w-0">
              <Button variant="ghost" aria-expanded={expanded === group.name} className="w-full justify-between text-xs" onClick={() => setExpanded(expanded === group.name ? null : group.name)}>
                {group.name}<ChevronDown className="size-3 shrink-0" />
              </Button>
              {expanded === group.name && <div className="space-y-1 border-l pl-2">
                {group.items.map(shortcut => <Button key={shortcut.name} variant={period.start === shortcut.start && period.end === shortcut.end ? "secondary" : "ghost"}
                  title={formatPeriod(shortcut)} className="w-full justify-start text-xs" onClick={() => { onPeriodChange(shortcut); setOpen(false); }}>
                  {shortcut.name}
                </Button>)}
                {group.subgroups?.map(sub => <div key={sub.name}>
                  <Button variant="ghost" aria-expanded={expandedYear === sub.name} className="w-full justify-between text-xs" onClick={() => setExpandedYear(expandedYear === sub.name ? null : sub.name)}>
                    {sub.name}<ChevronDown className="size-3 shrink-0" />
                  </Button>
                  {expandedYear === sub.name && <div className="space-y-1 border-l pl-2">
                    {sub.items.map(shortcut => <Button key={shortcut.name} variant={period.start === shortcut.start && period.end === shortcut.end ? "secondary" : "ghost"}
                      title={formatPeriod(shortcut)} className="w-full justify-start text-xs" onClick={() => { onPeriodChange(shortcut); setOpen(false); }}>
                      {shortcut.name}
                    </Button>)}
                  </div>}
                </div>)}
              </div>}
            </div>)}
          </div>
          <RangePanel value={period} onApply={(next) => { onPeriodChange(next); setOpen(false); }} onCancel={() => setOpen(false)} />
        </div>
      </PopoverContent>
    </Popover>
    <Popover open={customOpen} onOpenChange={setCustomOpen}>
      <Select value={comparisonChoice(mode, editionValue)}
        onValueChange={(value) => {
          const edition = editions.find((item) => `edition:${item.name}` === value);
          if (value === "custom") askCustom.current = true;
          else if (value === "two-years") onModeChange("two-years");
          else if (edition) onCustomComparison(edition);
          else onModeChange("previous");
        }}>
        <PopoverAnchor asChild>
          <SelectTrigger aria-label="Comparaison" className="w-48 bg-background font-medium shadow-none hover:bg-accent hover:text-accent-foreground max-sm:order-2"><SelectValue /></SelectTrigger>
        </PopoverAnchor>
        <SelectContent onCloseAutoFocus={(event) => { if (askCustom.current) { event.preventDefault(); askCustom.current = false; setCustomOpen(true); } }}>
          <SelectItem value="previous">Période précédente</SelectItem>
          {twoYearsAvailable(period) && <SelectItem value="two-years">Il y a 2 ans</SelectItem>}
          {editions.map((edition) => <SelectItem key={edition.name} value={`edition:${edition.name}`}>{edition.name}</SelectItem>)}
          {/* Choisie alors qu'elle est déjà active, la liste ne signale aucun changement : les gestes de sélection rouvrent le sélecteur de dates pour la modifier. */}
          <SelectItem value="custom" onPointerUp={() => { askCustom.current = true; }} onClick={() => { askCustom.current = true; }}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") askCustom.current = true; }}>Période personnalisée</SelectItem>
        </SelectContent>
      </Select>
      <PopoverContent align="end" className="pointer-events-auto w-auto max-w-[calc(100vw-1rem)] max-h-[85vh] overflow-y-auto p-3">
        <p className="mb-2 text-xs font-medium">Période de comparaison</p>
        <RangePanel value={comparison} onApply={(next) => { onCustomComparison(next); setCustomOpen(false); }} onCancel={() => setCustomOpen(false)} />
      </PopoverContent>
    </Popover>
  </>;
}