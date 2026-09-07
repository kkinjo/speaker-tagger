import { NextResponse } from "next/server";
import { kv, keys } from "@/lib/kv";
import { currentUser } from "@/lib/auth";
import { DEFAULT_SETTINGS, type UserSettings } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const patch = (await req.json()) as Partial<UserSettings>;
  const next: UserSettings = { ...DEFAULT_SETTINGS, ...user.settings };

  if (typeof patch.fontSize === "number") {
    next.fontSize = Math.min(32, Math.max(11, Math.round(patch.fontSize)));
  }
  if (patch.paneMode === "left" || patch.paneMode === "right" || patch.paneMode === "both") {
    next.paneMode = patch.paneMode;
  }
  if (typeof patch.playbackRate === "number") {
    next.playbackRate = Math.min(2, Math.max(0.5, patch.playbackRate));
  }
  if (typeof patch.followPlayback === "boolean") {
    next.followPlayback = patch.followPlayback;
  }
  if (typeof patch.syncScroll === "boolean") {
    next.syncScroll = patch.syncScroll;
  }

  await kv.set(keys.user(user.id), { ...user, settings: next });
  return NextResponse.json({ settings: next });
}
