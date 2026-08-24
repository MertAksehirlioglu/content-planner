"use client";

import { useState } from "react";
import { signInWithPopup } from "firebase/auth";
import { auth, googleProvider } from "@/lib/firebase";
import { Alert, Button, Card, Container, Group, Text, Title } from "@mantine/core";

export function SignIn({ error, onError }: { error: string; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    onError("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code = (err as { code?: string }).code;
      // Closing the popup yourself isn't an error worth shouting about.
      if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
        onError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Container size="xs" w="100%" py={{ base: "md", sm: "xl" }} px="md">
      <Card withBorder radius="lg" p={{ base: "lg", sm: "xl" }} mt={{ base: "xl", sm: "20vh" }}>
        <Group gap="sm" mb="lg">
          <div className="brandMark" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 64 64" fill="none">
              <rect x="14" y="12" width="36" height="40" rx="5" stroke="currentColor" strokeWidth="5" />
              <path d="M23 27h18M23 36h18M23 45h11" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <div className="wordmark">Content Planner</div>
            <div className="wordmarkSub">Weekly · IG + LinkedIn</div>
          </div>
        </Group>
        <Title order={1} size="h3">A week of content from one brief.</Title>
        <Text c="dimmed" size="sm" mt={6}>
          Strategy, writing, and production for Instagram and LinkedIn. Sign in to continue.
        </Text>
        <Button mt="lg" fullWidth loading={busy} onClick={() => void go()}>
          Sign in with Google
        </Button>
        {error && <Alert color="red" mt="md" title="Couldn&rsquo;t sign in">{error}</Alert>}
        <Text c="dimmed" size="xs" mt="md">
          Access is limited to approved accounts.
        </Text>
      </Card>
    </Container>
  );
}
