import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  redirect((await currentUserId()) ? "/projects" : "/login");
}
