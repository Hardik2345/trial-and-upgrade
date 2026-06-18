let accessToken = "";

const baseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export function setAccessToken(token) {
  accessToken = token || "";
}

export function getAccessToken() {
  return accessToken;
}

async function refreshAccessToken() {
  const response = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" }
  });
  if (!response.ok) {
    setAccessToken("");
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Session expired");
  }
  const data = await response.json();
  setAccessToken(data.accessToken);
  return data;
}

function shouldRefreshAuth(path, options, response) {
  if (response.status !== 401 || options.skipAuthRefresh) return false;
  return !["/api/auth/login", "/api/auth/logout", "/api/auth/refresh"].includes(path);
}

async function request(path, options = {}) {
  const { skipAuthRefresh, ...fetchOptions } = options;
  const response = await fetch(`${baseUrl}${path}`, {
    ...fetchOptions,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(fetchOptions.headers || {})
    }
  });
  return response;
}

export async function apiFetch(path, options = {}) {
  let response = await request(path, options);
  if (shouldRefreshAuth(path, options, response)) {
    await refreshAccessToken();
    response = await request(path, { ...options, skipAuthRefresh: true });
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

export async function downloadCsv(path, filename) {
  let response = await fetch(`${baseUrl}${path}`, {
    credentials: "include",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  });
  if (response.status === 401) {
    await refreshAccessToken();
    response = await fetch(`${baseUrl}${path}`, {
      credentials: "include",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
    });
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Download failed: ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function login(email, password) {
  const data = await apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  setAccessToken(data.accessToken);
  return data;
}

export async function logout() {
  await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  setAccessToken("");
}
