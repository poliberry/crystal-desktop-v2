---
title: Voice, soundboard and presence
topic: bots
kind: guide
section: Building
order: 270
summary: Join a voice channel, speak, press soundboard clips, and show what the bot is doing.
---

## Voice: audio and the soundboard only

A bot can join a voice channel, **speak** (play audio) and **press soundboard clips**, just like a member. It can **not** share a screen, a camera or a stream. The voice token Crystal hands a bot only allows a microphone, so the server refuses anything else whatever the code tries, and the Bot API rejects a `streaming` voice state.

Joining needs the **Join voice channels** permission, and LiveKit's Node client, which is optional so bots that don't use voice don't carry it:

~~~sh
npm install @livekit/rtc-node
~~~

~~~ts bot
import { Client, readWav } from "@crystal/bot";
import { readFile } from "node:fs/promises";

const client = new Client();

client.command("join", async (interaction) => {
  const community = interaction.community;
  if (!community) return;
  const channels = await community.channels.fetch();
  const lounge = channels.find((c) => c.isVoice && c.name === "lounge");
  if (!lounge) return void (await interaction.reply("There's no voice channel called lounge."));

  const voice = await lounge.join(); // a VoiceConnection
  await interaction.reply("Joined " + lounge);

  // Speak: play a WAV file (any sample rate or channel count; it's converted).
  await voice.play(readWav(await readFile("./greeting.wav")));

  // Press a soundboard clip, as a person does. Everyone in the channel hears it.
  const clip = (await community.sounds.fetch()).first();
  await voice.playSound(clip ?? "chime"); // one of the community's own clips, or a built-in
});

client.command("leave", async (interaction) => {
  // Connections are kept by channel id; leave the ones in this community.
  for (const [channelId, connection] of client.voice) {
    if (client.channels.get(channelId)?.communityId === interaction.community?.id) await connection.disconnect();
  }
  await interaction.reply("Bye!");
});
~~~

| Call | What it does |
| --- | --- |
| `channel.join()` | Joins and returns a `VoiceConnection`. Needs Join voice channels. |
| `voice.play(audio)` | Plays PCM audio (`readWav(bytes)` makes one from a WAV file). Resolves when it ends. |
| `voice.stop()` | Stops what's playing. |
| `voice.playSound(sound)` | Presses a soundboard clip: a `Sound` from `community.sounds.fetch()`, or a built-in name. |
| `voice.setState({ muted, deafened })` | Shows the bot as muted or deafened in the member list. |
| `voice.disconnect()` | Leaves. |
| `channel.fetchVoiceParticipants()` | Who is in the channel, and whether they're muted. |
| `client.voice` | The bot's open connections, by channel id. |

The built-in sounds are `ping`, `boop`, `pop`, `chime`, `buzz`, `zap`, `horn` and `drumroll`. A community's own clips come from `community.sounds.fetch()`.

Joining makes a real voice session. Uninstalling a bot removes it from any room it's in, and a bot that isn't connected isn't left showing in a channel.

### Voice moderation

With the matching permissions a bot can also move people about: `PATCH /channels/:channelId/voice/members/:userId` server-mutes or server-deafens a member, and `DELETE` on the same path disconnects them. These need **Mute members in voice**, **Deafen members in voice** or **Disconnect members from voice**, and the target must be below the bot's role. See the [API reference](doc:bots/api).

## Presence

A bot shows as online with a status, activities and a line of text under its name.

~~~ts bot
import { ActivityType, Client } from "@crystal/bot";

const client = new Client({
  // Shown as soon as the bot logs in.
  presence: { status: "online", activities: [{ type: ActivityType.Playing, name: "with Crystal" }] },
});

await client.login();

// Change it any time. What you leave out stays as it was.
await client.setPresence({ status: "idle", customStatus: "Back in five minutes" });
await client.setPresence({ activities: [{ type: ActivityType.Listening, name: "your commands", details: "v1.2" }] });
~~~

- Status is `online`, `idle`, `dnd` or `invisible`.
- Up to three activities of type `playing`, `listening`, `watching` or `streaming`; `streaming` is just a label, not a video stream. The custom status is up to 128 characters; pass `null` to clear it.
- The SDK keeps the bot online by telling Crystal every 30 seconds that it's alive (`keepAlive`). Stop the program and it shows as offline shortly after.
- `user.fetchPresence()` reads someone's status and activities, and needs **See the member list**.
