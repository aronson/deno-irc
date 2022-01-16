import { assertEquals } from "../deps.ts";
import { describe } from "../testing/helpers.ts";
import { mock } from "../testing/mock.ts";
import { joinPlugin } from "./join.ts";
import { joinOnRegisterPlugin } from "./join_on_register.ts";
import { registerPlugin } from "./register.ts";

describe("plugins/join_on_register", (test) => {
  const plugins = [joinOnRegisterPlugin, joinPlugin, registerPlugin];

  test("join on RPL_WELCOME", async () => {
    const { client, server } = await mock(
      plugins,
      { channels: ["#channel1", "#channel2"] },
    );

    server.send(":serverhost 001 me :Welcome to the server");
    await client.once("register");
    const raw = server.receive();

    assertEquals(raw, ["JOIN #channel1,#channel2"]);
  });

  test("not join on RPL_WELCOME if disabled", async () => {
    const { client, server } = await mock(
      plugins,
      { channels: undefined },
    );

    server.send(":serverhost 001 me :Welcome to the server");
    await client.once("register");
    const raw = server.receive();

    assertEquals(raw, []);
  });
});
