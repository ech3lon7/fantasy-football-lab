import { it, expect, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cloudClient, signOutFantasy } from "../src/sync/client";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

it("uses an app-specific, project-specific session store", () => {
  cloudClient({ url: "https://sharedproject.supabase.co", key: "public-key" });
  expect(createClient).toHaveBeenLastCalledWith(
    "https://sharedproject.supabase.co",
    "public-key",
    {
      auth: {
        storageKey: "fantasy-lab-sharedproject.supabase.co-auth",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    },
  );
});

it("revokes only Fantasy's session and reports sign-out failures", async () => {
  const signOut = vi.fn().mockResolvedValue({ error: null });
  const client = { auth: { signOut } } as unknown as SupabaseClient;
  await signOutFantasy(client);
  expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  signOut.mockResolvedValue({ error: new Error("offline") });
  await expect(signOutFantasy(client)).rejects.toThrow("offline");
});
