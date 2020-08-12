import { Pipeline, Command as IoRedisCmd, Result, Redis } from "ioredis";

// Find all the command names by looking at the Commands object, but then, with
// the index signature below, filtering the list down to those commands that are
// usable in a Pipeline (which rules out, e.g., `*Stream` methods on the
// Commands object). Within the keys on the Commands type, remove the `*Buffer`
// methods, as our exported function always creates Command objects with utf-8
// reply-encoding. To remove the buffer-returning methods, we first filter out
// the callback form of each method (those that return void) and then filter out
// the buffer keys by return type. However, this ends up omitting some legal
// commands because of https://github.com/microsoft/TypeScript/issues/29732,
// so we have to add to it w/ a union type.
export type CommandName = {
  [K in keyof Pipeline]: K extends
    | "object"
    | "function"
    | "addBatch"
    | "call"
    | `${string}Buffer`
    ? never
    : Pipeline[K] extends (...args: any[]) => Result<any, { type: "pipeline" }>
    ? K
    : never;
}[keyof Pipeline];

export type Commands = {
  [K in CommandName]: {
    args: OptionalMembers<Parameters<Pipeline[K]>>;
    return: Awaited<ReturnType<Redis[K]>>;
  };
};

type OptionalMembers<Tuple extends [...any[]]> = {
  [Index in keyof Tuple]?: Tuple[Index];
};

export type CommandArgs<T extends keyof Commands> = Commands[T]["args"];
export type CommandReturn<T extends keyof Commands> = Commands[T]["return"];

// ioredis CommandOptions - replyEncoding, which we fix to utf8
export type CommandOpts = {
  errorStack?: Error;
  keyPrefix?: string;
  readOnly?: boolean;
};

const dummy = Symbol();
export type Command<T extends CommandName = CommandName> = IoRedisCmd & {
  [dummy]: Commands[T];
};

export default function TypedStringCmd<T extends keyof Commands>(
  name: T,
  args: CommandArgs<T>,
  opts?: CommandOpts,
) {
  return new IoRedisCmd(name, args as any, {
    ...opts,
    replyEncoding: "utf8",
  }) as Command<T>;
}
