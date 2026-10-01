import type { Metadata } from "next";
import { Suspense } from "react";
import Workspace, { WorkspaceLoading } from "@/components/pilot/workspace";

export const metadata: Metadata = {
  title: "Workspace — VECTOR",
  description: "Persistent task briefs, invited operators, reference verification and a recorded review trail.",
};

export default function WorkspacePage() {
  return <Suspense fallback={<WorkspaceLoading />}><Workspace /></Suspense>;
}
