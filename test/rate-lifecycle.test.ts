import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
type Entry = {
  type: "message";
  message: { role: "assistant"; usage?: { output?: number } };
};

function harness(
  entries: Entry[],
  statuses: string[],
): { pi: ExtensionAPI; handlers: Map<string, Handler>; ctx: ExtensionContext } {
  const handlers = new Map<string, Handler>();
  const pi = {
    registerCommand: () => {},
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    model: undefined,
    sessionManager: { getEntries: () => entries },
    ui: {
      theme: { fg: (_state: string, text: string) => text },
      setStatus: (_id: string, text: string | undefined) => {
        statuses.push(text ?? "");
      },
      setWidget: () => {},
      notify: () => {},
    },
  } as unknown as ExtensionContext;
  return { pi, handlers, ctx };
}

test("rate appears while generating and clears afterwards", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 });
  const entries: Entry[] = [];
  const statuses: string[] = [];
  const { pi, handlers, ctx } = harness(entries, statuses);

  extension(pi);
  await handlers.get("session_start")?.({}, ctx);
  statuses.length = 0;
  await handlers.get("agent_start")?.({}, ctx);

  entries.push({
    type: "message",
    message: { role: "assistant", usage: { output: 60 } },
  });
  t.mock.timers.tick(1000);
  assert.ok(
    !statuses.some((s) => s.includes("tok/s")),
    JSON.stringify(statuses),
  );

  entries.push({
    type: "message",
    message: { role: "assistant", usage: { output: 180 } },
  });
  t.mock.timers.tick(1000);
  assert.ok(
    statuses.some((s) => s.includes("⇣180 tok/s")),
    JSON.stringify(statuses),
  );

  await handlers.get("agent_end")?.({}, ctx);
  const last = statuses[statuses.length - 1] ?? "";
  assert.ok(!last.includes("tok/s"), last);

  // Timer is stopped: further output growth must not re-render.
  const count = statuses.length;
  entries.push({
    type: "message",
    message: { role: "assistant", usage: { output: 999 } },
  });
  t.mock.timers.tick(5000);
  assert.equal(statuses.length, count);

  await handlers.get("session_shutdown")?.({}, ctx);
});
