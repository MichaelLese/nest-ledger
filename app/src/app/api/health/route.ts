// Process liveness only; integrations are introduced in later phases.
export function GET() {
  return Response.json({ status: "ok" });
}
