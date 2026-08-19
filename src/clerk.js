const AUTH = () => (process.env.SUNO_AUTH_BASE || "https://auth.suno.com").replace(/\/$/, "");

export async function sessionJwt(cookie) {
  const clientUrl =
    `${AUTH()}/v1/client?__clerk_api_version=2025-11-10&_clerk_js_version=5.117.0`;
  const clientRes = await fetch(clientUrl, {
    headers: {
      Cookie: cookie,
      Origin: "https://suno.com",
      Referer: "https://suno.com/",
    },
  });
  const clientText = await clientRes.text();
  if (!clientRes.ok) {
    throw new Error(`Clerk client ${clientRes.status}: ${clientText.slice(0, 180)}`);
  }
  let client;
  try {
    client = JSON.parse(clientText);
  } catch {
    throw new Error("Clerk client was not JSON — cookie likely expired");
  }
  const session =
    client?.response?.sessions?.[0] ??
    client?.sessions?.[0] ??
    client?.response?.last_active_session_id;
  const sessionId =
    typeof session === "string" ? session : session?.id ?? client?.response?.last_active_session_id;
  if (!sessionId) throw new Error("No Clerk session on this cookie. Sign in at suno.com and copy again.");

  const tokenRes = await fetch(`${AUTH()}/v1/client/sessions/${sessionId}/tokens`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: "https://suno.com",
      Referer: "https://suno.com/",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const tokenText = await tokenRes.text();
  if (!tokenRes.ok) {
    throw new Error(`Clerk token ${tokenRes.status}: ${tokenText.slice(0, 180)}`);
  }
  let tokenBody;
  try {
    tokenBody = JSON.parse(tokenText);
  } catch {
    throw new Error("Clerk token was not JSON");
  }
  const jwt = tokenBody?.jwt ?? tokenBody?.response?.jwt;
  if (!jwt) throw new Error("Clerk did not return a jwt");

  const user =
    client?.response?.user ??
    session?.user ??
    client?.response?.sessions?.[0]?.user ??
    {};
  return {
    jwt,
    sessionId,
    email: user.primary_email_address_id ? String(user.primary_email_address_id) : null,
    name: [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || null,
  };
}
