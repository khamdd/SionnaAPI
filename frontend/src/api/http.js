import {
  API_BASE_URL,
  AUTH_TOKEN_STORAGE_KEY,
} from "../constants";

export async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, withAuth(options));

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return response.json();
}

export function authHeaders() {
  const token = localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);

  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

export function toApiUrl(url) {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  return `${API_BASE_URL}${url.startsWith("/") ? url : `/${url}`}`;
}

function withAuth(options = {}) {
  return {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {}),
    },
  };
}

export async function readErrorMessage(response) {
  try {
    const body = await response.json();
    const detail = body.detail || body.error || body;

    if (typeof detail === "string") {
      return detail;
    }

    if (detail?.error) {
      return detail.error;
    }
  } catch {
    // Fall through to the generic HTTP message.
  }

  return `HTTP ${response.status}`;
}
