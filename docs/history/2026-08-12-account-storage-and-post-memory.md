# Account Storage, Post Memory & Backlog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store multiple business profiles ("accounts") in Firestore, remember posts the owner keeps so future plans don't duplicate them, and keep a backlog of future post ideas that generation draws from.

**Architecture:** Still a statically-exported Next.js site; the model call still goes browser → Gemini via Firebase AI Logic. New: account state (accounts + their items) lives in Firestore, owner-scoped by `uid`, accessed from the browser through a single data-layer module `lib/store.ts`. `lib/plan.ts` stays pure and gains two optional prompt sections. `app/page.tsx` grows an account switcher and per-post Keep / Backlog actions.

**Tech Stack:** Next.js 16 (App Router, static export), TypeScript, Mantine 9, `firebase/firestore`, `firebase/ai`, `firebase/auth`. Tests: `node --test` (native type-stripping, offline).

## Global Constraints

- **Instagram only** this round. Stored `Account.platform` is always `"instagram"` — it's a seam for later, no platform UI.
- **`lib/plan.ts` must stay pure**: no `firebase/*`, no network imports — `npm test` runs offline on Node type-stripping. Intra-repo imports under test keep the `.ts` extension (e.g. `from "./plan.ts"`).
- **Browser-only Firebase init must be `typeof window !== "undefined"` guarded** — the static export runs `lib/firebase.ts` under Node at build time and crashes otherwise.
- **Function region stays `europe-west1`** (unchanged; no new functions here).
- Dedup is naive by design: last ~30 kept-post summaries dropped into the prompt as text. No embeddings. (Upgrade path if it outgrows context: embed summaries + nearest-neighbour.)
- Commit format: `<type>: <description>` (feat, fix, refactor, docs, test, chore). No attribution footer.

---

## File Structure

- **Create** `lib/store.ts` — the only Firestore-touching module: `Account`/`Item` types + CRUD, all scoped by `uid`. SDK-bound, so not unit-tested (offline test rule); verified by typecheck + emulator.
- **Create** `firestore.rules` — lock every doc to its owner.
- **Modify** `lib/plan.ts` — `PlanRequest` gains `recent_posts?` + `backlog?`; `buildPrompt` appends two optional sections. Pure.
- **Modify** `lib/plan.test.ts` — cases for the two new sections.
- **Modify** `lib/firebase.ts` — export `db = getFirestore(app)`.
- **Modify** `firebase.json` — register `firestore.rules` and add Firestore to the emulator suite.
- **Modify** `app/page.tsx` — account switcher/add/rename/delete, profile→Firestore, Keep/Backlog buttons, backlog panel, first-load migration.
- **Modify** `CLAUDE.md` — architecture note: Firestore now holds account state.
- **Note:** `lib/gemini.ts` is **not** modified — `generatePlan` forwards the whole `PlanRequest` to `buildPrompt`, so the new fields ride along automatically.

---

## Task 1: Prompt gains "already posted" + "backlog" sections

**Files:**
- Modify: `lib/plan.ts`
- Test: `lib/plan.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PlanRequest` extended with `recent_posts?: unknown` and `backlog?: unknown` (untrusted string arrays). `buildPrompt` reads them via a new local `textList()` helper. No signature change to `buildPrompt` / `parsePlan`.

- [ ] **Step 1: Write the failing tests**

Add to `lib/plan.test.ts`:

```ts
test("recent posts become a do-not-repeat section", () => {
  const prompt = buildPrompt({
    ...BASE,
    recent_posts: ["Yacht demo teaser reel", "Broker testimonial carousel"],
  });
  assert.ok(prompt.includes("Already posted"));
  assert.ok(prompt.includes("Yacht demo teaser reel"));
  assert.ok(prompt.includes("Broker testimonial carousel"));
});

test("backlog ideas become a candidate-material section", () => {
  const prompt = buildPrompt({
    ...BASE,
    backlog: ["Explain the render pipeline", "Founder origin story"],
  });
  assert.ok(prompt.includes("Backlog"));
  assert.ok(prompt.includes("Explain the render pipeline"));
});

test("empty or junk recent_posts/backlog add no section", () => {
  const prompt = buildPrompt({ ...BASE, recent_posts: [], backlog: ["", 5, null] });
  assert.ok(!prompt.includes("Already posted"));
  assert.ok(!prompt.includes("Backlog"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test lib/plan.test.ts`
