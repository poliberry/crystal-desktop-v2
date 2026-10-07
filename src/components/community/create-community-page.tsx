"use client";

import { useConvex, useMutation } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Loader2, PartyPopper } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { ChannelsStep } from "@/components/community/create/channels-step";
import { CommunityPreviewBackdrop } from "@/components/community/create/community-preview";
import {
  CreatorStep,
  type CreatorAudienceChoice,
  type CreatorPlatformChoice,
} from "@/components/community/create/creator-step";
import { GamesStep } from "@/components/community/create/games-step";
import { TypeStep, type CommunityKindChoice } from "@/components/community/create/type-step";
import { InviteStep } from "@/components/community/create/invite-step";
import { ProfileStep } from "@/components/community/create/profile-step";
import { RolesStep } from "@/components/community/create/roles-step";
import { RulesStep } from "@/components/community/create/rules-step";
import { TemplateStep } from "@/components/community/create/template-step";
import {
  SCRATCH_CHOICE,
  stepsFor,
  type StepId,
  type TemplateChoice,
} from "@/components/community/create/wizard";
import { useNavigation } from "@/components/home/navigation-context";
import { usePage } from "@/components/pages/page-context";
import { PageSidebar } from "@/components/pages/page-sidebar";
import { SidebarContent, SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { type CommunitySetup, SCRATCH_SETUP, cloneSetup } from "@/lib/community-templates";
import { clanSetup, creatorSetup, type ClanGame } from "@/lib/community-kinds";
import { showCommunityFinale } from "@/lib/community-finale";
import { launchConfetti } from "@/lib/confetti";
import { inviteUrl } from "@/lib/invites";
import { uploadImage } from "@/lib/cdn-upload";
import { cn } from "@/lib/utils";

const COPY: Record<StepId, { title: string; description: string }> = {
  type: {
    title: "What are you making?",
    description: "This decides which tools your community starts with. You can change channels and roles later.",
  },
  games: {
    title: "Pick your games",
    description: "A clan is centred on up to five. Each gets a roster, its own channels and a place on the calendar.",
  },
  creator: {
    title: "Set up your creator community",
    description: "Choose your home platform and who can join.",
  },
  template: {
    title: "Choose a starting point",
    description:
      "Start from a template, or from scratch. Everything it sets up can be changed in the next steps.",
  },
  profile: {
    title: "Give it an identity",
    description: "Name your community and add an icon and a banner.",
  },
  rules: {
    title: "Set the ground rules",
    description: "Rules are shown on the overview, the first thing new members see.",
  },
  channels: {
    title: "Lay out the channels",
    description: "Group them into categories, and make them text or voice.",
  },
  roles: {
    title: "Create roles",
    description:
      "Roles group members and decide what they can do. The first in the list outranks the ones under it, and everyone also gets the default @everyone role. This is optional — you can add roles any time in settings.",
  },
  invite: {
    title: "Invite your people",
    description: "Your community is ready. Bring some people in, then finish.",
  },
};

function useObjectUrl(file: File | null): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

/**
 * Making a community, as a page: pick a starting point, then step through its
 * name, icon and banner, rules, channels, roles and invites while a miniature
 * of the result is redrawn beside you.
 *
 * Nothing exists on the server until the roles step is done — everything
 * before that is held here, so backing out leaves nothing behind. The community
 * is then made in one call and its icon and banner uploaded; the invite step
 * works on the real thing, which is why it can't be gone back from.
 */
export function CreateCommunityPage() {
  const convex = useConvex();
  const createFromSetup = useMutation(api.communities.createFromSetup);
  const generateIconUploadUrl = useMutation(api.communities.generateIconUploadUrl);
  const generateBannerUploadUrl = useMutation(api.communities.generateBannerUploadUrl);
  const setIcon = useMutation(api.communities.setIcon);
  const setBanner = useMutation(api.communities.setBanner);
  const getOrCreateInviteCode = useMutation(api.communities.getOrCreateInviteCode);
  const getOrCreateDirect = useMutation(api.conversations.getOrCreateDirect);
  const sendMessage = useMutation(api.messages.send);
  const nav = useNavigation();
  const { closePage } = usePage();

  const [stepIndex, setStepIndex] = useState(0);
  const [kind, setKind] = useState<CommunityKindChoice>("standard");
  const [games, setGames] = useState<ClanGame[]>([]);
  const [platform, setPlatform] = useState<CreatorPlatformChoice | null>(null);
  const [audience, setAudience] = useState<CreatorAudienceChoice>("public");
  const [choice, setChoice] = useState<TemplateChoice>(SCRATCH_CHOICE);
  const [setup, setSetup] = useState<CommunitySetup>(() => cloneSetup(SCRATCH_SETUP));
  const [name, setName] = useState("");
  const [icon, setIcon_] = useState<File | null>(null);
  const [banner, setBanner_] = useState<File | null>(null);
  const [created, setCreated] = useState<Id<"communities"> | null>(null);
  const [invited, setInvited] = useState<Set<Id<"users">>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const iconUrl = useObjectUrl(icon);
  const bannerUrl = useObjectUrl(banner);

  const steps = stepsFor(kind === "standard" ? undefined : kind);
  const step = steps[stepIndex]!;
  const last = stepIndex === steps.length - 1;

  // Choosing a kind starts the setup over from that kind's own starting point;
  // the later steps then refine it.
  const chooseKind = (next: CommunityKindChoice) => {
    setKind(next);
    setChoice(SCRATCH_CHOICE);
    if (next === "clan") setSetup(clanSetup(games));
    else if (next === "creator") setSetup(creatorSetup(audience));
    else setSetup(cloneSetup(SCRATCH_SETUP));
  };
  const changeGames = (next: ClanGame[]) => {
    setGames(next);
    setSetup(clanSetup(next));
  };
  const changeAudience = (next: CreatorAudienceChoice) => {
    setAudience(next);
    setSetup(creatorSetup(next));
  };
  const changePlatform = (next: CreatorPlatformChoice) => {
    setPlatform(next);
    // TikTok has no memberships, so a members-only community can't be gated on it.
    if (next === "tiktok" && audience === "members") changeAudience("public");
  };

  const canContinue = (() => {
    switch (step.id) {
      case "games":
        return games.length >= 1 && games.length <= 5;
      case "creator":
        return platform !== null;
      case "profile":
        return name.trim().length > 0;
      case "channels":
        return setup.channels.some((c) => c.name.trim());
      default:
        return true;
    }
  })();

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await createFromSetup({
        name,
        setup,
        templateId: choice.templateId,
        ...(kind === "clan" ? { kind: "clan" as const, clanGames: games } : {}),
        ...(kind === "creator"
          ? { kind: "creator" as const, creator: { platform: platform ?? undefined, audience } }
          : {}),
      });
      setCreated(id);
      // The community is made; a picture that fails to upload shouldn't undo
      // that, and can be set again in its settings.
      const uploads: Promise<unknown>[] = [];
      if (icon) {
        uploads.push(
          uploadImage(convex, icon, "icons", generateIconUploadUrl).then((uploaded) =>
            setIcon({ communityId: id, ...uploaded }),
          ),
        );
      }
      if (banner) {
        uploads.push(
          uploadImage(convex, banner, "banners", generateBannerUploadUrl).then((uploaded) =>
            setBanner({ communityId: id, ...uploaded }),
          ),
        );
      }
      await Promise.allSettled(uploads);
      setStepIndex(steps.length - 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the community.");
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (!created) return;
    setBusy(true);
    setError(null);
    try {
      if (invited.size > 0) {
        const code = await getOrCreateInviteCode({ communityId: created });
        // One DM each, sequentially: a handful of friends, and an order that
        // reads the same in every conversation.
        for (const friendId of invited) {
          try {
            const conversationId = await getOrCreateDirect({ friendId });
            await sendMessage({
              conversationId,
              text: `Join me in ${name.trim()} on Crystal: ${inviteUrl(code)}`,
            });
          } catch {
            // One friend who can't be messaged shouldn't stop the rest.
          }
        }
      }
      // The overview is opened underneath, and the finished view laid over it —
      // it outlives this page, which is closed here (see `showCommunityFinale`).
      launchConfetti();
      showCommunityFinale(created);
      nav.openCommunityOverview(created);
      closePage();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  };

  const onNext = () => {
    if (step.id === "roles") void create();
    else if (last) void finish();
    else setStepIndex((i) => i + 1);
  };

  const choose = (next: TemplateChoice, nextSetup: CommunitySetup) => {
    setChoice(next);
    setSetup(cloneSetup(nextSetup));
  };

  return (
    <div className="settings-surface relative flex h-full min-h-0 flex-col overflow-hidden">
      {/* Behind everything: a large picture of the community as it is so far,
          running off the right and bottom of the page. */}
      <CommunityPreviewBackdrop
        name={name}
        iconUrl={iconUrl}
        bannerUrl={bannerUrl}
        setup={setup}
        focus={step.id}
      />

      {/* The steps, listed in the sidebar for as long as the page is open. */}
      <PageSidebar>
        <SidebarContent>
          <SidebarMenu className="px-2 py-1">
            {steps.map((s, index) => {
              const done = index < stepIndex;
              const current = index === stepIndex;
              return (
                <SidebarMenuItem key={s.id}>
                  <div
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2 py-2 text-sm",
                      current ? "bg-sidebar-accent font-medium" : "text-muted-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                        done || current ? "border-primary bg-primary text-primary-foreground" : "border-foreground/20",
                      )}
                    >
                      {done ? <Check className="size-3" /> : index + 1}
                    </span>
                    {s.label}
                  </div>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarContent>
      </PageSidebar>

      {/* The segmented progress bar. */}
      <div className="relative shrink-0 px-8 pt-6">
        <div className="mx-auto flex max-w-6xl gap-1.5">
          {steps.map((s, index) => {
            const reached = index <= stepIndex;
            const clickable = index < stepIndex && !created;
            return (
              <button
                key={s.id}
                type="button"
                disabled={!clickable}
                onClick={() => setStepIndex(index)}
                className={cn("group min-w-0 flex-1 space-y-1.5 text-left", !clickable && "cursor-default")}
                aria-current={index === stepIndex ? "step" : undefined}
              >
                <div className="h-1.5 overflow-hidden rounded-full bg-foreground/15">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    initial={false}
                    animate={{ width: reached ? "100%" : "0%" }}
                    transition={{ type: "spring", stiffness: 300, damping: 32 }}
                  />
                </div>
                <p
                  className={cn(
                    "truncate text-[11px] transition-colors",
                    index === stepIndex ? "font-semibold text-foreground" : "text-muted-foreground",
                    clickable && "group-hover:text-foreground",
                  )}
                >
                  {s.label}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative mx-auto grid min-h-0 w-full max-w-6xl flex-1 gap-8 px-8 pt-6 pb-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* The step */}
        <div className="flex min-h-0 flex-1 flex-col">
          <header className="shrink-0 space-y-1 pb-4">
            <h1 className="text-2xl font-semibold tracking-tight">{COPY[step.id].title}</h1>
            <p className="text-sm text-muted-foreground">{COPY[step.id].description}</p>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto pr-2">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
                className="pb-4"
              >
                {step.id === "type" && <TypeStep value={kind} onChange={chooseKind} />}
                {step.id === "games" && <GamesStep games={games} onChange={changeGames} />}
                {step.id === "creator" && (
                  <CreatorStep platform={platform} onPlatform={changePlatform} audience={audience} onAudience={changeAudience} />
                )}
                {step.id === "template" && <TemplateStep choice={choice} onChoose={choose} />}
                {step.id === "profile" && (
                  <ProfileStep
                    name={name}
                    onName={setName}
                    iconUrl={iconUrl}
                    onIcon={setIcon_}
                    bannerUrl={bannerUrl}
                    onBanner={setBanner_}
                  />
                )}
                {step.id === "rules" && (
                  <RulesStep rules={setup.rules} onChange={(rules) => setSetup((s) => ({ ...s, rules }))} />
                )}
                {step.id === "channels" && (
                  <ChannelsStep
                    channels={setup.channels}
                    onChange={(channels) => setSetup((s) => ({ ...s, channels }))}
                  />
                )}
                {step.id === "roles" && (
                  <RolesStep roles={setup.roles} onChange={(roles) => setSetup((s) => ({ ...s, roles }))} />
                )}
                {step.id === "invite" && created && (
                  <InviteStep
                    communityId={created}
                    communityName={name.trim()}
                    selected={invited}
                    onToggle={(id) =>
                      setInvited((prev) => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      })
                    }
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {error && <p className="shrink-0 pt-2 text-sm text-destructive">{error}</p>}

          <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-foreground/10 pt-4">
            {/* No way back once it exists: the steps before this one are
                decisions already made. */}
            {stepIndex > 0 && !created ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setStepIndex((i) => i - 1)}>
                <ArrowLeft className="size-4" />
                Back
              </Button>
            ) : (
              <span />
            )}
            <Button type="button" disabled={!canContinue || busy} onClick={onNext}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : last ? (
                <PartyPopper className="size-4" />
              ) : null}
              {step.id === "roles" ? "Create community" : last ? "Finish" : "Continue"}
              {!busy && !last && step.id !== "roles" && <ArrowRight className="size-4" />}
            </Button>
          </footer>
        </div>

        {/* The right column is left open for the preview, which is drawn by
            the page itself so it can run off the page's edges. */}
        <div className="hidden lg:block" />
      </div>
    </div>
  );
}
