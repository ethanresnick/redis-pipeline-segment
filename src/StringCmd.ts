import { ValueType, Command } from "ioredis";

// TODO: import from ioredis once this PR is merged:
// https://github.com/DefinitelyTyped/DefinitelyTyped/pull/41635/
interface CommandOptions {
  replyEncoding?: string | null;
  errorStack?: string;
  keyPrefix?: string;
}

export default (name: string, args: ValueType[], opts?: CommandOptions) =>
  new (Command as any)(name, args, { ...opts, replyEncoding: "utf8" });
