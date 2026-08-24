"use client";

import { useEffect, useState } from "react";
import { Button, Card, Group, Stack, Text, TextInput } from "@mantine/core";
import { type AdminUserRow, callListUsers, callSetBudget } from "@/lib/billing";

export function AdminPanel() {
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const reload = () => { void callListUsers().then(setRows); };
  useEffect(() => { reload(); }, []);
  if (!rows) return null;
  return <Card withBorder padding="md" mt="md">
    <Text fw={700} mb="sm">User budgets (admin)</Text>
    <Stack gap="sm">
      {rows.map((row) => <AdminUserRowEditor key={row.uid} row={row} onSaved={reload} />)}
      {rows.length === 0 && <Text size="sm" c="dimmed">No users yet.</Text>}
    </Stack>
  </Card>;
}

function AdminUserRowEditor({ row, onSaved }: { row: AdminUserRow; onSaved: () => void }) {
  const [value, setValue] = useState(String(row.monthlyUsd));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) { setError("Enter a number ≥ 0."); return; }
    setSaving(true); setError("");
    try { await callSetBudget(row.uid, n); onSaved(); }
    catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  }
  return <Group justify="space-between" gap="xs" wrap="nowrap">
    <div style={{ minWidth: 0 }}>
      <Text size="sm" truncate>{row.email}</Text>
      <Text size="xs" c="dimmed">spent ${row.spentUsd.toFixed(2)} · remaining ${row.remainingUsd.toFixed(2)}{error ? ` · ${error}` : ""}</Text>
    </div>
    <Group gap="xs" wrap="nowrap">
      <TextInput size="xs" w={90} value={value} onChange={(e) => setValue(e.currentTarget.value)} leftSection="$" />
      <Button size="xs" onClick={() => void save()} loading={saving}>Save</Button>
    </Group>
  </Group>;
}
