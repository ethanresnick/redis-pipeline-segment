import { ValueType, Command, Redis } from "ioredis";
import { segment as segmentList, tryPipeline } from "./utils";

export type RedisResult = ValueType | null;
type SegmentEmpty = Segment<unknown>;

// tslint:disable: max-classes-per-file
export abstract class Segment<Result, Arg extends RedisResult = RedisResult> {
  public abstract readonly commands: Command[];
  public abstract apply: (cmdResults: Arg[]) => Result[];

  public static empty: SegmentEmpty;

  // TODO: if needed for perf, consider specializing this when an arg is a
  // CombinedSegment to extract its `segments` and spread them into a new
  // CombinedSegment, rather than having the new Segment hold a reference to
  // the original: `new CombinedSegment([...this.segments, ...other.segments])`
  public append<T, U extends RedisResult>(
    segment: Segment<T, U>
  ): Segment<Result | T, Arg | U> {
    return new CombinedSegment([
      (this as unknown) as Segment<Result | T, Arg | U>,
      (segment as unknown) as Segment<Result | T, Arg | U>
    ]);
  }

  public static concat<R, A extends RedisResult>(
    segments: Segment<R, A>[]
  ): Segment<R, A> {
    return segments.reduce(
      (acc, it) => acc.append(it),
      (CombinedSegment.empty as unknown) as Segment<R, A>
    );
  }

  public map<B>(f: (res: Result[]) => B[]): Segment<B, Arg> {
    const origApply = this.apply.bind(this);
    const mappedClone: Segment<B, Arg> = <any>(
      this.append(CombinedSegment.empty)
    );
    mappedClone.apply = (results: Arg[]) => f(origApply(results));
    return mappedClone;
  }

  public async run(redis: Redis) {
    const redisPipeline = redis.pipeline();
    this.commands.forEach(it => {
      redisPipeline.sendCommand(it);
    });
    return this.apply(await tryPipeline<Arg[]>(redisPipeline));
  }
}

export class CombinedSegment<
  R,
  A extends RedisResult = RedisResult
> extends Segment<R, A> {
  public static empty: SegmentEmpty = new CombinedSegment([]);
  constructor(private readonly segments: Segment<R, A>[]) {
    super();
  }

  private _commands?: Command[];
  public get commands(): Command[] {
    return (
      this._commands ||
      (this._commands = this.segments.flatMap(it => it.commands))
    );
  }

  public apply = (cmdResults: A[]): R[] => {
    const segmentLengths = this.segments.map(it => it.commands.length);
    const segmentedCmdResults = segmentList(cmdResults, segmentLengths);

    return segmentedCmdResults.flatMap((results, i) =>
      this.segments[i].apply(results)
    );
  };
}

export class LeafSegment<
  R,
  A extends RedisResult = RedisResult
> extends Segment<R, A> {
  public static readonly empty: SegmentEmpty = CombinedSegment.empty;
  public static of<R, A extends RedisResult>(
    commands: Command[],
    apply: (results: A[]) => R[]
  ) {
    return new LeafSegment(commands, apply);
  }

  constructor(
    public readonly commands: Command[],
    public apply: (results: A[]) => R[]
  ) {
    super();
  }

  public map<B>(f: (res: R[]) => B[]): Segment<B, A> {
    return new LeafSegment(this.commands, (results: A[]) =>
      f(this.apply(results))
    );
  }
}
