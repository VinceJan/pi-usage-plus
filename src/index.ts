import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { loadConfig, type UsageConfig } from "./core/config.ts";
import type { UsageSnapshot } from "./core/types.ts";
import { ProviderUsageController } from "./modules/provider/controller.ts";
import { formatRate, RateTracker } from "./modules/rate/tracker.ts";
import { showDetails } from "./ui/details.ts";
import { compactSnapshot, snapshotLines } from "./ui/format.ts";
import { handleSettings } from "./settings.ts";

const STATUS_ID = "pi-usage";
const WIDGET_ID = "pi-usage-provider";

export default function (pi: ExtensionAPI) {
  let config: UsageConfig;
  let controller: ProviderUsageController;
  let timer: ReturnType<typeof setInterval> | undefined;
  let modelWatchTimer: ReturnType<typeof setInterval> | undefined;
  let lastContext: ExtensionContext | undefined;
  let observedModelKey: string | undefined;
  let renderGeneration = 0;
  let rateTimer: ReturnType<typeof setInterval> | undefined;
  let rateText: string | undefined;
  let lastSnapshot: UsageSnapshot | undefined;
  const rateTracker = new RateTracker();

  function modelKey(model: Model<Api> | undefined): string | undefined {
    return model ? `${model.provider}/${model.id}/${model.baseUrl}` : undefined;
  }

  function liveModel(ctx: ExtensionContext): Model<Api> | undefined {
    return ctx.model;
  }

  function statusText(current: UsageSnapshot | undefined): string {
    const base = compactSnapshot(current);
    return rateText && config.display.rate ? `${base} · ${rateText}` : base;
  }

  function renderRate(ctx: ExtensionContext): void {
    // Rate-only refresh: status line only, never touches the widget.
    if (!config.display.status) return;
    const current = controller.currentView(ctx, lastSnapshot);
    ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg(current?.state === "ok" ? "success" : current?.state === "stale" ? "warning" : "dim", statusText(current)));
  }

  function render(ctx: ExtensionContext, snapshot?: UsageSnapshot, model: Model<Api> | undefined = ctx.model): void {
    const current = controller.currentView(ctx, snapshot, model);
    lastSnapshot = snapshot;
    ctx.ui.setStatus(STATUS_ID, config.display.status ? ctx.ui.theme.fg(current?.state === "ok" ? "success" : current?.state === "stale" ? "warning" : "dim", statusText(current)) : undefined);
    ctx.ui.setWidget(WIDGET_ID, config.display.widget && current ? snapshotLines(current) : undefined, { placement: "belowEditor" });
  }

  async function refreshCurrent(ctx: ExtensionContext, force = false, model: Model<Api> | undefined = liveModel(ctx)): Promise<UsageSnapshot | undefined> {
    lastContext = ctx;
    const generation = ++renderGeneration;
    try {
      // If we already have a cached snapshot for this provider, render it immediately
      // with group recalculation so model switches are instant without flicker.
      const cached = model ? controller.cache.values().find((item) => item.sourceProviderId === model.provider) : undefined;
      render(ctx, cached, model);
      const snapshot = await controller.refreshCurrent(ctx, force, model);
      if (generation === renderGeneration) render(ctx, snapshot, model);
      return snapshot;
    } catch (error) {
      const fallback = model ? controller.cache.values().find((item) => item.sourceProviderId === model.provider) : undefined;
      if (generation === renderGeneration) render(ctx, fallback, model);
      return fallback;
    }
  }

  // Cumulative session output tokens from the public read-only session manager
  // (the same source zentui aggregates for its footer). No disk or network I/O.
  function sessionOutputTotal(ctx: ExtensionContext): number | undefined {
    let entries: ReturnType<ExtensionContext["sessionManager"]["getEntries"]>;
    try {
      entries = ctx.sessionManager.getEntries();
    } catch {
      return undefined;
    }
    let total = 0;
    let seen = false;
    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const message = entry.message;
      if (message?.role !== "assistant") continue;
      const output = message.usage?.output;
      if (typeof output === "number" && Number.isFinite(output) && output > 0) {
        total += output;
        seen = true;
      }
    }
    return seen ? total : undefined;
  }

  function stopRateSampler(renderAfter: ExtensionContext | undefined = lastContext): void {
    if (rateTimer) clearInterval(rateTimer);
    rateTimer = undefined;
    rateTracker.reset();
    if (rateText !== undefined) {
      rateText = undefined;
      if (renderAfter) render(renderAfter);
    }
  }

  function startRateSampler(ctx: ExtensionContext): void {
    stopRateSampler(undefined);
    rateTracker.reset();
    rateText = undefined;
    lastContext = ctx;
    rateTimer = setInterval(() => {
      if (!lastContext || !config.display.rate) return;
      const total = sessionOutputTotal(lastContext);
      if (total === undefined) return;
      const next = formatRate(rateTracker.sample(total));
      if (next === rateText) return;
      rateText = next;
      renderRate(lastContext);
    }, 1000);
    rateTimer.unref?.();
  }

  function startTimer(ctx: ExtensionContext): void {
    if (timer) clearInterval(timer);
    timer = setInterval(() => { if (lastContext) void refreshCurrent(lastContext); }, config.refresh.intervalSeconds * 1000);
    timer.unref?.();
    lastContext = ctx;
    observedModelKey = modelKey(liveModel(ctx));

    // pi-web versions can update ctx.model without reliably delivering model_select
    // to package extensions. This watcher performs no network I/O unless the model
    // identity actually changes, and keeps the footer honest during that gap.
    if (modelWatchTimer) clearInterval(modelWatchTimer);
    modelWatchTimer = setInterval(() => {
      if (!lastContext) return;
      const nextModel = liveModel(lastContext);
      const nextKey = modelKey(nextModel);
      if (nextKey === observedModelKey) return;
      observedModelKey = nextKey;
      void refreshCurrent(lastContext, false, nextModel);
    }, 750);
    modelWatchTimer.unref?.();
  }

  async function command(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const [action = config.display.detailsDefault, ...rest] = args.trim().split(/\s+/).filter(Boolean);
    if (action === "settings") {
      config = await handleSettings(rest.join(" "), ctx, config);
      controller.setConfig(config);
      if (!config.display.rate) stopRateSampler(ctx);
      startTimer(ctx);
      await refreshCurrent(ctx);
      return;
    }
    if (action === "doctor") {
      const current = await controller.refreshCurrent(ctx, false);
      const deepSeekAuth = ctx.modelRegistry.getProviderAuthStatus("deepseek");
      const lines = [
        `Model: ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "none"}`,
        `Provider base URL: ${ctx.model?.baseUrl ? new URL(ctx.model.baseUrl).origin : "not exposed by model"}`,
        `Current adapter: ${current?.adapterId ?? "none"}`,
        `Current state: ${current?.state ?? "unavailable"}`,
        `Current auth: ${current?.state === "unauthorized" ? "missing or rejected" : "resolved without displaying secret"}`,
        `DeepSeek auth: ${deepSeekAuth.configured ? `configured${deepSeekAuth.source ? ` (${deepSeekAuth.source})` : ""}` : "not configured"}`,
        `Hint: /usage current shows only ${ctx.model?.provider ?? "the active provider"}; use /usage all for DeepSeek plus other configured providers.`,
        ...(current?.error ? [`Problem: ${current.error}`] : []),
        ...(current?.state === "not-installed" ? ["Fix: install and enable pi-bridge on the CLIProxyAPI server."] : []),
      ];
      ctx.ui.notify(lines.join("\n"), current?.state === "ok" || current?.state === "stale" ? "info" : "warning");
      return;
    }
    if (action === "refresh") {
      const snapshot = await refreshCurrent(ctx, true);
      await showDetails(ctx, snapshot ? [controller.currentView(ctx, snapshot) ?? snapshot] : []);
      return;
    }
    if (action === "current") {
      const snapshot = await refreshCurrent(ctx);
      await showDetails(ctx, snapshot ? [controller.currentView(ctx, snapshot) ?? snapshot] : []);
      return;
    }
    const snapshots = await controller.refreshAll(ctx, false);
    await showDetails(ctx, snapshots);
  }

  pi.registerCommand("usage", { description: "Show provider balances and quota windows", handler: command });
  pi.registerCommand("quota", { description: "Alias for /usage", handler: command });

  pi.on("session_start", async (_event, ctx) => {
    config = await loadConfig();
    controller = new ProviderUsageController(config);
    stopRateSampler(undefined);
    startTimer(ctx);
    await refreshCurrent(ctx);
  });

  pi.on("agent_start", (_event, ctx) => {
    if (config.display.rate) startRateSampler(ctx);
  });
  pi.on("agent_end", (_event, ctx) => {
    stopRateSampler(ctx);
  });
  pi.on("agent_settled", (_event, ctx) => {
    stopRateSampler(ctx);
  });
  pi.on("model_select", async (event, ctx) => {
    observedModelKey = modelKey(event.model);
    const cached = event.model ? controller.cache.values().find((item) => item.sourceProviderId === event.model.provider) : undefined;
    render(ctx, cached, event.model);
    await refreshCurrent(ctx, false, event.model);
  });
  pi.on("session_shutdown", async () => {
    if (rateTimer) clearInterval(rateTimer);
    rateTimer = undefined;
    rateText = undefined;
    rateTracker.reset();
    if (timer) clearInterval(timer);
    if (timer) clearInterval(timer);
    if (modelWatchTimer) clearInterval(modelWatchTimer);
    timer = undefined;
    modelWatchTimer = undefined;
    observedModelKey = undefined;
    renderGeneration++;
    lastContext = undefined;
    controller?.cache.clear();
  });
}
