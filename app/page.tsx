"use client";

import { useEffect, useRef, useState } from "react";
import {
  Accordion, Alert, Anchor, Button, Center, Chip, Group, Loader,
  Menu, MultiSelect, Select, Stack, Tabs, Text, Textarea, TextInput, Title,
} from "@mantine/core";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";

import { deriveStyleRule, generateContentPlan, generatePlan } from "@/lib/gemini";
import { mergeStyleRules } from "@/lib/rules";
import { downloadJson, downloadMarkdown } from "@/lib/export";
import { deleteWeekImages, hydrateWeekImages, recoverWeekImages, saveWeekImages } from "@/lib/media";
import { currentWeekKey, emptyWeek, imageManifestDiffers, shiftWeekKey, shouldAutosaveWeek,
  workspaceIdentity, type SavedImageState } from "@/lib/week";
import { selectRelevantFingerprints } from "@/lib/history";
import { type Plan, type Post, type Strategy } from "@/lib/plan";
import { auth } from "@/lib/firebase";
import { EMPTY_PROFILE, normalizeProfile, type Profile } from "@/lib/profile";
import {
  type Item, type ItemStatus, addItem, createWorkspace,
  deleteItem, deleteWeek, deleteWorkspace, listRecentWeekPosts, loadWeek, postSummary,
  renameWorkspace, saveWeek, setItemStatus, updateWorkspaceProfile,
} from "@/lib/store";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { AdminPanel } from "@/components/AdminPanel";
import { MembersPanel } from "@/components/MembersPanel";
import { CostSummary } from "@/components/CostSummary";
import { PostCard } from "@/components/PostCard";
import { SignIn } from "@/components/SignIn";
import { describeGenError } from "@/lib/errors";