Expected: the three new tests FAIL (`Already posted` / `Backlog` not found).

- [ ] **Step 3: Implement the two sections in `buildPrompt`**

In `lib/plan.ts`, extend the interface:

```ts
export interface PlanRequest {
  business?: unknown;
  audience?: unknown;
  tone?: unknown;
  frequency?: unknown;
  categories?: unknown;
  this_week?: unknown;
  feedback?: unknown;
  previous_plan?: unknown;
  recent_posts?: unknown;
  backlog?: unknown;
}
```

Add a helper next to `text()`:

```ts
/** Untrusted array → clean, capped list of non-empty strings. */
function textList(value: unknown, max = 30): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .slice(0, max)
    .map((s) => s.trim().slice(0, 300));
}
```

In `buildPrompt`, after the `parts` array is built and before the revision block, insert:

```ts
  const recent = textList(req.recent_posts);
  if (recent.length) {
    parts.push(
      "",
      "Already posted — do NOT repeat these ideas, angles, or hooks:",
      ...recent.map((s) => `- ${s}`),
    );
  }

  const backlog = textList(req.backlog);
  if (backlog.length) {
    parts.push(
      "",
      "Backlog ideas you may draw from this week if they fit:",
      ...backlog.map((s) => `- ${s}`),
    );
  }
```

(The revision block that reads `req.previous_plan`/`feedback` stays after these — order doesn't matter functionally, but keeping revision last matches the existing code.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test lib/plan.test.ts`
Expected: all tests PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add lib/plan.ts lib/plan.test.ts
git commit -m "feat: feed kept posts and backlog into the plan prompt"
```

---

## Task 2: Firestore data layer (`lib/store.ts`)

**Files:**
- Modify: `lib/firebase.ts`
- Create: `lib/store.ts`

**Interfaces:**
- Consumes: `app` from `lib/firebase.ts`; `Profile` from `lib/profile.ts`; `Post` from `lib/plan.ts`.
- Produces (relied on by Task 4):
  - `db` (exported from `lib/firebase.ts`)
  - Types `Account`, `Item`, `ItemStatus`
  - `postSummary(post: Post): string`
  - `listAccounts(uid: string): Promise<Account[]>`
  - `createAccount(uid: string, name: string, profile: Profile): Promise<Account>`
  - `updateAccountProfile(uid: string, accountId: string, profile: Profile): Promise<void>`
  - `renameAccount(uid: string, accountId: string, name: string): Promise<void>`
  - `deleteAccount(uid: string, accountId: string): Promise<void>`
  - `listItems(uid: string, accountId: string): Promise<Item[]>`
  - `addItem(uid: string, accountId: string, input: NewItem): Promise<Item>` where `NewItem = { status: ItemStatus; summary: string; post?: Post }`
  - `setItemStatus(uid: string, accountId: string, itemId: string, status: ItemStatus): Promise<void>`
  - `deleteItem(uid: string, accountId: string, itemId: string): Promise<void>`

- [ ] **Step 1: Export `db` from `lib/firebase.ts`**

Add the import at the top of `lib/firebase.ts`:

```ts
import { getFirestore } from "firebase/firestore";
```

And at the bottom, next to `export const auth`:

```ts
export const db = getFirestore(app);
```

(`getFirestore` is safe under Node at build time — unlike App Check it needs no `window`.)

- [ ] **Step 2: Create `lib/store.ts`**

```ts
/** The only Firestore-touching module. Account state (business profiles + their
 *  saved/backlog items) scoped to the signed-in user's uid. Kept out of lib/plan.ts
 *  so the prompt logic stays offline-testable. */

import {
  addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, updateDoc,
} from "firebase/firestore";

import { db } from "@/lib/firebase";
import type { Profile } from "@/lib/profile";
import type { Post } from "@/lib/plan";

export type ItemStatus = "used" | "backlog";

export interface Account {
  id: string;
  name: string;
  profile: Profile;
  platform: "instagram";
  createdAt: number;
}

export interface Item {
  id: string;
  status: ItemStatus;
  summary: string;
  post?: Post;
  createdAt: number;
}

export interface NewItem {
  status: ItemStatus;
  summary: string;
  post?: Post;
}

/** First non-empty line of a caption, capped — the line shown in lists and fed to prompts. */
export function postSummary(post: Post): string {
  const firstLine = post.caption.split("\n").find((l) => l.trim() !== "") ?? post.caption;
  return firstLine.trim().slice(0, 200);
}

const accountsCol = (uid: string) => collection(db, "users", uid, "accounts");
const itemsCol = (uid: string, accountId: string) =>
  collection(db, "users", uid, "accounts", accountId, "items");

export async function listAccounts(uid: string): Promise<Account[]> {
  const snap = await getDocs(query(accountsCol(uid), orderBy("createdAt", "asc")));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Account, "id">) }));
}

