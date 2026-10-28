"use client";

import { useMutation, useQuery } from "convex/react";
import { Mail } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import { SettingRow } from "@/components/settings/settings-ui";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/errors";

/** "Email me when support or our team replies" — shared by the Support and Reports tabs. */
export function EmailUpdatesToggle({ what }: { what: string }) {
  const preference = useQuery(api.support.emailPreference);
  const setPreference = useMutation(api.support.setEmailPreference);
  if (!preference) return null;

  return (
    <SettingRow
      icon={Mail}
      title="Email me about replies"
      description={
        preference.hasAddress
          ? `We'll email you when ${what}. You can always read it here.`
          : "Add and verify an email address in Account to get these by email. You can always read them here."
      }
    >
      <Switch
        checked={preference.enabled}
        disabled={!preference.hasAddress}
        onCheckedChange={(enabled) => void setPreference({ enabled }).catch((e) => toast.error(errorMessage(e)))}
      />
    </SettingRow>
  );
}