export default function Page() {

  // Bumped after each generation so the cost panel re-reads the server-recorded spend.
  const [spendVersion, setSpendVersion] = useState(0);

  const [customCat, setCustomCat] = useState("");
  const [ideaInput, setIdeaInput] = useState("");
  const [thisWeek, setThisWeek] = useState("");
  const [weeklyGoals, setWeeklyGoals] = useState("");
  const [availableAssets, setAvailableAssets] = useState("");
  const [requirements, setRequirements] = useState("");
  const [feedback, setFeedback] = useState("");
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>("business");
  const [tab, setTab] = useState<string | null>("planner");
  const [weekKey, setWeekKey] = useState(() => currentWeekKey());
  const [urlCompanyId, setUrlCompanyId] = useState("");
  const [urlReady, setUrlReady] = useState(false);
  const [imageStates, setImageStates] = useState<Record<string, SavedImageState>>({});
  const [weekReady, setWeekReady] = useState(false);
  const [recentWeekPosts, setRecentWeekPosts] = useState<string[]>([]);

  // undefined = still checking with Firebase, null = signed out.
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => onAuthStateChanged(auth, (u) => setUser(u)), []);

  const planRef = useRef<HTMLDivElement>(null);
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const weekSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedWeekRef = useRef("");
  const currentWorkspaceRef = useRef("");

  const { workspaces, setWorkspaces, setActiveId, items, setItems,
    loadingWorkspaces, active, profile, backlog, published } =
    useWorkspaces({ user, urlCompanyId, urlReady, onError: setError });

  // Identifies the workspace+week a save belongs to, so a debounced write that lands after the
  // user switches away is dropped instead of overwriting the new selection.
  currentWorkspaceRef.current = active ? workspaceIdentity(active.id, weekKey) : "";

  const [prefillText, setPrefillText] = useState("");
  const [showPrefill, setShowPrefill] = useState(false);


  // Read navigation context only after hydration, then let it take precedence
  // over the local-storage fallback used by older links.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedWeek = params.get("week") ?? "";
    setUrlCompanyId(params.get("company") ?? "");
    if (/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(requestedWeek)) setWeekKey(requestedWeek);
    setUrlReady(true);
  }, []);


  // Keep the address bar canonical without creating a browser-history entry on
  // every state update. The resulting URL survives reloads and can be copied.
  useEffect(() => {
    if (!urlReady || !active) return;
    const url = new URL(window.location.href);
    url.searchParams.set("company", active.id);
    url.searchParams.set("week", weekKey);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [urlReady, active?.id, weekKey]);


  useEffect(() => {
    if (!user || !active) return;
    let cancelled = false;
    const identity = workspaceIdentity(active.id, weekKey);
    loadedWeekRef.current = "";
    setWeekReady(false);
    // Post cards own display state derived from the loaded week. Do not
    // leave cards from the previous workspace/week mounted while data is loading.
    setStrategy(null); setPlan(null); setImageStates({});
    void (async () => {
      try {
        const saved = await loadWeek(active.id, weekKey);
        const value = saved ?? emptyWeek(weekKey);
        // Image bytes live in separate chunk documents. Hydrate those before
        // mounting the plan so cards initialize with the complete saved state.
        const expectedMediaPrefix = `workspaces/${active.id}/weeks/${weekKey}/media/`;
        const hydratedImageStates = await hydrateWeekImages(value.imageStates ?? {}, expectedMediaPrefix);
        const recoveredImageStates = await recoverWeekImages(active.id, weekKey,
          hydratedImageStates, value.plan?.posts.map((post) => post.id) ?? []);
        if (imageManifestDiffers(value.imageStates, recoveredImageStates)) {
          // Repair the manifest once so subsequent loads can use the direct path.
          await saveWeek(active.id, { ...value, imageStates: recoveredImageStates });
        }
        if (cancelled) return;
        setWeeklyGoals(value.weeklyGoals); setThisWeek(value.thisWeek);
        setAvailableAssets(value.availableAssets); setRequirements(value.requirements);
        setFeedback(value.feedback); setImageStates(recoveredImageStates);
        setStrategy(value.strategy); setPlan(value.plan);
        loadedWeekRef.current = identity;
        setWeekReady(true);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [user, active?.id, weekKey]);

  useEffect(() => {
    if (!user || !active) return;
    let cancelled = false;
    listRecentWeekPosts(active.id, weekKey)
      .then((posts) => { if (!cancelled) setRecentWeekPosts(posts); })
      .catch((err) => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [user, active?.id, weekKey]);

  useEffect(() => {
    // shouldAutosaveWeek owns the weekReady + identity guards; see its tests for why both matter.
    if (!user || !active) return;
    if (!shouldAutosaveWeek(loadedWeekRef.current, workspaceIdentity(active.id, weekKey), weekReady)) return;
    if (weekSaveTimer.current) clearTimeout(weekSaveTimer.current);
    weekSaveTimer.current = setTimeout(() => {
      void saveWeek(active.id, { weekKey, weeklyGoals, thisWeek, availableAssets,
        requirements, feedback, strategy, plan, imageStates, updatedAt: Date.now() })
        .catch((err) => setError(`Weekly workspace could not be saved: ${(err as Error).message}`));
    }, 700);
    return () => { if (weekSaveTimer.current) clearTimeout(weekSaveTimer.current); };
  }, [user, active?.id, weekKey, weekReady, weeklyGoals, thisWeek, availableAssets,
    requirements, feedback, strategy, plan, imageStates]);


  function updateActive(fn: (p: Profile) => Profile) {
    if (!user || !active) return;
    const workspaceId = active.id;
    const next = fn(active.profile);
    setWorkspaces((list) => list.map((a) => (a.id === workspaceId ? { ...a, profile: next } : a)));
    // ponytail: debounce the Firestore write so typing doesn't fire a write per keystroke.
    // The brand is shared now, so concurrent editors are last-write-wins on the whole profile.
    // 600ms is fine for a handful of colleagues; upgrade path if two people ever fight over
    // the same field is per-field writes or a presence indicator, not a shorter debounce.
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void updateWorkspaceProfile(workspaceId, next).catch((err) => setError((err as Error).message));
    }, 600);
  }

  function set<K extends keyof Profile>(key: K, value: Profile[K]) {
    updateActive((p) => ({ ...p, [key]: value }));
  }

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

  function requestBody(extra: Record<string, unknown> = {}) {
    const historyContext = [profile.business, profile.products, profile.categories.join(" "),
      weeklyGoals, thisWeek, requirements].join(" ");
    const history = selectRelevantFingerprints(
      [...published.map((i) => i.summary), ...recentWeekPosts], historyContext,
    );
    return {
      business: profile.business, audience: profile.audience, tone: profile.tone,
      language: profile.language, products: profile.products, founder_voice: profile.founderVoice,
      visual_identity: profile.visualIdentity, approved_facts: profile.approvedFacts,
      avoid: profile.avoid, platforms: profile.platforms, publishers: profile.publishers,
      frequency: profile.frequency, categories: profile.categories, style_rules: profile.styleRules,
      weekly_goals: weeklyGoals, events: thisWeek, available_assets: availableAssets,
      requirements, recent_posts: history,
      backlog: backlog.map((i) => i.summary), ...extra,
    };
  }

  // Cost is metered and recorded server-side inside the generate proxy now. Refresh the
  // displayed spend after a generation cycle finishes.
  const bumpSpend = () => setSpendVersion((v) => v + 1);

  async function requestContent() {
    if (!profile.business.trim()) {
      setError("Describe the business first.");
      setOpenSection("business");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const currentPlanHistory = plan?.posts.map(postSummary) ?? [];
      const history = [...published.map((i) => i.summary), ...recentWeekPosts, ...currentPlanHistory];
      const result = await generateContentPlan(requestBody({
        recent_posts: selectRelevantFingerprints(history, [weeklyGoals, thisWeek, requirements].join(" ")),
      }), active.id);
      bumpSpend();
      const { strategy: nextStrategy, plan: nextPlan } = result.data;
      setStrategy(nextStrategy);
      setPlan(nextPlan);
      setOpenSection(null);
      requestAnimationFrame(() =>
        planRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    } catch (err) {
      setError(describeGenError(err));
    } finally {
      setBusy(false);
    }
  }

  async function requestPlan(extra: Record<string, unknown> = {}) {
    if (!strategy) return undefined;
    setBusy(true); setError("");
    try {
      const result = await generatePlan(requestBody({ strategy, frequency: strategy.items.length, ...extra }), false, active.id);
      bumpSpend();
      setPlan(result.data);
      requestAnimationFrame(() => planRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
      return result.data;
    } catch (err) { setError(describeGenError(err)); return undefined; }
    finally { setBusy(false); }
  }

  async function revise() {
    const note = feedback.trim();
    if (!note) return feedbackRef.current?.focus();
    if (!plan) return;
    const previous = plan;
    const revised = await requestPlan({ previous_plan: previous, feedback: note });
    if (!revised) return;
    // Best-effort: a revision that teaches something durable becomes a standing rule.
    // Never blocks the plan, and a failure here is silent by design.
    const rule = await deriveStyleRule(previous, revised, note, profile.styleRules, active.id);
    bumpSpend();
    // Merge inside the updater: the profile may have been edited during the two awaits above.
    if (rule) updateActive((p) => ({ ...p, styleRules: mergeStyleRules(p.styleRules, rule) }));
  }

  function tweakDay(day: string) {
    setFeedback(`${day}: `);
    feedbackRef.current?.focus();
  }

  async function saveItem(status: ItemStatus, post: Post) {
    if (!user || !active) return;
    try {
      const item = await addItem(active.id, { status, summary: postSummary(post), post });
      setItems((list) => [item, ...list]);
    } catch (err) { setError((err as Error).message); }
  }

  async function addIdea() {
    const text = ideaInput.trim();
    if (!text || !user || !active) return;
    setIdeaInput("");
    try {
      const item = await addItem(active.id, { status: "backlog", summary: text });
      setItems((list) => [item, ...list]);
    } catch (err) { setError((err as Error).message); }
  }

  async function changeStatus(item: Item, status: ItemStatus) {
    if (!user || !active) return;
    setItems((list) => list.map((i) => (i.id === item.id ? { ...i, status } : i)));
    try { await setItemStatus(active.id, item.id, status); }
    catch (err) { setError((err as Error).message); }
  }

  async function transformPost(post: Post, transformation: string) {
    setBusy(true); setError("");
    try {
      const economy = [
        "Shorten the caption while preserving its strongest idea.",
        "Replace only the hook with a sharper, specific opening.",
        "Turn this into a concise founder repost caption that adds personal context.",
        "Adapt this into a credible first-person LinkedIn founder post.",
        "Adapt this for a LinkedIn company post with a distinct channel-native angle.",
        "Correct grammar and clarity issues without changing the meaning, claims, or voice.",
        "Replace only the hashtags with a smaller set of specific, relevant hashtags.",
      ].includes(transformation);
      const result = await generatePlan(
        requestBody({ mode: "transform", selected_post: post, transformation }), economy, active.id,
      );
      bumpSpend();
      const replacement = result.data.posts[0];
      if (!replacement) throw new Error("The model returned no transformed post.");
      setPlan((current) => current ? { ...current, posts: current.posts.map((p) => p.id === post.id ? replacement : p) } : current);
    } catch (err) { setError(describeGenError(err)); }
    finally { setBusy(false); }
  }

  async function removeItem(item: Item) {
    if (!user || !active) return;
    setItems((list) => list.filter((i) => i.id !== item.id));
    try { await deleteItem(active.id, item.id); }
    catch (err) { setError((err as Error).message); }
  }

  async function newWorkspace() {
    if (!user) return;
    const name = window.prompt("Name this brand")?.trim();
    if (!name) return;
    try {
      // The callable writes the workspace and the creator's member document together, so the
      // id only exists once it is reachable.
      const id = await createWorkspace(name, EMPTY_PROFILE);
      setWorkspaces((list) => [...list, { id, name, profile: EMPTY_PROFILE, platform: "multi",
        ownerUid: user.uid, createdAt: Date.now() }]);
      setActiveId(id);
    } catch (err) { setError((err as Error).message); }
  }

  async function renameActive() {
    if (!user || !active) return;
    const name = window.prompt("Rename brand", active.name)?.trim();
    if (!name) return;
    const id = active.id;
    setWorkspaces((list) => list.map((a) => (a.id === id ? { ...a, name } : a)));
    try { await renameWorkspace(id, name); }
    catch (err) { setError((err as Error).message); }
  }

  async function deleteActive() {
    if (!user || !active) return;
    if (workspaces.length === 1) { setError("Can't delete your only brand."); return; }
    if (active.ownerUid !== user.uid) { setError("Only the brand's owner can delete it."); return; }
    if (!window.confirm(`Delete "${active.name}"? Its saved posts and backlog go too, for every member.`)) return;
    const id = active.id;
    const remaining = workspaces.filter((a) => a.id !== id);
    setWorkspaces(remaining);
    setActiveId(remaining[0]?.id ?? "");
    try { await deleteWorkspace(id); }
    catch (err) { setError((err as Error).message); }
  }

  async function discardCurrentWeek() {
    if (!user || !active) return;
    if (!window.confirm(`Discard all saved work and generated images for ${weekKey}?`)) return;
    if (weekSaveTimer.current) clearTimeout(weekSaveTimer.current);
    try {
      await Promise.all([deleteWeek(active.id, weekKey), deleteWeekImages(imageStates)]);
      setWeeklyGoals(""); setThisWeek(""); setAvailableAssets(""); setRequirements("");
      setFeedback(""); setStrategy(null); setPlan(null); setImageStates({});
      loadedWeekRef.current = workspaceIdentity(active.id, weekKey);
    } catch (err) { setError((err as Error).message); }
  }

  async function navigateWeek(nextWeekKey: string) {
    if (!user || !active || !weekReady || nextWeekKey === weekKey) return;
    if (weekSaveTimer.current) clearTimeout(weekSaveTimer.current);
    setWeekReady(false);
    try {
      await saveWeek(active.id, { weekKey, weeklyGoals, thisWeek, availableAssets,
        requirements, feedback, strategy, plan, imageStates, updatedAt: Date.now() });
      setWeekKey(nextWeekKey);
    } catch (err) {
      setWeekReady(true);
      setError(`Could not save this week before switching: ${(err as Error).message}`);
    }
  }

  if (user === undefined) {
    return (
      <Center h="60vh">
        <Loader />
      </Center>
    );
  }

  if (user === null) {
    return <SignIn error={error} onError={setError} />;
  }

  if (loadingWorkspaces) {
    return (
      <Center h="60vh">
        <Loader />
      </Center>
    );
  }

  return (
    <>
    <header className="topbar">
      <div className="topbarInner">
        <div className="brand">
          <div className="brandMark" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 64 64" fill="none">
              <rect x="14" y="12" width="36" height="40" rx="5" stroke="currentColor" strokeWidth="5" />
              <path d="M23 27h18M23 36h18M23 45h11" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="wordmark">Content Planner</div>
            <div className="wordmarkSub">Weekly · IG + LinkedIn</div>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <Group gap="md" wrap="nowrap" style={{ flexShrink: 0 }}>
          <Text size="xs" c="dimmed" visibleFrom="sm"
            style={{ overflowWrap: "anywhere", maxWidth: 200, textAlign: "right" }}>{user.email}</Text>
          <Anchor component="button" type="button" size="xs" onClick={() => void signOut(auth)}>
            Sign out
          </Anchor>
        </Group>
      </div>
    </header>

    <main className="shell">
      {active && (
        <Group gap="xs" mb="xl">
          <Select
            flex={1}
            maw={260}
            aria-label="Active brand"
            allowDeselect={false}
            value={active.id}
            onChange={(v) => v && setActiveId(v)}
            data={workspaces.map((a) => ({ value: a.id, label: a.name }))}
          />
          <Menu shadow="md" position="bottom-start">
            <Menu.Target>
              <Button variant="default" size="compact-sm">Manage</Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => void newWorkspace()}>New brand…</Menu.Item>
              <Menu.Item onClick={() => void renameActive()}>Rename this brand…</Menu.Item>
              <Menu.Item color="red" onClick={() => void deleteActive()}>Delete this brand…</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      )}

      <Tabs variant="pills" value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="xl">
          <Tabs.Tab value="planner">Planner</Tabs.Tab>
          <Tabs.Tab value="brand">Brand</Tabs.Tab>
          <Tabs.Tab value="library">Library</Tabs.Tab>
        </Tabs.List>

      <Tabs.Panel value="brand">
        <div className="eyebrow">Brand brain</div>
        <Title order={2} size="h3" mt={4} mb={4}>Brand workspace</Title>
        <Text c="dimmed" size="sm" mb="lg">Persistent guidance used across every strategy and post.</Text>

        <Button variant="subtle" size="xs" mb="xs" onClick={() => setShowPrefill((v) => !v)}>
          {showPrefill ? "Hide prefill" : "Prefill brand from JSON"}
        </Button>
        {showPrefill && (
          <Stack gap="xs" mb="md">
            <Textarea
              label="Paste brand JSON from the onboard-brand skill"
              description="Replaces all brand fields — use on a new account."
              autosize minRows={4} maxRows={12}
              value={prefillText}
              onChange={(e) => setPrefillText(e.currentTarget.value)}
              placeholder='{ "business": "...", "audience": "...", ... }'
            />
            <Group>
              <Button
                size="xs"
                disabled={!prefillText.trim()}
                onClick={() => {
                  updateActive(() => normalizeProfile(prefillText));
                  setPrefillText("");
                  setShowPrefill(false);
                }}
              >
                Apply
              </Button>
            </Group>
          </Stack>
        )}

      <Accordion value={openSection} onChange={setOpenSection} variant="separated">
        <Accordion.Item value="members">
          <Accordion.Control>Who can edit this brand</Accordion.Control>
          <Accordion.Panel>
            {active && <MembersPanel workspaceId={active.id} ownerUid={active.ownerUid}
              uid={user.uid} onError={setError} />}
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="business">
          <Accordion.Control>Your business</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <Textarea
                label="What's the business, and what do you sell?"
                autosize
                minRows={3}
                value={profile.business}
                onChange={(e) => set("business", e.currentTarget.value)}
                placeholder="e.g. We build visionOS apps for real estate and yacht companies — immersive property and vessel walkthroughs on Apple Vision Pro."
              />

              <Group grow align="flex-start">
                <TextInput
                  label="Who are you talking to?"
                  value={profile.audience}
                  onChange={(e) => set("audience", e.currentTarget.value)}
                  placeholder="e.g. Brokerage owners, yacht dealers, CTOs"
                />
                <TextInput
                  label="Tone of voice"
                  value={profile.tone}
                  onChange={(e) => set("tone", e.currentTarget.value)}
                  placeholder="e.g. Confident, technical, no hype"
                />
                <Select
                  label="Posts / week"
                  maw={120}
                  allowDeselect={false}
                  data={["1", "2", "3", "4", "5", "6", "7"]}
                  value={String(profile.frequency)}
                  onChange={(v) => set("frequency", Number(v))}
                />
              </Group>

              <Group grow align="flex-start">
                <TextInput label="Output language" value={profile.language}
                  onChange={(e) => set("language", e.currentTarget.value)} placeholder="English" />
                <MultiSelect label="Platforms" value={profile.platforms}
                  onChange={(v) => set("platforms", v as Profile["platforms"])}
                  data={[{ value: "instagram", label: "Instagram" }, { value: "linkedin", label: "LinkedIn" }]} />
                <MultiSelect label="Publishers" value={profile.publishers}
                  onChange={(v) => set("publishers", v as Profile["publishers"])}
                  data={[{ value: "company", label: "Company" }, { value: "founder", label: "Founder" }]} />
              </Group>

              <Accordion variant="contained">
                <Accordion.Item value="advanced-brand">
                  <Accordion.Control>Advanced brand guidance</Accordion.Control>
                  <Accordion.Panel><Stack gap="md">
              <Textarea label="Products and verticals" autosize minRows={2} value={profile.products}
                onChange={(e) => set("products", e.currentTarget.value)}
                placeholder="Product names, industries, markets, and important distinctions." />
              <Textarea label="Founder voice" autosize minRows={2} value={profile.founderVoice}
                onChange={(e) => set("founderVoice", e.currentTarget.value)}
                placeholder="How the founder sounds, their point of view, and topics they can credibly own." />
              <Textarea label="Visual identity" description="Applied as the style lock for every AI image. A consistent premium default is used when this is empty."
                autosize minRows={2} value={profile.visualIdentity}
                onChange={(e) => set("visualIdentity", e.currentTarget.value)}
                placeholder="Brand colors, fonts, visual rhythm, preferred real/AI balance." />
              <Textarea label="Approved facts and claims" description="Only claims entered here may be stated as facts."
                autosize minRows={2} value={profile.approvedFacts}
                onChange={(e) => set("approvedFacts", e.currentTarget.value)}
                placeholder="Verified product capabilities, links, event details, results, contact details." />
              <Textarea label="Avoid" description="Also applied as a forbidden-subject list on every AI image."
                autosize minRows={2} value={profile.avoid}
                onChange={(e) => set("avoid", e.currentTarget.value)}
                placeholder="Clichés, banned claims, repeated phrases, visual styles, tone problems." />

              {profile.styleRules.length > 0 && (
                <div>
                  <Text size="sm" fw={500}>Learned rules</Text>
                  <Text size="xs" c="dimmed" mb={6}>
                    Picked up from your revisions and applied to every future plan. Delete any that stop being true.
                  </Text>
                  <Stack gap={6}>
                    {profile.styleRules.map((rule) => (
                      <Group key={rule} gap="xs" wrap="nowrap" align="flex-start">
                        <Text size="sm" style={{ flex: 1 }}>{rule}</Text>
                        <Button size="compact-xs" variant="subtle" color="gray"
                          onClick={() => set("styleRules", profile.styleRules.filter((r) => r !== rule))}>
                          Remove
                        </Button>
                      </Group>
                    ))}
                  </Stack>
                </div>
              )}

              <div>
                <Text size="sm" fw={500} mb={6}>Content categories to draw from</Text>
                <Chip.Group
                  multiple
                  value={profile.categories}
                  onChange={(v) => set("categories", v)}
                >
                  <Group gap="xs">
                    {profile.allCategories.map((name) => (
                      <Chip key={name} value={name} size="sm">{name}</Chip>
                    ))}
                  </Group>
                </Chip.Group>
                <Group gap="xs" mt="sm">
                  <TextInput
                    flex={1}
                    value={customCat}
                    onChange={(e) => setCustomCat(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCategory();
                      }
                    }}
                    placeholder="Add your own category…"
                  />
                  <Button variant="default" onClick={addCategory}>Add</Button>
                </Group>
              </div>
                  </Stack></Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
      </Tabs.Panel>

      <Tabs.Panel value="library">
        <div className="eyebrow">Pipeline</div>
        <Title order={2} size="h3" mt={4} mb={4}>Content library</Title>
        <Text c="dimmed" size="sm" mb="lg">Park future ideas and track posts through production.</Text>
      <Accordion variant="separated" defaultValue="backlog">
        <Accordion.Item value="costs">
          <Accordion.Control>AI costs</Accordion.Control>
          <Accordion.Panel>{user && active
            ? <><CostSummary uid={user.uid} workspaceId={active.id}
                workspaceNames={Object.fromEntries(workspaces.map((a) => [a.id, a.name]))}
                version={spendVersion} /><AdminPanel /></>
            : null}</Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="backlog">
          <Accordion.Control>Backlog ({backlog.length})</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              {backlog.map((item) => (
                <Group key={item.id} justify="space-between" align="flex-start">
                  <Text size="sm" style={{ flex: "1 1 16rem", minWidth: 0 }}>{item.summary}</Text>
                  <Group gap={4} wrap="nowrap">
                    <Button size="compact-xs" variant="light" onClick={() => void changeStatus(item, "planned")}>
                      Plan it
                    </Button>
                    <Button size="compact-xs" variant="subtle" color="red" onClick={() => void removeItem(item)}>
                      Remove
                    </Button>
                  </Group>
                </Group>
              ))}
              {backlog.length === 0 && (
                <Text size="sm" c="dimmed">
                  Nothing parked yet. Add an idea, or hit &ldquo;Backlog&rdquo; on any generated post.
                </Text>
              )}
              <Group gap="xs" mt="xs">
                <TextInput
                  flex={1}
                  value={ideaInput}
                  onChange={(e) => setIdeaInput(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addIdea();
                    }
                  }}
                  placeholder="Add a future post idea…"
                />
                <Button variant="default" onClick={() => void addIdea()}>Add</Button>
              </Group>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="workflow">
          <Accordion.Control>Production workflow ({items.filter((i) => i.status !== "backlog").length})</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              {items.filter((i) => i.status !== "backlog").map((item) => (
                <Group key={item.id} justify="space-between" align="flex-start">
                  <div style={{ flex: "1 1 16rem", minWidth: 0 }}>
                    <Text size="sm">{item.summary}</Text>
                    {item.post && <Text size="xs" c="dimmed">{item.post.platform} · {item.post.publisher} · {item.post.format.replace("_", " ")}</Text>}
                  </div>
                  <Select size="xs" w={145} allowDeselect={false} value={item.status}
                    onChange={(value) => value && void changeStatus(item, value as ItemStatus)}
                    data={[
                      { value: "planned", label: "Planned" },
                      { value: "in_production", label: "In production" },
                      { value: "ready", label: "Ready" },
                      { value: "published", label: "Published" },
                      { value: "skipped", label: "Skipped" },
                      { value: "backlog", label: "Backlog" },
                    ]} />
                  <Button size="compact-xs" variant="subtle" color="red" onClick={() => void removeItem(item)}>Remove</Button>
                </Group>
              ))}
              {items.every((i) => i.status === "backlog") && <Text size="sm" c="dimmed">No posts in production yet.</Text>}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
      </Tabs.Panel>

      <Tabs.Panel value="planner">
      <div className="weekRail">
        <Group gap="sm" wrap="nowrap">
          <Button size="compact-sm" variant="default" disabled={!weekReady} aria-label="Previous week"
            onClick={() => void navigateWeek(shiftWeekKey(weekKey, -1))}>←</Button>
          <div>
            <div className="weekKey">{weekKey}</div>
            <Text size="xs" c="dimmed">Saved automatically · checking {recentWeekPosts.length} prior posts</Text>
          </div>
          <Button size="compact-sm" variant="default" disabled={!weekReady} aria-label="Next week"
            onClick={() => void navigateWeek(shiftWeekKey(weekKey, 1))}>→</Button>
          {weekKey !== currentWeekKey() && <Button size="compact-sm" variant="light" disabled={!weekReady}
            onClick={() => void navigateWeek(currentWeekKey())}>Today</Button>}
        </Group>
        <Button size="compact-sm" variant="subtle" color="red" disabled={!weekReady}
          onClick={() => void discardCurrentWeek()}>Discard week</Button>
      </div>

      <div className="eyebrow" style={{ marginTop: "1.9rem" }}>Weekly brief</div>
      <Title order={2} size="h2" mt={4} mb="lg">What&rsquo;s happening this week?</Title>
      <Textarea label="Goals" autosize minRows={2} value={weeklyGoals}
        onChange={(e) => setWeeklyGoals(e.currentTarget.value)}
        placeholder="e.g. Build founder authority and turn event interest into demo conversations." />
      <Textarea
        mt="xl"
        label="Events and timely context"
        autosize
        minRows={3}
        value={thisWeek}
        onChange={(e) => setThisWeek(e.currentTarget.value)}
        placeholder="e.g. Shipping the yacht-tour demo Thursday, and we're at a proptech meetup Friday."
      />

      <Accordion mt="md" variant="contained">
        <Accordion.Item value="weekly-details">
          <Accordion.Control>Assets and constraints (optional)</Accordion.Control>
          <Accordion.Panel><Stack gap="md">
            <Textarea label="Available assets" autosize minRows={3} value={availableAssets}
              onChange={(e) => setAvailableAssets(e.currentTarget.value)}
              placeholder="One unused backstage video; Optivest reaction video; London apartment render; founder portrait." />
            <Textarea label="Required posts and constraints" autosize minRows={2} value={requirements}
              onChange={(e) => setRequirements(e.currentTarget.value)}
              placeholder="One real-life Instagram post, one written carousel, two LinkedIn posts including one founder post." />
          </Stack></Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      <Button mt="md" loading={busy} disabled={!weekReady} onClick={() => void requestContent()}>
        Generate content plan
      </Button>
      {!weekReady && <Text c="dimmed" size="sm" mt="sm">Loading this company&rsquo;s saved week…</Text>}
      {busy && (
        <Text c="dimmed" size="sm" mt="sm">Building the strategy and writing the posts… this may take up to a minute.</Text>
      )}
      {error && <Alert color="red" mt="md" title="Didn't work">{error}</Alert>}

      {plan && (
        <div ref={planRef}>
          <div className="eyebrow" style={{ marginTop: "2.75rem" }}>The plan · {plan.posts.length} posts</div>
          <Title order={2} size="h2" mt={6} mb="lg">{plan.week_theme}</Title>

          <Stack gap="md">
            {plan.posts.map((post, i) => (
              <PostCard
                key={`${active.id}-${weekKey}-${post.id}-${i}`}
                post={post}
                onTweak={() => tweakDay(post.day)}
                onKeep={() => void saveItem("planned", post)}
                onBacklog={() => void saveItem("backlog", post)}
                onTransform={(instruction) => void transformPost(post, instruction)}
                visualIdentity={profile.visualIdentity}
                avoid={profile.avoid}
                workspaceId={active.id}
                onSpend={bumpSpend}
                savedImageState={imageStates[post.id]}
                onImageState={(state) => setImageStates((current) => ({ ...current, [post.id]: state }))}
                onGeneratedImages={async (images, state) => {
                  if (!user || !active) return;
                  const generationWorkspace = workspaceIdentity(active.id, weekKey);
                  const saved = await saveWeekImages(active.id, weekKey, post.id, images);
                  const nextImageStates = { ...imageStates, [post.id]: { ...state, images: saved } };
                  // The image chunks and their references form one logical save. Do
                  // not rely on the general debounce here: an immediate refresh after
                  // generation must still be able to discover the saved chunks.
                  if (weekSaveTimer.current) clearTimeout(weekSaveTimer.current);
                  await saveWeek(active.id, { weekKey, weeklyGoals, thisWeek,
                    availableAssets, requirements, feedback, strategy, plan,
                    imageStates: nextImageStates, updatedAt: Date.now() });
                  // Generation can finish after the user navigates away. The data
                  // belongs to its captured week, but must not leak into the newly
                  // selected week's React state and autosave.
                  if (currentWorkspaceRef.current !== generationWorkspace) return;
                  setImageStates(nextImageStates);
                }}
              />
            ))}
          </Stack>

          {strategy && <Menu>
            <Menu.Target><Button mt="md" variant="default">Export plan</Button></Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => downloadMarkdown(strategy, plan)}>Production brief (.md)</Menu.Item>
              <Menu.Item onClick={() => downloadJson(strategy, plan)}>Structured data (.json)</Menu.Item>
            </Menu.Dropdown>
          </Menu>}

          <Textarea
            mt="xl"
            label="Not quite right?"
            description="Use this for whole-plan changes. Each post also has scoped transformations."
            autosize
            minRows={2}
            ref={feedbackRef}
            value={feedback}
            onChange={(e) => setFeedback(e.currentTarget.value)}
            placeholder="e.g. Wednesday is too salesy — make it a behind-the-scenes clip instead."
          />
          <Button mt="md" loading={busy} onClick={() => void revise()}>Revise the plan</Button>
        </div>
      )}
      </Tabs.Panel>
      </Tabs>
    </main>
    </>
  );
}

