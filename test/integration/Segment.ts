import { expect } from "chai";
import Redis = require("ioredis");
import { LeafSegment as sut } from "../../src/Segment";
import StringCmd from "../../src/StringCmd";

describe("Segment integration tests", () => {
  let randomKey: string,
    redis: Redis.Redis,
    one: { pipeline: sut<any, any>; result: { results: any[] } },
    two: { pipeline: sut<any, any>; result: { results: any[] } },
    three: { pipeline: sut<any, any>; result: { results: any[] } };

  before(() => {
    // tslint:disable-next-line: insecure-random
    randomKey = `segment-monoid-test:${Math.random() + "-" + Date.now()}`;
    redis = new Redis(process.env.TEST_REDIS_URL);

    one = {
      pipeline: sut.of(
        [
          StringCmd("SET", [randomKey, "hi"]),
          StringCmd("GET", [randomKey]),
          // test that command args still get flattened.
          StringCmd("MGET", [[randomKey]])
        ],
        results => [{ results }]
      ),
      result: { results: ["OK", "hi", ["hi"]] }
    };

    two = {
      pipeline: sut.of(
        [
          StringCmd("SET", [randomKey, "hi"]),
          StringCmd("GET", [randomKey]),
          StringCmd("SET", [randomKey, "hello"]),
          StringCmd("GET", [randomKey])
        ],
        results => [{ results }]
      ),
      result: { results: ["OK", "hi", "OK", "hello"] }
    };

    three = {
      pipeline: sut.of(
        [
          StringCmd("SET", [randomKey, "howdy yall"]),
          StringCmd("GET", [randomKey])
        ],
        results => [{ results }]
      ),
      result: { results: ["OK", "howdy yall"] }
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
