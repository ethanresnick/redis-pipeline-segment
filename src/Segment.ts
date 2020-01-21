import { ValueType, Command, Redis } from "ioredis";
import { segment as segmentList, tryPipeline } from "./utils";

export type RedisResult = ValueType | null;

type UnionElems<A extends any[], B extends any[]> = (A[number] | B[number])[];
type SegmentEmpty = Segment<unknown[]>;

// tslint:disable: max-classes-per-file
export abstract class Segment<
  Result extends any[],
  Args extends RedisResult[] = RedisResult[]
> {
  public abstract readonly commands: Command[];
  public abstract apply: (cmdResults: Args) => Result;
  public static empty: SegmentEmpty;

  // TODO: if needed for perf, consider specializing this when an arg is a
  // CombinedSegment to extract its `segments` and spread them into a new
  // CombinedSegment, rather than having the new Segment hold a reference to
  // the original: `new CombinedSegment([...this.segments, ...other.segments])`
  public append<T extends any[], U extends RedisResult[]>(
    segment: Segment<T, U>
  ): Segment<UnionElems<Result, T>, UnionElems<Args, U>> {
    return new CombinedSegment([
      (this as unknown) as Segment<Result, UnionElems<Args, U>>,
      (segment as unknown) as Segment<T, UnionElems<Args, U>>
    ]);
  }

  public static concat<R extends any[], A extends RedisResult[]>(
    segments: Segment<R, A>[]
  ) {
    return segments.reduce((acc, it) => acc.append(it), CombinedSegment.empty);
  }

  public map<B extends any[]>(f: (res: Result) => B): Segment<B, Args> {
    const origApply = this.apply.bind(this);
    const mappedClone: Segment<B, Args> = <any>(
      this.append(CombinedSegment.empty)
    );
    mappedClone.apply = (results: Args) => f(origApply(results));
    return mappedClone;
  }

  public async run(redis: Redis) {
    const redisPipeline = redis.pipeline();
    this.commands.forEach(it => {
      redisPipeline.sendCommand(it);
    });
    return this.apply(await tryPipeline<Args>(redisPipeline));
  }
}

export class CombinedSegment<
  R extends any[],
  A extends RedisResult[] = RedisResult[]
> extends Segment<R, A> {
  public static empty: SegmentEmpty = new CombinedSegment([]);
  constructor(private readonly segments: Segment<unknown[]>[]) {
    super();
  }

  private _commands?: Command[];
  public get commands(): Command[] {
    return (
      this._commands ||
      (this._commands = this.segments.flatMap(it => it.commands))
    );
  }

  public apply = <T extends A>(cmdResults: T): R => {
    const segmentLengths = this.segments.map(it => it.commands.length);
    const segmentedCmdResults = segmentList(cmdResults, segmentLengths);

    // Typescript is rightly complaining here without the cast, since we're
    // totally just assuming that the result of mappending all the pipeline
    // segments, whose return types we weren't tracking, is the return type
    // that the user said this CombinedSegment should have (i.e., A).
    return segmentedCmdResults.flatMap((results, i) =>
      this.segments[i].apply(results)
    ) as R;
  };
}

export class LeafSegment<
  R extends any[],
  A extends RedisResult[] = RedisResult[]
> extends Segment<R, A> {
  public static readonly empty: SegmentEmpty = CombinedSegment.empty;
  constructor(
    public readonly commands: Command[],
    public apply: (results: A) => R
  ) {
    super();
  }

  public map<B extends any[]>(f: (res: R) => B): Segment<B, A> {
    return new LeafSegment(this.commands, (results: A) =>
      f(this.apply(results))
    );
  }
}
