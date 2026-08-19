export async function GET() {
  return Response.json({
    ok: true,
    service: "misscan-email-api",
    route: "/api/ping",
    timestamp: new Date().toISOString()
  });
}
