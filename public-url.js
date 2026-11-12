function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized.endsWith(".localhost")
    || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

export function resolveFriendsPublicUrl({
  friendsPublicUrl,
  railwayPublicDomain,
  clientOrigins,
  isProduction,
  discordEnabled
}) {
  const candidates = [
    friendsPublicUrl,
    railwayPublicDomain ? `https://${railwayPublicDomain.replace(/^https?:\/\//i, "")}` : "",
    ...clientOrigins
  ].filter(Boolean);

  for (const candidate of candidates) {
    let url;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
    if (isProduction && (url.protocol !== "https:" || isLoopbackHostname(url.hostname))) continue;
    return url.origin;
  }
  if (discordEnabled) {
    throw new Error("Set FRIENDS_PUBLIC_URL to the deployed HTTPS site URL, or enable the Railway public domain.");
  }
  return clientOrigins[0];
}
