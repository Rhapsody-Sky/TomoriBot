import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Client } from "discord.js";
import { assertGuildAccess, getSharedGuilds } from "@/web/dashboard/auth";
import type { DashboardGuildSnapshot } from "@/web/dashboard/types";
import type { DashboardSession } from "@/web/dashboard/types";

const originalFetch = globalThis.fetch;
const emptyCore = { loadGuildSnapshot: async () => null };

function createSession(): DashboardSession {
  const now = Date.now();
  return {
    id: "session",
    user: {
      id: "987654321098765432",
      username: "Dashboard user",
    },
    accessToken: "access-token",
    tokenExpiresAt: now + 60_000,
    csrfToken: "csrf",
    createdAt: now,
    expiresAt: now + 60_000,
  };
}

function createClient(): Client {
  return {
    guilds: {
      cache: new Map([
        [
          "123456789012345678",
          {
            memberCount: 7,
          },
        ],
      ]),
    },
  } as unknown as Client;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("dashboard Discord guild cache", () => {
  it("coalesces concurrent OAuth guild refreshes for one session", async () => {
    const fetchMock = mock(async () =>
      Response.json([
        {
          id: "123456789012345678",
          name: "Test server",
          owner: true,
          permissions: "0",
        },
      ]),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const session = createSession();

    const [first, second] = await Promise.all([
      getSharedGuilds(session, createClient(), emptyCore),
      getSharedGuilds(session, createClient(), emptyCore),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first[0]).toMatchObject({
      id: "123456789012345678",
      canManage: true,
      memberCount: 7,
    });
  });

  it("uses a recently verified guild list when Discord rate-limits the refresh", async () => {
    const fetchMock = mock(async () => new Response("rate limited", { status: 429 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const session = createSession();
    const cachedGuilds = [
      {
        id: "123456789012345678",
        name: "Test server",
        iconUrl: null,
        memberCount: 7,
        canManage: true,
      },
    ];
    session.guildCache = {
      fetchedAt: Date.now() - 2 * 60 * 1000,
      guilds: cachedGuilds,
    };

    await expect(getSharedGuilds(session, createClient(), emptyCore)).resolves.toBe(cachedGuilds);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("only discovers and grants management of the signed-in user's DM workspace", async () => {
    globalThis.fetch = mock(async () => Response.json([])) as unknown as typeof fetch;
    const session = createSession();
    const core = {
      loadGuildSnapshot: mock(async (id: string) => ({ serverDiscordId: id }) as DashboardGuildSnapshot),
    };
    const spaces = await getSharedGuilds(session, createClient(), core);
    expect(core.loadGuildSnapshot.mock.calls).toEqual([[session.user.id]]);
    expect(spaces).toMatchObject([{ id: session.user.id, isDirectMessage: true, canManage: true }]);
    expect(await assertGuildAccess(session, createClient(), session.user.id, core, true)).not.toBeNull();
    expect(await assertGuildAccess(session, createClient(), "111111111111111111", core, true)).toBeNull();
  });

  it("does not offer an uninitialized DM workspace", async () => {
    globalThis.fetch = mock(async () => Response.json([])) as unknown as typeof fetch;
    expect(await getSharedGuilds(createSession(), createClient(), emptyCore)).toEqual([]);
  });
});
