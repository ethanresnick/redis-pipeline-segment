import { Pipeline as IORedisPipeline, ValueType } from "ioredis";

// Simpler version of lodash's unzip, just for pairs
export const unzip2 = <T, U>(data: [T, U][]): [T[], U[]] => [
  data.map(it => it[0]),
  data.map(it => it[1])
];

export const segment = <T>(arr: T[], lengths: number[]) =>
  lengths.reduce(
    (acc, toTake) => {
      acc[0].push(acc[1].splice(0, toTake));
      return acc;
    },
    [[], arr.slice()] as [T[][], T[]]
  )[0];

/**
 * A helper that runs a redis pipeline and returns a promise that rejects
 * if any of the redis commands errored, and otherwise resolves with an array
 * of command results.
 */
export async function tryPipeline<T extends (ValueType | null)[]>(
  pipeline: IORedisPipeline
) {
  const pipelineResponse = await pipeline.exec();
  const [errorsOrNulls, results] = unzip2(pipelineResponse);
  const errors = errorsOrNulls.filter(isErorr);

  if (errors.length) {
    throw errors[0];
  }

  return results as T;
}

const isErorr = (it: any): it is Error => it instanceof Error;
