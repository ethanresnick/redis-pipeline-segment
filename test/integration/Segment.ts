import chai from "chai";
import { Redis } from "ioredis";
import { Segment as sut } from "../../src/Segment.js";
import StringCmd from "../../src/TypedCmd.js";

const { expect } = chai;
describe("Segment integration tests", () => {
  let randomKey: string,
    redis: Redis,
    one: { pipeline: sut<any>; result: { results: any[] } },
    two: { pipeline: sut<any>; result: { results: any[] } },
    three: { pipeline: sut<any>; result: { results: any[] } };

  before(() => {
    // tslint:disable-next-line: insecure-random
    randomKey = `segment-monoid-test:${Math.random() + "-" + Date.now()}`;
    redis = new Redis(process.env.TEST_REDIS_URL!);

    one = {
      pipeline: sut.from(
        [
          StringCmd("set", [randomKey, "hi"]),
          StringCmd("get", [randomKey]),
          // test that command args still get flattened.
          StringCmd("mget", [[randomKey]]),
        ],
        (results) => [{ results }],
      ),
      result: { results: ["OK", "hi", ["hi"]] },
    };

    two = {
      pipeline: sut.from(
        [
          StringCmd("set", [randomKey, "hi"]),
          StringCmd("get", [randomKey]),
          StringCmd("set", [randomKey, "hello"]),
          StringCmd("get", [randomKey]),
        ],
        (results) => [{ results }],
      ),
      result: { results: ["OK", "hi", "OK", "hello"] },
    };

    three = {
      pipeline: sut.from(
        [
          StringCmd("set", [randomKey, "howdy yall"]),
          StringCmd("get", [randomKey]),
        ],
        (results) => [{ results }],
      ),
      result: { results: ["OK", "howdy yall"] },
    };
  });

  after(() => {
    redis.disconnect();
  });

  it("should run provided commands", async () => {
    expect(await one.pipeline.run(redis)).to.deep.eq([one.result]);
    expect(await two.pipeline.run(redis)).to.deep.eq([two.result]);
    expect(await three.pipeline.run(redis)).to.deep.eq([three.result]);
  });
});
