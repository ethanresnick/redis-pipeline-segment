import fc = require("fast-check");
import { Arbitrary } from "fast-check";
import chai from "chai";
import { Command } from "../../src/TypedCmd.js";
import { Segment, RedisResult } from "../../src/Segment.js";

const { expect } = chai;
// Disable below because I promise that creating these abitraries doesn't throw.
// tslint:disable mocha-no-side-effect-code

// Make a function that returns a list -- as LeafSegment.apply must -- and
// throws if it's called with different commands different times, because
// that's a convenient way to verify that, even as we combine LeafSegments into
// bigger Segments, the ultimate apply call splits the command results properly
// among the leafs.
const leafSegmentApply = fc
  .func(fc.array(fc.anything({ maxDepth: 2 })))
  .map((applyFn) => {
    let lastCallArgs: string;
    return (...args: any[]) => {
      const argsString = JSON.stringify(args);

      if (lastCallArgs && argsString !== lastCallArgs) {
        throw new Error(`Expected fn to always be called with same args.
        Previously called with: ${lastCallArgs};
        Now called with: ${argsString}
      `);
      } else if (lastCallArgs) {
        return applyFn();
      } else {
        lastCallArgs = argsString;
        return applyFn();
      }
    };
  });

// For perf, our fake commands don't follow the structure of real Commands,
// but they don't need to, since they shouldn't be inspected by this code. We
// give them _some_ data just in case we want to identify a command in a test.
const commandArb = fc.record({ id: fc.string() }) as any as Arbitrary<Command>;
const commandResultArb = fc.anything({ maxDepth: 1 }) as Arbitrary<RedisResult>;

const leafAndResultsArb = fc
  .tuple(fc.array(fc.tuple(commandArb, commandResultArb), 3), leafSegmentApply)
  .map(([commandsAndResults, fn]) => {
    const commands = commandsAndResults.map((it) => it[0]);
    const results = commandsAndResults.map((it) => it[1]);
    return <const>[Segment.from(commands, fn), results];
  });

const { combinedAndResultsArb: combinedAndResultsArb } = fc.letrec((tie) => ({
  combinedAndResultsArb: fc
    .array(
      fc.oneof(
        leafAndResultsArb,
        leafAndResultsArb,
        tie("combinedAndResultsArb") as Arbitrary<
          [Segment<unknown[]>, RedisResult[]]
        >,
      ),
      5,
    )
    .map((generated) => {
      const segments = generated.map((it) => it[0]);
      const results = generated.flatMap((it) => it[1]);
      return <const>[Segment.concat(segments), results];
    }),
}));

const segmentAndResults = fc.oneof(combinedAndResultsArb, leafAndResultsArb);
// tslint:enable mocha-no-side-effect-code

describe("Segment unit tests", () => {
  describe("as a monoid", () => {
    describe("empty (aka mempty)", () => {
      it("should be an identity element from POV of apply's result", async () =>
        fc.assert(
          fc.asyncProperty(segmentAndResults, async ([segment, results]) => {
            const runner = async () => results;
            const res = await segment.run(runner);
            const leftAppend = await Segment.empty.append(segment).run(runner);
            const rightAppend = await segment.append(Segment.empty).run(runner);
            expect(res).to.deep.eq(leftAppend);
            expect(leftAppend).to.deep.eq(rightAppend);
          }),
        ));
    });

    describe("append (aka mappend)", () => {
      it("should work by splitting cmd results and then appending apply results", async () =>
        fc.assert(
          fc.asyncProperty(
            segmentAndResults,
            segmentAndResults,
            async ([seg1, results1], [seg2, results2]) => {
              const seg1Applied = await seg1.run(async () => results1);
              const seg2Applied = await seg2.run(async () => results2);

              const joinedSegment = seg1.append(seg2);
              const joinedSegmentApplied = await joinedSegment.run(
                async (cmds) => {
                  return results1.concat(results2);
                },
              );

              expect(joinedSegmentApplied).to.deep.eq(
                seg1Applied.concat(seg2Applied),
              );
            },
          ),
        ));
    });
  });

  describe("as a functor", () => {
    it("should compose the results of apply when mapped", async () =>
      fc.assert(
        fc.asyncProperty(segmentAndResults, async ([segment, cmdResults]) => {
          const f = (...args: any[]) => ["applied f!", args];
          const runner = async () => cmdResults;

          const res = await segment.run(runner);
          const mappedRes = await segment.map(f).run(runner);
          expect(mappedRes).to.deep.eq(f(res));
        }),
      ));
  });
});
