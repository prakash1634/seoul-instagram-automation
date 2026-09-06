import express from "express";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();

app.use(express.json({ limit: "20mb" }));

/* =========================
   SERVER
========================= */

app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/index.html");
});

app.use(express.static(process.cwd()));

const PORT = process.env.PORT || 3000;

const BASE =
  process.env.PUBLIC_BASE_URL ||
  `http://localhost:${PORT}`;

const REDIRECT =
  process.env.META_REDIRECT_URI ||
  `${BASE}/auth/instagram/callback`;

const GRAPH_VERSION =
  process.env.INSTAGRAM_GRAPH_VERSION || "v25.0";

const GRAPH_BASE =
  `https://graph.instagram.com/${GRAPH_VERSION}`;


/* =========================
   MEMORY STORAGE
========================= */

const sessions = new Map();

const OAUTH_STATE_SECRET =
  process.env.META_APP_SECRET ||
  "temporary-secret-change-this";


/* =========================
   HELPERS
========================= */

function requireEnv(name) {
  if (
    !process.env[name] ||
    process.env[name].startsWith("YOUR_")
  ) {
    throw new Error(
      `${name} is not configured in Render Environment Variables.`
    );
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}


/* =========================
   OAUTH STATE
   Does NOT depend on memory
========================= */

function createOAuthState() {
  const timestamp = Date.now().toString();

  const signature = crypto
    .createHmac(
      "sha256",
      OAUTH_STATE_SECRET
    )
    .update(timestamp)
    .digest("hex");

  return `${timestamp}.${signature}`;
}

function verifyOAuthState(state) {
  try {
    const parts =
      String(state).split(".");

    if (parts.length !== 2) {
      return false;
    }

    const timestamp = parts[0];
    const signature = parts[1];

    const age =
      Date.now() - Number(timestamp);

    if (
      !Number.isFinite(age) ||
      age < 0 ||
      age > 10 * 60 * 1000
    ) {
      return false;
    }

    const expected =
      crypto
        .createHmac(
          "sha256",
          OAUTH_STATE_SECRET
        )
        .update(timestamp)
        .digest("hex");

    if (
      signature.length !==
      expected.length
    ) {
      return false;
    }

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );

  } catch {
    return false;
  }
}


/* =========================
   SESSION
========================= */

const SESSION_COOKIE =
  "ig_session";

