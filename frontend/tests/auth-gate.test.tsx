import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "@/components/auth/AuthGate";
import { resolveBase } from "@/lib/api/backend/client";
import { ApiError, authErrorMessage } from "@/lib/api/errors";

const mocks = vi.hoisted(() => ({ status: vi.fn(), login: vi.fn() }));
vi.mock("@/lib/api/client", () => ({
  API_MODE: "http",
  api: { getAuthStatus: mocks.status, login: mocks.login, logout: vi.fn() },
}));

afterEach(() => { cleanup(); mocks.status.mockReset(); mocks.login.mockReset(); });
const wrap = () => render(<QueryClientProvider client={new QueryClient()}><AuthGate><div>the app</div></AuthGate></QueryClientProvider>);

describe("resolveBase", () => {
  const cfg = "http://127.0.0.1:8000/api/v1";
  it("follows the page host for localhost backends", () => {
    expect(resolveBase(cfg, "192.168.1.20")).toBe("http://192.168.1.20:8000/api/v1");
    expect(resolveBase("http://localhost:8000/api/v1/", "10.0.0.5")).toBe("http://10.0.0.5:8000/api/v1");
  });
  it("keeps the configured URL on localhost, server-side, or for remote backends", () => {
    expect(resolveBase(cfg, "localhost")).toBe(cfg);
    expect(resolveBase(cfg, "127.0.0.1")).toBe(cfg);
    expect(resolveBase(cfg, undefined)).toBe(cfg);
    expect(resolveBase("https://api.example.com/api/v1", "192.168.1.20")).toBe("https://api.example.com/api/v1");
  });
});

describe("authErrorMessage", () => {
  it("explains 401, 429 and a missing PIN", () => {
    expect(authErrorMessage(new ApiError("unauthorized", "Wrong PIN", 401))).toBe("Wrong PIN");
    expect(authErrorMessage(new ApiError("unauthorized", "No PIN is set", 401))).toMatch(/set_pin/);
    expect(authErrorMessage(new ApiError("rate_limited", "x", 429, { retryAfter: 45 }))).toBe("Too many attempts. Try again in 45 seconds.");
    expect(authErrorMessage(new ApiError("rate_limited", "x", 429, { retryAfter: 600 }))).toBe("Too many attempts. Try again in 10 minutes.");
    expect(authErrorMessage(new ApiError("unavailable", "x", 0))).toMatch(/could not be reached/);
  });
});

describe("AuthGate", () => {
  it("renders the app on the host PC", async () => {
    mocks.status.mockResolvedValue({ local: true, pin_set: true, authenticated: false });
    wrap();
    expect(await screen.findByText("the app")).toBeTruthy();
  });

  it("shows the PIN screen when not authenticated and shows errors", async () => {
    mocks.status.mockResolvedValue({ local: false, pin_set: true, authenticated: false });
    mocks.login.mockRejectedValue(new ApiError("unauthorized", "Wrong PIN", 401));
    wrap();
    const input = await screen.findByLabelText("PIN");
    expect(screen.queryByText("the app")).toBeNull();
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("inputmode", "numeric");
    const user = userEvent.setup();
    await user.type(input, "12ab34");
    expect(input).toHaveValue("1234");
    expect(screen.getByRole("button", { name: /connect/i })).toBeDisabled();
    await user.type(input, "56{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong PIN");
    expect(mocks.login).toHaveBeenCalledWith("123456");
  });

  it("shows the app after unlocking", async () => {
    mocks.status.mockResolvedValueOnce({ local: false, pin_set: true, authenticated: false }).mockResolvedValue({ local: false, pin_set: true, authenticated: true });
    mocks.login.mockResolvedValue(undefined);
    wrap();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("PIN"), "123456");
    await user.click(screen.getByRole("button", { name: /connect/i }));
    await waitFor(() => expect(screen.getByText("the app")).toBeTruthy());
  });

  it("shows the This PC connect button when the This PC tab is selected", async () => {
    mocks.status.mockResolvedValue({ local: false, pin_set: true, authenticated: false });
    wrap();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "This PC" }));
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
    expect(screen.getByText(/On any other device this will not connect/)).toBeTruthy();
    expect(screen.queryByLabelText("PIN")).toBeNull();
  });

  describe("Remote tab", () => {
    const original = process.env.NEXT_PUBLIC_TUNNEL_HOST;
    afterEach(() => {
      if (original === undefined) delete process.env.NEXT_PUBLIC_TUNNEL_HOST;
      else process.env.NEXT_PUBLIC_TUNNEL_HOST = original;
    });
    const openRemote = async () => {
      mocks.status.mockResolvedValue({ local: false, pin_set: true, authenticated: false });
      wrap();
      const user = userEvent.setup();
      await user.click(await screen.findByRole("radio", { name: "Remote" }));
    };

    it("explains setup when no tunnel host is configured", async () => {
      process.env.NEXT_PUBLIC_TUNNEL_HOST = "";
      await openRemote();
      expect(screen.getByText(/Remote access is not set up yet/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
      expect(screen.queryByLabelText("PIN")).toBeNull();
    });

    it("shows the PIN form when the page is already on the tunnel host", async () => {
      process.env.NEXT_PUBLIC_TUNNEL_HOST = "localhost";
      await openRemote();
      expect(screen.getByLabelText("PIN")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
    });

    it("offers a Connect button through the tunnel when on a different host", async () => {
      process.env.NEXT_PUBLIC_TUNNEL_HOST = "tunnel.example.ts.net";
      await openRemote();
      expect(screen.getByText("Connect through your private tunnel.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
      expect(screen.queryByLabelText("PIN")).toBeNull();
    });
  });
});
