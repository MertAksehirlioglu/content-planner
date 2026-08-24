"use client";

import { useEffect, useState } from "react";
import { Card, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { type Budget, type Spend, currentMonthKey, loadBudget, loadSpend } from "@/lib/billing";

export function CostSummary({ uid, accountId, accountNames, version }: {
  uid: string; accountId: string; accountNames: Record<string, string>; version: number;
}) {
  const [budget, setBudget] = useState<Budget | null>(null);
  const [spend, setSpend] = useState<Spend>({ totalUsd: 0, byAccount: {} });
  useEffect(() => {
    let cancelled = false;
    const month = currentMonthKey();
    void loadBudget(uid).then((b) => { if (!cancelled) setBudget(b); });
    void loadSpend(uid, month).then((s) => { if (!cancelled) setSpend(s); });
    return () => { cancelled = true; };
    // accountId is included so switching companies re-reads (spend is per-user but the
    // panel lives inside an account view); version bumps after each generation.
  }, [uid, accountId, version]);

  const cap = budget?.monthlyUsd ?? null;
  const spent = spend.totalUsd;
  const remaining = cap === null ? null : Math.max(0, cap - spent);
  const money = (value: number) => value < 0.01 && value > 0 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
  const rows = Object.entries(spend.byAccount).filter(([, usd]) => usd > 0)
    .sort((a, b) => b[1] - a[1]);
  return <Stack gap="sm">
    <SimpleGrid cols={{ base: 1, sm: 3 }}>
      <Card withBorder padding="sm"><Text size="xs" c="dimmed">Spent this month</Text><Text fw={700}>{money(spent)}</Text></Card>
      <Card withBorder padding="sm"><Text size="xs" c="dimmed">Monthly budget</Text><Text fw={700}>{cap === null ? "—" : money(cap)}</Text></Card>
      <Card withBorder padding="sm"><Text size="xs" c="dimmed">Remaining</Text><Text fw={700}>{remaining === null ? "—" : money(remaining)}</Text></Card>
    </SimpleGrid>
    <Text size="xs" c="dimmed">Recorded server-side per generation. Your budget is set by the owner. Your Google Cloud invoice is authoritative.</Text>
    {rows.map(([id, usd]) => <Group key={id} justify="space-between" gap="xs">
      <Text size="sm">{accountNames[id] ?? id}</Text>
      <Text size="sm" fw={600}>{money(usd)}</Text>
    </Group>)}
    {spent === 0 && <Text size="sm" c="dimmed">No tracked AI usage this month yet.</Text>}
  </Stack>;
}

// Owner-only. Security is entirely server-side: callListUsers returns null for a non-admin
// (the callable rejects with permission-denied), so the panel simply never renders — no
// admin flag or email is shipped to the client.