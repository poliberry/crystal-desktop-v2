import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { STATUS_DOT_CLASS, STATUS_LABEL, type FriendStatus } from "@/lib/presence";
import { cn } from "@/lib/utils";

interface FriendRowProps {
  name: string;
  username: string;
  imageUrl?: string;
  status?: FriendStatus;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function FriendRow({ name, username, imageUrl, status, subtitle, actions }: FriendRowProps) {
  return (
    <div className="group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/60">
      <Avatar>
        <AvatarImage src={imageUrl} alt={name} />
        <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
        {status && <AvatarBadge className={cn(STATUS_DOT_CLASS[status])} />}
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {subtitle ?? (status ? STATUS_LABEL[status] : `@${username}`)}
        </p>
      </div>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </div>
  );
}
