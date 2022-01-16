import { Plugin } from "../core/client.ts";
import { parseUserMask, Raw, UserMask } from "../core/parsers.ts";

export interface JoinEvent {
  /** User who sent the JOIN. */
  origin: UserMask;

  /** Channel joined by the user. */
  channel: string;
}

export type ChannelsDescription = [
  channel: string | [channel: string, key: string],
  ...channels: (string | [channel: string, key: string])[],
];

export interface JoinParams {
  commands: {
    /** Joins `channels` with optional keys.
     *
     *      client.join("#channel");
     *      client.join("#channel1", ["#channel2", "key"]); */
    join(...params: ChannelsDescription): void;
  };
  events: {
    "join": JoinEvent;
  };
}

export const joinPlugin: Plugin<JoinParams> = (client) => {
  const sendJoin = (...params: ChannelsDescription) => {
    const channels = [];
    const keys = [];

    for (const param of params) {
      if (typeof param === "string") {
        channels.push(param);
        keys.push("");
      } else {
        channels.push(param[0]);
        keys.push(param[1]);
      }
    }

    const commandParams = [channels.join(",")];

    if (keys.some((key) => key !== "")) {
      commandParams.push(keys.join(","));
    }

    client.send("JOIN", ...commandParams);
  };

  const emitJoin = (msg: Raw) => {
    if (msg.command !== "JOIN") {
      return;
    }

    const { prefix, params: [channel] } = msg;
    const origin = parseUserMask(prefix);

    client.emit("join", { origin, channel });
  };

  client.join = sendJoin;
  client.on("raw", emitJoin);
};