export async function createAccount(
  uid: string, name: string, profile: Profile,
): Promise<Account> {
  const body: Omit<Account, "id"> = {
    name, profile, platform: "instagram", createdAt: Date.now(),
  };
  const ref = await addDoc(accountsCol(uid), body);
  return { id: ref.id, ...body };
}

export function updateAccountProfile(
  uid: string, accountId: string, profile: Profile,
): Promise<void> {
  return updateDoc(doc(db, "users", uid, "accounts", accountId), { profile });
}

export function renameAccount(uid: string, accountId: string, name: string): Promise<void> {
  return updateDoc(doc(db, "users", uid, "accounts", accountId), { name });
}

/** ponytail: deletes the account doc only; its items subcollection is orphaned.
 *  Fine for a single-owner POC. Upgrade path: a recursive delete (Cloud Function or
 *  the admin SDK from the future CLI) if orphaned items ever matter. */
export function deleteAccount(uid: string, accountId: string): Promise<void> {
  return deleteDoc(doc(db, "users", uid, "accounts", accountId));
}

export async function listItems(uid: string, accountId: string): Promise<Item[]> {
  const snap = await getDocs(query(itemsCol(uid, accountId), orderBy("createdAt", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Item, "id">) }));
}

export async function addItem(
  uid: string, accountId: string, input: NewItem,
): Promise<Item> {
  // Firestore rejects `undefined`, so only include `post` when present.
  const body = {
    status: input.status,
    summary: input.summary,
    createdAt: Date.now(),
    ...(input.post ? { post: input.post } : {}),
  };
  const ref = await addDoc(itemsCol(uid, accountId), body);
  return { id: ref.id, ...body };
}

export function setItemStatus(
  uid: string, accountId: string, itemId: string, status: ItemStatus,
): Promise<void> {
  return updateDoc(doc(db, "users", uid, "accounts", accountId, "items", itemId), { status });
}

