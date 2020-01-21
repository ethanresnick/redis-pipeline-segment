import * as IORedis from "ioredis";
import { LeafSegment } from "./Segment";
declare module "ioredis" {
  interface Pipeline {
    sendCommand(it: IORedis.Command): IORedis.Pipeline;
  }
}

export default LeafSegment;
export { default as StringCmd } from "./StringCmd";
