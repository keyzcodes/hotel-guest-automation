// All browser traffic uses the frontend origin. The server proxies it to the backend.
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, { ...init, credentials: "same-origin" });
  if (response.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event("hotel-session-expired"));
  }
  return response;
}