export function deleteItem(
  uid: string, accountId: string, itemId: string,
): Promise<void> {
  return deleteDoc(doc(db, "users", uid, "accounts", accountId, "items", itemId));
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: build succeeds (this also typechecks the web app). If it fails only inside `app/page.tsx` because Task 4 isn't done yet, that's fine at this point — but `lib/store.ts` and `lib/firebase.ts` must typecheck clean. To check the new module in isolation without a full build:

Run: `npx tsc --noEmit`
Expected: no errors in `lib/store.ts` or `lib/firebase.ts`.

- [ ] **Step 4: Commit**

```bash
git add lib/firebase.ts lib/store.ts
git commit -m "feat: add Firestore data layer for accounts and items"
```

---

## Task 3: Firestore security rules + emulator config

**Files:**
- Create: `firestore.rules`
- Modify: `firebase.json`

**Interfaces:**
- Consumes: nothing.
- Produces: owner-scoped access to `users/{uid}/**`; a Firestore emulator for `npm run preview`.

- [ ] **Step 1: Create `firestore.rules`**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // A signed-in user can read and write only their own tree. Everything else is denied.
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

- [ ] **Step 2: Register rules + emulator in `firebase.json`**

Add a top-level `"firestore"` key and an `"emulators"` block. The file becomes:

```json
{
  "hosting": {
    "public": "out",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "cleanUrls": true,
    "headers": [
      {
        "source": "**",
        "headers": [
          {
            "key": "Cross-Origin-Opener-Policy",
            "value": "same-origin-allow-popups"
          }
        ]
      }
    ]
  },
  "firestore": {
    "rules": "firestore.rules"
  },
  "functions": [
    {
      "source": "functions",
      "codebase": "default",
      "runtime": "nodejs22",
      "predeploy": ["npm --prefix \"$RESOURCE_DIR\" run build"],
      "ignore": ["node_modules", ".git", "*.log", "src/**/*.test.ts"]
    }
  ],
  "emulators": {
    "firestore": { "port": 8080 },
    "singleProjectMode": true
  }
}
```

- [ ] **Step 3: Verify the rules file is picked up**

Run: `npx firebase emulators:start --only firestore` (Ctrl-C after it prints "All emulators ready")
Expected: the Firestore emulator starts and logs that it loaded `firestore.rules`. No syntax error.

- [ ] **Step 4: Commit**

```bash
git add firestore.rules firebase.json
git commit -m "feat: owner-scoped Firestore rules and emulator config"
```

---

## Task 4: Wire accounts, Keep/Backlog, and the backlog panel into the UI

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: everything Task 2 produced from `lib/store.ts`; `EMPTY_PROFILE`, `normalizeProfile`, `type Profile` from `lib/profile.ts`; `generatePlan` from `lib/gemini.ts`.
- Produces: the finished UI. Nothing downstream depends on it.

This is one cohesive file. Do the steps in order; each block says where it slots into the existing `Page` component (read against `app/page.tsx` as it stands).

- [ ] **Step 1: Add imports and the active-account persistence**

At the top of `app/page.tsx`, add to the existing imports:

```ts
import { Menu, Modal } from "@mantine/core";
import {
  type Account, type Item, createAccount, deleteAccount, listAccounts, listItems,
  renameAccount, updateAccountProfile, addItem, deleteItem, setItemStatus, postSummary,
} from "@/lib/store";
```

- [ ] **Step 2: Replace the `localStorage` profile state with Firestore-backed account state**

Remove the `useLocalStorage<Profile>({ key: "planner.profile", ... })` block. Replace with account state and keep only a lightweight `localStorage` key for *which* account is active:

```ts
const [accounts, setAccounts] = useState<Account[]>([]);
const [activeId, setActiveId] = useLocalStorage<string>({
  key: "planner.activeAccount", defaultValue: "", getInitialValueInEffect: true,
});
const [items, setItems] = useState<Item[]>([]);
const [loadingAccounts, setLoadingAccounts] = useState(true);

const active = accounts.find((a) => a.id === activeId) ?? accounts[0] ?? null;
const profile = active?.profile ?? EMPTY_PROFILE;
```

- [ ] **Step 3: Load accounts on sign-in, migrating the legacy profile once**

Add an effect that runs when `user` becomes a real user. It lists accounts; if there are none, it seeds a "default" account from the legacy `planner.profile` `localStorage` value (or `EMPTY_PROFILE`):

```ts
useEffect(() => {
  if (!user) return;
  let cancelled = false;
  (async () => {
    setLoadingAccounts(true);
    try {
      let list = await listAccounts(user.uid);
      if (list.length === 0) {
        const legacy = normalizeProfile(
          typeof window !== "undefined" ? localStorage.getItem("planner.profile") : null,
        );
        const created = await createAccount(user.uid, "Default", legacy);
        list = [created];
      }
      if (cancelled) return;
      setAccounts(list);
      setActiveId((cur) => (list.some((a) => a.id === cur) ? cur : list[0].id));
    } catch (err) {
      if (!cancelled) setError((err as Error).message);
    } finally {
      if (!cancelled) setLoadingAccounts(false);
    }
  })();
  return () => { cancelled = true; };
}, [user, setActiveId]);
```

- [ ] **Step 4: Load the active account's items whenever it changes**

```ts
useEffect(() => {
  if (!user || !active) return;
  let cancelled = false;
  listItems(user.uid, active.id)
    .then((list) => { if (!cancelled) setItems(list); })
    .catch((err) => { if (!cancelled) setError((err as Error).message); });
  return () => { cancelled = true; };
}, [user, active?.id]);
```

- [ ] **Step 5: Point profile edits at Firestore**

Replace the old `set` / `setProfile` helpers. `set` now updates the active account locally *and* persists it:

```ts
function set<K extends keyof Profile>(key: K, value: Profile[K]) {
  updateActive((p) => ({ ...p, [key]: value }));
}

function updateActive(fn: (p: Profile) => Profile) {
  if (!user || !active) return;
  const next = fn(active.profile);
  setAccounts((list) => list.map((a) => (a.id === active.id ? { ...a, profile: next } : a)));
  void updateAccountProfile(user.uid, active.id, next).catch((err) => setError((err as Error).message));
}
```

Update `addCategory` to use `updateActive` instead of `setProfile`:

```ts
function addCategory() {
  const name = customCat.trim();
  if (!name) return;
  updateActive((p) =>
    p.allCategories.includes(name)
      ? p
      : { ...p, allCategories: [...p.allCategories, name], categories: [...p.categories, name] },
  );
  setCustomCat("");
}
```

- [ ] **Step 6: Feed kept posts + backlog into generation**

In `request()`, derive the two lists from `items` and pass them along. Change the `generatePlan({...})` call to include:

```ts
      const data = await generatePlan({
        business: profile.business,
        audience: profile.audience,
        tone: profile.tone,
        frequency: profile.frequency,
        categories: profile.categories,
        this_week: thisWeek,
        recent_posts: items.filter((i) => i.status === "used").map((i) => i.summary),
        backlog: items.filter((i) => i.status === "backlog").map((i) => i.summary),
        ...extra,
      });
```

- [ ] **Step 7: Add item actions (Keep / Save-to-backlog / add idea / use / remove)**

Add these handlers inside `Page`:

```ts
async function saveItem(status: "used" | "backlog", post: Post) {
  if (!user || !active) return;
  try {
    const item = await addItem(user.uid, active.id, { status, summary: postSummary(post), post });
    setItems((list) => [item, ...list]);
  } catch (err) { setError((err as Error).message); }
}

async function addIdea(summary: string) {
  const text = summary.trim();
  if (!text || !user || !active) return;
  try {
    const item = await addItem(user.uid, active.id, { status: "backlog", summary: text });
    setItems((list) => [item, ...list]);
  } catch (err) { setError((err as Error).message); }
}

async function useIdea(item: Item) {
  if (!user || !active) return;
  setItems((list) => list.map((i) => (i.id === item.id ? { ...i, status: "used" } : i)));
  try { await setItemStatus(user.uid, active.id, item.id, "used"); }
  catch (err) { setError((err as Error).message); }
}

async function removeItem(item: Item) {
  if (!user || !active) return;
  setItems((list) => list.filter((i) => i.id !== item.id));
  try { await deleteItem(user.uid, active.id, item.id); }
  catch (err) { setError((err as Error).message); }
}
```

- [ ] **Step 8: Add account actions (create / rename / delete)**

```ts
async function newAccount() {
  if (!user) return;
  const name = window.prompt("Name this account")?.trim();
  if (!name) return;
  try {
    const acc = await createAccount(user.uid, name, EMPTY_PROFILE);
    setAccounts((list) => [...list, acc]);
    setActiveId(acc.id);
  } catch (err) { setError((err as Error).message); }
}

async function renameActive() {
  if (!user || !active) return;
  const name = window.prompt("Rename account", active.name)?.trim();
  if (!name) return;
  setAccounts((list) => list.map((a) => (a.id === active.id ? { ...a, name } : a)));
  try { await renameAccount(user.uid, active.id, name); }
  catch (err) { setError((err as Error).message); }
}

async function deleteActive() {
  if (!user || !active) return;
  if (accounts.length === 1) { setError("Can't delete your only account."); return; }
  if (!window.confirm(`Delete "${active.name}"? Its saved posts and backlog go too.`)) return;
  const id = active.id;
  const remaining = accounts.filter((a) => a.id !== id);
  setAccounts(remaining);
  setActiveId(remaining[0]?.id ?? "");
  try { await deleteAccount(user.uid, id); }
  catch (err) { setError((err as Error).message); }
}
```

> ponytail: `window.prompt`/`confirm` for naming and delete-confirm instead of building Mantine modals. It's the lazy-correct POC choice — swap for `Modal` if the UX needs it. (The `Menu`/`Modal` imports in Step 1 are for the switcher menu in Step 9; drop `Modal` from the import if you don't end up using it.)

