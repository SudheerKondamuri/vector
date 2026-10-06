import { handlePilotRequest } from "../../../../lib/pilot-server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handlePilotRequest;
export const POST = handlePilotRequest;
export const PATCH = handlePilotRequest;
export const DELETE = handlePilotRequest;
export const PUT = handlePilotRequest;
