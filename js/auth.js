// ── ThinkHere — Cognito Hosted UI Integration ──
// Fill in these values after setting up your Cognito User Pool

const AUTH_CONFIG = {
  // AWS Cognito User Pool settings
  userPoolId: "us-east-1_LSizPNStx",
  clientId: "21r4hda7dvc55rktfpmuj78ife",
  cognitoDomain: "thinkhere.auth.us-east-1.amazoncognito.com",
  region: "us-east-1",

  // Redirect URIs (must match Cognito App Client settings)
  signInRedirectUri: "https://thinkhere.ai/",
  signOutRedirectUri: "https://thinkhere.ai/",

  // Where authenticated users go
  appUrl: "https://app.thinkhere.ai",

  // OAuth scopes
  scopes: ["openid", "email", "profile"],
};

// ── Build Cognito Hosted UI URLs ──
function getSignInUrl() {
  const params = new URLSearchParams({
    client_id: AUTH_CONFIG.clientId,
    response_type: "token",
    scope: AUTH_CONFIG.scopes.join(" "),
    redirect_uri: AUTH_CONFIG.signInRedirectUri,
  });
  return `https://${AUTH_CONFIG.cognitoDomain}/login?${params}`;
}

function getSignUpUrl() {
  const params = new URLSearchParams({
    client_id: AUTH_CONFIG.clientId,
    response_type: "token",
    scope: AUTH_CONFIG.scopes.join(" "),
    redirect_uri: AUTH_CONFIG.signInRedirectUri,
  });
  return `https://${AUTH_CONFIG.cognitoDomain}/signup?${params}`;
}

function getSignOutUrl() {
  const params = new URLSearchParams({
    client_id: AUTH_CONFIG.clientId,
    logout_uri: AUTH_CONFIG.signOutRedirectUri,
  });
  return `https://${AUTH_CONFIG.cognitoDomain}/logout?${params}`;
}

// ── Token Handling ──
function parseTokensFromHash() {
  const hash = window.location.hash.substring(1);
  if (!hash) return null;

  const params = new URLSearchParams(hash);
  const idToken = params.get("id_token");
  const accessToken = params.get("access_token");
  const expiresIn = params.get("expires_in");

  if (!idToken || !accessToken) return null;

  return {
    idToken,
    accessToken,
    expiresIn: parseInt(expiresIn || "3600", 10),
    timestamp: Date.now(),
  };
}

function parseJwtPayload(token) {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

function storeTokens(tokens) {
  sessionStorage.setItem("thinkhere_tokens", JSON.stringify(tokens));
}

function getStoredTokens() {
  try {
    const raw = sessionStorage.getItem("thinkhere_tokens");
    if (!raw) return null;
    const tokens = JSON.parse(raw);

    // Check expiration
    const elapsed = (Date.now() - tokens.timestamp) / 1000;
    if (elapsed >= tokens.expiresIn) {
      sessionStorage.removeItem("thinkhere_tokens");
      return null;
    }

    return tokens;
  } catch {
    return null;
  }
}

function clearTokens() {
  sessionStorage.removeItem("thinkhere_tokens");
}

// ── Auth Actions (exposed to HTML) ──
window.signIn = function () {
  window.location.href = getSignInUrl();
};

window.signUp = function () {
  window.location.href = getSignUpUrl();
};

window.signOut = function () {
  clearTokens();
  window.location.href = getSignOutUrl();
};

// ── Callback Handler ──
// Called on page load — checks if we're returning from Cognito with tokens
function handleAuthCallback() {
  // Check for tokens in URL hash (Cognito implicit grant callback)
  const tokens = parseTokensFromHash();
  if (tokens) {
    storeTokens(tokens);

    // Clean the URL
    window.history.replaceState(null, "", window.location.pathname);

    // Redirect to the authenticated app with the token
    const payload = parseJwtPayload(tokens.idToken);
    const email = payload?.email || "";
    console.log(`Authenticated as ${email}, redirecting to app...`);

    // Pass token to app.thinkhere.ai via URL fragment
    window.location.href = `${AUTH_CONFIG.appUrl}/#id_token=${tokens.idToken}&access_token=${tokens.accessToken}`;
    return true;
  }

  return false;
}

// ── Check if user is already authenticated ──
function isAuthenticated() {
  return getStoredTokens() !== null;
}

function getAuthenticatedUser() {
  const tokens = getStoredTokens();
  if (!tokens) return null;
  const payload = parseJwtPayload(tokens.idToken);
  return {
    email: payload?.email || "",
    sub: payload?.sub || "",
  };
}

// ── Init: handle callback or update UI ──
(function () {
  // If this is a callback from Cognito, handle it
  if (window.location.hash.includes("id_token")) {
    if (handleAuthCallback()) return; // Redirecting to app
  }

  // If user is already authenticated, show "Go to App" instead of sign in
  if (isAuthenticated()) {
    const user = getAuthenticatedUser();
    const signInBtn = document.getElementById("signInBtn");
    const createAccountBtn = document.getElementById("createAccountBtn");

    if (signInBtn && user) {
      signInBtn.textContent = "Open App";
      signInBtn.onclick = () => {
        const tokens = getStoredTokens();
        window.location.href = `${AUTH_CONFIG.appUrl}/#id_token=${tokens.idToken}&access_token=${tokens.accessToken}`;
      };
    }
    if (createAccountBtn) {
      createAccountBtn.style.display = "none";
    }
  }
})();