- [ ] **Step 9: Render the account switcher**

In the header `Group` (the one with the title), replace the right-hand `Stack` (email + sign out) so it also carries the account controls. Put this above the `<Accordion>`:

```tsx
{active && (
  <Group justify="space-between" mb="md">
    <Group gap="xs">
      <Select
        w={220}
        aria-label="Active account"
        allowDeselect={false}
        value={active.id}
        onChange={(v) => v && setActiveId(v)}
        data={accounts.map((a) => ({ value: a.id, label: a.name }))}
      />
      <Menu shadow="md">
        <Menu.Target>
          <Button variant="default" size="compact-sm">Manage</Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={() => void newAccount()}>New account…</Menu.Item>
          <Menu.Item onClick={() => void renameActive()}>Rename this account…</Menu.Item>
          <Menu.Item color="red" onClick={() => void deleteActive()}>Delete this account…</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  </Group>
)}
```

- [ ] **Step 10: Add Keep / Backlog buttons to each generated post**

Extend `PostCard`'s props and button row. Change the component signature and add two buttons next to the existing ones:

```tsx
function PostCard({
  post, onTweak, onKeep, onBacklog,
}: {
  post: Post; onTweak: () => void; onKeep: () => void; onBacklog: () => void;
}) {
  // ...unchanged body...
  // in the <Group gap="xs" mt="md"> button row, after "Tweak this day":
  <Button size="compact-sm" variant="light" onClick={onKeep}>Keep</Button>
  <Button size="compact-sm" variant="subtle" onClick={onBacklog}>Backlog</Button>
}
```

