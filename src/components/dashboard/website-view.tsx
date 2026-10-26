import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { definition } from "@/lib/kpi-definitions";
import { Kpi, Panel, axis } from "@/components/dashboard/common";

export function WebsiteView() {
  return (
    <div className="space-y-4">
      <div data-export-block className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Sessions" value="—" />
        <Kpi label="Utilisateurs" value="—" />
        <Kpi label="Pages vues" value="—" />
        <Kpi label="Temps passé" value="—" />
        <Kpi label="Taux de rebond" value="—" />
      </div>
      <Panel title="Sessions et utilisateurs par jour" info={definition("webChart")}>
        <div className="h-72">
          <ResponsiveContainer>
            <AreaChart data={[]}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={axis} />
              <YAxis tick={axis} ticks={[]} />
              <Area dataKey="sessions" name="Sessions" stroke="var(--web)" fill="var(--web)" />
              <Area dataKey="users" name="Utilisateurs" stroke="var(--primary)" fill="var(--primary)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </div>
  );
}
