import { redirect } from "next/navigation";
import { currentUserId, signupEnabled } from "@/lib/auth";
import AuthForm from "@/components/AuthForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentUserId()) redirect("/projects");
  return <AuthForm allowSignup={signupEnabled()} />;
}
