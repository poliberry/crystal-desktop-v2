"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Loader2, Palette, X } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState, EntityLink, Fields, Loading, Panel, ReasonDialog, StatusPill, useRun, useStaff } from "@/components/admin/admin-ui";
import { useConsole } from "@/components/admin/console-state";
import { CreationReview } from "@/components/admin/records/creation-review";
import { slugify } from "@/components/admin/records/sku-form";
import { GRANT_KIND_META, type GrantKind } from "@/components/marketplace/sku-kinds";
import { SkuPreview } from "@/components/marketplace/sku-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatDate, formatMoney } from "@/lib/money";

/** Reviewing something a member wants to sell. */
export function SubmissionRecord({ id }: { id: string }) {
  const staff = useStaff();
  const { retitle, open } = useConsole();
  const submissionId = id as Id<"marketplaceSubmissions">;
  const submission = useQuery(api.marketplace.adminSubmission, { submissionId });
  const categories = useQuery(api.catalog.adminCategories);
  const approve = useMutation(api.marketplace.adminApproveSubmission);
  const reject = useMutation(api.marketplace.adminRejectSubmission);
  const { run, busy } = useRun();

  const [categoryId, setCategoryId] = useState("");
  const [slug, setSlug] = useState("");
  const [price, setPrice] = useState("");
  const [share, setShare] = useState("80");
  const [featured, setFeatured] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  useEffect(() => {
    if (!submission) return;
    retitle({ kind: "submission", id }, submission.name, submission.creator ? `by @${submission.creator.username}` : undefined);
    setSlug((s) => s || slugify(submission.name));
    // An update starts from the price it has now: a creator changing the artwork hasn't agreed a new price with anyone.
    setPrice((p) => p || ((submission.updates?.priceCents ?? submission.requestedPriceCents) / 100).toFixed(2));
  }, [submission, id, retitle]);

  useEffect(() => {
    if (!categoryId && categories?.[0]) setCategoryId(categories[0].id);
  }, [categories, categoryId]);

  if (submission === undefined) return <Loading />;
  if (submission === null) return <EmptyState icon={Palette} title="That submission no longer exists" />;

  const write = staff.can("catalog.write");
  const pending = submission.status === "pending";
  const kind = (submission.grants[0]?.kind ?? "plan") as GrantKind;
  const cents = Math.round(Number(price) * 100);
  const shareBps = Math.round(Number(share) * 100);
  const updating = !!submission.updates;
  const valid = (updating || (!!categoryId && !!slug)) && Number.isFinite(cents) && cents >= 0 && shareBps >= 0 && shareBps <= 9500;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-5">
        <header className="flex flex-wrap items-center gap-3">
          <Palette className="size-6 text-orange-400" />
          <h1 className="text-2xl font-semibold tracking-tight">{submission.name}</h1>
          <StatusPill tone={pending ? "warn" : submission.status === "approved" ? "good" : "bad"}>{submission.status}</StatusPill>
        </header>

        {submission.updates && (
          <Panel title={`Update to “${submission.updates.name}”`} description={`The live listing (${submission.updates.slug}) stays as it is until this is approved; approving replaces it in place — its address, sales and owners are unchanged.`}>
            <div className="space-y-3 text-sm">
              <Fields
                items={[
                  ["Name", submission.updates.name === submission.name ? "unchanged" : `${submission.updates.name} → ${submission.name}`],
                  ["Description", (submission.updates.description ?? "") === (submission.description ?? "") ? "unchanged" : "changed (below)"],
                  ["Price", `${formatMoney(submission.updates.priceCents, submission.currency, { free: true })}${submission.requestedPriceCents !== submission.updates.priceCents ? ` → asking ${formatMoney(submission.requestedPriceCents, submission.currency, { free: true })}` : " (unchanged)"}`],
                  ["Status of the listing", submission.updates.status],
                ]}
              />
              <p className="text-xs font-medium text-muted-foreground">As it is now</p>
              <SkuPreview grants={submission.updates.grants as { kind: GrantKind; payload?: string; label?: string }[]} size="md" className="min-h-48" />
            </div>
          </Panel>
        )}

        <Panel title={updating ? "As updated" : "Preview"} description="On your own avatar and profile." flush>
          <SkuPreview grants={submission.grants as { kind: GrantKind; payload?: string; label?: string }[]} size="lg" className="min-h-72" />
        </Panel>

        <CreationReview grants={submission.grants} name={submission.name} id={id} />

        <Panel title="Submission">
          <Fields
            items={[
              ["Type", GRANT_KIND_META[kind]?.label ?? kind],
              ["Description", submission.description ?? "—"],
              ["Asked price", formatMoney(submission.requestedPriceCents, submission.currency, { free: true })],
              ["Submitted", formatDate(submission.createdAt, true)],
              [
                "Creator",
                submission.creator ? (
                  <EntityLink key="c" entity={{ kind: "user", id: submission.creator.id, title: submission.creator.name, subtitle: `@${submission.creator.username}` }}>
                    @{submission.creator.username}
                  </EntityLink>
                ) : (
                  "—"
                ),
              ],
              ["Track record", `${submission.past.approved} approved · ${submission.past.rejected} rejected`],
            ]}
          />
          {submission.reviewNote && <p className="mt-3 rounded-lg bg-foreground/5 p-3 text-sm">{submission.reviewNote}</p>}
        </Panel>
      </div>

      <aside className="space-y-5">
        {pending && write ? (
          <Panel title="Decision">
            <div className="space-y-3">
              {updating && <p className="rounded-lg bg-sky-500/10 p-2 text-xs">An update to a live listing. It keeps its category, address, creator share and place in the shop.</p>}
              {!updating && <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Category</label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {(categories ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>}
              {!updating && <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
                Slug
                <Input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} className="font-mono" />
              </label>}
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                  Price ({submission.currency.toUpperCase()})
                  <Input type="number" min="0" step="0.01" value={price} disabled={!staff.can("pricing.write")} onChange={(e) => setPrice(e.target.value)} />
                </label>
                {!updating && (
                  <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                    Creator keeps (%)
                    <Input type="number" min="0" max="95" value={share} onChange={(e) => setShare(e.target.value)} />
                  </label>
                )}
              </div>
              {!updating && (
                <label className="flex items-center justify-between text-sm">
                  Feature it
                  <Switch checked={featured} onCheckedChange={setFeatured} />
                </label>
              )}
              <div className="flex gap-2 pt-1">
                <Button
                  className="flex-1"
                  disabled={!valid || busy === "approve"}
                  onClick={async () => {
                    const skuId = await run(
                      "approve",
                      () =>
                        approve(
                          updating
                            ? { submissionId, priceCents: cents }
                            : { submissionId, categoryId: categoryId as Id<"skuCategories">, slug, priceCents: cents, creatorShareBps: shareBps, featured },
                        ),
                      updating ? "Approved. The live listing is updated." : "Approved and on sale.",
                    );
                    if (skuId) open({ kind: "sku", id: skuId, title: submission.name, subtitle: "Item" }, "tab");
                  }}
                >
                  {busy === "approve" ? <Loader2 className="animate-spin" /> : <Check />} Approve
                </Button>
                <Button variant="outline" className="flex-1 text-destructive" onClick={() => setRejecting(true)}>
                  <X /> Reject
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{updating ? "Approving updates the live listing and brings owners' copies up to date. Rejecting leaves the listing as it is and tells the creator why." : "Approving puts it on sale straight away. Rejecting tells the creator why."}</p>
            </div>
          </Panel>
        ) : (
          <Panel title="Decision">
            <p className="text-sm text-muted-foreground">
              {pending ? "You can read submissions but not decide them." : `This was ${submission.status}.`}
            </p>
            {submission.sku && (
              <Button
                variant="outline"
                className="mt-3 w-full"
                onClick={() => open({ kind: "sku", id: submission.sku!.id, title: submission.name, subtitle: "Item" }, "tab")}
              >
                Open the item
              </Button>
            )}
          </Panel>
        )}
      </aside>

      <ReasonDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title="Reject this submission?"
        description="The creator sees what you write, so say what to fix."
        confirmLabel="Reject"
        destructive
        placeholder="What needs to change"
        onConfirm={(note) => reject({ submissionId, note })}
      />
    </div>
  );
}
