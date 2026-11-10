import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";

const DEFAULT_LOG_CHANNEL_ID = "1569557281266344116";

export const nineXCommands = [
  new SlashCommandBuilder()
    .setName("ninex")
    .setDescription("Gerencie a sala NineX do seu canal de voz")
    .addSubcommand((command) =>
      command.setName("link").setDescription("Criar ou obter o link da sala deste canal de voz")
    )
    .addSubcommand((command) =>
      command.setName("sala").setDescription("Mostrar o link da sala vinculada a este canal de voz")
    )
    .addSubcommand((command) =>
      command.setName("encerrar").setDescription("Encerrar a sala deste canal de voz")
    )
    .toJSON()
];

function cleanName(value) {
  return value.replace(/[\r\n`]/g, "").slice(0, 100);
}

export function startDiscordBot({
  token,
  guildId,
  logChannelId = DEFAULT_LOG_CHANNEL_ID,
  friendsUrl,
  ensureRoom,
  findRoom,
  endRoom
}) {
  if (!token) {
    console.info("Discord integration disabled; configure DISCORD_BOT_TOKEN to enable it.");
    return null;
  }
  if (!guildId || !/^\d{17,20}$/.test(guildId)) {
    throw new Error("DISCORD_GUILD_ID must be configured with the server ID when DISCORD_BOT_TOKEN is set.");
  }
  if (!/^\d{17,20}$/.test(logChannelId)) {
    throw new Error("DISCORD_LOG_CHANNEL_ID must be a valid Discord channel ID.");
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
  });

  async function sendLog({ title, description, color = 0xa24ce6, fields = [] }) {
    const channel = await client.channels.fetch(logChannelId);
    if (!channel?.isTextBased() || !("send" in channel)) {
      throw new Error(`Discord log channel ${logChannelId} is unavailable or is not a text channel.`);
    }
    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(description.slice(0, 4000))
      .setTimestamp();
    if (fields.length) embed.addFields(fields);
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  }

  async function report(log) {
    try {
      await sendLog(log);
    } catch (error) {
      console.error(`Discord log delivery failed: ${error.message}`);
    }
  }

  async function setVoiceStatus(channelId, status) {
    await client.rest.put(`/channels/${channelId}/voice-status`, {
      body: { status }
    });
  }

  async function handleCommand(interaction) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "ninex") return;
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      await interaction.reply({ content: "Entre em um canal de voz antes de usar este comando.", ephemeral: true });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "link") {
      const roomUrl = await announceJoin(voiceChannel);
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xa24ce6)
          .setTitle("Sua sala NineX")
          .setDescription(`A sala vinculada a **#${cleanName(voiceChannel.name)}** está pronta.`)
          .addFields({ name: "Link", value: roomUrl })
          .setTimestamp()],
        ephemeral: true
      });
      return;
    }

    const room = findRoom(voiceChannel.id);
    if (subcommand === "sala") {
      if (!room) {
        await interaction.reply({
          content: "Ainda não há uma sala vinculada. Use `/ninex link` para criar uma.",
          ephemeral: true
        });
        return;
      }
      const roomUrl = `${friendsUrl.replace(/\/+$/, "")}/watch/${room.slug}`;
      await interaction.reply({
        embeds: [new EmbedBuilder()
          .setColor(0xa24ce6)
          .setTitle("Sala vinculada")
          .setDescription(`Link da sala para **#${cleanName(voiceChannel.name)}**:`)
          .addFields({ name: "Link", value: roomUrl })
          .setTimestamp()],
        ephemeral: true
      });
      return;
    }

    if (subcommand === "encerrar") {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
        await interaction.reply({
          content: "Você precisa da permissão **Gerenciar canais** para encerrar esta sala.",
          ephemeral: true
        });
        return;
      }
      if (!room) {
        await interaction.reply({ content: "Não há uma sala vinculada a este canal de voz.", ephemeral: true });
        return;
      }
      await setVoiceStatus(voiceChannel.id, "");
      endRoom(room, "A sala vinculada foi encerrada por um moderador do Discord.");
      await report({
        title: "Sala encerrada pelo Discord",
        description: `A sala vinculada a **#${cleanName(voiceChannel.name)}** foi encerrada por **${cleanName(interaction.user.username)}**.`,
        color: 0x777b87
      });
      await interaction.reply({ content: "A sala NineX foi encerrada e o status do canal foi removido.", ephemeral: true });
    }
  }

  async function announceJoin(channel) {
    const { room, created } = ensureRoom(channel);
    const roomUrl = `${friendsUrl.replace(/\/+$/, "")}/watch/${room.slug}`;
    try {
      await setVoiceStatus(channel.id, roomUrl);
    } catch (error) {
      console.error(`Could not update Discord voice status for channel ${channel.id}: ${error.message}`);
      await report({
        title: "Falha ao atualizar status do canal",
        description: `Não foi possível atualizar o status de **#${cleanName(channel.name)}**. Verifique a permissão **Gerenciar canais** do bot.`,
        color: 0xe5a33d
      });
    }
    if (created) {
      await report({
        title: "Sala NineX criada",
        description: `Uma sala foi criada para o canal de voz **#${cleanName(channel.name)}**.`,
        fields: [{ name: "Link da sala", value: roomUrl }]
      });
    }
    return roomUrl;
  }

  async function handleVoiceStateUpdate(oldState, newState) {
    if (newState.guild.id !== guildId || oldState.channelId === newState.channelId) return;
    const member = newState.member || oldState.member;
    if (member?.user.bot) return;
    const user = cleanName(member?.displayName || member?.user.username || "Usuário");

    if (oldState.channel && oldState.channelId !== newState.channelId) {
      await report({
        title: "Saída do canal de voz",
        description: `**${user}** saiu de **#${cleanName(oldState.channel.name)}**.`,
        color: 0x777b87
      });
      if (oldState.channel.members.size === 0) {
        try {
          await setVoiceStatus(oldState.channel.id, "");
        } catch (error) {
          console.error(`Could not clear Discord voice status for channel ${oldState.channel.id}: ${error.message}`);
        }
      }
    }

    if (newState.channel && oldState.channelId !== newState.channelId) {
      const roomUrl = await announceJoin(newState.channel);
      await report({
        title: "Entrada no canal de voz",
        description: `**${user}** entrou em **#${cleanName(newState.channel.name)}**.`,
        fields: [{ name: "Sala NineX", value: roomUrl }]
      });
    }
  }

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    handleVoiceStateUpdate(oldState, newState).catch((error) => {
      console.error(`Discord voice synchronization failed: ${error.message}`);
    });
  });

  client.on(Events.InteractionCreate, (interaction) => {
    handleCommand(interaction).catch(async (error) => {
      console.error(`Discord command failed: ${error.message}`);
      const response = { content: "Não foi possível concluir o comando. Tente novamente.", ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response).catch((followUpError) => {
          console.error(`Could not report Discord command failure: ${followUpError.message}`);
        });
      } else {
        await interaction.reply(response).catch((replyError) => {
          console.error(`Could not report Discord command failure: ${replyError.message}`);
        });
      }
    });
  });

  client.once(Events.ClientReady, async (readyClient) => {
    console.info(`Discord bot connected as ${readyClient.user.tag}.`);
    const guild = readyClient.guilds.cache.get(guildId);
    if (!guild) {
      console.error(`Discord bot is not connected to configured guild ${guildId}.`);
      return;
    }
    const activeVoiceChannels = guild.channels.cache.filter((channel) =>
      channel.isVoiceBased() && channel.members.size > 0
    );
    for (const channel of activeVoiceChannels.values()) {
      try {
        const roomUrl = await announceJoin(channel);
        await report({
          title: "Sincronização restaurada",
          description: `A sala NineX foi vinculada novamente ao canal de voz **#${cleanName(channel.name)}**.`,
          fields: [{ name: "Sala NineX", value: roomUrl }],
          color: 0x777b87
        });
      } catch (error) {
        console.error(`Could not restore Discord voice channel ${channel.id}: ${error.message}`);
      }
    }
  });

  client.login(token).catch((error) => {
    console.error(`Discord bot login failed: ${error.message}`);
  });
  return client;
}
