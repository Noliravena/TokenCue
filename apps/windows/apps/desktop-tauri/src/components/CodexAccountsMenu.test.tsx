import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const tauriMocks = vi.hoisted(() => ({
  getCodexAccountsState: vi.fn(),
  codexAccountSwitch: vi.fn(),
  refreshProviders: vi.fn(),
}));

vi.mock("../lib/tauri", () => tauriMocks);
vi.mock("../hooks/useLocale", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

import CodexAccountsMenu from "./CodexAccountsMenu";

function account(id: string, ambient = false) {
  return {
    id,
    nickname: null,
    emailHint: `${id}@example.com`,
    authSubject: null,
    providerAccountId: null,
    codexHomePath: `C:/codex/${id}`,
    source: ambient ? "ambient" : "managedByApp",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    lastAuthenticatedAt: null,
  } as const;
}

describe("CodexAccountsMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauriMocks.codexAccountSwitch.mockResolvedValue({});
    tauriMocks.refreshProviders.mockResolvedValue(undefined);
  });

  it("shows all accounts, masks personal info, and switches the inactive account", async () => {
    tauriMocks.getCodexAccountsState.mockResolvedValue({
      accounts: [account("active", true), account("other")],
      snapshots: {},
    });
    render(<CodexAccountsMenu hidePersonalInfo />);

    expect(await screen.findByText("a***@example.com")).toBeInTheDocument();
    expect(screen.getByText("o***@example.com")).toBeInTheDocument();

    const buttons = screen.getAllByRole("button", { name: "CodexAccountsSwitchButton" });
    fireEvent.click(buttons.find((button) => !button.hasAttribute("disabled"))!);

    await waitFor(() => expect(tauriMocks.codexAccountSwitch).toHaveBeenCalledWith("other"));
    expect(tauriMocks.refreshProviders).toHaveBeenCalledTimes(1);
  });

  it("stays hidden for a single account", async () => {
    tauriMocks.getCodexAccountsState.mockResolvedValue({
      accounts: [account("only", true)],
      snapshots: {},
    });
    const { container } = render(<CodexAccountsMenu hidePersonalInfo={false} />);
    await waitFor(() => expect(tauriMocks.getCodexAccountsState).toHaveBeenCalled());
    expect(container.querySelector(".tokencue-tray__accounts")).toBeNull();
  });
});
