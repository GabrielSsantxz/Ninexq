import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { REST, Routes } from "discord.js";
import { nineXCommands } from "./bot.js";

dotenv.config({ path: fileURLToPath(new URL("./.env", import.meta.url)) });

const token = process.env.DISCORD_BOT_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
  throw new Error("Configure DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID e DISCORD_GUILD_ID no .env.");
}
if (!/^\d{17,20}$/.test(clientId) || !/^\d{17,20}$/.test(guildId)) {
  throw new Error("DISCORD_CLIENT_ID e DISCORD_GUILD_ID devem ser IDs Discord válidos.");
}

const rest = new REST({ version: "10" }).setToken(token);
await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: nineXCommands });
console.info("Comandos /ninex registrados no servidor Discord configurado.");