function getCookie(req, name) {
  const header =
    req.headers.cookie || "";

  const cookies =
    header.split(";");

  for (const item of cookies) {
    const index =
      item.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key =
      item
        .slice(0, index)
        .trim();

    const value =
      item
        .slice(index + 1)
        .trim();

    if (key === name) {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }

  return null;
}

function getSessionId(req) {
  return (
    getCookie(
      req,
      SESSION_COOKIE
    ) ||
    req.body?.sessionId ||
    req.query?.sessionId ||
    null
  );
}

function getSession(req) {
  const sessionId =
    getSessionId(req);

  if (!sessionId) {
    return null;
  }

  const session =
    sessions.get(sessionId);

  if (!session) {
    return null;
  }

  return {
    id: sessionId,
    ...session
  };
}

function createSession(data) {
  const sessionId =
    crypto.randomBytes(32).toString("hex");

  sessions.set(
    sessionId,
    {
      ...data,
      created_at: Date.now()
    }
  );

  return sessionId;
}

function deleteSession(sessionId) {
  if (sessionId) {
    sessions.delete(sessionId);
  }
}


/* =========================
   BASIC API STATUS
========================= */

app.get(
  "/api/status",
  (req, res) => {

    res.json({
      ok: true,
      instagram_sessions:
        sessions.size,
      graph_version:
        GRAPH_VERSION,
      redirect_uri:
        REDIRECT
    });
  }
);


/* =========================
   INSTAGRAM STATUS
========================= */

app.get(
  "/api/instagram/status",
  async (req, res) => {

    try {

      const session =
        getSession(req);

      if (!session) {

        return res.json({
          ok: true,
          connected: false,
          message:
            "Instagram is not connected."
        });
      }

      const url =
        `${GRAPH_BASE}/${session.user_id}` +
        `?fields=id,username` +
        `&access_token=${encodeURIComponent(
          session.access_token
        )}`;

      const response =
        await fetch(url);

      const data =
        await response.json();

      if (!response.ok) {

        deleteSession(
          session.id
        );

        return res.status(401).json({
          ok: false,
          connected: false,
          error: data
        });
      }

      res.json({
        ok: true,
        connected: true,
        instagram: data
      });

    } catch (error) {

      res.status(500).json({
        ok: false,
        connected: false,
        error:
          error.message
      });
    }
  }
);


/* =========================
   START INSTAGRAM LOGIN
========================= */

app.get(
  "/auth/instagram",
  (req, res) => {

    try {

      requireEnv(
        "META_APP_ID"
      );

      const state =
        createOAuthState();

      const scopes =
        process.env.INSTAGRAM_SCOPES ||
        [
          "instagram_business_basic",
          "instagram_business_content_publish"
        ].join(",");

      const url =
        new URL(
          "https://www.instagram.com/oauth/authorize"
        );

      url.searchParams.set(
        "client_id",
        process.env.META_APP_ID
      );

      url.searchParams.set(
        "redirect_uri",
        REDIRECT
      );

      url.searchParams.set(
        "response_type",
        "code"
      );

      url.searchParams.set(
        "scope",
        scopes
      );

      url.searchParams.set(
        "state",
        state
      );

      res.redirect(
        url.toString()
      );

    } catch (error) {

      res.status(500).send(`
        <h2>Instagram setup required</h2>
        <p>${escapeHtml(
          error.message
        )}</p>
      `);
    }
  }
);


/* =========================
   INSTAGRAM CALLBACK
========================= */

app.get(
  "/auth/instagram/callback",
  async (req, res) => {

    const {
      code,
      state,
      error,
      error_reason
    } = req.query;


    /* Authorization error */

    if (error) {

      return res.status(400).send(`
        <h2>Instagram authorization failed</h2>
        <p>${escapeHtml(
          error_reason || error
        )}</p>
      `);
    }


    /* State validation */

    if (
      !state ||
      !verifyOAuthState(state)
    ) {

      return res.status(400).send(`
        <h2>Invalid OAuth state</h2>
        <p>
          The Instagram login session expired or
          the authorization request was not created
          by this application.
        </p>
        <p>
          Please return to the dashboard and click
          <b>Connect Instagram</b> again.
        </p>
      `);
    }


    /* Code check */

    if (!code) {

      return res.status(400).send(
        "No authorization code returned."
      );
    }


    try {

      requireEnv(
        "META_APP_ID"
      );

      requireEnv(
        "META_APP_SECRET"
      );


      /* =========================
         EXCHANGE CODE FOR TOKEN
      ========================= */

      const body =
        new URLSearchParams({
          client_id:
            process.env.META_APP_ID,

          client_secret:
            process.env.META_APP_SECRET,

          grant_type:
            "authorization_code",

          redirect_uri:
            REDIRECT,

          code
        });


      const response =
        await fetch(
          "https://api.instagram.com/oauth/access_token",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded"
            },

            body
          }
        );


      const data =
        await response.json();


      if (
        !response.ok ||
        !data.access_token ||
        !data.user_id
      ) {

        return res.status(400).send(`
          <h2>Instagram token exchange failed</h2>

          <p>
            Check Meta/Instagram configuration.
          </p>

          <pre>${escapeHtml(
            JSON.stringify(
              data,
              null,
              2
            )
          )}</pre>
        `);
      }


      /* =========================
         CREATE LOGIN SESSION
      ========================= */

      const sessionId =
        createSession({
          access_token:
            data.access_token,

          user_id:
            data.user_id
        });


      /* =========================
         SECURE COOKIE
      ========================= */

      res.setHeader(
        "Set-Cookie",
        `${SESSION_COOKIE}=${encodeURIComponent(
          sessionId
        )}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`
      );


      /* =========================
         RETURN TO DASHBOARD
      ========================= */

      res.send(`
        <!doctype html>

        <html>

        <head>
          <meta charset="utf-8">
          <title>
            Instagram Connected
          </title>
        </head>

        <body>

          <script>

            localStorage.setItem(
              "ig_session",
              ${JSON.stringify(
                sessionId
              )}
            );

            window.location.replace(
              "/?connected=1"
            );

          </script>

          <p>
            Instagram connected.
            Returning to dashboard...
          </p>

        </body>

        </html>
      `);

    } catch (error) {

      res.status(500).send(`
        <h2>Instagram connection error</h2>

        <pre>${escapeHtml(
          error.message
        )}</pre>
      `);
    }
  }
);