And where `PostCard` is rendered in the plan list, pass the new props:

```tsx
<PostCard
  key={`${post.day}-${i}`}
  post={post}
  onTweak={() => tweakDay(post.day)}
  onKeep={() => void saveItem("used", post)}
  onBacklog={() => void saveItem("backlog", post)}
/>
```

- [ ] **Step 11: Render the backlog panel**

Add a `Backlog` accordion item (or a plain `Card` below the plan). Minimal version, placed after the `<Accordion>` and before the "This week" textarea:

```tsx
<Accordion mt="md" variant="separated">
  <Accordion.Item value="backlog">
    <Accordion.Control>
      Backlog ({items.filter((i) => i.status === "backlog").length})
    </Accordion.Control>
    <Accordion.Panel>
      <Stack gap="xs">
        {items.filter((i) => i.status === "backlog").map((item) => (
          <Group key={item.id} justify="space-between" wrap="nowrap">
            <Text size="sm" style={{ flex: 1 }}>{item.summary}</Text>
            <Group gap={4}>
              <Button size="compact-xs" variant="light" onClick={() => void useIdea(item)}>Mark used</Button>
              <Button size="compact-xs" variant="subtle" color="red" onClick={() => void removeItem(item)}>Remove</Button>
            </Group>
          </Group>
        ))}
        <Group gap="xs" mt="xs">
          <TextInput
            flex={1}
            value={ideaInput}
            onChange={(e) => setIdeaInput(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addIdea(ideaInput); setIdeaInput(""); } }}
            placeholder="Add a future post idea…"
          />
          <Button variant="default" onClick={() => { void addIdea(ideaInput); setIdeaInput(""); }}>Add</Button>
        </Group>
      </Stack>
    </Accordion.Panel>
  </Accordion.Item>
</Accordion>
```

