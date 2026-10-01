import { redirect } from "next/navigation";
import VectorApp from "@/components/vector-app";

export default async function ArenaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  if (query.view === "agents") redirect("/agents");
  if (query.view === "evidence") redirect("/escrows");
  return <VectorApp initialCreate={query.create === "1"} />;
}