/* =========================
   DISCONNECT
========================= */

app.post(
  "/api/disconnect",
  (req, res) => {

    const sessionId =
      getSessionId(req);

    deleteSession(
      sessionId
    );

    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
    );

    res.json({
      ok: true,
      connected: false
    });
  }
);


/* =========================
   CAMPAIGN PLAN
========================= */

app.post(
  "/api/generate-plan",
  (req, res) => {

    const {
      prompt,
      angles = 6
    } = req.body;

    res.json({

      prompt:
        prompt ||
        "Korean Seoul luxury fashion editorial",

      angles,

      steps: [
        "Generate hero fashion image",
        "Create controlled fashion angles",
        "Create 10 second fashion reel",
        "Generate caption and hashtags",
        "Prepare Instagram publishing"
      ],

      status:
        "planned"
    });
  }
);


/* =========================
   PUBLISH IMAGE
========================= */

app.post(
  "/api/publish-image",
  async (req, res) => {

    try {

      const session =
        getSession(req);


      if (!session) {

        return res.status(401).json({
          ok: false,
          connected: false,
          error:
            "Instagram is not connected."
        });
      }


      const {
        image_url,
        caption = ""
      } = req.body;


      if (!image_url) {

        return res.status(400).json({
          ok: false,
          error:
            "image_url is required."
        });
      }


      if (
        !image_url.startsWith(
          "https://"
        )
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "Image URL must be public HTTPS."
        });
      }


      /* CREATE MEDIA */

      const createUrl =
        `${GRAPH_BASE}/${session.user_id}/media`;

      const createBody =
        new URLSearchParams();

      createBody.set(
        "image_url",
        image_url
      );

      createBody.set(
        "caption",
        caption
      );

      createBody.set(
        "access_token",
        session.access_token
      );


      const createResponse =
        await fetch(
          createUrl,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded"
            },

            body: createBody
          }
        );


      const createData =
        await createResponse.json();


      if (
        !createResponse.ok ||
        !createData.id
      ) {

        return res.status(400).json({
          ok: false,
          step:
            "create_media",
          error:
            createData
        });
      }


      /* PUBLISH */

      const publishUrl =
        `${GRAPH_BASE}/${session.user_id}/media_publish`;

      const publishBody =
        new URLSearchParams();

      publishBody.set(
        "creation_id",
        createData.id
      );

      publishBody.set(
        "access_token",
        session.access_token
      );


      const publishResponse =
        await fetch(
          publishUrl,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded"
            },

            body: publishBody
          }
        );


      const publishData =
        await publishResponse.json();


      if (
        !publishResponse.ok
      ) {

        return res.status(400).json({
          ok: false,
          step:
            "publish_media",

          container_id:
            createData.id,

          error:
            publishData
        });
      }


      res.json({

        ok: true,

        message:
          "Instagram post published successfully.",

        container_id:
          createData.id,

        media_id:
          publishData.id

      });

    } catch (error) {

      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);


/* =========================
   PUBLISH REEL
========================= */

