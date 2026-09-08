import { pathToFileURL } from "node:url";

import type { Adapter, AdapterModule, Command, Context, Invocation } from "./contract.ts";

let adapter: Adapter;
let context: Context;
let module: AdapterModule;
process.on(
  "message",
  async (request: {
    id: string;
    operation: string;
    modulePath: string;
    context: Context;
    command: Command;
    invocation: Invocation;
    timeoutMs: number;
  }) => {
    const control = {
      signal: AbortSignal.timeout(request.timeoutMs),
      deadlineEpochMs: Date.now() + request.timeoutMs,
    };
    try {
      let value: unknown;
      switch (request.operation) {
        case "launch":
          context = request.context;
          module = await import(pathToFileURL(request.modulePath).href);
          adapter = module.create(context);
          value = await adapter.launch(control);
          break;
        case "perform":
          value = await adapter.perform(request.command, request.invocation, control);
          break;
        case "cleanup":
          module = await import(pathToFileURL(request.modulePath).href);
          value = await module.disposeOwned(request.context, control);
          break;
        default:
          throw new Error("Unknown worker operation");
      }
      process.send?.({ id: request.id, value });
    } catch (error) {
      process.send?.({ id: request.id, error: String(error) });
    }
  }
);
