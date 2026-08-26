"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Group, Stack, Text, TextInput } from "@mantine/core";

import { addMemberByEmail, listMembers, removeMember, type Member } from "@/lib/store";

/**
 * Who else can see and edit this brand.
 *
 * Everything here is server-enforced: firestore.rules denies every client write to
 * members/*, so the add/remove buttons call the owner-only callables. A non-owner sees the
 * roster and no controls — and even a forged request is refused by the callable.
 */
export function MembersPanel({ workspaceId, ownerUid, uid, onError }: {
  workspaceId: string; ownerUid: string; uid: string; onError: (message: string) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const isOwner = ownerUid === uid;

  useEffect(() => {
    let cancelled = false;
    listMembers(workspaceId)
      .then((list) => { if (!cancelled) setMembers(list); })
      .catch((err) => { if (!cancelled) onError((err as Error).message); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  async function invite() {
    const target = email.trim();
    if (!target) return;
    setBusy(true);
    try {
      await addMemberByEmail(workspaceId, target);
      setMembers(await listMembers(workspaceId));
      setEmail("");
    } catch (err) { onError(describe(err)); }
    finally { setBusy(false); }
  }

  async function drop(member: Member) {
    if (!window.confirm(`Remove ${member.email} from this brand?`)) return;
    setBusy(true);
    try {
      await removeMember(workspaceId, member.uid);
      setMembers((list) => list.filter((m) => m.uid !== member.uid));
    } catch (err) { onError(describe(err)); }
    finally { setBusy(false); }
  }

  return <Stack gap="sm">
    <Text size="sm" c="dimmed">
      Everyone listed here shares this brand: the same profile, plan history, backlog and
      weeks. Editing is live for all of them.
    </Text>
    {members.map((member) => <Group key={member.uid} justify="space-between" gap="xs">
      <Text size="sm" style={{ overflowWrap: "anywhere" }}>
        {member.email}{member.uid === ownerUid ? " (owner)" : ""}
      </Text>
      {isOwner && member.uid !== ownerUid && (
        <Button size="compact-xs" variant="subtle" color="red" disabled={busy}
          onClick={() => void drop(member)}>Remove</Button>
      )}
    </Group>)}
    {isOwner && <Group align="flex-end" gap="xs">
      <TextInput flex={1} label="Add someone" type="email" placeholder="colleague@company.com"
        description="They must be on the sign-in allowlist and have signed in once already."
        value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
      <Button loading={busy} disabled={!email.trim()} onClick={() => void invite()}>Add</Button>
    </Group>}
    <Alert variant="light" color="gray" title="Budgets are not shared">
      <Text size="sm">
        AI spend is metered per signed-in person against their own monthly cap. Sharing a brand
        does not share a wallet: when your cap runs out, generation stops for you even if a
        colleague still has room.
      </Text>
    </Alert>
  </Stack>;
}

/** The callables reject with codes the raw message does not explain well. */
function describe(err: unknown): string {
  const code = (err as { code?: string }).code;
  if (code === "functions/not-found") {
    return "No account for that email yet — they need to sign in once before you can add them.";
  }
  if (code === "functions/permission-denied") return "Only the brand's owner can manage members.";
  return (err as Error).message;
}