app.post(
  "/api/publish-reel",
  async (req, res) => {

    try {

      const session =
        getSession(req);


      if (!session) {

        return res.status(401).json({
          ok: false,
          connected: false,
          error:
            "Instagram is not connected."
        });
      }


      const {
        video_url,
        caption = ""
      } = req.body;


      if (!video_url) {

        return res.status(400).json({
          ok: false,
          error:
            "video_url is required."
        });
      }


      if (
        !video_url.startsWith(
          "https://"
        )
      ) {

        return res.status(400).json({
          ok: false,
          error:
            "Video URL must be public HTTPS."
        });
      }


      /* CREATE REEL CONTAINER */

      const createUrl =
        `${GRAPH_BASE}/${session.user_id}/media`;

      const body =
        new URLSearchParams();

      body.set(
        "media_type",
        "REELS"
      );

      body.set(
        "video_url",
        video_url
      );

      body.set(
        "caption",
        caption
      );

      body.set(
        "access_token",
        session.access_token
      );


      const response =
        await fetch(
          createUrl,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded"
            },

            body
          }
        );


      const data =
        await response.json();


      if (
        !response.ok ||
        !data.id
      ) {

        return res.status(400).json({
          ok: false,
          step:
            "create_reel",
          error:
            data
        });
      }


      const containerId =
        data.id;


      /* WAIT FOR PROCESSING */

      let statusData =
        null;

      for (
        let attempt = 0;
        attempt < 12;
        attempt++
      ) {

        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              5000
            )
        );


        const statusUrl =
          `${GRAPH_BASE}/${containerId}` +
          `?fields=status_code,status` +
          `&access_token=${encodeURIComponent(
            session.access_token
          )}`;


        const statusResponse =
          await fetch(
            statusUrl
          );


        statusData =
          await statusResponse.json();


        if (
          statusData.status_code ===
          "FINISHED"
        ) {
          break;
        }


        if (
          statusData.status_code ===
            "ERROR" ||
          statusData.status_code ===
            "EXPIRED"
        ) {

          return res.status(400).json({
            ok: false,
            step:
              "reel_processing",

            container_id:
              containerId,

            status:
              statusData
          });
        }
      }


      /* STILL PROCESSING */

      if (
        !statusData ||
        statusData.status_code !==
          "FINISHED"
      ) {

        return res.status(202).json({

          ok: true,

          processing: true,

          container_id:
            containerId,

          status:
            statusData,

          message:
            "Instagram is still processing the Reel."
        });
      }


      /* PUBLISH REEL */

      const publishUrl =
        `${GRAPH_BASE}/${session.user_id}/media_publish`;

      const publishBody =
        new URLSearchParams();

      publishBody.set(
        "creation_id",
        containerId
      );

      publishBody.set(
        "access_token",
        session.access_token
      );


      const publishResponse =
        await fetch(
          publishUrl,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded"
            },

            body: publishBody
          }
        );


      const publishData =
        await publishResponse.json();


      if (
        !publishResponse.ok
      ) {

        return res.status(400).json({
          ok: false,
          step:
            "publish_reel",

          container_id:
            containerId,

          error:
            publishData
        });
      }


      res.json({

        ok: true,

        message:
          "Instagram Reel published successfully.",

        container_id:
          containerId,

        media_id:
          publishData.id

      });

    } catch (error) {

      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);


/* =========================
   PLACEHOLDER
========================= */

app.post(
  "/api/publish-placeholder",
  async (req, res) => {

    if (req.body?.image_url) {

      return res.status(400).json({
        ok: false,

        message:
          "Use /api/publish-image for Instagram image publishing."
      });
    }

    res.status(400).json({

      ok: false,

      message:
        "Instagram publishing requires a public HTTPS image URL and caption."
    });
  }
);


/* =========================
   START
========================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Seoul Instagram Automation running on port ${PORT}`
    );

    console.log(
      `Instagram Redirect URI: ${REDIRECT}`
    );
  }
);
