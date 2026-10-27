"use client";

import { api } from "../../../convex/_generated/api";
import { DmConversationRow, DmListSkeleton } from "@/components/home/dm-conversation-row";
import { useNavigation } from "@/components/home/navigation-context";
import { NewDmDialog } from "@/components/home/new-dm-dialog";
import { useTabs } from "@/components/home/tabs-context";
import { SidebarSectionHeader } from "@/components/sidebar/sidebar-section";
import { useCachedQuery } from "@/hooks/use-cached-query";

/**
 * Direct messages and group chats — the same list, and the same rows, as the
 * home page's, newest first with pinned ones on top.
 */
export function DmSection() {
  const nav = useNavigation();
  const { activeTab } = useTabs();
  const conversations = useCachedQuery(
    api.conversations.listMine,
    {},
    "conversations.listMine",
  );
  const target = activeTab.target;
  const activeId = target.type === "dm" ? target.conversationId : null;

  return (
    <section className="flex flex-col gap-1">
      <SidebarSectionHeader
        title="Direct messages"
        action={<NewDmDialog onCreated={nav.openConversation} />}
      />
      <div className="flex flex-col gap-0.5">
        {conversations === undefined ? (
          <DmListSkeleton />
        ) : conversations.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            No conversations yet.
          </p>
        ) : (
          conversations.map((conversation: any) => (
            <DmConversationRow
              key={conversation.id}
              conversation={conversation}
              active={conversation.id === activeId}
              onSelect={nav.openConversation}
            />
          ))
        )}
      </div>
    </section>
  );
}
