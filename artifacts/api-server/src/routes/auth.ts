import { Router } from "express";
import { createOAuth2Client, getAuthUrl, getRedirectUri } from "../lib/google";
import { logger } from "../lib/logger";

const router = Router();

router.get("/auth/google", (req, res) => {
  try {
    const oauth2Client = createOAuth2Client();
    const url = getAuthUrl(oauth2Client);
    res.json({ url });
  } catch (err) {
    req.log.error({ err }, "Failed to generate Google auth URL");
    res.status(500).json({ error: "Failed to initiate Google auth" });
  }
});

router.get("/auth/google/callback", async (req, res) => {
  const { code } = req.query as { code?: string };

  if (!code) {
    return res.redirect("/?error=no_code");
  }

  try {
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Fetch user info
    const { google } = await import("googleapis");
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    req.session.googleAccessToken = tokens.access_token ?? undefined;
    req.session.googleRefreshToken = tokens.refresh_token ?? undefined;
    req.session.googleTokenExpiry = tokens.expiry_date ?? undefined;
    req.session.userEmail = userInfo.email ?? undefined;
    req.session.userName = userInfo.name ?? undefined;
    req.session.userPicture = userInfo.picture ?? undefined;

    res.redirect("/?auth=success");
  } catch (err) {
    logger.error({ err }, "Google OAuth callback failed");
    res.redirect("/?error=auth_failed");
  }
});

router.get("/auth/me", (req, res) => {
  if (!req.session.googleAccessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  res.json({
    name: req.session.userName ?? "Unknown",
    email: req.session.userEmail ?? "",
    picture: req.session.userPicture ?? null,
  });
});

router.post("/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      req.log.error({ err }, "Failed to destroy session");
      return res.status(500).json({ error: "Logout failed" });
    }
    res.json({ success: true });
  });
});

export default router;
