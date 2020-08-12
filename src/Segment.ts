import { Redis, type Pipeline } from "ioredis";
import type { Command, CommandReturn } from "./TypedCmd.js";
import { tryPipeline } from "./utils.js";

export type RedisResult = unknown;
export type Runner = (cmds: readonly Command<any>[]) => Promise<RedisResult[]>;

type RootHandler<T extends any[]> = {
  commands: readonly Command[];
  apply: (cmdResults: any) => T;
};

type ChildHandler<T extends any[]> = {
  parent: Segment<any[]>;
  continue(parentResults: any): Handler<T>;
};

type Handler<T extends any[]> = RootHandler<T> | ChildHandler<T>;

const isRootHandler = <T extends any[]>(it: Handler<T>): it is RootHandler<T> =>
  "commands" in it;

// tslint:disable-next-line: completed-docs
function transformRoot<T extends any[], U extends any[]>(
  handler: Handler<T>,
  f: (res: RootHandler<T>) => Handler<U>,
): Handler<U> {
  return isRootHandler(handler)
    ? f(handler)
    : {
        ...handler,
        continue: (parentRes) => transformRoot(handler.continue(parentRes), f),
      };
}

const mergeRootHandlers = <T extends any[], U extends any[]>(
  a: RootHandler<T>,
  b: RootHandler<U>,
): RootHandler<[...T, ...U]> => ({
  commands: [...a.commands, ...b.commands],
  apply: (cmdResults) => [
    ...a.apply(cmdResults.slice(0, a.commands.length)),
    ...b.apply(cmdResults.slice(a.commands.length)),
  ],
});

export class Segment<Results extends any[]> {
  public static readonly empty: Segment<never[]> = Segment.from([], () => []);
  private constructor(private readonly handler: Handler<Results>) {}

  public static from<
    // https://github.com/microsoft/TypeScript/issues/27179#issuecomment-422606990
    R extends any[] | [],
    C extends readonly Command[] | [],
    A extends {
      [P in keyof C]: C[P] extends Command<infer Name>
        ? CommandReturn<Name>
        : C[P];
    },
  >(commands: C, apply: (results: A) => R) {
    return new Segment({ commands, apply });
  }

  public append<T extends any[] | []>(segment: Segment<T>) {
    const thisHandler = this.handler;
    const segmentHandler = segment.handler;

    if (isRootHandler(thisHandler)) {
      if (isRootHandler(segmentHandler)) {
        return new Segment(mergeRootHandlers(thisHandler, segmentHandler));
      }

      return new Segment({
        parent: segmentHandler.parent,
        continue: (parentResults) =>
          transformRoot(segmentHandler.continue(parentResults), (it) =>
            mergeRootHandlers(thisHandler, it),
          ),
      });
    }

    if (isRootHandler(segmentHandler)) {
      return new Segment({
        parent: thisHandler.parent,
        continue: (parentResults) =>
          transformRoot(thisHandler.continue(parentResults), (it) =>
            mergeRootHandlers(it, segmentHandler),
          ),
      });
    }

    // Two Segments with dependendies.
    return new Segment({
      parent: thisHandler.parent,
      continue: (thisParentRes) => ({
        parent: segmentHandler.parent,
        continue: (segmentParentRes: any) =>
          transformRoot(
            thisHandler.continue(thisParentRes),
            (thisRootHandler) =>
              transformRoot(
                segmentHandler.continue(segmentParentRes),
                (segRootHandler) =>
                  mergeRootHandlers(thisRootHandler, segRootHandler),
              ),
          ),
      }),
    });
  }

  public static concat<R>(segments: Segment<R[]>[]) {
    return segments.reduce(
      (acc, it) => acc.append(it),
      Segment.empty as Segment<R[]>,
    );
  }

  public map<B extends any[] | []>(f: (res: Results) => B) {
    return new Segment(
      transformRoot(this.handler, (it) => ({
        ...it,
        apply: (res) => f(it.apply(res)),
      })),
    );
  }

  public continue<B extends any[] | []>(
    continuation: (res: Results) => Segment<B>,
  ) {
    return new Segment({
      parent: this,
      continue(thisRes: Results) {
        const newSeg = continuation(thisRes);
        return newSeg.handler;
      },
    });
  }

  public async run(runner: Redis | Runner) {
    return this.runHandler(runner, this.handler);
  }

  private async runHandler(
    runner: Redis | Runner,
    handler: Handler<Results>,
  ): Promise<Results> {
    if (isRootHandler(handler)) {
      const cmdResultsPromise =
        runner instanceof Redis
          ? Segment.runner(runner, handler.commands)
          : runner(handler.commands);

      return handler.apply(await cmdResultsPromise);
    }

    const parentRes: any = await handler.parent.run(runner);
    return this.runHandler(runner, handler.continue(parentRes));
  }

  private static async runner(redis: Redis, cmds: readonly Command[]) {
    if (!cmds.length) return [];

    const redisPipeline = redis.pipeline() as Pipeline;
    cmds.forEach((it) => {
      redisPipeline.sendCommand(it);
    });
    return tryPipeline(redisPipeline);
  }
}