Add the `ideaInput` state near the other `useState` calls:

```ts
const [ideaInput, setIdeaInput] = useState("");
```

- [ ] **Step 12: Guard the loading state**

The `if (user === undefined)` loader stays. Add, right after it, a loader while accounts load so the form doesn't flash `EMPTY_PROFILE`:

```tsx
if (user && loadingAccounts) {
  return <Center h="60vh"><Loader /></Center>;
}
```

- [ ] **Step 13: Typecheck + build**

Run: `npm run build`
Expected: build + static export succeed with no type errors. Fix any unused-import or type mismatches (e.g. drop `Modal` if unused).

- [ ] **Step 14: Manual verification against the emulator**

Run: `npm run preview`
Verify in the browser:
1. Sign in → a "Default" account exists, pre-filled from any prior `localStorage` profile.
2. Create a second account → switcher shows both; switching swaps the business form.
3. Edit the business text → reload → it persisted (Firestore, not localStorage).
4. Generate a plan → **Keep** one post, **Backlog** another → both appear in the backlog count / list; Kept one is `used`.
5. Generate again → the kept post's idea is not repeated (check the prompt effect qualitatively).
6. Add a manual backlog idea, mark one used, remove one.
7. Rename and delete a (non-only) account.

- [ ] **Step 15: Commit**

```bash
git add app/page.tsx
git commit -m "feat: account switcher, post memory, and backlog UI"
```

---

## Task 5: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Revise the architecture note**

In the "Architecture" section, change the "no backend proxy / no database" framing to reflect Firestore. Replace the opening architecture paragraph's claim of "no server state" with:

> Account state (business profiles + their saved/backlog `items`) now lives in **Firestore**, owner-scoped by `uid` via `firestore.rules`. The model call still goes **straight from the browser to Gemini** — Firestore never proxies it. `lib/store.ts` is the only Firestore-touching module; `lib/plan.ts` stays pure/offline-testable.

Add to "Where things live":

> - `lib/store.ts` — Firestore CRUD for accounts and their items (kept posts + backlog). The only module importing `firebase/firestore`.
> - `firestore.rules` — every doc under `users/{uid}` locked to its owner.

Add to "Deploy":

> Enable Firestore in the console, then `npx firebase deploy --only firestore:rules` to publish rules. `npm run preview` now also starts the Firestore emulator.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: note Firestore account storage in CLAUDE.md"
```

---

## Self-Review

**Spec coverage:**
- Accounts (store/switch/rename/delete) → Task 2 (data) + Task 4 Steps 2,3,5,8,9. ✓
- Post memory / dedup (explicit Keep → prompt) → Task 1 + Task 4 Steps 6,7,10. ✓
- Backlog (park + manual add, feeds generation) → Task 1 + Task 4 Steps 6,7,11. ✓
- Instagram-only + `platform` seam → `Account.platform: "instagram"` in Task 2. ✓
- Firestore owner-scoped → Task 3. ✓
- Migration from legacy `localStorage` → Task 4 Step 3. ✓
- CLI-compatible history (same `items` collection) → Task 2 model; no code needed now. ✓
- CLAUDE.md update → Task 5. ✓

**Type consistency:** `Account`, `Item`, `ItemStatus`, `NewItem`, `postSummary`, and every `store.ts` function name used in Task 4 match their Task 2 definitions. `recent_posts`/`backlog` on `PlanRequest` (Task 1) match the fields passed in Task 4 Step 6.

**Placeholder scan:** No TBD/TODO; every code step carries real code. `window.prompt`/`confirm` and orphaned-items-on-delete are deliberate, ponytail-flagged ceilings, not gaps.

**Manual-setup callout (yours, not the code's):** Enable Firestore in the Firebase console and run `npx firebase deploy --only firestore:rules` before the deployed site can read/write. The emulator covers local verification without either step.
